// apps/web/src/app/(protected)/app/settings/signatures/page.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import SettingsPage from '~/components/global/settings-page'
import { SignatureDialog, SignatureList } from '~/components/signatures/ui'

/**
 * Signatures settings page.
 * Lists all signatures with options to create, edit, and delete via a dialog.
 */
export default function SignaturesPage() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const openCreate = () => {
    setEditingId(null)
    setDialogOpen(true)
  }

  const openEdit = (id: string) => {
    setEditingId(id)
    setDialogOpen(true)
  }

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
      {dialogOpen && (
        <SignatureDialog open={dialogOpen} onOpenChange={setDialogOpen} signatureId={editingId} />
      )}
    </SettingsPage>
  )
}
