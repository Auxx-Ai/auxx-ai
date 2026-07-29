import SettingsPage from '~/components/global/settings-page'
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
      <TagTreeView />
    </SettingsPage>
  )
}

export default TagsPage
