import { Select, SelectContent, SelectItem, SelectTrigger } from '@gpuix/react/select'
import { Icon } from '../icons.tsx'
import { C } from '../theme.ts'
import type { WorktreeSort } from '../worktreeSort.ts'

const SORT_OPTIONS: ReadonlyArray<{ value: WorktreeSort; label: string }> = [
  { value: 'default', label: 'Default order' },
  { value: 'size-desc', label: 'Size · largest first' },
  { value: 'size-asc', label: 'Size · smallest first' },
  { value: 'date-desc', label: 'Last commit · newest first' },
  { value: 'date-asc', label: 'Last commit · oldest first' },
]

const isWorktreeSort = (value: string): value is WorktreeSort =>
  SORT_OPTIONS.some((option) => option.value === value)

export function WorktreeSortMenu({ value, onChange }: { value: WorktreeSort; onChange: (value: WorktreeSort) => void }) {
  const selectedOption = SORT_OPTIONS.find((option) => option.value === value) ?? SORT_OPTIONS[0]

  return (
    <Select
      testId="worktrees-sort-menu"
      items={SORT_OPTIONS}
      value={value}
      onValueChange={(nextValue) => {
        if (isWorktreeSort(nextValue)) onChange(nextValue)
      }}
      style={{ flexDirection: 'row', alignItems: 'stretch' }}
    >
      <SelectTrigger
        testId="worktrees-sort-trigger"
        aria-label="Sort Worktrees"
        style={{
          height: 26,
          gap: 8,
          paddingLeft: 10,
          paddingRight: 8,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: 6,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          cursor: 'pointer',
          hover: { backgroundColor: C.overlay },
        }}
      >
        <text style={{ fontSize: 11, color: C.secondary }}>{selectedOption.label}</text>
        <Icon name="chevronDown" size={12} color={C.secondary} />
      </SelectTrigger>
      <SelectContent
        side="bottom"
        align="end"
        sideOffset={4}
        style={{
          minWidth: 190,
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
        {SORT_OPTIONS.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            testId={`worktrees-sort-option-${option.value}`}
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
