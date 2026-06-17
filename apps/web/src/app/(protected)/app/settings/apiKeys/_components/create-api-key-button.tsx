'use client'
import type { ApiKey } from '@auxx/database/types'
import { Button, type ButtonProps } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { ApiKeyForm } from './api-key-form'

type PointerDownOutsideEvent = CustomEvent<{
  originalEvent: PointerEvent
}>

type CreateAPIKeyButtonProps = {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: React.ReactNode
}

/**
 * Thin modal wrapper around {@link ApiKeyForm}. Supplies the `Dialog` shell, the
 * header, and the controlled/uncontrolled + trigger-hiding behavior; all form logic
 * lives in the core, which the command palette hosts directly as a page. Public API
 * is unchanged.
 */
export function CreateAPIKeyButton({
  open: externalOpen,
  onOpenChange: externalOnOpenChange,
  trigger,
}: CreateAPIKeyButtonProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [isSecretShown, setIsSecretShown] = useState(false)
  const isControlled = externalOpen !== undefined
  const open = isControlled ? externalOpen : internalOpen

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setIsSecretShown(false)
    }
    if (!isControlled) {
      setInternalOpen(newOpen)
    }
    externalOnOpenChange?.(newOpen)
  }

  // Block escape/outside-click dismissal while the secret is shown so it isn't lost.
  const onEscapeOrOutsideClick = (e: KeyboardEvent | PointerDownOutsideEvent) => {
    if (isSecretShown) {
      e.preventDefault()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant='outline' size='sm'>
            <PlusIcon />
            Create API Key
          </Button>
        )}
      </DialogTrigger>

      <DialogContent
        onEscapeKeyDown={onEscapeOrOutsideClick}
        onPointerDownOutside={onEscapeOrOutsideClick}
        position='tc'>
        <ApiKeyForm
          open={open}
          onSuccess={() => setIsSecretShown(true)}
          onClose={() => handleOpenChange(false)}
          header={({ title }) => (
            <DialogHeader className='mb-4'>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                This will create a new secret key for your account. You will need to use this secret
                key to authenticate your requests to the API.
              </DialogDescription>
            </DialogHeader>
          )}
        />
      </DialogContent>
    </Dialog>
  )
}
export function RevokeAPIKeyButton({
  id,
  buttonProps,
}: {
  id: ApiKey['id']
  buttonProps?: ButtonProps
}) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const revokeApiKey = api.apiKey.delete.useMutation({
    onSuccess: async () => {
      await utils.apiKey.getAll.invalidate()
      toastSuccess({ description: 'API key revoked' })
    },
    onError: (error) => {
      toastError({ description: error.message })
    },
  })

  const handleRevoke = async () => {
    const confirmed = await confirm({
      title: 'Revoke API key?',
      description: 'This action cannot be undone. Any application using this key will lose access.',
      confirmText: 'Revoke',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      await revokeApiKey.mutateAsync({ id })
    }
  }

  return (
    <>
      <Button onClick={handleRevoke} {...buttonProps} disabled={revokeApiKey.isPending}>
        Revoke
      </Button>
      <ConfirmDialog />
    </>
  )
}
