// apps/web/src/components/permissions/ui/instance-share-avatars.tsx
'use client'

import type { RecordId } from '@auxx/types/resource'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { useInstanceShare } from '~/components/permissions/hooks/use-instance-share'
import { useActors } from '~/components/resources/hooks/use-actor'
import { ActorAvatar } from '~/components/resources/ui/actor-badge'

/** How many faces before the rest collapse into a "+N". */
const MAX_FACES = 3

/**
 * Who a record is shared with, as a compact overlapping avatar stack — the
 * at-a-glance answer to "is this private?" that otherwise costs opening the
 * share dialog.
 *
 * ⚠ **Mount this only behind `canShare`.** It issues
 * `resourceAccess.forInstance`, a per-record query, and the grantee list is
 * itself information a non-admin has no business reading — who else can see a
 * record is not something a `read` member should be able to enumerate. Gating at
 * the CALL SITE rather than inside keeps the query from being issued at all,
 * where an internal early-return would still have paid for it.
 *
 * Renders nothing when the record has no explicit grants (the common case), so
 * an unshared record shows a bare Share button rather than an empty slot.
 */
export function InstanceShareAvatars({
  recordId,
  className,
}: {
  recordId: RecordId
  className?: string
}) {
  const { grants, isLoading } = useInstanceShare({ recordId })
  // Pure store read — no query of its own; the actor store is hydrated once per
  // org by its provider.
  const actors = useActors(grants.map((g) => g.actorId))

  if (isLoading || grants.length === 0) return null

  const shown = grants.slice(0, MAX_FACES)
  const overflow = grants.length - shown.length
  const names = grants.map((g) => actors.get(g.actorId)?.name ?? 'Someone')

  return (
    <SimpleTooltip content={`Shared with ${names.join(', ')}`}>
      {/* `-space-x-1.5` overlaps the faces; each carries the page background as
          a ring so the overlap reads as a stack rather than a smudge. */}
      <div className={cn('-space-x-1.5 flex items-center', className)}>
        {shown.map((grant) => {
          const actor = actors.get(grant.actorId)
          return (
            <ActorAvatar
              key={grant.actorId}
              type={actor?.type ?? 'user'}
              avatarUrl={actor?.avatarUrl}
              className='size-5 ring-2 ring-background'
            />
          )
        })}
        {overflow > 0 && (
          <span className='flex size-5 items-center justify-center rounded-full bg-neutral-200 text-[9px] text-neutral-700 ring-2 ring-background dark:bg-neutral-700 dark:text-neutral-200'>
            +{overflow}
          </span>
        )}
      </div>
    </SimpleTooltip>
  )
}
