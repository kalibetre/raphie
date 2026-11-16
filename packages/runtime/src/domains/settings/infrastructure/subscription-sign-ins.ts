import type {
  AuthEvent,
  AuthPrompt,
  OAuthAuth,
  OAuthCredential,
} from "@earendil-works/pi-ai";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import type { Provider } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import type {
  ProviderSignIn,
  SignInEvent,
  SignInPrompt,
} from "@raphie/contracts";

import { InputError } from "../../../shared/application/input-error.ts";
import { registerRedactionSecret } from "../../activity/infrastructure/pi-activity-journal.ts";

/**
 * A subscription Raphie lets the owner sign in to. Pi provides the sign-in,
 * refresh and models; this list only decides which of Pi's providers are
 * offered, so each is enabled deliberately. Adding one is an entry here.
 */
export type SubscriptionProvider = {
  /** Pi's provider id, also the connection's `provider`. */
  id: string;
  /** Pi's provider, holding `auth.oauth` and the models. */
  create: () => Provider;
};

// Pi loads each sign-in flow by a module name built at run time, which
// `bun build --compile` cannot follow: the release binaries would have no
// flow to run. Registering the flows here bundles them, and is harmless when
// running from source.
registerBunOAuthFlows();

export const subscriptionProviders: SubscriptionProvider[] = [
  // Sign in with ChatGPT. Its browser sign-in returns to 127.0.0.1:1455 on
  // the host; from another machine the owner pastes that address back.
  { id: "openai", create: openaiProvider },
];

/** How long an unfinished sign-in waits before it is abandoned. */
const SIGN_IN_TIMEOUT_MS = 15 * 60 * 1000;

/** How long a finished sign-in stays readable for the client to see it. */
const KEEP_FINISHED_MS = 5 * 60 * 1000;

/**
 * Sign-ins running anywhere in this process. OpenAI's browser sign-in needs
 * a fixed local port, so two at once (even for two bots) would collide.
 */
let running: string | undefined;

type Session = ProviderSignIn & {
  controller: AbortController;
  /** Settles the pending prompt. */
  answer?: (value: string) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** What a finished sign-in hands back to be saved. */
export type SignedIn = {
  provider: string;
  name: string;
  connectionId?: string;
  credential: OAuthCredential;
};

/**
 * Subscription sign-ins for one bot's settings. Each runs Pi's provider
 * `login` and turns its prompts and events into state a client reads by
 * polling, so the owner can finish it from any device.
 */
export class SubscriptionSignIns {
  private sessions = new Map<string, Session>();
  private providers = new Map<string, Provider>();
  private catalog: SubscriptionProvider[];
  private deviceId: () => string;

  constructor(options: {
    providers?: SubscriptionProvider[];
    /** A stable id for this installation, which some sign-ins send. */
    deviceId: () => string;
  }) {
    this.catalog = options.providers ?? subscriptionProviders;
    this.deviceId = options.deviceId;
  }

  /** Pi's provider for `id`, made once. */
  provider(id: string) {
    const known = this.catalog.find((p) => p.id === id);
    if (!known) return undefined;
    let provider = this.providers.get(id);
    if (!provider) {
      provider = known.create();
      this.providers.set(id, provider);
    }
    return provider;
  }

  /** Pi's sign-in for `id`, when it is an offered subscription. */
  oauth(id: string): OAuthAuth | undefined {
    return this.provider(id)?.auth.oauth;
  }

  /** The offered subscriptions, for the providers list. */
  offered() {
    return this.catalog.flatMap((entry) => {
      const provider = this.provider(entry.id);
      const oauth = provider?.auth.oauth;
      if (!provider || !oauth) return [];
      return [
        {
          id: provider.id,
          name: provider.name,
          signInLabel: oauth.loginLabel ?? `Sign in to ${oauth.name}`,
        },
      ];
    });
  }

  /**
   * Starts a sign-in. `save` stores the credential once Pi has it and
   * returns the connection it went to.
   */
  start(
    input: { provider: string; name: string; connectionId?: string },
    save: (signedIn: SignedIn) => Promise<string>,
  ): ProviderSignIn {
    const oauth = this.oauth(input.provider);
    if (!oauth) throw new InputError("Choose an available subscription.");
    if (running)
      throw new InputError(
        "Another sign-in is in progress. Finish or cancel it first.",
        409,
      );
    const id = crypto.randomUUID();
    const controller = new AbortController();
    const session: Session = {
      id,
      provider: input.provider,
      name: input.name,
      status: "waiting",
      events: [],
      controller,
      timer: setTimeout(() => this.cancel(id), SIGN_IN_TIMEOUT_MS),
    };
    this.sessions.set(id, session);
    running = id;
    void this.run(session, oauth, input, save);
    return this.view(session);
  }

  private async run(
    session: Session,
    oauth: OAuthAuth,
    input: { provider: string; name: string; connectionId?: string },
    save: (signedIn: SignedIn) => Promise<string>,
  ) {
    try {
      const credential = await oauth.login(
        {
          signal: session.controller.signal,
          notify: (event) => this.notify(session, event),
          prompt: (prompt) => this.ask(session, prompt),
        },
        { getDeviceId: this.deviceId, agentName: "Raphie" },
      );
      for (const secret of [credential.access, credential.refresh])
        registerRedactionSecret(secret);
      session.connectionId = await save({ ...input, credential });
      session.status = "connected";
    } catch (error) {
      if (session.status === "waiting") {
        session.status = session.controller.signal.aborted
          ? "cancelled"
          : "failed";
        if (session.status === "failed") {
          session.error =
            error instanceof InputError
              ? error.message
              : "Sign-in did not finish. Try again.";
          // The owner sees the short message; the log keeps the reason.
          console.error(
            `Sign-in to ${input.provider} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } finally {
      session.prompt = undefined;
      session.answer = undefined;
      clearTimeout(session.timer);
      if (running === session.id) running = undefined;
      // Readable for a while, so the client sees how it ended.
      setTimeout(
        () => this.sessions.delete(session.id),
        KEEP_FINISHED_MS,
      ).unref?.();
    }
  }

  private notify(session: Session, event: AuthEvent) {
    const shown: SignInEvent | undefined =
      event.type === "auth_url"
        ? { type: "auth_url", url: event.url, instructions: event.instructions }
        : event.type === "device_code"
          ? {
              type: "device_code",
              userCode: event.userCode,
              verificationUri: event.verificationUri,
              expiresInSeconds: event.expiresInSeconds,
            }
          : { type: event.type, message: event.message };
    session.events.push(shown);
  }

  private ask(session: Session, prompt: AuthPrompt) {
    return new Promise<string>((resolve, reject) => {
      const asked: SignInPrompt = {
        id: crypto.randomUUID(),
        type: prompt.type,
        message: prompt.message,
        ...("placeholder" in prompt && prompt.placeholder
          ? { placeholder: prompt.placeholder }
          : {}),
        ...(prompt.type === "select"
          ? { options: prompt.options.map((o) => ({ ...o })) }
          : {}),
      };
      session.prompt = asked;
      // A prompt Pi withdraws (a callback arrived) or a cancelled sign-in
      // rejects; Pi expects that.
      const abort = () => reject(new Error("Sign-in cancelled."));
      prompt.signal?.addEventListener("abort", abort, { once: true });
      session.controller.signal.addEventListener("abort", abort, {
        once: true,
      });
      session.answer = (value) => {
        if (session.prompt?.id === asked.id) session.prompt = undefined;
        resolve(value);
      };
      prompt.signal?.addEventListener(
        "abort",
        () => {
          if (session.prompt?.id === asked.id) session.prompt = undefined;
        },
        { once: true },
      );
    });
  }

  read(id: string): ProviderSignIn {
    const session = this.sessions.get(id);
    if (!session) throw new InputError("Sign-in not found.", 404);
    return this.view(session);
  }

  /** Answers the pending prompt `promptId` with `value`. */
  answer(id: string, promptId: string, value: string): ProviderSignIn {
    const session = this.sessions.get(id);
    if (!session) throw new InputError("Sign-in not found.", 404);
    if (session.status !== "waiting" || session.prompt?.id !== promptId)
      throw new InputError("That question is no longer asked.", 409);
    // Pasted codes and redirect addresses are secrets.
    registerRedactionSecret(value);
    const answer = session.answer;
    session.answer = undefined;
    answer?.(value);
    return this.view(session);
  }

  cancel(id: string): ProviderSignIn {
    const session = this.sessions.get(id);
    if (!session) throw new InputError("Sign-in not found.", 404);
    if (session.status === "waiting") {
      session.status = "cancelled";
      session.controller.abort();
    }
    return this.view(session);
  }

  /** Stops every sign-in, as the settings close. */
  close() {
    for (const session of this.sessions.values()) {
      if (session.status === "waiting") {
        session.status = "cancelled";
        session.controller.abort();
      }
      clearTimeout(session.timer);
    }
    this.sessions.clear();
  }

  private view(session: Session): ProviderSignIn {
    return {
      id: session.id,
      provider: session.provider,
      name: session.name,
      status: session.status,
      events: session.events.map((e) => ({ ...e })),
      ...(session.prompt ? { prompt: { ...session.prompt } } : {}),
      ...(session.error ? { error: session.error } : {}),
      ...(session.connectionId ? { connectionId: session.connectionId } : {}),
    };
  }
}
