// apps/web/src/components/permissions/ui/instance-share-body.tsx
'use client'

import { ResourcePermission } from '@auxx/database/enums'
import { INSTANCE_ACCESS_RESOURCES, Level, PERMISSION_AREAS } from '@auxx/lib/permissions/client'
import type { RecordId } from '@auxx/types/resource'
import { parseRecordId } from '@auxx/types/resource'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { AlertTriangle } from 'lucide-react'
import { useMemo } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useCanAdminInstance } from '~/providers/capabilities-provider'
import type { InstanceLevel } from '../hooks/use-instance-share'
import { useInstanceShare } from '../hooks/use-instance-share'
import { GranteeList } from './grantee-list'
import {
  deadGrantWarning,
  INSTANCE_SHARE_COPY,
  type InstanceShareCopy,
} from './instance-share-copy'
import { permissionLabel } from './level-labels'

/**
 * The per-INSTANCE tiers offered by every share picker. A flat module const with
 * no per-key subset, deliberately left that way by plan 43 §5.4.
 *
 * **Plan 43 §3.1 does not disturb this.** Dropping the *area* `Edit` rung from
 * `signatures` / `snippets` / `dashboards` says nothing about the per-instance
 * `edit` tier, which stays real and asserted (`assertEditInstance`). An instance
 * row must keep offering `Read and write` even where its area's ladder no longer
 * has that rung — pinned by §8 test 23.
 */
export const LEVEL_ORDER: InstanceLevel[] = [
  ResourcePermission.view,
  ResourcePermission.edit,
  ResourcePermission.admin,
]

export function levelHelper(copy: InstanceShareCopy, level: InstanceLevel): string {
  if (level === ResourcePermission.edit) return copy.levels.write
  if (level === ResourcePermission.admin) return copy.levels.full
  return copy.levels.read
}

/** The Read only / Read and write / Full access picker for a grantee row. */
export function InstanceLevelSelect({
  value,
  onChange,
  copy,
  disabled,
}: {
  value: InstanceLevel
  onChange: (value: InstanceLevel) => void
  copy: InstanceShareCopy
  disabled: boolean
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as InstanceLevel)} disabled={disabled}>
      <SelectTrigger size='sm' variant='transparent' className='h-7 w-36'>
        <SelectValue>{permissionLabel(value, 'long')}</SelectValue>
      </SelectTrigger>
      <SelectContent align='end' className='min-w-56'>
        {LEVEL_ORDER.map((level) => (
          <SelectItem key={level} value={level} textValue={permissionLabel(level, 'long')}>
            <div className='flex flex-col items-start'>
              <span>{permissionLabel(level, 'long')}</span>
              <span className='text-muted-foreground text-xs'>{levelHelper(copy, level)}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * The generic per-instance grantee list — extracted out of `InstanceShareCard`
 * (capability layer v2 Part B.2.3) so the standalone Share card/dialog AND the
 * nested per-instance rows on the Workspace defaults grid
 * (`instance-baseline-rows.tsx`) render the exact same grantee list, level
 * picker, revoke button and "add people or groups" trigger. Every mount is
 * driven by its own {@link useInstanceShare}, so opening several nested rows at
 * once just runs several small `forInstance` queries (accepted per-open-row
 * cost, §B.2.4) — no new mutation surface.
 *
 * **This list's subject is always *everyone*** (plan 31 §2.1). It belongs under
 * a row whose own subject is the workspace, because its children are that row's
 * exceptions. `grantee-instance-rows.tsx` used to mount it too, which put every
 * OTHER grantee's access — editable and revocable — inside a page about one
 * member; those rows are leaves now and link out to `InstanceShareDialog`
 * instead. If this list ever gains a shared primitive, the axis is **subject**,
 * never a standalone `expandable` boolean.
 *
 * Editability is gated on {@link useCanAdminInstance} exactly as before: an
 * instance-restricted admin sees this list read-only (§B.2.7).
 *
 * Dead-row warning (§B.2.8, re-aimed by plan 25 §2): an explicit instance row
 * now beats the area floor, so a positive grant to a member composing the area
 * to `None` is a REAL single-instance share, not a no-op. What is inert is an
 * explicit `'none'` RESTRICTION on such a member — it removes access they never
 * had — and only those rows get the inline warning icon, driven by the
 * `granteeAreaLevel` the server annotates onto `forInstance` for `user`
 * grantees only.
 */
export function InstanceShareBody({
  recordId,
  depth = 0,
  emptyHint,
}: {
  recordId: RecordId
  /**
   * Indent for the grantee rows. `0` suits the Share card and dialog, which own
   * their panel. A nested mount passes its instance row's depth **+ 1** — the
   * people belong under the dataset, not level with the area above it.
   */
  depth?: number
  /**
   * The empty-state sentence, built from the resource noun this mount resolves.
   * **Required, and deliberately not defaulted** (plan 31 §2.6): the previous
   * hardcoded copy pointed at "the workspace default above", which is only true
   * where such a control exists. Every mount states its own scope.
   */
  emptyHint: (noun: string) => string
}) {
  const { entityDefinitionId: key } = parseRecordId(recordId)
  const isSupported = key in INSTANCE_SHARE_COPY
  const canAdmin = useCanAdminInstance(recordId)
  const { grants, unmanageableGrants, grant, changeLevel, revoke } = useInstanceShare({
    recordId,
    enabled: isSupported,
  })

  const areaLabel = useMemo(() => {
    if (!isSupported) return undefined
    const area = INSTANCE_ACCESS_RESOURCES[key as keyof typeof INSTANCE_ACCESS_RESOURCES].area
    return PERMISSION_AREAS[area].label
  }, [isSupported, key])

  // An explicit `'none'` restriction on a member who already composes the area
  // to `None` — the only row shape that is still genuinely inert (plan 25 §2).
  const deadRowActorIds = useMemo(() => {
    const ids = new Set<string>()
    for (const g of grants) {
      if (g.granteeAreaLevel === Level.None && g.permission === ResourcePermission.none) {
        ids.add(g.actorId)
      }
    }
    return ids
  }, [grants])

  if (!isSupported) return null
  const copy = INSTANCE_SHARE_COPY[key as keyof typeof INSTANCE_SHARE_COPY]

  return (
    <GranteeList<InstanceLevel>
      grants={grants}
      onGrant={grant}
      onChange={changeLevel}
      onRevoke={revoke}
      defaultChoice={ResourcePermission.view}
      depth={depth}
      renderLockedLabel={(choice) => permissionLabel(choice, 'long')}
      renderPicker={({ value, onChange, disabled, actorId }) => {
        const isDeadRow = deadRowActorIds.has(actorId)
        return (
          <>
            {isDeadRow && areaLabel && (
              <Tooltip content={deadGrantWarning(areaLabel)}>
                <AlertTriangle className='size-3.5 text-amber-500' />
              </Tooltip>
            )}
            <InstanceLevelSelect
              value={value}
              onChange={onChange}
              copy={copy}
              disabled={disabled}
            />
          </>
        )
      }}
      disabled={!canAdmin}
      unmanageableGrants={unmanageableGrants}
      emptyHint={emptyHint(copy.noun)}
    />
  )
}
