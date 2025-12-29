import { SimpleLayout } from '@/components/layouts/simple-layout'
import { getSession } from '~/lib/auth'
import { AccountsCard } from './_components/accounts-card'

export default async function Home() {
  const session = await getSession()

  return (
    <SimpleLayout title="Subscription">
      <AccountsCard />
      <div>{session?.userName || session?.userEmail}</div>
    </SimpleLayout>
  )
}
