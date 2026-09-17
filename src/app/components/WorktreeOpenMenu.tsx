import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@gpuix/react/select'
import { C } from '../theme.ts'
import { getOpenWorktreeOptions, type WorktreeOpenTarget } from '../utils/openWorktree.ts'

export function WorktreeOpenMenu({
  index,
  onOpen,
}: {
  index: number
  onOpen: (target: WorktreeOpenTarget) => void | Promise<void>
}) {
  const options = getOpenWorktreeOptions()

  return (
    <Select items={options} onValueChange={(value) => void onOpen(value as WorktreeOpenTarget)}>
      <SelectTrigger
        testId={`worktree-open-${index}`}
        aria-label="Open Worktree"
        style={{
          height: 26,
          minWidth: 96,
          paddingLeft: 9,
          paddingRight: 9,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: C.secondary,
          hover: { backgroundColor: C.overlay },
        }}
      >
        <SelectValue placeholder="Open in…" style={{ fontSize: 11, color: C.secondary }} />
      </SelectTrigger>
      <SelectContent
        side="bottom"
        align="end"
        sideOffset={4}
        style={{
          minWidth: 176,
          paddingTop: 4,
          paddingBottom: 4,
          paddingLeft: 4,
          paddingRight: 4,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: 7,
          backgroundColor: C.canvas,
        }}
      >
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            style={({ highlighted, selected }) => ({
              height: 28,
              paddingLeft: 8,
              paddingRight: 8,
              display: 'flex',
              alignItems: 'center',
              borderRadius: 4,
              backgroundColor: highlighted ? C.overlay : selected ? C.raised : C.canvas,
              cursor: 'pointer',
            })}
          >
            <text style={{ fontSize: 12, color: C.text }}>{option.label}</text>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
