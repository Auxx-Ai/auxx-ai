import { redirect } from 'next/navigation'
import { getSession } from '~/auth/session'
import { AdminPageGuard } from '~/components/global/admin-page-guard'
import SettingsPage from '~/components/global/settings-page'
import InviteForm from '../_components/invite-form'

type Props = {}

async function InvitePage({}: Props) {
  const session = await getSession()

  if (!session) {
    redirect('/login')
  }
  const defaultOrgId = session.user?.defaultOrganizationId

  const defaultOrganizationId = 'your-default-organization-id' // Replace with actual logic to get the default organization ID
  return (
    <SettingsPage
      title='Members'
      description='Members of your organization'
      breadcrumbs={[
        { title: 'Settings', href: '/app/settings' },
        { title: 'Members', href: '/app/settings/members' },
        { title: 'Invite' },
      ]}>
      <AdminPageGuard />
      <div className='p-8'>
        <InviteForm organizationId={defaultOrgId} />
      </div>
    </SettingsPage>
  )
}

export default InvitePage
