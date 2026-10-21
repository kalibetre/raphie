/** Serializes model capture/admission with the final provider busy check and write. */
export class ModelConnectionGate {
  private tail: Promise<void> = Promise.resolve();

  async run<A>(operation: () => Promise<A>): Promise<A> {
    const previous = this.tail;
    const released = Promise.withResolvers<void>();
    this.tail = released.promise;
    await previous;
    try {
      return await operation();
    } finally {
      released.resolve();
    }
  }
}
