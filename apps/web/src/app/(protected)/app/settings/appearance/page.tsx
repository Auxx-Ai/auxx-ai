import AppearanceForm from '~/components/global/forms/appearance-form'
import SettingsPage from '~/components/global/settings-page'
import { api } from '~/trpc/server'

type Props = {}

export default async function AppearancePage({}: Props) {
  const settings = await api.user.settings()
  console.log('settings:', settings)

  return (
    <SettingsPage
      title='Appearance'
      description='Customize the appearance of the app. Automatically switch between day and night themes.'
      breadcrumbs={[{ title: 'Settings', href: '/settings' }]}>
      <div className='p-8'>
        <AppearanceForm settings={settings} />
      </div>
    </SettingsPage>
  )
}
