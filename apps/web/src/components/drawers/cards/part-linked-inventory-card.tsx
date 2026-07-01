// apps/web/src/components/drawers/cards/part-linked-inventory-card.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Switch } from '@auxx/ui/components/switch'
import { toastError } from '@auxx/ui/components/toast'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

interface PartLinkedInventoryCardProps {
  /** The part's entityInstanceId. */
  partId: string
}

/**
 * Option F console — every inventory source linked to this part, with its watermark, the
 * source's current level, and (for confirm-mode links) a pending consumption delta the user
 * applies. Renders nothing when the part has no links. Divergence is signal, not error: a part
 * QoH below the source level just means stock was written off in auxx (auxx-ledger-truth).
 */
export function PartLinkedInventoryCard({ partId }: PartLinkedInventoryCardProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()
  const { data: links } = api.inventoryBridge.linksForPart.useQuery({ partInstanceId: partId })

  const invalidate = () => utils.inventoryBridge.linksForPart.invalidate({ partInstanceId: partId })

  const applyPending = api.inventoryBridge.applyPending.useMutation({
    onError: (e) => toastError({ title: 'Failed to apply deduction', description: e.message }),
    onSuccess: () => void invalidate(),
  })
  const setMode = api.inventoryBridge.setMode.useMutation({
    onError: (e) => toastError({ title: 'Failed to change mode', description: e.message }),
    onSuccess: () => void invalidate(),
  })
  const unlink = api.inventoryBridge.unlink.useMutation({
    onError: (e) => toastError({ title: 'Failed to unlink', description: e.message }),
    onSuccess: () => void invalidate(),
  })

  if (!links || links.length === 0) return null

  const busy = applyPending.isPending || setMode.isPending || unlink.isPending

  return (
    <div className='group/entity-card bg-primary-100/50 dark:bg-[#23272e]/50 dark:border rounded-2xl relative ring-border-illustration shadow-black/6.5 shadow-md ring-1 w-full'>
      <div className='flex flex-col gap-2 p-3'>
        <div className='text-sm font-semibold text-neutral-400'>Inventory sources</div>

        {links.map((link) => {
          const diverges =
            link.currentQuantity != null && link.currentQuantity !== link.lastSeenQuantity
          return (
            <div
              key={link.variantInstanceId}
              className='flex flex-col gap-1.5 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] p-2.5'>
              <div className='flex items-center justify-between gap-2'>
                <span className='text-sm tabular-nums'>
                  Source {link.currentQuantity ?? '—'} · watermark {link.lastSeenQuantity}
                </span>
                {link.pendingDelta > 0 && (
                  <Badge variant='yellow'>−{link.pendingDelta} pending</Badge>
                )}
              </div>

              {diverges && link.pendingDelta === 0 && (
                <p className='text-xs text-muted-foreground'>
                  Source and part have diverged — e.g. stock written off in auxx.
                </p>
              )}

              <div className='flex items-center justify-between gap-2'>
                <label className='flex items-center gap-2 text-xs text-muted-foreground'>
                  <Switch
                    checked={link.mode === 'auto'}
                    disabled={busy}
                    onCheckedChange={(checked) =>
                      setMode.mutate({
                        variantInstanceId: link.variantInstanceId,
                        mode: checked ? 'auto' : 'confirm',
                      })
                    }
                  />
                  Auto-deduct
                </label>

                <div className='flex items-center gap-1.5'>
                  {link.pendingDelta > 0 && (
                    <Button
                      variant='outline'
                      size='xs'
                      loading={applyPending.isPending}
                      disabled={busy}
                      onClick={() =>
                        applyPending.mutate({ variantInstanceId: link.variantInstanceId })
                      }>
                      Apply
                    </Button>
                  )}
                  <Button
                    variant='ghost'
                    size='xs'
                    disabled={busy}
                    onClick={async () => {
                      const ok = await confirm({
                        title: 'Unlink inventory source?',
                        description: 'This part will no longer deduct from this source.',
                        confirmText: 'Unlink',
                        cancelText: 'Cancel',
                        destructive: true,
                      })
                      if (ok)
                        unlink.mutate({
                          variantInstanceId: link.variantInstanceId,
                          sourceDefId: link.sourceDefId,
                        })
                    }}>
                    Unlink
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <ConfirmDialog />
    </div>
  )
}
