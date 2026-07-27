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

export const LEVEL_ORDER: InstanceLevel[] = [
  ResourcePermission.view,
  ResourcePermission.edit,
  ResourcePermission.admin,
]

export const LEVEL_TIER: Record<InstanceLevel, string> = {
  [ResourcePermission.view]: 'Read',
  [ResourcePermission.edit]: 'Write',
  [ResourcePermission.admin]: 'Full',
}

export function levelHelper(copy: InstanceShareCopy, level: InstanceLevel): string {
  if (level === ResourcePermission.edit) return copy.levels.write
  if (level === ResourcePermission.admin) return copy.levels.full
  return copy.levels.read
}

/** The Read / Write / Full picker for a grantee row. */
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
      <SelectTrigger size='sm' variant='transparent' className='h-7 w-32'>
        <SelectValue>{LEVEL_TIER[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent align='end' className='min-w-56'>
        {LEVEL_ORDER.map((level) => (
          <SelectItem key={level} value={level} textValue={LEVEL_TIER[level]}>
            <div className='flex flex-col items-start'>
              <span>{LEVEL_TIER[level]}</span>
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
 * nested per-instance rows on the Member baseline / grantee-override grids
 * (`instance-baseline-rows.tsx` / `grantee-instance-rows.tsx`) render the exact
 * same grantee list, Read/Write/Full picker, revoke button and "add people or
 * groups" trigger. Every mount is driven by its own {@link useInstanceShare},
 * so opening several nested rows at once just runs several small `forInstance`
 * queries (accepted per-open-row cost, §B.2.4) — no new mutation surface.
 *
 * Editability is gated on {@link useCanAdminInstance} exactly as before: an
 * instance-restricted admin sees this list read-only (§B.2.7).
 *
 * Dead-grant warning (§B.2.8): a `user` grant whose composed area level is
 * `None` is inert — `effectiveInstanceLevel` closes the area gate before ever
 * consulting the instance row — so each such row gets an inline warning icon,
 * driven by the `granteeAreaLevel` the server annotates onto `forInstance` for
 * `user` grantees only.
 */
export function InstanceShareBody({ recordId }: { recordId: RecordId }) {
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

  const granteeAreaLevelByActor = useMemo(() => {
    const map = new Map<string, Level | undefined>()
    for (const g of grants) map.set(g.actorId, g.granteeAreaLevel)
    return map
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
      renderLockedLabel={(choice) => LEVEL_TIER[choice]}
      renderPicker={({ value, onChange, disabled, actorId }) => {
        const isDeadGrant = granteeAreaLevelByActor.get(actorId) === Level.None
        return (
          <>
            {isDeadGrant && areaLabel && (
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
      emptyHint={`Not shared with anyone specific. Adjust the workspace default above to restrict this ${copy.noun}.`}
    />
  )
}
