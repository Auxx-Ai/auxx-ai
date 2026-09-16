// apps/web/src/components/accounting/ui/ledger/posting-register.tsx

'use client'

// Accounting > Ledger > the REGISTER, level A
// (plans/accounting/tasks/53-two-modes-one-ledger.md §7.3, decision D16).
//
// ## What this is
//
// MK, 2026-09-15: *"could we show the register as well? which would be used to
// create the summaries?"* Synder puts the register on its own page, next to
// Summaries, because those are two different GRAINS. We store both already:
// `AccountingEffect.acceptedBasis` has carried a balanced, account-resolved,
// sha256-hashed `contribution[]` per transaction since 42D, and
// `AccountingEffect.glPostingId` already names the summary it rolled into.
// Nothing has ever rendered it. So this is a READ, and the whole feature is a
// join plus this file.
//
// ## 🛑 Not a third page (§7.3.4)
//
// D17's reasoning applies unchanged: the sync queue is one list because
// `GlPosting` IS the aggregate, and a second page would show the same rows with
// different columns. The register is the same again, one level down - a summary
// row drills to its member effects, and an effect drills to its documentRefs.
// So this lives in the posting drawer, which is already the thing BOTH the
// ledger list and the sync queue open on a row. One implementation, reached
// from both, no route.
//
// ## 🛑 Read-only, always
//
// A register row is a projection of a frozen, hashed basis. Nothing here edits
// one and nothing here posts one - level B (writing these contributions as
// `GlPosting` rows too) is refused by §7.3.2, because a derived register in the
// trial balance double-counts every summary it rolls into and both sides still
// balance, so nothing detects it. The correction path is
// `operation: 'correction'` on `AccountingWork`, which already exists.
//
// ## ⚠️ No entries is an ANSWER, not a hole
//
// §7.3.3 splits the twenty posting types in two. Seven transaction-driven
// families gain an `AccountingWork` under D19; seven more have no upstream
// transaction at all - a manual journal, an opening balance, a `provider_sync`
// row authored in the provider - and for those the posting IS the register row,
// 1:1. The register is the UNION of per-transaction effects and standalone
// postings. Nothing in this file assumes every posting has effects, and nothing
// switches on `effectKind`, so families land as rows without editing it.

import type { RegisterDocumentRef, RegisterEntry } from '@auxx/lib/postings/client'
import { registerTiesToPosting } from '@auxx/lib/postings/client'
import { toRecordId } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { EmptySection } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { CircleAlert, FileStack, Receipt } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { useResources } from '~/components/resources'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { api } from '~/trpc/react'
import { EntryJournal } from './entry-journal'
import { formatAccountingDate, formatMinor } from './format'

interface PostingRegisterProps {
  /** The summary posting whose members are wanted. `null` reads nothing. */
  glPostingId: string | null
  /**
   * The section is open, so the read is worth making.
   *
   * 🛑 The register is the one read in the drawer that can be LARGE - a daily
   * fulfillment group is one summary over every shipment that day, and each
   * member carries its own jsonb basis. Firing it on every drawer open, for the
   * majority of readers who only want the journal entry, is a cost nobody asked
   * for. The section is collapsed by default and this is what gates it.
   */
  enabled: boolean
  currencyCode: string
  bookTimeZone: string
}

/**
 * The member effects of one summary posting, read-only.
 *
 * One row per transaction, expanding to that transaction's own balanced
 * contribution rendered through {@link EntryJournal} - the same table the
 * summary's own lines use, because a register line IS a journal line and
 * rendering it any other way would imply it is something else.
 */
export function PostingRegister({
  glPostingId,
  enabled,
  currencyCode,
  bookTimeZone,
}: PostingRegisterProps) {
  const [openEffectId, setOpenEffectId] = useState<string | null>(null)

  const registerQuery = api.ledger.register.useQuery(
    { glPostingId: glPostingId ?? '' },
    { enabled: enabled && !!glPostingId, staleTime: 30_000 }
  )

  if (registerQuery.error) {
    return (
      <p className='text-destructive text-xs'>
        The register could not be read, so nothing here has been checked.{' '}
        {registerQuery.error.message}
      </p>
    )
  }

  if (registerQuery.isPending) {
    return (
      <div className='flex flex-col gap-1.5'>
        <Skeleton className='h-8 w-full' />
        <Skeleton className='h-8 w-full' />
        <Skeleton className='h-8 w-full' />
      </div>
    )
  }

  const register = registerQuery.data

  if (register.entries.length === 0) {
    return (
      <EmptySection
        icon={<FileStack className='size-5' />}
        title='This entry is its own register row'
        // ⚠️ Worded as a PROPERTY of the entry, not as a gap. A manual journal
        // or an opening balance has no upstream transaction to model, and copy
        // that said "no transactions found" would teach a reader that something
        // is missing from a family where nothing ever will be (§7.3.3).
        description='It was not composed from transactions, so there is nothing underneath it to expand. Its own lines above are the whole record.'
      />
    )
  }

  const ties = registerTiesToPosting(register)

  return (
    <div className='flex flex-col gap-2'>
      <p className='text-muted-foreground text-xs'>
        {register.entries.length === 1
          ? 'One transaction composed this entry.'
          : `${register.entries.length} transactions composed this entry.`}{' '}
        {ties === true && (
          <>
            They add up to {formatMinor(register.totalMinor, register.currency)}, which is what the
            entry above says.
          </>
        )}
        {/* 🛑 Stated, never implied. The members and the summary are written in
            one transaction and `assertExactContributions` refuses an acceptance
            where they disagree, so this should be unreachable - which is exactly
            why it has to be visible if it ever happens rather than left for a
            reader to spot by comparing two numbers themselves. */}
        {ties === false && (
          <span className='text-amber-600'>
            They add up to {formatMinor(register.totalMinor, register.currency)}, but the entry
            above says {formatMinor(register.postingTotalMinor, register.currency)}.
          </span>
        )}
      </p>

      <div className='flex flex-col gap-px'>
        {register.entries.map((entry) => (
          <RegisterRow
            key={entry.effectId}
            entry={entry}
            isOpen={openEffectId === entry.effectId}
            // One at a time. A drawer is 380-720px wide and a member's own
            // journal is a table; forty of them open at once is a scroll nobody
            // reads, and the question a register answers is always about ONE
            // transaction.
            onToggle={() =>
              setOpenEffectId((current) => (current === entry.effectId ? null : entry.effectId))
            }
            currencyCode={currencyCode}
            bookTimeZone={bookTimeZone}
          />
        ))}
      </div>
    </div>
  )
}

function RegisterRow({
  entry,
  isOpen,
  onToggle,
  currencyCode,
  bookTimeZone,
}: {
  entry: RegisterEntry
  isOpen: boolean
  onToggle: () => void
  currencyCode: string
  bookTimeZone: string
}) {
  return (
    <TreeRow
      expandable
      isOpen={isOpen}
      onToggleOpen={onToggle}
      icon={
        entry.unreadable ? (
          <CircleAlert className='size-4 text-amber-600' />
        ) : (
          <Receipt className='size-4 text-muted-foreground' />
        )
      }
      title={
        <span className='flex min-w-0 items-center gap-1.5'>
          <span className='w-24 shrink-0 text-muted-foreground text-xs'>
            {formatAccountingDate(entry.effectiveDate, bookTimeZone)}
          </span>
          <span className='truncate text-sm'>{effectKindLabel(entry.effectKind)}</span>
        </span>
      }
      secondary={<RegisterRefs refs={entry.documentRefs} />}
      actions={
        <div className='flex items-center gap-2'>
          {entry.operation === 'correction' && (
            <Badge variant='amber' size='xs'>
              Correction
            </Badge>
          )}
          {/* D13's reserved dimension. Absent on every row written so far, so
              this renders nothing today and needs no change when it does not. */}
          {entry.basis && (
            <Badge variant='outline' size='xs'>
              {entry.basis}
            </Badge>
          )}
          {!entry.unreadable && (
            <span className='font-mono text-xs tabular-nums'>
              {formatMinor(entry.totalMinor, entry.currency)}
            </span>
          )}
        </div>
      }>
      <div className='px-2 pb-2'>
        {entry.unreadable ? (
          /* 🛑 "Could not read" and "has none" are different answers and must
             never render the same. An empty table here would be a false answer,
             not a missing one. */
          <p className='text-amber-600 text-xs'>
            This transaction's stored basis could not be read, so its lines are not shown. The entry
            above is unaffected - the basis is frozen and hashed, and nothing here is derived from
            it.
          </p>
        ) : (
          <>
            <EntryJournal
              lines={entry.lines.map((line, index) => ({
                glAccountId: line.glAccountId,
                accountCode: line.accountCode,
                accountName: line.accountName ?? undefined,
                direction: line.direction,
                amount: line.amountMinor,
                // Why this account, off the frozen `accountResolution`. The
                // summary's "Why these accounts" section says the same thing
                // for the entry as a whole; this says it per transaction,
                // which is the grain somebody asking "why is THIS order in
                // here" actually wants.
                memo: resolutionMemo(line.accountRole, line.selectedBy),
                // TRUE, not invented: the row that produced this contribution
                // is the accounting work, and its id is the audit trail back to
                // it. `GlPostingLineBase` requires the pair precisely so a line
                // stays explainable without joining through a provider.
                sourceType: entry.effectKind,
                sourceId: entry.workId,
                sortOrder: index,
                counterpartyType: line.counterpartyType ?? undefined,
                counterpartyId: line.counterpartyId ?? undefined,
                dimensions: line.dimensions ?? undefined,
              }))}
              currencyCode={currencyCode}
            />
            <p className='pt-1.5 font-mono text-[10px] text-muted-foreground'>
              {entry.policyKey ?? 'unknown policy'} · basis v{entry.basisVersion} ·{' '}
              {entry.basisHash.slice(0, 12)}
            </p>
          </>
        )}
      </div>
    </TreeRow>
  )
}

/**
 * The transactions behind one effect.
 *
 * 🔑 Resolved through `getResourceById`, which takes an `apiSlug` OR an
 * `entityDefinitionId`, so a `documentRef` whose `resourceKind` names a resource
 * (`order`, `fulfillment`, `credit_memo`) becomes a real, linkable
 * {@link RecordBadge}. One that does not - `money_transaction` is a table, not
 * an `EntityInstance` - falls back to its kind and a short id rather than a
 * badge that would 404. That fallback is also what makes D19's seven new
 * families render on day one without touching this file.
 */
function RegisterRefs({ refs }: { refs: RegisterDocumentRef[] }): ReactNode {
  const { getResourceById } = useResources()

  const rendered = useMemo(
    () =>
      refs.map((ref) => {
        const resource = getResourceById(ref.resourceKind)
        return { ref, defId: resource?.id ?? null }
      }),
    [refs, getResourceById]
  )

  if (rendered.length === 0) return undefined

  return (
    <span className='flex flex-wrap items-center gap-1'>
      {rendered.map(({ ref, defId }) =>
        defId ? (
          <RecordBadge
            key={`${ref.resourceKind}:${ref.entityInstanceId}`}
            recordId={toRecordId(defId, ref.entityInstanceId)}
            size='sm'
            link
          />
        ) : (
          <span
            key={`${ref.resourceKind}:${ref.entityInstanceId}`}
            className='font-mono text-[10px] text-muted-foreground'>
            {ref.resourceKind.replace(/_/g, ' ')} {ref.entityInstanceId.slice(-6)}
          </span>
        )
      )}
    </span>
  )
}

/**
 * What KIND of transaction a member is, in words.
 *
 * ⚠️ Open-ended on purpose. D19 adds seven families and the fallback is the same
 * one the sync queue uses for `postingType`, so a family lands readable without
 * anybody remembering to edit a label map.
 */
const EFFECT_KIND_LABELS: Record<string, string> = {
  fulfillment_accounting: 'Shipment',
  customer_receipt: 'Customer payment',
  customer_credit_issued: 'Credit memo',
  customer_refund: 'Refund',
}

function effectKindLabel(effectKind: string): string {
  return EFFECT_KIND_LABELS[effectKind] ?? effectKind.replace(/_/g, ' ')
}

/** The frozen "why this account" for one contribution line, or nothing to say. */
function resolutionMemo(accountRole: string | null, selectedBy: string | null): string | undefined {
  const parts = [accountRole, selectedBy].filter((part): part is string => !!part)
  return parts.length > 0 ? parts.map((part) => part.replace(/_/g, ' ')).join(' · ') : undefined
}
