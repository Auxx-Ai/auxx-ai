// apps/web/src/components/manufacturing/parts/link-inventory-source-dialog.tsx
'use client'

import type { RecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import { Label } from '@auxx/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Switch } from '@auxx/ui/components/switch'
import { toastError } from '@auxx/ui/components/toast'
import { useEffect, useMemo, useState } from 'react'
import { RecordPicker } from '~/components/pickers/record-picker'
import { parseRecordId } from '~/components/resources'
import { api } from '~/trpc/react'

interface LinkInventorySourceDialogProps {
  /** The part's entityInstanceId. */
  partId: string
  onSuccess?: () => void
  children: React.ReactNode
}

type Mode = 'auto' | 'confirm'

/**
 * "Link inventory source" — connect a synced inventory record (e.g. a Shopify variant) to
 * this part so its level changes deduct the part (via the v9 watermark bridge). Sets the
 * relationship + baselines the watermark; optionally seeds the part's opening stock.
 */
export function LinkInventorySourceDialog({
  partId,
  onSuccess,
  children,
}: LinkInventorySourceDialogProps) {
  const [open, setOpen] = useState(false)
  const [sourceDefId, setSourceDefId] = useState<string | null>(null)
  const [variantRecordId, setVariantRecordId] = useState<RecordId | null>(null)
  const [mode, setMode] = useState<Mode>('confirm')
  const [baselineSeed, setBaselineSeed] = useState(false)

  const { data: sources } = api.inventoryBridge.sources.useQuery(undefined, { enabled: open })
  const utils = api.useUtils()

  // Default to the sole configured source when the dialog opens.
  useEffect(() => {
    if (open) {
      setVariantRecordId(null)
      setMode('confirm')
      setBaselineSeed(false)
      setSourceDefId(sources && sources.length > 0 ? sources[0]!.sourceDefId : null)
    }
  }, [open, sources])

  const link = api.inventoryBridge.link.useMutation({
    onError: (error) =>
      toastError({ title: 'Failed to link inventory source', description: error.message }),
    onSuccess: () => {
      void utils.inventoryBridge.linksForPart.invalidate({ partInstanceId: partId })
      onSuccess?.()
      setOpen(false)
    },
  })

  const sourceOptions = useMemo(() => sources ?? [], [sources])

  const handleSubmit = () => {
    if (!sourceDefId || !variantRecordId) return
    link.mutate({
      partInstanceId: partId,
      variantInstanceId: parseRecordId(variantRecordId).entityInstanceId,
      sourceDefId,
      mode,
      baselineSeed,
    })
  }

  const noSources = sources !== undefined && sourceOptions.length === 0

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent size='sm'>
        <DialogHeader>
          <DialogTitle>Link inventory source</DialogTitle>
          <DialogDescription>
            Connect a synced inventory record to this part. Its level changes will deduct the part
            and cascade through the bill of materials.
          </DialogDescription>
        </DialogHeader>

        {noSources ? (
          <p className='text-sm text-muted-foreground'>
            No inventory source is connected yet. Set up an inventory connector (e.g. Shopify)
            first.
          </p>
        ) : (
          <div className='space-y-4'>
            {/* Source def selector — only shown when more than one source is configured. */}
            {sourceOptions.length > 1 && (
              <div className='space-y-1.5'>
                <Label>Source</Label>
                <Select value={sourceDefId ?? undefined} onValueChange={setSourceDefId}>
                  <SelectTrigger>
                    <SelectValue placeholder='Select a source' />
                  </SelectTrigger>
                  <SelectContent>
                    {sourceOptions.map((s) => (
                      <SelectItem key={s.sourceDefId} value={s.sourceDefId}>
                        {s.sourceDefId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Record picker constrained to the chosen source def. */}
            <div className='space-y-1.5'>
              <Label>Record</Label>
              {sourceDefId && (
                <RecordPicker
                  entityDefinitionId={sourceDefId}
                  multi={false}
                  value={variantRecordId ? [variantRecordId] : []}
                  onSelectSingle={(recordId) => setVariantRecordId(recordId)}
                  emptyLabel='Choose a record'
                  triggerClassName='w-full'
                />
              )}
            </div>

            {/* Apply mode. */}
            <div className='space-y-1.5'>
              <Label>When inventory drops</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='confirm'>Suggest — I confirm each deduction</SelectItem>
                  <SelectItem value='auto'>Automatic — deduct immediately</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Baseline seed. */}
            <div className='flex items-start justify-between gap-3'>
              <div>
                <Label htmlFor='baseline-seed'>Match this part's stock to the source now</Label>
                <p className='text-xs text-muted-foreground'>
                  Adds a one-time adjustment so the part's on-hand equals the source's current
                  level. Does not touch sub-parts.
                </p>
              </div>
              <Switch id='baseline-seed' checked={baselineSeed} onCheckedChange={setBaselineSeed} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant='ghost' onClick={() => setOpen(false)} disabled={link.isPending}>
            Cancel
          </Button>
          <Button
            variant='outline'
            onClick={handleSubmit}
            disabled={!sourceDefId || !variantRecordId}
            loading={link.isPending}
            loadingText='Linking...'>
            Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
