// apps/web/src/components/mail-permissions/ui/access-levels-guide.tsx
'use client'

import { GuideConcept, GuideConcepts, GuideDialog, GuideSection } from '@auxx/ui/components/guide'
import { Activity, Eye, EyeOff, Heading, ShieldCheck } from 'lucide-react'

/**
 * "Learn about access levels" — the shared explainer linked from the inbox
 * Access section and the thread share popover footer.
 */
export function AccessLevelsGuide({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <GuideDialog open={open} onOpenChange={onOpenChange} title='Access levels' size='lg'>
      <GuideConcepts>
        <GuideConcept glyph={<Eye className='size-4' />} term='Full access'>
          Read and reply to conversations — message content, attachments, and unread state. Full
          access is also what assignment gives on a single conversation.
        </GuideConcept>
        <GuideConcept glyph={<Heading className='size-4' />} term='Subject only'>
          See who is talking, when, and subject lines — never message content or attachments.
        </GuideConcept>
        <GuideConcept glyph={<Activity className='size-4' />} term='Activity only'>
          See that conversations exist: participants, timestamps, status, and tags — no subjects, no
          content.
        </GuideConcept>
        <GuideConcept glyph={<EyeOff className='size-4' />} term='No access'>
          Conversations are hidden entirely — they don't appear in lists, search, or counts.
        </GuideConcept>
        <GuideConcept glyph={<ShieldCheck className='size-4' />} term='Manager'>
          Full access plus managing who can see the inbox — without needing to be an organization
          admin.
        </GuideConcept>
      </GuideConcepts>
      <GuideSection title='How access combines' cols={1}>
        <GuideConcept term='Inbox default + individual shares'>
          Every inbox sets a default level for the whole organization ("Everyone" at a level, or
          "Restricted" for no default access). Individual shares — on the inbox, a single
          conversation, or a contact — only ever raise someone's level, never lower it. Being
          assigned a conversation always grants full access to it, and organization admins see
          everything.
        </GuideConcept>
      </GuideSection>
    </GuideDialog>
  )
}
