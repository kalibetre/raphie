import { Tooltip, TooltipContent, TooltipTrigger } from '@gpuix/react'
import type { EnvVar } from '../../core/index.ts'
import { ACTIONS_COLUMN_WIDTH, C, KEY_COLUMN_WIDTH, MASKED_VALUE } from '../theme.ts'
import { DuplicateBadge } from './DuplicateBadge.tsx'
import { IconButton } from './IconButton.tsx'

export function EnvVarRow({
  envVar,
  revealed,
  isDuplicate,
  index,
  isLast,
  onToggleReveal,
  onCopy,
  onEdit,
  onDelete,
}: {
  envVar: EnvVar
  revealed: boolean
  isDuplicate: boolean
  index: number
  isLast: boolean
  onToggleReveal: () => void
  onCopy: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const actionKey = isDuplicate ? envVar.key + '-' + index : envVar.key

  return (
    <div
      testId={`envvar-row-${envVar.key}`}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 10,
        paddingBottom: 10,
        borderBottomWidth: isLast ? 0 : 1,
        borderColor: C.border,
        hover: { backgroundColor: C.overlay },
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          width: KEY_COLUMN_WIDTH,
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            {/* No word-break primitive here, and env var names have no
                spaces to wrap on anyway — truncate long ones and let the
                tooltip carry the full name instead. */}
            <text
              style={{
                fontSize: 13,
                color: C.text,
                flexGrow: 1,
                minWidth: 0,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {envVar.key}
            </text>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            sideOffset={6}
            style={{
              paddingLeft: 8,
              paddingRight: 8,
              paddingTop: 6,
              paddingBottom: 6,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: C.border,
              backgroundColor: C.raised,
            }}
          >
            <text style={{ fontSize: 11, color: C.text }}>{envVar.key}</text>
          </TooltipContent>
        </Tooltip>
        {isDuplicate ? <DuplicateBadge /> : null}
      </div>
      <div
        testId={`envvar-value-${envVar.key}`}
        onClick={onToggleReveal}
        style={{ flexGrow: 1, minWidth: 0, overflow: 'hidden', cursor: 'pointer' }}
      >
        {/* A revealed secret can be far longer than 8 mask dots (a path, a
            key) — truncate instead of forcing the row wider and pushing
            Copy out of view. */}
        <text
          style={{
            fontSize: 13,
            color: revealed ? C.text : C.ghost,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {revealed ? envVar.value : MASKED_VALUE}
        </text>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 2,
          flexShrink: 0,
          width: ACTIONS_COLUMN_WIDTH,
        }}
      >
        <IconButton
          testId={'envvar-copy-' + actionKey}
          label={'Copy ' + envVar.key + ' value'}
          icon="copy"
          onClick={onCopy}
        />
        <IconButton
          testId={'envvar-edit-' + actionKey}
          label={'Edit ' + envVar.key}
          icon="pencil"
          onClick={onEdit}
        />
        <IconButton
          testId={'envvar-delete-' + actionKey}
          label={'Delete ' + envVar.key}
          icon="trash2"
          color={C.warning}
          onClick={onDelete}
        />
      </div>
    </div>
  )
}
