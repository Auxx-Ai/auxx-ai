// apps/web/src/components/money/ui/batch-posting/batch-posting-exclusions.tsx
'use client'

// The members of the range that produce no posting, with the reason
// (§5.1 of plans/accounting/tasks/25-batch-posting-and-credit-memos.md,
// following 44 §7.2b and `manufacturing/builds/backfill-exclusions.tsx`).
//
// 🛑 **The first question anyone asks this screen is "where is order 1042?"** If
// an excluded member is simply absent, that question has no answer, and a
// preview whose omissions cannot be explained is a preview nobody trusts,
// which on this screen means somebody posts the day twice looking for it.
//
// ⚠️ **The `detail` column is not decoration.** Every exclusion carries the
// number or the value that PROVES its reason: the cutoff month, the currency
// code, the gateway list. A reason without its evidence is an assertion.
//
// Shared across sources; the two left-hand column heads and the reason copy come
// from the descriptor, because the reason union is per source (the four common
// ones plus that source's own).

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { formatDayKey } from './format'
import type { BatchPostingExclusionRow } from './types'

interface BatchPostingExclusionsProps {
  rows: readonly BatchPostingExclusionRow[]
  columns: { document: string; date: string }
  copy: Readonly<Record<string, { label: string; detail: string }>>
}

export function BatchPostingExclusions({ rows, columns, copy }: BatchPostingExclusionsProps) {
  if (rows.length === 0) return null

  return (
    <div className='flex flex-col gap-1.5'>
      <p className='font-medium text-muted-foreground text-xs'>Not being posted ({rows.length})</p>

      <div className='overflow-x-auto rounded-md border border-dashed bg-muted/40'>
        <Table>
          <TableHeader>
            <TableRow className='hover:bg-transparent'>
              <TableHead className='min-w-[140px] text-muted-foreground'>
                {columns.document}
              </TableHead>
              <TableHead className='min-w-[110px] text-muted-foreground'>{columns.date}</TableHead>
              <TableHead className='min-w-[200px] text-muted-foreground'>Reason</TableHead>
              <TableHead className='min-w-[160px] text-muted-foreground'>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const reason = copy[row.reason]
              return (
                <TableRow key={row.key} className='text-muted-foreground'>
                  <TableCell>
                    <span className='block truncate text-xs'>{row.title}</span>
                    {row.subtitle && <span className='block text-[11px]'>{row.subtitle}</span>}
                  </TableCell>
                  <TableCell className='text-xs'>{formatDayKey(row.dayKey)}</TableCell>
                  <TableCell>
                    <span className='block text-xs'>{reason?.label ?? row.reason}</span>
                    {reason && <span className='block text-[11px]'>{reason.detail}</span>}
                  </TableCell>
                  <TableCell className='text-[11px] break-words'>{row.detail}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
