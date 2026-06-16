import SettingsPage from '~/components/global/settings-page'
import { AccountSettings } from './_components/account-settings'

export default function AccountPage() {
  return (
    <SettingsPage title='My Account' description='Manage your credentials and account access'>
      <div className='p-3 sm:p-8'>
        <AccountSettings />
      </div>
    </SettingsPage>
  )
}
