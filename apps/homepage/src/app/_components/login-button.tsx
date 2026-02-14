// apps/homepage/src/app/_components/login-button.tsx

import Link from 'next/link'
import React from 'react'
// import { auth } from '~/auth/server'
import { Button } from '~/components/ui/button'
import { config } from '~/lib/config'

export default async function LoginButton() {
  // const session = await auth.api.getSession({ headers: await headers() })

  // if (session) {
  //   return (
  //     <Button variant={'default'} size={'sm'} asChild>
  //       <Link href={config.urls.dashboard}>Dashboard</Link>
  //     </Button>
  //   )
  // } else {
  return (
    <Button variant={'secondary'} size={'sm'} asChild>
      <Link href={config.urls.login}>Login</Link>
    </Button>
  )
  // }
}
