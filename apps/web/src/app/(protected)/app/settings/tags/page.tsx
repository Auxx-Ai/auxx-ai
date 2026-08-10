// apps/web/src/app/(protected)/app/settings/tags/page.tsx

import { ArrowRight, Sparkles } from 'lucide-react'
import Link from 'next/link'
import SettingsPage, { SettingsSection } from '~/components/global/settings-page'
import { TagTreeView } from '~/components/tags/ui/tags-list'

/**
 * Settings page for managing organization tags.
 *
 * No `CapabilityPageGuard` here on purpose: tags are records, so the gate is the
 * per-def `canEditEntity(tag)` that `TagTreeView` runs — a coarse key here would
 * be a second authority disagreeing with the one the server enforces, which is
 * the defect plan 39 exists to remove.
 */
async function TagsPage() {
  return (
    <SettingsPage
      title='Company Tags'
      description='Shared tags help you and your team stay organize conversations, tickets, and more'
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Tags' }]}>
      {/* AI tagging needs BOTH halves: an eligible tag here and an opted-in
          inbox there. Marking five tags and seeing nothing happen because no
          inbox is switched on is a dead end, so the two halves point at each
          other. */}
      <div className='border-b p-3 sm:p-6'>
        <SettingsSection
          icon={<Sparkles className='size-4' />}
          title='AI tagging'
          description={
            <>
              Open any tag and turn on <span className='font-medium'>Let AI apply this tag</span> to
              add it to the set Auxx may apply to incoming mail — its description tells the
              classifier when it fits. Nothing is classified until you also switch a specific inbox
              on.
            </>
          }
          action={
            <Link
              href='/app/settings/inbox'
              className='inline-flex min-w-0 items-center gap-1.5 text-primary-600 text-sm underline-offset-4 hover:underline'>
              <span className='truncate'>Inbox settings</span>
              <ArrowRight className='size-3.5 shrink-0' />
            </Link>
          }
        />
      </div>

      <TagTreeView />
    </SettingsPage>
  )
}

export default TagsPage
