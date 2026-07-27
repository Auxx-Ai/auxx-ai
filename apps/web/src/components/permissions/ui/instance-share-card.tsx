// apps/web/src/components/permissions/ui/instance-share-card.tsx
'use client'

import { ResourcePermission } from '@auxx/database/enums'
import type { RecordId } from '@auxx/types/resource'
import { parseRecordId } from '@auxx/types/resource'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { Globe, Lock } from 'lucide-react'
import { useCanAdminInstance } from '~/providers/capabilities-provider'
import type { InstanceLevel, WorkspaceBaseline } from '../hooks/use-instance-share'
import { useInstanceShare } from '../hooks/use-instance-share'
import { InstanceShareBody, LEVEL_ORDER, LEVEL_TIER, levelHelper } from './instance-share-body'
import { INSTANCE_SHARE_COPY, type InstanceShareCopy } from './instance-share-copy'

/** The workspace-baseline picker: Read / Write / Full + "No access (Restricted)". */
function WorkspaceBaselineSelect({
  value,
  onChange,
  copy,
  disabled,
}: {
  value: InstanceLevel | 'restricted'
  onChange: (value: InstanceLevel | 'restricted') => void
  copy: InstanceShareCopy
  disabled: boolean
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as InstanceLevel | 'restricted')}
      disabled={disabled}>
      <SelectTrigger size='sm' variant='transparent' className='h-7 w-40'>
        <SelectValue>{value === 'restricted' ? 'Restricted' : LEVEL_TIER[value]}</SelectValue>
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
        <SelectSeparator />
        <SelectItem value='restricted' textValue='No access'>
          <div className='flex flex-col items-start'>
            <span>No access (Restricted)</span>
            <span className='text-muted-foreground text-xs'>Only people below and admins</span>
          </div>
        </SelectItem>
      </SelectContent>
    </Select>
  )
}

/**
 * The workspace-baseline row (org-wide default). Rendered above the grantee list.
 * When no explicit baseline row exists yet, an unshared `baselineAtCreate:false`
 * resource is org-visible at Read — shown as Read so the admin sees the org has
 * access, and switching to Restricted is the explicit opt-out.
 */
function WorkspaceBaselineRow({
  baseline,
  onChange,
  copy,
  disabled,
}: {
  baseline: WorkspaceBaseline
  onChange: (value: InstanceLevel | 'restricted') => void
  copy: InstanceShareCopy
  disabled: boolean
}) {
  const restricted = baseline === 'restricted'
  const display: InstanceLevel | 'restricted' = baseline ?? ResourcePermission.view

  return (
    <TreeRow
      icon={
        restricted ? (
          <Lock className='size-4 text-muted-foreground' />
        ) : (
          <Globe className='size-4 text-muted-foreground' />
        )
      }
      title='Everyone in the workspace'
      rowClassName='bg-primary-50 hover:bg-primary-100'
      actions={
        <WorkspaceBaselineSelect
          value={display}
          onChange={onChange}
          copy={copy}
          disabled={disabled}
        />
      }
    />
  )
}

/**
 * Generic per-instance Share card, keyed by a whole `RecordId` (§4). Mounted by
 * every instance-access consumer (datasets now; KB / dashboards later) with a
 * different `recordId` — nothing here is dataset-shaped except one entry in
 * {@link INSTANCE_SHARE_COPY}.
 *
 * Rows: a workspace-baseline row (org-wide default, Read/Write/Full/Restricted)
 * plus user/group grantees (Read/Write/Full). Editable to members who may
 * administer the instance (OWNER/ADMIN or a `Full` grant); a read-only list
 * otherwise, and hidden entirely when neither admin nor any grant exists (same
 * affordance rule as `contact-shared-with-card.tsx`).
 */
export function InstanceShareCard({ recordId }: { recordId: RecordId }) {
  const { entityDefinitionId: key } = parseRecordId(recordId)
  const isSupported = key in INSTANCE_SHARE_COPY
  const canAdmin = useCanAdminInstance(recordId)
  const { grants, unmanageableGrants, baseline, setBaseline } = useInstanceShare({
    recordId,
    enabled: isSupported,
  })

  if (!isSupported) return null
  const copy = INSTANCE_SHARE_COPY[key as keyof typeof INSTANCE_SHARE_COPY]
  // A grant this card can't render still means the resource IS shared — hiding
  // the card would leave an admin with no signal at all.
  if (!canAdmin && grants.length === 0 && unmanageableGrants.length === 0) return null

  const restricted = baseline === 'restricted'

  return (
    <div className='space-y-2'>
      <p className='text-muted-foreground text-xs'>
        {restricted ? (
          <>
            This {copy.noun} is <span className='font-medium'>restricted</span>. Only the people
            below and admins can access it.
          </>
        ) : (
          <>
            This {copy.noun} is <span className='font-medium'>shared with the workspace</span>.{' '}
            {copy.baselineHint}
          </>
        )}
      </p>

      <div className='space-y-0.5'>
        <WorkspaceBaselineRow
          baseline={baseline}
          onChange={setBaseline}
          copy={copy}
          disabled={!canAdmin}
        />
      </div>

      <InstanceShareBody recordId={recordId} />
    </div>
  )
}
