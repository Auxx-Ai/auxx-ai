// apps/web/src/components/inbox/inbox-members-page.tsx
'use client'

import type { LensChoice } from '@auxx/lib/permissions/visibility/client'
import type { ActorId } from '@auxx/types/actor'
import { Button } from '@auxx/ui/components/button'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { Section } from '@auxx/ui/components/section'
import { Plus, Users } from 'lucide-react'
import {
  MailGranteeAddButton,
  MailGranteeList,
} from '~/components/mail-permissions/ui/mail-grantee-list'
import type { UnmanageableGrant } from '~/components/permissions/utils/grantee'

/** A grantee row as the form edits it (mirrors {@link InboxForm}'s FormGrant). */
interface FormGrant {
  actorId: ActorId
  choice: LensChoice
}

interface InboxMembersPageProps {
  grants: FormGrant[]
  onGrant: (actorId: ActorId, choice: LensChoice) => void
  onChangeLens: (actorId: ActorId, choice: LensChoice) => void
  onRevoke: (actorId: ActorId) => void
  /** Renders the Manager entry in each row's picker (inbox surface only). */
  includeManager?: boolean
  disabled?: boolean
  /** Empty-state description. */
  emptyHint?: string
  /**
   * Rows that render muted with a fixed level and no remove/change controls —
   * the inbox owner's locked Manager grant, so the list never lies.
   */
  lockedActorIds?: ActorId[]
  /** Grants on a kind the list can't address (e.g. `profile`) — disclosed, not dropped. */
  unmanageableGrants?: UnmanageableGrant[]
  /** Personal-account note rendered above the list. */
  note?: string
  /** Opens the access-levels guide. */
  onOpenGuide?: () => void
  /** Returns to the configure page. */
  onBack: () => void
}

/**
 * The "People & groups" drill page — the second page of the inbox dialog, styled
 * like the webhook `topics` page: a non-collapsible {@link Section} wrapping the
 * shared {@link GranteeList} (the single grantee-row source), plus a personal
 * note, the access-levels guide link, and a footer. Fully controlled —
 * persistence lives in the hosting form's submit.
 */
export function InboxMembersPage({
  grants,
  onGrant,
  onChangeLens,
  onRevoke,
  includeManager = false,
  disabled = false,
  emptyHint = 'Not shared with anyone yet.',
  lockedActorIds = [],
  unmanageableGrants,
  note,
  onOpenGuide,
  onBack,
}: InboxMembersPageProps) {
  return (
    <div className='flex flex-col'>
      <Section
        title='People & groups'
        icon={<Users className='size-4' />}
        collapsible={false}
        actions={
          <MailGranteeAddButton grants={grants} onGrant={onGrant} disabled={disabled}>
            <Button variant='ghost' size='xs' disabled={disabled}>
              <Plus />
              Add
            </Button>
          </MailGranteeAddButton>
        }>
        {note && <p className='px-1 pb-2 text-muted-foreground text-xs'>{note}</p>}

        <MailGranteeList
          grants={grants}
          onGrant={onGrant}
          onChangeLens={onChangeLens}
          onRevoke={onRevoke}
          includeManager={includeManager}
          disabled={disabled}
          emptyHint={emptyHint}
          lockedActorIds={lockedActorIds}
          unmanageableGrants={unmanageableGrants}
          hideAddButton
        />

        {onOpenGuide && (
          <button
            type='button'
            className='mt-2 self-start px-1 text-muted-foreground text-xs underline-offset-2 hover:underline'
            onClick={onOpenGuide}>
            Learn about access levels
          </button>
        )}
      </Section>

      {/* The bangs are required, not stylistic: `DialogNavPages` gutters nested
          footers with `[&_[data-slot=dialog-footer]]:px-4 …:pb-4`, and that
          descendant selector outranks a plain utility. Without them this compact
          footer silently renders at the standard 4-gutter, misaligned with the
          Section's `p-3` above it. */}
      <DialogFooter className='px-3! py-2!'>
        <Button variant='outline' size='sm' type='button' onClick={onBack}>
          Done
        </Button>
      </DialogFooter>
    </div>
  )
}
