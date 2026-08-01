import { redirect } from 'next/navigation'
import { getSession } from '~/auth/session'
import { CapabilityPageGuard } from '~/components/global/capability-page-guard'
import SettingsPage from '~/components/global/settings-page'
import InviteForm from '../_components/invite-form'

async function InvitePage() {
  const session = await getSession()

  if (!session) {
    redirect('/login')
  }

  // Inviting is organization-scoped; with no active org there is nothing to invite into.
  const defaultOrgId = session.user?.defaultOrganizationId
  if (!defaultOrgId) {
    redirect('/organizations')
  }

  return (
    <SettingsPage
      title='Members'
      description='Members of your organization'
      breadcrumbs={[
        { title: 'Settings', href: '/app/settings' },
        { title: 'Members', href: '/app/settings/members' },
        { title: 'Invite' },
      ]}>
      <CapabilityPageGuard permissionKey='members.manage' />
      <div className='p-8'>
        <InviteForm organizationId={defaultOrgId} />
      </div>
    </SettingsPage>
  )
}

export default InvitePage
