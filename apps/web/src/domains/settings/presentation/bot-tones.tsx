import {
  createContext,
  type CSSProperties,
  type ReactNode,
  useContext,
  useMemo,
} from "react";

import {
  botColors,
  botEyeColor,
  botPalette,
  botTone,
} from "../application/bot-tone";

const BotTonesContext = createContext<ReadonlyMap<string, string>>(new Map());

/** One assignment shared by avatars, roster highlights and settings accents. */
export function BotTonesProvider({
  bots,
  children,
}: {
  bots: readonly { id: string; color?: string | null }[];
  children: ReactNode;
}) {
  const tones = useMemo(() => botColors(bots), [bots]);
  return (
    <BotTonesContext.Provider value={tones}>
      {children}
    </BotTonesContext.Provider>
  );
}

export function useBotStyle() {
  const tones = useContext(BotTonesContext);
  return (id: string, override?: string): CSSProperties => {
    const color = override ?? tones.get(id) ?? botPalette[botTone(id)].color;
    return {
      "--tone": color,
      "--bot-eye": botEyeColor(color),
    } as CSSProperties;
  };
}
