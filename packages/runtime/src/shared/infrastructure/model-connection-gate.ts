import { InputError } from "../application/input-error.ts";

/** Serializes configuration and admission; retirement fences all queued work. */
export class ModelConnectionGate {
  private tail: Promise<void> = Promise.resolve();
  private retired = false;

  retire() {
    this.retired = true;
  }

  async run<A>(operation: () => Promise<A>): Promise<A> {
    const previous = this.tail;
    const released = Promise.withResolvers<void>();
    this.tail = released.promise;
    await previous;
    try {
      if (this.retired) throw new InputError("Bot is being deleted.", 410);
      return await operation();
    } finally {
      released.resolve();
    }
  }
}
