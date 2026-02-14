import { MailIcon } from 'lucide-react'
import React from 'react'
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
      ]}
      button={
        <div className='flex items-center gap-2'>
          {/* <Button variant='outline' size='sm' asChild>
              <Link href='/app/settings/members'>
                <RefreshCw className='h-4 w-4' />
                Refresh
              </Link>
            </Button> */}
        </div>
      }>
      <div className='p-8'>
        <EmailTemplatesList />
      </div>
      {/* <InviteForm organizationId={defaultOrganizationId} /> */}
    </SettingsPage>
  )
}

export default EmailTemplateListPage
