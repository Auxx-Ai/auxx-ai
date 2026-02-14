// import { SessionProvider } from 'next-auth/react'
import { Suspense } from 'react'

// import { auth } from '~/auth/server'

type Props = { children: React.ReactNode }

const layout = async ({ children }: Props) => {
  // const session = await auth()
  return <Suspense>{children}</Suspense>
  // return <SessionProvider session={session}>{children}</SessionProvider>
}

export default layout
