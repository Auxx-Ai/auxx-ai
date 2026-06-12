// apps/build/src/app/(portal)/[slug]/settings/api-keys/_components/create-api-key-dialog.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { CopyButton } from '@auxx/ui/components/button-copy'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { toastError } from '~/components/global/toast'
import { api } from '~/trpc/react'

interface Props {
  developerSlug: string
}

/**
 * Dialog to mint a developer API key. The plaintext is shown once on creation.
 */
export function CreateApiKeyDialog({ developerSlug }: Props) {
  const utils = api.useUtils()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [secret, setSecret] = useState('')

  const create = api.apiKeys.create.useMutation({
    onSuccess: (data) => {
      setSecret(data.secretKey)
      utils.apiKeys.list.invalidate({ developerSlug })
    },
    onError: (error) => toastError({ title: 'Failed to create key', description: error.message }),
  })

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setName('')
      setSecret('')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant='outline' size='sm'>
          <Plus />
          Create key
        </Button>
      </DialogTrigger>
      <DialogContent
        onEscapeKeyDown={(e) => secret && e.preventDefault()}
        onPointerDownOutside={(e) => secret && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Create developer API key</DialogTitle>
          <DialogDescription>
            Use this key as <code>AUXX_API_KEY</code> in CI to publish apps headlessly.
          </DialogDescription>
        </DialogHeader>

        {secret ? (
          <div className='space-y-2'>
            <DialogDescription>
              This will only be shown once. Copy it and store it securely.
            </DialogDescription>
            <div className='flex items-center gap-2 rounded-md border px-3 py-2'>
              <code className='flex-1 truncate text-xs'>{secret}</code>
              <CopyButton text={secret} />
            </div>
          </div>
        ) : (
          <div className='space-y-4'>
            <div className='space-y-1'>
              <label className='text-sm font-medium' htmlFor='key-name'>
                Name (optional)
              </label>
              <Input
                id='key-name'
                placeholder='CI deploy key'
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className='flex justify-end'>
              <Button
                variant='outline'
                size='sm'
                loading={create.isPending}
                loadingText='Creating...'
                onClick={() => create.mutate({ developerSlug, name: name || undefined })}>
                Create
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
