import type { AskAnswer, AskStatus, Channel } from "@raphie/contracts";

/** Answering a bot's question, for the routes that take the owner's answer. */
export type AskCommands = {
  answer(
    id: string,
    answer: AskAnswer,
    actor: string,
    via: Channel,
    app?: "desktop",
  ): Promise<AskStatus>;
};
