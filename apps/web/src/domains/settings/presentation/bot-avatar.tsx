export function BotAvatar({ id }: { id: string }) {
  const tone = id.split("").reduce((sum, c) => sum + c.charCodeAt(0), 0) % 4;
  return (
    <span className={`bot-avatar tone-${tone}`} aria-hidden="true">
      <i />
      <i />
    </span>
  );
}
