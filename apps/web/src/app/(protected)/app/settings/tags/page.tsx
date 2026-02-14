import SettingsPage from '~/components/global/settings-page'
import { TagTreeView } from '~/components/tags/ui/tags-list'

/**
 * Settings page for managing organization tags
 */
async function TagsPage() {
  return (
    <SettingsPage
      title='Company Tags'
      description='Shared tags help you and your team stay organize conversations, tickets, and more'
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Tags' }]}>
      <div className='p-8'>
        <TagTreeView />
      </div>
    </SettingsPage>
  )
}

export default TagsPage
