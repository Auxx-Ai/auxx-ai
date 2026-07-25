// apps/web/src/components/inbox/ui/inbox-info-card.tsx
'use client'

import { LENS_LABELS } from '@auxx/lib/permissions/visibility/client'
import { toActorId } from '@auxx/types/actor'
import { Badge } from '@auxx/ui/components/badge'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { granteeToActorId, unmanageableGrantsNote } from '~/components/permissions/utils/grantee'
import { ActorStack } from '~/components/resources/ui/actor-stack'
import type { InboxItem } from '~/components/threads/hooks/use-inbox'
import { api } from '~/trpc/react'

/** Resolve the org-wide access label from the inbox's floor + personal flag. */
function accessLabel(inbox: InboxItem): string {
  if (inbox.isPersonal) return 'Private to owner'
  if (inbox.defaultLens === 'none') return 'Restricted'
  return `Everyone · ${LENS_LABELS[inbox.defaultLens]?.label ?? 'Full access'}`
}

/** Small muted section label (Access / People / Description). */
function Label({ children }: { children: React.ReactNode }) {
  return <span className='text-muted-foreground text-xs font-medium'>{children}</span>
}

/** Bordered panel with the responsive two-column grid — shared by the loaded
 *  card and its skeleton so the two occupy identical space (no layout shift). */
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className='@container rounded-2xl bg-primary-50 border p-4'>
      <div className='grid gap-4 @md:grid-cols-2'>{children}</div>
    </div>
  )
}

/** Skeleton mirror of {@link InboxInfoCard} — same section heights + two-column
 *  layout as the real card so swapping in the loaded card is jitter-free. */
function InboxInfoCardSkeleton() {
  return (
    <Panel>
      {/* Left — Access + People */}
      <div className='space-y-2'>
        <div className='space-y-1.5'>
          <Label>Access</Label>
          <Skeleton className='h-5 w-24 rounded-full' />
        </div>
        <div className='space-y-1.5'>
          <Label>People</Label>
          <div className='flex -space-x-1.5'>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className='size-6 rounded-full ring-2 ring-background' />
            ))}
          </div>
        </div>
      </div>
      {/* Right — Description (reserve one text-sm row) */}
      <div className='space-y-1.5'>
        <Label>Description</Label>
        <div className='flex min-h-5 flex-col gap-1.5'>
          <Skeleton className='h-4 w-full' />
          <Skeleton className='h-4 w-2/3' />
        </div>
      </div>
    </Panel>
  )
}

/**
 * Read-only inbox info panel: a two-column grid with the org-wide access level
 * and the people & groups with individual access on the left, and the
 * description on the right. Reuses the resolved `inbox` prop (from the page's
 * `useInbox`) plus the existing `resourceAccess.forInstance` grant query — no new
 * endpoint, no edit controls.
 *
 * Renders a same-sized skeleton while `loading` (or before `inbox` resolves) so
 * the detail page reserves this space up front and never shifts.
 */
export function InboxInfoCard({ inbox, loading }: { inbox?: InboxItem; loading?: boolean }) {
  const { data: rows } = api.resourceAccess.forInstance.useQuery(
    { recordId: inbox?.recordId ?? '' },
    { enabled: !!inbox?.recordId }
  )

  if (loading || !inbox) return <InboxInfoCardSkeleton />

  // `granteeToActorId` returns null for every kind with no actor — the old
  // `r.granteeType === 'group' ? 'group' : 'user'` ternary rendered a `role`
  // baseline or a `profile` grant as a bogus `user:<id>` avatar that resolves to
  // "Unknown", and counted it as a person.
  const actorIds = (rows ?? []).flatMap((r) => granteeToActorId(r.granteeType, r.granteeId) ?? [])
  const hiddenNote = unmanageableGrantsNote(
    (rows ?? [])
      .filter((r) => !granteeToActorId(r.granteeType, r.granteeId) && r.granteeType !== 'role')
      .map((r) => ({ granteeType: r.granteeType, granteeId: r.granteeId }))
  )
  // Personal inbox: ensure the owner shows even if there's no explicit grant row.
  const ownerActorId =
    inbox.isPersonal && inbox.ownerUserId ? toActorId('user', inbox.ownerUserId) : null
  const allActorIds =
    ownerActorId && !actorIds.includes(ownerActorId) ? [ownerActorId, ...actorIds] : actorIds

  const count = allActorIds.length

  return (
    <Panel>
      {/* Left — Access + People */}
      <div className='space-y-2'>
        <div className='space-y-1.5'>
          <Label>Access</Label>
          <div>
            <Badge variant='secondary'>{accessLabel(inbox)}</Badge>
          </div>
        </div>

        <div className='space-y-1.5'>
          <Label>People</Label>
          {rows === undefined ? (
            <div className='flex -space-x-1.5'>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className='size-6 rounded-full ring-2 ring-background' />
              ))}
            </div>
          ) : count === 0 ? (
            <p className='text-muted-foreground text-sm'>No individual access</p>
          ) : (
            <div className='flex items-center gap-2'>
              <ActorStack actorIds={allActorIds} />
              <span className='text-muted-foreground text-sm'>
                {count} {count === 1 ? 'person or group' : 'people & groups'}
              </span>
            </div>
          )}
          {hiddenNote && <p className='text-muted-foreground text-xs'>{hiddenNote}</p>}
        </div>
      </div>

      {/* Right — Description (always reserve one text-sm row to avoid layout shift) */}
      <div className='space-y-1.5'>
        <Label>Description</Label>
        <div className='flex min-h-5 flex-col'>
          {inbox.description ? (
            <p className='text-sm whitespace-pre-wrap'>{inbox.description}</p>
          ) : (
            <p className='text-muted-foreground text-sm'>No description</p>
          )}
        </div>
      </div>
    </Panel>
  )
}
