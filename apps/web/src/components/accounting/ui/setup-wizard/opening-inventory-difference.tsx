// apps/web/src/components/accounting/ui/setup-wizard/opening-inventory-difference.tsx
'use client'

// The explicit, repeatable opening inventory difference screen (111 Q19/Q23): the books
// against the parts at the cutover, the in-books question asked once, the uncounted parts,
// and the one press that posts the delta. It never posts on its own.

import { FieldType } from '@auxx/database/enums'
import { DEFAULT_CHART_OF_ACCOUNTS } from '@auxx/lib/accounting/ledger/client'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { toastError } from '@auxx/ui/components/toast'
import { formatCurrency } from '@auxx/utils/currency'
import { BookOpen, Boxes, PackageSearch, Scale } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { Tooltip } from '~/components/global/tooltip'
import { useConfirm } from '~/hooks/use-confirm'
import { useSettings } from '~/hooks/use-settings'
import { api, type RouterOutputs } from '~/trpc/react'

type Difference = RouterOutputs['ledger']['openingInventory']['read']
type InBooks = NonNullable<Difference['inBooks']>
type Uncounted = Difference['uncounted'][number]

/** Where a count is set by hand; `parts` prefilters it (111 Q24). */
const SET_COUNTS_HREF = '/app/parts/manage/costing?s=opening'

/** 103 D2's two answers, and the account each one credits (111 Q19). */
const IN_BOOKS_OPTIONS: { value: InBooks; label: string; description: string; role: string }[] = [
  {
    value: 'revaluation',
    label: 'Already in my books',
    description: 'Inventory was on the old books at a different value.',
    role: 'inventory_revaluation',
  },
  {
    value: 'opening_equity',
    label: 'Never on my books',
    description: 'It was expensed when bought.',
    role: 'equity_opening_balance',
  },
]

/** `5092 Inventory Revaluation`, from the seeded chart; the role string when unmapped. */
export function creditAccountLabel(inBooks: InBooks): string {
  const role = IN_BOOKS_OPTIONS.find((option) => option.value === inBooks)?.role ?? inBooks
  const account = DEFAULT_CHART_OF_ACCOUNTS.find((entry) => entry.role === role)
  return account ? `${account.code} ${account.name}` : role
}

/** The entry's date: the day after the cutover, `YYYY-MM-DD`. */
export function dayAfter(cutoverDate: string): string {
  const date = new Date(`${cutoverDate}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

/** Why the press is disabled, or `null` when it may post. */
export function adjustDisabledReason(difference: Difference): string | null {
  if (difference.needsAnswer) return 'Answer whether this inventory was on your old books first.'
  if (difference.deltaMinor === 0) return 'The books and the parts agree; there is nothing to post.'
  return null
}

function formatUnits(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)))
}

export function OpeningInventoryDifference({ settingsHint = false }: { settingsHint?: boolean }) {
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'
  const money = (minor: number) => formatCurrency(minor, { currencyCode })

  const utils = api.useUtils()
  const read = api.ledger.openingInventory.read.useQuery()
  const refetch = () => utils.ledger.openingInventory.read.invalidate()

  const setInBooks = api.ledger.openingInventory.setInBooks.useMutation({
    onSuccess: () => {
      setAnswering(false)
      void refetch()
    },
    onError: (error) =>
      toastError({ title: 'The answer was not saved', description: error.message }),
  })
  const post = api.ledger.openingInventory.post.useMutation({
    onSuccess: () => void refetch(),
    onError: (error) =>
      toastError({ title: 'The difference was not posted', description: error.message }),
  })

  const [confirm, ConfirmDialog] = useConfirm()
  const [answering, setAnswering] = useState(false)
  const [adopting, setAdopting] = useState<Uncounted[] | null>(null)

  if (read.isPending) return <Skeleton className='h-40 w-full' />
  if (read.isError) {
    return (
      <Alert variant='neutral'>
        <AlertDescription>{read.error.message}</AlertDescription>
      </Alert>
    )
  }

  const difference = read.data
  const disabledReason = adjustDisabledReason(difference)
  const booksMinor = difference.providerOpeningMinor + difference.postedDifferencesMinor
  const showQuestion = difference.needsAnswer || answering

  const handleAdjust = async () => {
    if (!difference.inBooks) return
    const delta = difference.deltaMinor
    const confirmed = await confirm({
      title: 'Adjust the books?',
      description:
        `Posts ${delta > 0 ? 'Dr' : 'Cr'} Inventory ${money(Math.abs(delta))} against ` +
        `${creditAccountLabel(difference.inBooks)}, dated ${dayAfter(difference.cutoverDate)}, exported. ` +
        'Only the difference since the last entry is posted; pressing again later posts the next delta.',
      confirmText: 'Post the difference',
      cancelText: 'Cancel',
      destructive: false,
    })
    if (!confirmed) return
    post.mutate()
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-col gap-1'>
        <p className='text-sm' data-testid='difference-headline'>
          Books say <span className='font-medium tabular-nums'>{money(booksMinor)}</span> · your
          parts add up to{' '}
          <span className='font-medium tabular-nums'>
            {money(difference.partsValueAtCutoverMinor)}
          </span>{' '}
          · difference{' '}
          <span className='font-medium tabular-nums'>{money(difference.deltaMinor)}</span>
        </p>
        <p className='text-muted-foreground text-xs'>
          At the cutover, {difference.cutoverDate}.{' '}
          {difference.postedDifferenceCount === 0
            ? 'No difference entry has been posted yet.'
            : `${difference.postedDifferenceCount} ${difference.postedDifferenceCount === 1 ? 'entry' : 'entries'} posted so far, ${money(difference.postedDifferencesMinor)} in all.`}
          {difference.pendingRows > 0 &&
            ` ${difference.pendingRows} ${difference.pendingRows === 1 ? 'movement is' : 'movements are'} waiting for a standard cost; valued rows only.`}
          {settingsHint && ' You can come back to this under Accounting › Settings › Opening.'}
        </p>
      </div>

      {showQuestion ? (
        <div className='flex flex-col gap-2'>
          <p className='text-sm'>Was this inventory on your old books?</p>
          <RadioGroup
            value={difference.inBooks ?? ''}
            onValueChange={(next) => setInBooks.mutate({ inBooks: next as InBooks })}
            className='grid gap-2'>
            {IN_BOOKS_OPTIONS.map((option) => (
              <RadioGroupItemCard
                key={option.value}
                value={option.value}
                label={option.label}
                icon={option.value === 'revaluation' ? <BookOpen /> : <Boxes />}
                description={`${option.description} Posts against ${creditAccountLabel(option.value)}.`}
                disabled={setInBooks.isPending}
              />
            ))}
          </RadioGroup>
        </div>
      ) : (
        difference.inBooks && (
          <p className='text-muted-foreground text-xs'>
            Posts against{' '}
            <span className='font-medium text-foreground'>
              {creditAccountLabel(difference.inBooks)}
            </span>
            .{' '}
            <button type='button' className='underline' onClick={() => setAnswering(true)}>
              Change
            </button>
          </p>
        )
      )}

      <Section
        title='By part'
        icon={<Scale className='size-4 text-muted-foreground' />}
        secondary={`${difference.byPart.length} ${difference.byPart.length === 1 ? 'part' : 'parts'}`}
        initialOpen={false}>
        {difference.byPart.length === 0 ? (
          <p className='text-muted-foreground text-xs'>No part has been counted yet.</p>
        ) : (
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow className='hover:bg-transparent'>
                  <TableHead className='text-muted-foreground'>Part</TableHead>
                  <TableHead className='text-right text-muted-foreground'>Qty at cutover</TableHead>
                  <TableHead className='text-right text-muted-foreground'>Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {difference.byPart.map((part) => (
                  <TableRow key={part.partId} className='hover:bg-transparent'>
                    <TableCell className='text-xs'>{part.name}</TableCell>
                    <TableCell className='text-right text-xs tabular-nums'>
                      {formatUnits(part.qtyAtCutover)}
                    </TableCell>
                    <TableCell className='text-right text-xs tabular-nums'>
                      {money(part.valueMinor)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      {difference.uncounted.length > 0 && (
        <Section
          title='Uncounted parts'
          icon={<PackageSearch className='size-4 text-muted-foreground' />}
          description='Sold before the cutover, never counted — count them to value them.'
          secondary={`${difference.uncounted.length}`}
          actions={
            <div className='flex items-center gap-1'>
              <Button variant='ghost' size='xs' onClick={() => setAdopting(difference.uncounted)}>
                Adopt channel count for all
              </Button>
              <Button variant='ghost' size='xs' asChild>
                <Link
                  href={`${SET_COUNTS_HREF}&parts=${encodeURIComponent(difference.uncounted.map((p) => p.partId).join(','))}`}>
                  Set counts
                </Link>
              </Button>
            </div>
          }>
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow className='hover:bg-transparent'>
                  <TableHead className='text-muted-foreground'>Part</TableHead>
                  <Tooltip content='What left the shelf before the cutover with nothing counted behind it. A negative replay is throughput, not stock.'>
                    <TableHead className='cursor-default text-right text-muted-foreground'>
                      Throughput at cutover
                    </TableHead>
                  </Tooltip>
                  <TableHead className='w-px' />
                </TableRow>
              </TableHeader>
              <TableBody>
                {difference.uncounted.map((part) => (
                  <TableRow key={part.partId} className='hover:bg-transparent'>
                    <TableCell className='text-xs'>{part.name}</TableCell>
                    <TableCell className='text-right text-xs tabular-nums'>
                      {formatUnits(part.throughputAtCutover)}
                    </TableCell>
                    <TableCell className='whitespace-nowrap text-right'>
                      <Button variant='ghost' size='xs' onClick={() => setAdopting([part])}>
                        Adopt channel count
                      </Button>
                      <Button variant='ghost' size='xs' asChild>
                        <Link href={`${SET_COUNTS_HREF}&parts=${encodeURIComponent(part.partId)}`}>
                          Set count
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>
      )}

      <div className='flex flex-col items-end gap-1'>
        <Button
          variant='outline'
          size='sm'
          disabled={disabledReason !== null}
          loading={post.isPending}
          loadingText='Posting...'
          onClick={() => void handleAdjust()}>
          Adjust the books
        </Button>
        {disabledReason && <p className='text-muted-foreground text-xs'>{disabledReason}</p>}
      </div>

      <ConfirmDialog />
      <AdoptChannelCountsDialog
        parts={adopting}
        onClose={() => setAdopting(null)}
        onAdopted={() => {
          setAdopting(null)
          void refetch()
        }}
      />
    </div>
  )
}

/**
 * Nothing in this repo reads the channel's count yet (111 §3), so the person types it: one
 * number per part, anchored today through `setCount`.
 */
function AdoptChannelCountsDialog({
  parts,
  onClose,
  onAdopted,
}: {
  parts: Uncounted[] | null
  onClose: () => void
  onAdopted: () => void
}) {
  const [counts, setCounts] = useState<Record<string, number | null>>({})
  const adopt = api.ledger.openingInventory.adoptChannelCounts.useMutation({
    onError: (error) =>
      toastError({ title: 'The counts were not adopted', description: error.message }),
  })

  const typed = useMemo(
    () =>
      (parts ?? []).flatMap((part) => {
        const quantity = counts[part.partId]
        return quantity != null && Number.isFinite(quantity) && quantity >= 0
          ? [{ partId: part.partId, quantity }]
          : []
      }),
    [parts, counts]
  )

  const handleSubmit = async () => {
    if (typed.length === 0) return
    try {
      const { results } = await adopt.mutateAsync({ counts: typed })
      const failed = results.filter((result) => !result.ok)
      if (failed.length > 0) {
        const names = new Map((parts ?? []).map((part) => [part.partId, part.name]))
        toastError({
          title: `${failed.length} ${failed.length === 1 ? 'part was' : 'parts were'} not counted`,
          description: failed
            .map((result) => `${names.get(result.partId) ?? result.partId}: ${result.error ?? ''}`)
            .join('\n'),
        })
      }
      setCounts({})
      onAdopted()
    } catch {
      // Surfaced by the mutation's onError.
    }
  }

  return (
    <Dialog
      open={parts !== null}
      onOpenChange={(open) => {
        if (!open) {
          setCounts({})
          onClose()
        }
      }}>
      <DialogContent size='md'>
        <DialogHeader>
          <DialogTitle>Adopt channel count</DialogTitle>
          <DialogDescription>
            Type what the sales channel says is on hand today. Each part is anchored at that count,
            dated today, and its history is reconstructed behind it.
          </DialogDescription>
        </DialogHeader>
        <div className='max-h-72 overflow-y-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow className='hover:bg-transparent'>
                <TableHead className='text-muted-foreground'>Part</TableHead>
                <TableHead className='w-32 text-right text-muted-foreground'>
                  Channel count
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(parts ?? []).map((part) => (
                <TableRow key={part.partId} className='hover:bg-transparent'>
                  <TableCell className='text-xs'>{part.name}</TableCell>
                  <TableCell>
                    <FieldInputAdapter
                      fieldType={FieldType.NUMBER}
                      value={counts[part.partId] ?? null}
                      onChange={(value) =>
                        setCounts((prev) => ({ ...prev, [part.partId]: (value as number) ?? null }))
                      }
                      placeholder='0'
                      disabled={adopt.isPending}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={onClose}
            disabled={adopt.isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            variant='outline'
            size='sm'
            disabled={typed.length === 0}
            loading={adopt.isPending}
            loadingText='Counting...'
            onClick={() => void handleSubmit()}
            data-dialog-submit>
            Adopt{' '}
            {typed.length > 0 ? `${typed.length} ${typed.length === 1 ? 'count' : 'counts'}` : ''}{' '}
            <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
