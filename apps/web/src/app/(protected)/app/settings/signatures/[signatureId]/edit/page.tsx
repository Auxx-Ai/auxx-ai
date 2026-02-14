// apps/web/src/app/(protected)/app/settings/signatures/[signatureId]/edit/page.tsx
'use client'

import { Skeleton } from '@auxx/ui/components/skeleton'
import { notFound } from 'next/navigation'
import React, { use } from 'react'
import SettingsPage from '~/components/global/settings-page'
import { useSignature } from '~/components/signatures/hooks'
import { SignatureForm } from '~/components/signatures/ui'

interface EditSignaturePageProps {
  params: Promise<{ signatureId: string }>
}

/**
 * Edit signature page.
 * Uses the entity system via useSignature hook.
 */
export default function EditSignaturePage({ params }: EditSignaturePageProps) {
  const { signatureId } = use(params)
  const { signature, isLoading } = useSignature(signatureId)

  // TODO: Get isAdmin from session/auth context
  const isAdmin = true

  if (isLoading) {
    return (
      <SettingsPage
        title='Edit Signature'
        description='Update the appearance of the signature'
        breadcrumbs={[
          { title: 'Settings', href: '/app/settings' },
          { title: 'Signatures', href: '/app/settings/signatures' },
          { title: 'Edit' },
        ]}>
        <div className='p-8 space-y-4'>
          <Skeleton className='h-10 w-full' />
          <Skeleton className='h-40 w-full' />
          <Skeleton className='h-10 w-1/2' />
        </div>
      </SettingsPage>
    )
  }

  if (!signature) {
    notFound()
  }

  return (
    <SettingsPage
      title='Edit Signature'
      description='Update the appearance of the signature'
      breadcrumbs={[
        { title: 'Settings', href: '/app/settings' },
        { title: 'Signatures', href: '/app/settings/signatures' },
        { title: signature.name },
      ]}>
      <div className='p-8'>
        <SignatureForm
          signature={{
            id: signature.id,
            recordId: signature.recordId,
            name: signature.name,
            body: signature.body,
            isDefault: signature.isDefault,
            visibility: signature.visibility,
          }}
          isAdmin={isAdmin}
        />
      </div>
    </SettingsPage>
  )
}
