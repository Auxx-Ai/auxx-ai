// apps/web/src/components/permissions/ui/base-level-select.tsx
'use client'

import { Level } from '@auxx/lib/permissions/client'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { RUNG_LABELS } from './level-labels'

/**
 * Sentinel for "no blanket rung". `null` cannot be a `Select` value, and
 * `Level.None` is `0` — a REAL rung whose string form is `'0'` — so the two must
 * never collapse into one falsy option.
 */
const NO_BASE_LEVEL = 'member_default'

/** The rungs offered, in ladder order. */
const RUNGS: Level[] = [Level.None, Level.Read, Level.Edit, Level.Full]

/** Label of the "no blanket rung" option, on the surfaces that offer it. */
const UNSET_LABEL = 'Member default'

type BaseLevelSelectProps = {
  /** Sentence fragment before the control, e.g. `'Unset areas fall through to'`. */
  label: string
  disabled?: boolean
} & (
  | {
      /**
       * Offer the "no blanket rung" option (`Member default`). Only the human
       * profile editor does: an agent's default is mandatory and fail-closed at
       * `None`, so it has no such state to express.
       */
      allowUnset: true
      value: Level | null
      onChange: (level: Level | null) => void
    }
  | {
      allowUnset?: false
      value: Level
      onChange: (level: Level) => void
    }
)

/**
 * The blanket rung a keyspace falls through to when it holds no entry of its own
 * (§0.7). Keeping it explicit is what makes a grid's "Not set" state readable: a
 * row either falls through to this default or, when there is none, to the member
 * default in code — which is also why a newly added area is automatically
 * reachable for Owner/Admin on deploy instead of needing a backfill.
 *
 * Shared by the human profile editor and the agent policy header, both labelled
 * `Unset areas fall through to` (plan 29 §2.2/§4a). Only the human one offers the
 * `Member default` sentinel — an agent's default is mandatory and fails closed.
 *
 * One control per editor. The agent header briefly carried a second,
 * `New resource types fall through to`, backing an `AgentPermissionPolicy`
 * field that answered the same question one level above the area rung it was then
 * intersected with; a resource type with no rule now falls through to its own
 * area, exactly as a human's absent instance row does.
 */
export function BaseLevelSelect(props: BaseLevelSelectProps) {
  const { label, value, disabled = false } = props

  const handleChange = (next: string) => {
    if (props.allowUnset) {
      props.onChange(next === NO_BASE_LEVEL ? null : (Number(next) as Level))
      return
    }
    props.onChange(Number(next) as Level)
  }

  return (
    <div className='flex items-center gap-2'>
      <span className='text-xs text-muted-foreground'>{label}</span>
      <Select
        value={value === null ? NO_BASE_LEVEL : String(value)}
        disabled={disabled}
        onValueChange={handleChange}>
        <SelectTrigger size='sm' className='w-44'>
          <SelectValue placeholder={props.allowUnset ? UNSET_LABEL : undefined} />
        </SelectTrigger>
        <SelectContent align='end'>
          {props.allowUnset && <SelectItem value={NO_BASE_LEVEL}>{UNSET_LABEL}</SelectItem>}
          {RUNGS.map((level) => (
            <SelectItem key={level} value={String(level)}>
              {RUNG_LABELS[level]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
