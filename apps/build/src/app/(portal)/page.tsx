import { SimpleLayout } from '@/components/layouts/simple-layout'
import { getLocalSession } from '~/lib/auth'
import { AccountsCard } from './_components/accounts-card'

export default async function Home() {
  const session = await getLocalSession()

  return (
    <SimpleLayout title='Subscription'>
      <AccountsCard />
      <div>{session?.email}</div>
    </SimpleLayout>
  )
}
