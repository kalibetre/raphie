import type { AskAnswer, AskStatus, Channel } from "@raphie/contracts";

/** Who pressed a button in a chat, as the bridge verified it. */
export type ChannelSender = {
  threadId: string;
  connectionId: string;
  userId: string;
};

/** Answering a bot's question, for the routes and chats that take the answer. */
export type AskCommands = {
  answer(
    id: string,
    answer: AskAnswer,
    actor: string,
    via: Channel,
    app?: "desktop",
    from?: ChannelSender,
  ): Promise<AskStatus>;
};
