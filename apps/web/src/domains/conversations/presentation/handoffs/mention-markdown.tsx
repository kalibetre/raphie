import { GraduationCap } from "lucide-react";
import type { Components } from "react-markdown";

import { BotAvatar } from "../../../settings/presentation/bot-avatar";
import { useBotStyle } from "../../../settings/presentation/bot-tones";
import { splitMentions } from "../../application/mentions";
import { leadingSkill } from "../../application/slash";
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

const SKILL = "#skill-";

/**
 * A remark plugin: a message that starts with "/name" for one of the bot's
 * skills shows that as a chip, as the runtime read it.
 */
export function remarkSkills(skills: readonly string[]) {
  return () => (tree: Node) => {
    const first = tree.children?.[0];
    const text = first?.type === "paragraph" ? first.children?.[0] : undefined;
    if (!first?.children || text?.type !== "text") return;
    const found = leadingSkill(text.value ?? "", skills);
    if (!found) return;
    first.children.splice(
      0,
      1,
      {
        type: "link",
        url: `${SKILL}${found.name}`,
        children: [{ type: "text", value: found.typed }],
      },
      { type: "text", value: found.rest },
    );
  };
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
      if (href?.startsWith(SKILL))
        return (
          <span className="skill-chip" title="Skill">
            <GraduationCap aria-hidden="true" />
            {href.slice(SKILL.length)}
          </span>
        );
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
