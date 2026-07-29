// apps/web/src/app/(protected)/app/settings/signatures/page.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { PlusIcon } from 'lucide-react'
import SettingsPage from '~/components/global/settings-page'
import { useSignatureAccess } from '~/components/signatures/hooks'
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
  // Creating is the coarse `signatures.manage` rung — instance-less, so it takes
  // no id. The list itself stays visible: `signature.list` already filters to
  // what this member may see, and a member with shares but no create rung still
  // needs to reach them.
  const { canCreate } = useSignatureAccess()

  return (
    <SettingsPage
      title='Email Signatures'
      description='Sign off your replies with a saved signature, and share it with the teammates who should be able to use it.'
      button={
        canCreate ? (
          <Button variant='outline' size='sm' onClick={openCreate}>
            <PlusIcon className='h-4 w-4' />
            Add Signature
          </Button>
        ) : undefined
      }
      breadcrumbs={[{ title: 'Settings', href: '/app/settings' }, { title: 'Signatures' }]}>
      <SignatureList onCreate={canCreate ? openCreate : undefined} onEdit={openEdit} />
    </SettingsPage>
  )
}
