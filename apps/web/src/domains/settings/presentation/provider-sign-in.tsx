import type {
  ProviderSignIn,
  SignInEvent,
  SignInPrompt,
} from "@raphie/contracts";
import { ExternalLink, LoaderCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";

/**
 * A subscription sign-in in progress: whatever the provider reports (a page
 * to open, a code to enter, progress) and whatever it asks. Generic, so
 * every provider's sign-in reads the same way.
 */
export function ProviderSignInSteps({
  signIn,
  answering,
  onAnswer,
}: {
  signIn: ProviderSignIn;
  answering: boolean;
  onAnswer: (promptId: string, value: string) => void;
}) {
  const link = signIn.events.findLast((e) => e.type === "auth_url");
  const code = signIn.events.findLast((e) => e.type === "device_code");
  const notes = signIn.events.filter(
    (e): e is Extract<SignInEvent, { message: string }> =>
      e.type === "progress" || e.type === "info",
  );
  return (
    <div className="sign-in-steps" aria-live="polite">
      {link && (
        <div className="sign-in-step">
          <p>
            Open the sign-in page and sign in. When it sends you back and the
            page doesn’t load, which happens when Raphie runs on another
            computer, copy that page’s address and paste it below.
          </p>
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <a href={link.url} target="_blank" rel="noopener noreferrer" />
            }
          >
            <ExternalLink />
            Open the sign-in page
          </Button>
        </div>
      )}
      {code && (
        <div className="sign-in-step">
          <p>Enter this code on the page that opens:</p>
          <code className="sign-in-code">{code.userCode}</code>
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <a
                href={code.verificationUri}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            <ExternalLink />
            Open {new URL(code.verificationUri).host}
          </Button>
        </div>
      )}
      {notes.slice(-1).map((note) => (
        <p key={note.message} className="sign-in-note">
          <LoaderCircle size={12} className="animate-spin" />
          {note.message}
        </p>
      ))}
      {signIn.prompt && (
        <SignInQuestion
          key={signIn.prompt.id}
          prompt={signIn.prompt}
          busy={answering}
          onAnswer={(value) => onAnswer(signIn.prompt!.id, value)}
        />
      )}
      {!signIn.prompt && !link && !code && !notes.length && (
        <p className="sign-in-note">
          <LoaderCircle size={12} className="animate-spin" />
          Starting sign-in…
        </p>
      )}
    </div>
  );
}

/** One question from the provider's sign-in. */
function SignInQuestion({
  prompt,
  busy,
  onAnswer,
}: {
  prompt: SignInPrompt;
  busy: boolean;
  onAnswer: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  if (prompt.type === "select")
    return (
      <div className="sign-in-step" role="group" aria-label={prompt.message}>
        <p>{prompt.message}</p>
        <div className="sign-in-options">
          {prompt.options?.map((option) => (
            <Button
              key={option.id}
              variant="outline"
              type="button"
              disabled={busy}
              title={option.description}
              onClick={() => onAnswer(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
    );
  return (
    <div className="sign-in-step">
      <label htmlFor={`sign-in-${prompt.id}`}>{prompt.message}</label>
      <div className="sign-in-answer">
        <Input
          id={`sign-in-${prompt.id}`}
          // Pasted addresses and codes are secret; keep them out of view.
          type={prompt.type === "text" ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={prompt.placeholder}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && value.trim()) {
              event.preventDefault();
              onAnswer(value.trim());
            }
          }}
        />
        <Button
          type="button"
          disabled={busy || !value.trim()}
          onClick={() => onAnswer(value.trim())}
        >
          {busy ? "Sending…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}
