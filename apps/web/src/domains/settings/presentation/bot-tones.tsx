import { createContext, type ReactNode, useContext, useMemo } from "react";

import { botTone, botTones } from "../application/bot-tone";

const BotTonesContext = createContext<ReadonlyMap<string, number>>(new Map());

/** One assignment shared by avatars, roster highlights and settings accents. */
export function BotTonesProvider({
  bots,
  children,
}: {
  bots: readonly { id: string }[];
  children: ReactNode;
}) {
  const tones = useMemo(() => botTones(bots.map((bot) => bot.id)), [bots]);
  return (
    <BotTonesContext.Provider value={tones}>
      {children}
    </BotTonesContext.Provider>
  );
}

export function useBotTones() {
  const tones = useContext(BotTonesContext);
  return (id: string) => tones.get(id) ?? botTone(id);
}
