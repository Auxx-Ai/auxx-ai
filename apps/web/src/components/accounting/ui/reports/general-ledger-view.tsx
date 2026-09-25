// apps/web/src/components/accounting/ui/reports/general-ledger-view.tsx

'use client'

import type { GeneralLedgerLine, GeneralLedgerSummary } from '@auxx/lib/accounting/reports/client'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { keepPreviousData } from '@tanstack/react-query'
import { BookOpen } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { ReportGrid, type ReportTextColumn } from '~/components/global/report-grid/report-grid'
import type { ReportGridRow } from '~/components/global/report-grid/report-grid-layout'
import { ReportMessage } from '~/components/global/report-grid/report-page-layout'
import { useDebounce } from '~/hooks/use-debounced-value'
import { downloadCsv } from '~/lib/csv'
import { api } from '~/trpc/react'
import { postingTypeLabel } from '../ledger/type-labels'
import { PostingDrawerHost, usePostingDrawer } from './posting-drawer-host'
import { ReportErrorCard } from './report-error-card'
import type { StatementColumn } from './statement-parts'

/** Lines per page read. */
const PAGE_SIZE = 200

export const GENERAL_LEDGER_GRID_COLUMNS: StatementColumn[] = [
  { key: 'debit', label: 'Debit', align: 'right' },
  { key: 'credit', label: 'Credit', align: 'right' },
  { key: 'balance', label: 'Balance', align: 'right', signed: true },
]

const TEXT_COLUMNS: ReportTextColumn[] = [
  { key: 'type', label: 'Type', width: 120 },
  { key: 'name', label: 'Name', width: 160 },
  { key: 'memo', label: 'Memo', minWidth: 160 },
  { key: 'split', label: 'Split', width: 160 },
]

export interface GeneralLedgerSource {
  sourceKind: string
  sourceId: string
}

export interface GeneralLedgerViewProps {
  from: string
  to: string
  glAccountId?: string
  source?: GeneralLedgerSource
  currency: string
  /** Names the saved label width. */
  reportKey: string
}

/**
 * The general ledger's body: account sections from one summary read, each
 * section's lines fetched a page at a time as they scroll into view (108 §3.2).
 * The general ledger page renders it, and so does a statement drilled into one account.
 */
export function GeneralLedgerView({
  from,
  to,
  glAccountId,
  source,
  currency,
  reportKey,
}: GeneralLedgerViewProps) {
  const posting = usePostingDrawer()
  const [searchInput, setSearchInput] = useState('')
  const search = useDebounce(searchInput.trim(), 300)

  const summaryQuery = api.ledgerReports.generalLedgerSummary.useQuery(
    { from, to, glAccountId, source, search: search || undefined },
    { enabled: !!from && !!to, placeholderData: keepPreviousData }
  )
  const summary = summaryQuery.data

  const pages = useLedgerPages({ from, to, source, search: search || undefined })
  const rows = useLedgerRows(summary, pages.pages, !source)

  const request = pages.request
  const handleVisibleRows = useCallback(
    (visible: ReportGridRow[]) => {
      for (const row of visible) {
        if (!row.loading) continue
        // A line row's id is `<glAccountId>:<index>`.
        const [glAccountId, index] = row.id.split(':')
        if (glAccountId && index) request(glAccountId, Math.floor(Number(index) / PAGE_SIZE))
      }
    },
    [request]
  )

  const openPosting = posting.open
  const handleRowClick = useCallback(
    (row: ReportGridRow) => {
      if (row.meta?.glPostingId) openPosting(row.meta.glPostingId)
    },
    [openPosting]
  )

  let body: ReactNode
  if (summaryQuery.isPending) {
    body = (
      <ReportMessage>
        <Skeleton className='h-64 w-full' />
      </ReportMessage>
    )
  } else if (summaryQuery.error) {
    body = (
      <ReportMessage>
        <ReportErrorCard message={summaryQuery.error.message} />
      </ReportMessage>
    )
  } else if (summary && summary.accounts.length === 0 && !search) {
    body = (
      <ReportMessage>
        <EmptyState
          icon={BookOpen}
          title='No posted lines in this range'
          description='Nothing posted between these two dates. Widen the range, or pick a month with activity.'
        />
      </ReportMessage>
    )
  } else {
    body = (
      <ReportGrid
        reportKey={reportKey}
        columns={GENERAL_LEDGER_GRID_COLUMNS}
        textColumns={TEXT_COLUMNS}
        rows={rows}
        currency={currency}
        defaultLabelWidth={240}
        search={{ value: searchInput, onChange: setSearchInput }}
        labelHeading='Account'
        openAll={!!search}
        defaultOpenIds={glAccountId ? [glAccountId] : undefined}
        verdict={
          summary && !search ? { label: 'Debits = Credits', ok: summary.balanced } : undefined
        }
        // Account sections carry `glAccountId` too; only a line opens a posting.
        canRowDrill={(row) => !!row.meta?.glPostingId}
        isRowActive={(row) => !!posting.postingId && row.meta?.glPostingId === posting.postingId}
        onRowClick={handleRowClick}
        onVisibleRowsChange={handleVisibleRows}
      />
    )
  }

  return (
    <>
      {body}
      <PostingDrawerHost postingId={posting.postingId} onClose={posting.close} />
    </>
  )
}

interface PageRequestBase {
  from: string
  to: string
  source?: GeneralLedgerSource
  search?: string
}

/** Loaded pages of lines, keyed `accountId:page`, with a per-account version so only that account rebuilds. */
function useLedgerPages(base: PageRequestBase) {
  const utils = api.useUtils()
  const baseKey = JSON.stringify(base)
  const [state, setState] = useState(() => ({
    baseKey,
    pages: new Map<string, GeneralLedgerLine[]>(),
  }))
  const inflight = useRef(new Set<string>())
  const baseRef = useRef({ base, baseKey })
  baseRef.current = { base, baseKey }

  // A new range, filter or search starts from nothing.
  useEffect(() => {
    inflight.current = new Set()
    setState((prev) => (prev.baseKey === baseKey ? prev : { baseKey, pages: new Map() }))
  }, [baseKey])

  const pages = state.baseKey === baseKey ? state.pages : EMPTY_PAGES

  const request = useCallback(
    (glAccountId: string, page: number) => {
      const { base: current, baseKey: key } = baseRef.current
      const pageKey = `${glAccountId}:${page}`
      if (inflight.current.has(pageKey)) return
      inflight.current.add(pageKey)
      utils.ledgerReports.generalLedgerLines
        .fetch({ ...current, glAccountId, offset: page * PAGE_SIZE, limit: PAGE_SIZE })
        .then((lines) =>
          setState((prev) => {
            if (prev.baseKey !== key) return prev
            const next = new Map(prev.pages)
            next.set(pageKey, lines)
            return { baseKey: key, pages: next }
          })
        )
        .catch((error: Error) => {
          inflight.current.delete(pageKey)
          toastError({ title: 'Error loading ledger lines', description: error.message })
        })
    },
    [utils]
  )

  return { pages, request }
}

const EMPTY_PAGES = new Map<string, GeneralLedgerLine[]>()

/**
 * Sections from the summary, each with an opening row, one row per line (a
 * placeholder until its page loads) and an ending row. Children are cached per
 * account and rebuilt only when that account's pages change.
 */
function useLedgerRows(
  summary: GeneralLedgerSummary | undefined,
  pages: ReadonlyMap<string, GeneralLedgerLine[]>,
  showOpening: boolean
) {
  const cache = useRef(
    new Map<string, { summary: unknown; pages: GeneralLedgerLine[][]; children: ReportGridRow[] }>()
  )

  return useMemo(() => {
    if (!summary) return [] as ReportGridRow[]

    const sections: ReportGridRow[] = summary.accounts.map((account) => {
      const id = account.glAccountId
      const pageCount = Math.ceil(account.lineCount / PAGE_SIZE)
      const accountPages = Array.from(
        { length: pageCount },
        (_, page) => pages.get(`${id}:${page}`) ?? []
      )

      const cached = cache.current.get(id)
      const reuse =
        cached?.summary === account &&
        cached.pages.length === accountPages.length &&
        cached.pages.every((loaded, page) => loaded === accountPages[page])
      let children = cached?.children
      if (!reuse || !children) {
        children = [
          ...(showOpening
            ? [
                {
                  id: `${id}:opening`,
                  label: 'Opening balance',
                  depth: 1,
                  kind: 'line' as const,
                  values: [null, null, account.openingBalanceMinor],
                },
              ]
            : []),
          ...Array.from({ length: account.lineCount }, (_, index) =>
            lineRow(id, index, accountPages[Math.floor(index / PAGE_SIZE)]?.[index % PAGE_SIZE])
          ),
          {
            id: `${id}:ending`,
            label: 'Ending balance',
            depth: 1,
            kind: 'subtotal' as const,
            values: [account.debitMinor, account.creditMinor, account.endingBalanceMinor],
          },
        ]
        cache.current.set(id, { summary: account, pages: accountPages, children })
      }

      return {
        id,
        label: account.label,
        depth: 0,
        kind: 'section' as const,
        values: [account.debitMinor, account.creditMinor, account.endingBalanceMinor],
        meta: {
          glAccountId: id,
          // A sub-account reads by its path, not `AccountLabel`'s code/name split.
          accountCode: account.nested ? undefined : account.accountCode,
          accountName: account.nested ? undefined : account.accountName || undefined,
          accountType: account.accountType ?? undefined,
          note: account.accountType
            ? undefined
            : 'This account has posted lines but has been deleted from the current chart of accounts.',
        },
        children,
      }
    })

    const rows: ReportGridRow[] = [
      ...sections,
      {
        id: 'total',
        label: 'Total',
        depth: 0,
        kind: 'total',
        values: [summary.totalDebitMinor, summary.totalCreditMinor, null],
      },
    ]
    return rows
  }, [summary, pages, showOpening])
}

function lineRow(
  glAccountId: string,
  index: number,
  line: GeneralLedgerLine | undefined
): ReportGridRow {
  const id = `${glAccountId}:${index}`
  if (!line) {
    return { id, label: '', depth: 1, kind: 'line', values: [null, null, null], loading: true }
  }
  return {
    id,
    label: `${line.txnDate}  ${line.docNumber}`,
    depth: 1,
    kind: 'line',
    values: [
      line.direction === 'debit' ? line.amountMinor : null,
      line.direction === 'credit' ? line.amountMinor : null,
      line.runningBalanceMinor,
    ],
    meta: { glPostingId: line.glPostingId },
    cells: {
      type: postingTypeLabel(line.postingType),
      name: line.counterpartyName ?? '',
      memo: line.memo ?? '',
      split: line.splitLabel ?? '',
    },
  }
}

/** PDF and CSV for a general ledger slice: the page's own, or a statement's drill-down. */
export function useGeneralLedgerExports({
  from,
  to,
  glAccountId,
  source,
  currency,
  fileLabel,
}: {
  from: string
  to: string
  glAccountId?: string
  source?: GeneralLedgerSource
  currency: string
  /** Folded into the CSV filename. */
  fileLabel?: string
}) {
  const renderPdf = api.ledgerReports.renderStatementPdf.useMutation({
    onError: (error) => toastError({ title: 'Error generating PDF', description: error.message }),
  })
  const csv = api.ledgerReports.generalLedgerCsv.useMutation({
    onError: (error) => toastError({ title: 'Error exporting CSV', description: error.message }),
  })

  const renderPdfMutate = renderPdf.mutate
  const downloadPdf = useCallback(() => {
    renderPdfMutate(
      { kind: 'general-ledger', from, to, glAccountId, source },
      {
        onSuccess: ({ assetId }) =>
          window.open(`/api/files/download/asset:${assetId}`, '_blank', 'noopener,noreferrer'),
      }
    )
  }, [renderPdfMutate, from, to, glAccountId, source])

  const csvMutate = csv.mutate
  const downloadCsvFile = useCallback(() => {
    csvMutate(
      { from, to, glAccountId, source, currencyCode: currency },
      {
        onSuccess: ({ csv: content }) => {
          const label = fileLabel ? `${fileLabel.replace(/[^\w.-]+/g, '-')}-` : ''
          const sourceLabel = source ? `${source.sourceKind}-${source.sourceId}-` : ''
          downloadCsv(content, `general-ledger-${label}${sourceLabel}${from}-to-${to}.csv`)
        },
      }
    )
  }, [csvMutate, from, to, glAccountId, source, currency, fileLabel])

  return {
    downloadPdf,
    downloadCsv: downloadCsvFile,
    isDownloadingPdf: renderPdf.isPending,
  }
}
