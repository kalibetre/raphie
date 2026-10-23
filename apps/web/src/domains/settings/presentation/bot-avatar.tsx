/** Stable colour family for a bot: its avatar and its settings pages share it. */
export function botTone(id: string) {
  return id === "default"
    ? 0
    : id.split("").reduce((sum, c) => sum + c.charCodeAt(0), 0) % 4;
}

export function BotAvatar({ id }: { id: string }) {
  return (
    <span className={`bot-avatar tone-${botTone(id)}`} aria-hidden="true">
      <i />
      <i />
    </span>
  );
}
