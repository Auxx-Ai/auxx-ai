import { MailIcon } from 'lucide-react'
import SettingsPage from '~/components/global/settings-page'
import { EmailTemplatesList } from './_components/template-list'

type Props = {}

function EmailTemplateListPage({}: Props) {
  return (
    <SettingsPage
      title='Email Templates'
      description='Customize the emails sent to your customers.'
      icon={<MailIcon />}
      breadcrumbs={[
        { title: 'Support Tickets', href: '/app/tickets' },
        { title: 'Settings', href: '/app/tickets/settings' },
        { title: 'Email Templates' },
      ]}>
      <div className='pt-3 sm:pt-8 p-0 sm:p-8'>
        <EmailTemplatesList />
      </div>
      {/* <InviteForm organizationId={defaultOrganizationId} /> */}
    </SettingsPage>
  )
}

export default EmailTemplateListPage
