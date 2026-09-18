import { Select, SelectContent, SelectItem, SelectTrigger } from '@gpuix/react/select'
import { Icon } from '../icons.tsx'
import { C } from '../theme.ts'
import type { WorktreeOpenOption, WorktreeOpenTarget } from '../utils/openWorktree.ts'

export function WorktreeOpenMenu({
  index,
  options,
  selectedTarget,
  onOpen,
  onSelect,
}: {
  index: number
  options: readonly WorktreeOpenOption[]
  selectedTarget: WorktreeOpenTarget | null
  onOpen: (target: WorktreeOpenTarget) => void | Promise<void>
  onSelect: (target: WorktreeOpenTarget) => void
}) {
  const selectedOption = options.find((option) => option.value === selectedTarget)
  const canOpen = selectedTarget !== null

  return (
    <Select
      items={options}
      value={selectedTarget ?? undefined}
      disabled={options.length === 0}
      onValueChange={(value) => {
        const target = value as WorktreeOpenTarget
        onSelect(target)
        void onOpen(target)
      }}
      style={{ flexDirection: 'row', alignItems: 'stretch', gap: 0 }}
    >
      <div
        testId={`worktree-open-${index}`}
        role="button"
        aria-label="Open Worktree"
        onClick={() => {
          if (canOpen) void onOpen(selectedTarget)
        }}
        style={{
          height: 26,
          paddingLeft: 10,
          paddingRight: 8,
          borderWidth: 1,
          borderRightWidth: 0,
          borderColor: C.border,
          borderRadius: 6,
          borderTopRightRadius: 0,
          borderBottomRightRadius: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: canOpen ? 'pointer' : 'default',
          opacity: canOpen ? 1 : 0.55,
          hover: canOpen ? { backgroundColor: C.overlay } : undefined,
        }}
      >
        <text style={{ fontSize: 11, color: C.secondary }}>{selectedOption?.label ?? 'Open'}</text>
      </div>
      <SelectTrigger
        testId={`worktree-open-menu-${index}`}
        aria-label="Choose where to open Worktree"
        style={{
          height: 26,
          width: 24,
          paddingLeft: 0,
          paddingRight: 0,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: 6,
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: canOpen ? 'pointer' : 'default',
          color: C.secondary,
          hover: canOpen ? { backgroundColor: C.overlay } : undefined,
        }}
      >
        <Icon name="chevronDown" size={12} color={C.secondary} />
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
