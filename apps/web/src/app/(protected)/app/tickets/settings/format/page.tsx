import { Ticket } from 'lucide-react'
import SettingsPage from '~/components/global/settings-page'
import TicketNumberingSettings from '../../_components/ticket-number-form'

type Props = {}

function TicketSequenceSettings({}: Props) {
  return (
    <SettingsPage
      title='Ticket Format'
      description='Configure how ticket numbers are generated for your organization.'
      icon={<Ticket />}
      breadcrumbs={[
        { title: 'Support Tickets', href: '/app/tickets' },
        { title: 'Settings', href: '/app/tickets/settings' },
        { title: 'Ticket format' },
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
        <TicketNumberingSettings />
      </div>
      {/* <InviteForm organizationId={defaultOrganizationId} /> */}
    </SettingsPage>
  )
}

export default TicketSequenceSettings
