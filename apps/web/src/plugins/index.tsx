import { Component, type ComponentType, type ReactNode } from "react";
export type ComposerContext = { draft: string; model: string | null };
export type UiPlugin = {
  id: string;
  version: string;
  hostApiVersion: 1;
  name: string;
  slots: { "composer.footer"?: ComponentType<ComposerContext> };
};
const tokenCounter: UiPlugin = {
  id: "raphie.token-counter",
  version: "0.1.0",
  hostApiVersion: 1,
  name: "Draft token estimate",
  slots: {
    "composer.footer": ({ draft }) => (
      <span title="Rough estimate: one token per four characters. This is not provider-reported usage.">
        ~{Math.ceil([...draft].length / 4).toLocaleString()} draft tokens
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
      <span role="status">{this.props.id} unavailable</span>
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
