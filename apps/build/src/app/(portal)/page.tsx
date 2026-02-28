import { SimpleLayout } from '@/components/layouts/simple-layout'
import { AccountsCard } from './_components/accounts-card'

export default function Home() {
  return (
    <SimpleLayout title='Subscription'>
      <AccountsCard />
    </SimpleLayout>
  )
}
