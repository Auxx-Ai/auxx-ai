// apps/web/src/components/permissions/ui/instance-share-card.tsx
'use client'

import type { RecordId } from '@auxx/types/resource'
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
import type { InstanceLevel, WorkspaceBaseline } from '../hooks/use-instance-share'
import { useInstanceShare } from '../hooks/use-instance-share'
import { useCanManageInstanceSharing, useInstanceShareCopy } from '../hooks/use-instance-share-copy'
import { InstanceShareBody, LEVEL_ORDER, levelHelper } from './instance-share-body'
import { INSTANCE_ROW_COPY, type InstanceShareCopy } from './instance-share-copy'
import { rungLabel } from './level-labels'

/** The workspace-baseline picker: the three positive rungs + "No access (Restricted)". */
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
        <SelectValue>
          {value === 'restricted' ? 'Restricted' : rungLabel(value, 'long')}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align='end' className='min-w-56'>
        {LEVEL_ORDER.map((level) => (
          <SelectItem key={level} value={level} textValue={rungLabel(level, 'long')}>
            <div className='flex flex-col items-start'>
              <span>{rungLabel(level, 'long')}</span>
              <span className='text-muted-foreground text-xs'>{levelHelper(copy, level)}</span>
            </div>
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem value='restricted' textValue='No access'>
          <div className='flex flex-col items-start'>
            <span>No access (Restricted)</span>
            {/* NOT "and admins" (plan 43 §5.5.3). There is no admin bypass:
                `effectiveInstanceLevel` has only the
                `role === 'OWNER' && !cfg.baselineAtCreate` arm — doc 19 §5.3
                step 10 removed the ADMIN one and plan 36 §0.6 then scoped
                OWNER's away from the private resources too. The old string was
                wrong in the dangerous direction: an admin restricting a dataset
                was told a group still had access when it did not, and could
                leave a genuine grant off. */}
            <span className='text-muted-foreground text-xs'>Only people listed below</span>
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
  const display: InstanceLevel | 'restricted' = baseline ?? 'read'

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
 * Rows: a workspace-baseline row (org-wide default, the three positive rungs
 * plus Restricted) and user/group grantees. Editable to members who may
 * administer the instance (OWNER/ADMIN or a `Full` grant); a read-only list
 * otherwise, and hidden entirely when neither admin nor any grant exists (same
 * affordance rule as `contact-shared-with-card.tsx`).
 */
export function InstanceShareCard({ recordId }: { recordId: RecordId }) {
  const copy = useInstanceShareCopy(recordId)
  const isSupported = copy !== null
  const canAdmin = useCanManageInstanceSharing(recordId)
  const { grants, unmanageableGrants, baseline, setBaseline } = useInstanceShare({
    recordId,
    enabled: isSupported,
  })

  if (!copy) return null
  // A grant this card can't render still means the resource IS shared — hiding
  // the card would leave an admin with no signal at all.
  if (!canAdmin && grants.length === 0 && unmanageableGrants.length === 0) return null

  // **The record lane has no per-instance workspace baseline** (plan v3/03 §6.3):
  // the record write path is raise-only (D7 rejects `rung: 'none'` for record
  // defs), so a Restricted control would offer a state the server refuses to
  // store, and there is no `role:org_member` default row to down-tier. What takes
  // its slot is the def-level inherited-access line — "everyone who can see this
  // definition already sees this row" — which is the same footer idea mail uses
  // for its inbox floor, with per-domain content.
  const isRecordLane = copy.lane === 'record'
  const restricted = baseline === 'restricted'

  return (
    <div className='space-y-2'>
      <p className='text-muted-foreground text-xs'>
        {isRecordLane ? (
          copy.baselineHint
        ) : restricted ? (
          <>
            This {copy.noun} is <span className='font-medium'>restricted</span>. Only the people
            listed below can access it.
          </>
        ) : (
          <>
            This {copy.noun} is <span className='font-medium'>shared with the workspace</span>.{' '}
            {copy.baselineHint}
          </>
        )}
      </p>

      {/* What this card does NOT control. Shown in both states, but it exists for
          the restricted one: a workflow locked down here still fires from every
          schedule, event, rule, webhook, and poll (plan 30 §2.1). */}
      {copy.scopeNote ? <p className='text-muted-foreground text-xs'>{copy.scopeNote}</p> : null}

      <div className='space-y-0.5'>
        {isRecordLane ? null : (
          <WorkspaceBaselineRow
            baseline={baseline}
            onChange={setBaseline}
            copy={copy}
            disabled={!canAdmin}
          />
        )}
        {/* Plan 43 §5.5.2 — the mirror of the area row's confusion, and this
            dialog's own: an admin sets a workspace default and it does not reach
            everyone, because §0.2a gates the baseline lane on the member's area
            rung. The row above is titled "Everyone in the workspace"; this is the
            sentence that makes that title honest.

            Only for the six org-shared keys (`baselineReachNote` is unset on the
            private three, where there is no workspace default to be shut out of),
            and only while a default actually exists — under Restricted the
            baseline reaches nobody, so the line would imply the opposite. */}
        {!restricted && copy.baselineReachNote ? (
          <p className='px-2 pt-1 text-muted-foreground text-xs'>{copy.baselineReachNote}</p>
        ) : null}
      </div>

      <InstanceShareBody recordId={recordId} emptyHint={INSTANCE_ROW_COPY.baseline.emptyHint} />
    </div>
  )
}
