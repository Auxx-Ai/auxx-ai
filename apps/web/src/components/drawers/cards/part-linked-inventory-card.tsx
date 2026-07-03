// apps/web/src/components/drawers/cards/part-linked-inventory-card.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Switch } from '@auxx/ui/components/switch'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { ResourceBadge } from '~/components/resources/ui/resource-badge'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

interface PartLinkedInventorySectionProps {
  /** The part's entityInstanceId. */
  partId: string
}

/**
 * Synced-inventory section of the part inventory card: each external stock feed linked to this
 * part with its current level, and — in confirm mode — the units it wants to deduct. Auto-deduct
 * keeps the part in lock-step with the source; confirm mode holds the deduction for review.
 * Renders nothing when the part has no linked feeds. Designed to nest inside `PartInventoryCard`.
 */
export function PartLinkedInventorySection({ partId }: PartLinkedInventorySectionProps) {
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

  const handleUnlink = async (variantInstanceId: string, sourceDefId: string) => {
    const ok = await confirm({
      title: 'Unlink inventory source?',
      description: 'This part will no longer deduct from this source.',
      confirmText: 'Unlink',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (ok) unlink.mutate({ variantInstanceId, sourceDefId })
  }

  if (!links || links.length === 0) return null

  const busy = applyPending.isPending || setMode.isPending || unlink.isPending
  // A part usually has a single source — surface Unlink in the header; fall back to a per-row
  // button only when several sources are linked and the header can't disambiguate.
  const single = links.length === 1

  return (
    <div className='border-t border-border/50 pt-2 mt-1 flex flex-col gap-2'>
      <div className='flex items-start justify-between gap-2'>
        <div>
          <h4 className='text-xs font-semibold text-muted-foreground'>Synced inventory</h4>
          <p className='text-xs text-muted-foreground/70'>
            Deducts this part when a linked source sells stock.
          </p>
        </div>
        {single && (
          <Button
            variant='ghost'
            size='xs'
            disabled={busy}
            onClick={() => handleUnlink(links[0].variantInstanceId, links[0].sourceDefId)}>
            Unlink
          </Button>
        )}
      </div>

      {links.map((link) => (
        <div key={link.variantInstanceId} className='flex flex-col'>
          {/* Source + its current level */}
          <TreeRow
            title={<ResourceBadge id={link.sourceDefId} />}
            description='Live stock level at the linked source.'
            actions={
              <div className='flex items-center gap-2'>
                {link.pendingDelta > 0 && (
                  <Badge variant='yellow' size='xs'>
                    {link.pendingDelta} to deduct
                  </Badge>
                )}
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
                <span className='text-sm font-semibold tabular-nums text-foreground'>
                  {link.currentQuantity ?? '—'}
                </span>
                {!single && (
                  <Button
                    variant='ghost'
                    size='xs'
                    disabled={busy}
                    onClick={() => handleUnlink(link.variantInstanceId, link.sourceDefId)}>
                    Unlink
                  </Button>
                )}
              </div>
            }
          />

          {/* Auto-deduct toggle */}
          <TreeRow
            title='Auto-deduct'
            description='Automatically lowers this part when the source sells. Off holds each change for review.'
            actions={
              <Switch
                size='xs'
                checked={link.mode === 'auto'}
                disabled={busy}
                onCheckedChange={(checked) =>
                  setMode.mutate({
                    variantInstanceId: link.variantInstanceId,
                    mode: checked ? 'auto' : 'confirm',
                  })
                }
              />
            }
          />
        </div>
      ))}
      <ConfirmDialog />
    </div>
  )
}
