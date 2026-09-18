import { C } from '../theme.ts'
import {
  cycleWorktreeSortDirection,
  type WorktreeSort,
  type WorktreeSortDirection,
} from '../worktreeSort.ts'

const directionLabel = (direction: WorktreeSortDirection, descendingLabel: string, ascendingLabel: string) => {
  if (direction === 'desc') return descendingLabel
  if (direction === 'asc') return ascendingLabel
  return 'off'
}

function SortButton({
  testId,
  label,
  direction,
  onClick,
}: {
  testId: string
  label: string
  direction: WorktreeSortDirection
  onClick: () => void
}) {
  const arrow = direction === 'desc' ? '↓' : direction === 'asc' ? '↑' : '—'
  const sortLabel =
    label === 'Size'
      ? directionLabel(direction, 'largest first', 'smallest first')
      : directionLabel(direction, 'newest first', 'oldest first')

  return (
    <div
      testId={testId}
      role="button"
      aria-label={`Sort Worktrees by ${label.toLowerCase()}: ${sortLabel}`}
      onClick={onClick}
      style={{
        height: 26,
        paddingLeft: 9,
        paddingRight: 8,
        borderWidth: 1,
        borderColor: C.border,
        borderRadius: 6,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        cursor: 'pointer',
        hover: { backgroundColor: C.overlay },
      }}
    >
      <text style={{ fontSize: 11, color: direction ? C.secondary : C.ghost }}>{label}</text>
      <text style={{ fontSize: 13, lineHeight: 1, color: direction ? C.text : C.ghost }}>{arrow}</text>
    </div>
  )
}

export function WorktreeSortButtons({ sort, onChange }: { sort: WorktreeSort; onChange: (sort: WorktreeSort) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <SortButton
        testId="worktrees-sort-size"
        label="Size"
        direction={sort.size}
        onClick={() => onChange({ ...sort, size: cycleWorktreeSortDirection(sort.size) })}
      />
      <SortButton
        testId="worktrees-sort-date"
        label="Date"
        direction={sort.date}
        onClick={() => onChange({ ...sort, date: cycleWorktreeSortDirection(sort.date) })}
      />
    </div>
  )
}
