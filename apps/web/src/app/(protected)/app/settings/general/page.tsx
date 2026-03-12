import SettingsPage from '~/components/global/settings-page'
import { EditUserProfileForm } from './_components/edit-user-profile'

type Props = {}

export default function GeneralPage({}: Props) {
  return (
    <SettingsPage title='General' description='Manage your organization and user preferences'>
      <div className='p-8'>
        <EditUserProfileForm />
      </div>
    </SettingsPage>
  )
}
