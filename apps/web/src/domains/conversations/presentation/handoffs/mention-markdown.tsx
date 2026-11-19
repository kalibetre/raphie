import type { Components } from "react-markdown";

import { BotAvatar } from "../../../settings/presentation/bot-avatar";
import { useBotStyle } from "../../../settings/presentation/bot-tones";
import { splitMentions } from "../../application/mentions";
import { markdownComponents } from "../markdown-components";
import { useOpenSession } from "./handoff-cards";

type Bot = { id: string; name: string };

type Node = {
  type: string;
  value?: string;
  url?: string;
  children?: Node[];
};

const PREFIX = "#mention-";

/** Code and existing links keep their text as written. */
const literal = new Set(["link", "linkReference", "inlineCode", "code"]);

function mark(node: Node, bots: readonly Bot[]) {
  if (!node.children || literal.has(node.type)) return;
  node.children = node.children.flatMap((child): Node[] => {
    if (child.type !== "text") {
      mark(child, bots);
      return [child];
    }
    return splitMentions(child.value ?? "", bots).map((part) =>
      typeof part === "string"
        ? { type: "text", value: part }
        : {
            type: "link",
            url: `${PREFIX}${part.bot.id}`,
            children: [{ type: "text", value: part.text }],
          },
    );
  });
}

/** A remark plugin: "@Name" for a known bot becomes a link the chip renders. */
export function remarkMentions(bots: readonly Bot[]) {
  return () => (tree: Node) => mark(tree, bots);
}

function MentionChip({ bot }: { bot: Bot }) {
  const open = useOpenSession();
  const botStyle = useBotStyle();
  return (
    <button
      type="button"
      className="mention-chip"
      style={botStyle(bot.id)}
      title={`Open ${bot.name}`}
      onClick={() => void open(bot.id)}
    >
      <BotAvatar id={bot.id} />
      {bot.name}
    </button>
  );
}

/** Markdown components that show a mention as the bot it names. */
export function mentionComponents(bots: readonly Bot[]): Components {
  return {
    ...markdownComponents,
    a: ({ href, children, node: _node, ...props }) => {
      const bot = href?.startsWith(PREFIX)
        ? bots.find((item) => item.id === href.slice(PREFIX.length))
        : undefined;
      return bot ? (
        <MentionChip bot={bot} />
      ) : (
        <a href={href} {...props}>
          {children}
        </a>
      );
    },
  };
}
