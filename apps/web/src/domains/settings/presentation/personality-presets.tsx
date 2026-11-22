import { usePersonalityPresets } from "../infrastructure/use-bots";

/**
 * The built-in personalities: picking one puts its text in the editor, to
 * save as it is or edit first.
 */
export function PersonalityPresets({
  personality,
  pending,
  onPick,
}: {
  personality: string;
  pending: boolean;
  onPick: (personality: string) => void;
}) {
  const presets = usePersonalityPresets().data?.items;
  if (!presets) return null;
  const current = personality.trim();
  return (
    <div className="personality-presets" role="group" aria-label="Start from">
      {presets.map((preset) => (
        <button
          key={preset.id}
          type="button"
          className="personality-preset"
          aria-pressed={preset.personality === current}
          disabled={pending}
          onClick={() => onPick(preset.personality)}
        >
          <strong>{preset.name}</strong>
          <span>{preset.summary}</span>
        </button>
      ))}
    </div>
  );
}
