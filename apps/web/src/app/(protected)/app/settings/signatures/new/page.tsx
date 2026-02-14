// apps/web/src/app/(protected)/app/settings/signatures/new/page.tsx

import { headers } from 'next/headers'
import React from 'react'
import { auth } from '~/auth/server'
import SettingsPage from '~/components/global/settings-page'
import { SignatureForm } from '~/components/signatures/ui'

export default async function NewSignaturePage() {
  const session = await auth.api.getSession({ headers: await headers() })

  const isAdmin = session?.user?.role === 'ADMIN'

  return (
    <SettingsPage
      title='Create New Signature'
      description='Set the appearance of your organization'
      breadcrumbs={[
        { title: 'Settings', href: '/app/settings' },
        { title: 'Signatures', href: '/app/settings/signatures' },
        { title: 'New Signature' },
      ]}>
      <div className='p-8'>
        <SignatureForm isAdmin={isAdmin} />
      </div>
    </SettingsPage>
  )
}
