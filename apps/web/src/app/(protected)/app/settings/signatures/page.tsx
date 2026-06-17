// apps/web/src/app/(protected)/app/settings/signatures/page.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { PlusIcon } from 'lucide-react'
import SettingsPage from '~/components/global/settings-page'
import { useSignatureDialogStore } from '~/components/signatures/stores/signature-dialog-store'
import { SignatureList } from '~/components/signatures/ui'

/**
 * Signatures settings page.
 * Lists all signatures; create/edit run through the global signature dialog
 * (see {@link useSignatureDialogStore} + SignatureDialogRoot at the app root),
 * so the same dialog is reachable from the command palette.
 */
export default function SignaturesPage() {
  const openCreate = useSignatureDialogStore((s) => s.openCreate)
  const openEdit = useSignatureDialogStore((s) => s.openEdit)

  return (
    <SettingsPage
      title='Email Signatures'
      description='Give your teammates access to predefined signatures on email channels by creating shared signatures.'
      button={
        <Button variant='outline' size='sm' onClick={openCreate}>
          <PlusIcon className='h-4 w-4' />
          Add Signature
        </Button>
      }
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Signatures' }]}>
      <SignatureList onCreate={openCreate} onEdit={openEdit} />
    </SettingsPage>
  )
}
