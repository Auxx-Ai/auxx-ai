// ~/app/(dashboard)/signatures/[id]/edit/page.tsx
import React from 'react'
import { notFound } from 'next/navigation'
import { api } from '~/trpc/server'
import { auth } from '~/auth/server'
import { SignatureForm } from '../../_components/signature-form'
import SettingsPage from '~/components/global/settings-page'
import { headers } from 'next/headers'

interface EditSignaturePageProps {
  params: Promise<{ signatureId: string }>
}

export default async function EditSignaturePage({ params }: EditSignaturePageProps) {
  const { signatureId } = await params

  // Fetch the signature
  const signature = await api.signature.getById({ id: signatureId })
  const session = await auth.api.getSession({ headers: await headers() })

  // const session = await auth()
  // Check if user is admin
  const isAdmin = session?.user?.role === 'ADMIN'

  if (!signature) {
    notFound()
  }

  return (
    <SettingsPage
      title="Edit Signatures"
      description="Update the appearance of the signature"
      breadcrumbs={[
        { title: 'Settings', href: '/app/settings' },
        { title: 'Signatures', href: '/app/settings/signatures' },
      ]}>
      <div className="p-8">
        <SignatureForm signature={signature} isAdmin={isAdmin} />
      </div>
    </SettingsPage>
  )
}
