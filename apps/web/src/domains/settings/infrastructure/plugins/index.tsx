import { Gauge } from "lucide-react";
import { Component, type ComponentType, type ReactNode } from "react";

import {
  formatCost,
  formatTokens,
} from "../../../conversations/application/run-projection";

export type ComposerContext = {
  draft: string;
  model: string | null;
  // Provider-reported usage for the open conversation, when there is one.
  usage?: { tokens: number; cost: number };
};

export type UiPlugin = {
  id: string;
  version: string;
  hostApiVersion: 1;
  name: string;
  description: string;
  slots: { "composer.footer"?: ComponentType<ComposerContext> };
};

const tokenCounter: UiPlugin = {
  id: "raphie.token-counter",
  version: "0.1.0",
  hostApiVersion: 1,
  name: "Token counter",
  description:
    "Rough token estimate for your draft, plus the provider-reported tokens and cost of the open conversation.",
  slots: {
    "composer.footer": ({ draft, usage }) => (
      <span
        className="composer-chip"
        title={`Draft: rough estimate, one token per four characters.${usage ? `\nConversation: ${usage.tokens.toLocaleString()} tokens, ${formatCost(usage.cost)}, provider-reported.` : ""}`}
      >
        <Gauge size={13} />~
        {formatTokens(Math.ceil(Array.from(draft).length / 4))}
        {usage && (
          <span className="composer-chip-muted">
            · {formatTokens(usage.tokens)} used · {formatCost(usage.cost)}
          </span>
        )}
      </span>
    ),
  },
};

export const plugins: UiPlugin[] = [tokenCounter];

class PluginBoundary extends Component<
  { children: ReactNode; id: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? (
      <span role="status" className="composer-chip">
        {this.props.id} unavailable
      </span>
    ) : (
      this.props.children
    );
  }
}

export function ComposerPlugins({
  context,
  enabled,
}: {
  context: ComposerContext;
  enabled: string[];
}) {
  return plugins
    .filter((p) => enabled.includes(p.id) && p.hostApiVersion === 1)
    .map((p) => {
      const Slot = p.slots["composer.footer"];
      return Slot ? (
        <PluginBoundary key={p.id} id={p.id}>
          <Slot {...context} />
        </PluginBoundary>
      ) : null;
    });
}
