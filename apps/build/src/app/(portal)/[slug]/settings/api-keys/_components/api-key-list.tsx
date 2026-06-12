// apps/build/src/app/(portal)/[slug]/settings/api-keys/_components/api-key-list.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { formatDistanceToNow } from 'date-fns'
import { KeyRound, Trash2 } from 'lucide-react'
import { toastError } from '~/components/global/toast'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

type Key = {
  id: string
  name: string | null
  createdAt: Date
}

interface Props {
  developerSlug: string
  keys: Key[]
}

export function ApiKeyList({ developerSlug, keys }: Props) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()

  const revoke = api.apiKeys.revoke.useMutation({
    onSuccess: () => utils.apiKeys.list.invalidate({ developerSlug }),
    onError: (error) => toastError({ title: 'Failed to revoke key', description: error.message }),
  })

  async function handleRevoke(key: Key) {
    const confirmed = await confirm({
      title: 'Revoke API key?',
      description: `${key.name || 'This key'} will stop working immediately. This cannot be undone.`,
      confirmText: 'Revoke',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      revoke.mutate({ developerSlug, id: key.id })
    }
  }

  if (keys.length === 0) {
    return (
      <div className='text-center text-sm text-muted-foreground py-8'>
        No API keys yet. Create one to publish apps from CI.
      </div>
    )
  }

  return (
    <div className='space-y-1'>
      {keys.map((key) => (
        <div
          key={key.id}
          className='group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200'>
          <div className='flex items-center gap-3'>
            <div className='size-8 border bg-muted rounded-lg flex items-center justify-center shrink-0'>
              <KeyRound className='size-4' />
            </div>
            <div className='flex flex-col'>
              <div className='text-sm font-medium'>{key.name || 'Untitled key'}</div>
              <div className='text-muted-foreground text-xs'>
                Created {formatDistanceToNow(new Date(key.createdAt), { addSuffix: true })}
              </div>
            </div>
          </div>
          <Button
            variant='ghost'
            size='icon-sm'
            onClick={() => handleRevoke(key)}
            disabled={revoke.isPending}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <ConfirmDialog />
    </div>
  )
}
