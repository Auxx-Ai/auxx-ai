// apps/web/src/components/manufacturing/ui/settings/tariff-types.ts

// Shared shapes for Parts > Settings > Tariffs (money 29-tariff-schedule.md).
//
// 🛑 The resolution rule lives in `@auxx/lib/bom/client`, never here. §6 of the
// brief is explicit: `vendor-cost.ts` exists because the landed formula once
// lived twice - once in the calculator and once hand-copied into the Suppliers
// tab - and a second copy of *"latest row per authority, summed"* would be the
// same mistake with worse consequences, because the number it produces values
// stock. Everything below is adaptation: mapping our field-value rows into the
// resolver's shape and mapping its answer back onto the records the list
// renders.

import type { TariffRateComponent, TariffResolutionStatus } from '@auxx/lib/bom/client'
import { resolveTariffRate } from '@auxx/lib/bom/client'
import type { RecordId } from '@auxx/lib/resources/client'

/** apiSlug of the two definitions this page reads and writes. */
export const TARIFF_CODE_SLUG = 'tariff-codes'
export const TARIFF_RATE_SLUG = 'tariff-rates'

/**
 * `tariff_code`'s systemAttributes.
 *
 * Named once, here, because they are the join between this page and the
 * registry: a typo in one of them reads as an empty field rather than as an
 * error, which is the failure mode the whole registry convention exists to make
 * findable.
 */
export const TARIFF_CODE_ATTRS = {
  code: 'tariff_code_code',
  country: 'tariff_code_country',
  description: 'tariff_code_description',
} as const

/** `tariff_rate`'s systemAttributes. See {@link TARIFF_CODE_ATTRS}. */
export const TARIFF_RATE_ATTRS = {
  tariffCode: 'tariff_rate_tariff_code',
  rate: 'tariff_rate_rate',
  effectiveFrom: 'tariff_rate_effective_from',
  authority: 'tariff_rate_authority',
  chapter99Code: 'tariff_rate_chapter99_code',
  note: 'tariff_rate_note',
} as const

/** One `tariff_code` record, as this page consumes it. */
export interface TariffCode {
  id: string
  recordId: RecordId
  code: string
  /** ISO-3166-1 alpha-2. Country of ORIGIN, never the vendor's address. */
  country: string | null
  description: string | null
}

/**
 * One `tariff_rate` record.
 *
 * ⚠️ `chapter99Code` is DOCUMENTATION (§2). It is rendered so an estimate can be
 * reconciled against the broker's entry summary line by line, and so a Federal
 * Register notice moving `9903.88.03` can be traced to the rows it touches. The
 * arithmetic never reads it, and nothing here should start.
 */
export interface TariffRate {
  id: string
  recordId: RecordId
  /** Instance id of the owning `tariff_code`. */
  tariffCodeId: string | null
  /** A percentage - `25` means 25%, matching `vendor_part.tariffRate`. */
  rate: number
  /** ISO string. Always required by the registry; `null` only mid-write. */
  effectiveFrom: string | null
  /** `MFN`, `Section 301 List 3`, ... A blank authority is its own authority. */
  authority: string | null
  chapter99Code: string | null
  note: string | null
}

/**
 * What a code resolves to on one date, as this page renders it.
 *
 * Thin over `@auxx/lib`'s {@link TariffResolution}: the same `status`, `rate`
 * and `components`, plus the two things only a UI needs - the ids of the rows in
 * force (so the history can mark them) and the missing-base-rate flag.
 */
export interface TariffScheduleView {
  status: TariffResolutionStatus
  /** The summed percentage in force. `0` for `unclassified` AND for `pending`. */
  total: number
  /** One entry per authority in force, oldest first - entry-summary order. */
  components: TariffRateComponent[]
  /** Ids of {@link components}, so the history list can mark what is live. */
  liveIds: Set<string>
  /**
   * Rows are in force and every one of them carries a `chapter99Code`.
   *
   * 🛑 This is the silent undercharge §3 names: under a summing rule a code
   * with a 301 row and no ordinary-duty row resolves to 25% rather than 27%,
   * and nothing about the number looks wrong. It has to be visible on the list
   * AND in the editor, because the total is otherwise self-consistent.
   *
   * 🛑 **The test is the Chapter 99 code, NOT a blank authority.** The first
   * version of this asked whether every row named an authority, and that
   * false-positives on the ordinary China case - `MFN` + `Section 301` +
   * `IEEPA` names three authorities and very much HAS a base row, so the page
   * told a correct schedule it was broken and advised adding a fourth row that
   * would have double-counted the base. A base duty row never carries a
   * Chapter 99 code and a 301 / IEEPA / 232 row always does, so an
   * all-Chapter-99 set is structurally a schedule with its base missing. A row
   * whose code was simply left blank yields a false NEGATIVE, which is the safe
   * direction to fail.
   *
   * ⚠️ This does not make `chapter99Code` an arithmetic input (§2). It is a
   * completeness signal about the SET of rows, never a term in the sum.
   */
  missingBaseRate: boolean
}

/** A blank/whitespace authority is the base rate, and is its own authority. */
export function isBaseAuthority(authority: string | null): boolean {
  return (authority ?? '').trim().length === 0
}

/** How a rate row's authority reads when it has none. */
export function authorityLabel(authority: string | null): string {
  return isBaseAuthority(authority) ? 'Base rate' : (authority as string)
}

/**
 * Resolve a code's schedule at `atDate`, through the shared resolver.
 *
 * 🛑 `timeZone` is the org's `bookTimeZone`, not the viewer's and not UTC.
 * `effectiveFrom` is a calendar day and `atDate` is an instant, so turning one
 * into the other is a timezone decision - and compared in UTC a rate starting
 * on March 2 puts a March 1 evening on the wrong side of the change, silently
 * and by exactly one day. Same rule `gather-month-end-inventory.ts` applies to
 * period membership.
 */
export function resolveScheduleAt(
  rows: TariffRate[],
  atDate: Date,
  timeZone: string
): TariffScheduleView {
  const resolution = resolveTariffRate(rows, atDate, timeZone)
  const liveIds = new Set(resolution.components.map((component) => component.id))
  return {
    status: resolution.status,
    total: resolution.rate,
    components: resolution.components,
    liveIds,
    missingBaseRate:
      resolution.components.length > 0 &&
      resolution.components.every((component) => !!component.chapter99Code),
  }
}

/** `25` reads as `25.0%`. One decimal everywhere, so a column of them lines up. */
export function formatRate(rate: number): string {
  return `${rate.toFixed(1)}%`
}

/** `2019-05-10` - the date as entered, with no locale reinterpretation. */
export function formatEffectiveFrom(iso: string | null): string {
  if (!iso) return 'no date'
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return 'no date'
  return parsed.toISOString().slice(0, 10)
}

/**
 * The composed label: `8481.80.9005 CN`.
 *
 * 🛑 Composed, never stored (§1.1). The two halves stay separate fields so the
 * code half can be typed ahead of, so *"what origins have I classified this code
 * for"* is answerable, and so a trailing space in a hand-typed string can never
 * fork the `(code, country)` natural key.
 */
export function composeTariffLabel(code: string, country: string | null): string {
  return country ? `${code} ${country}` : code
}

/** Newest first - the order the rate history renders in. */
export function sortRatesNewestFirst(rows: TariffRate[]): TariffRate[] {
  return [...rows].sort((a, b) => {
    const at = a.effectiveFrom ? new Date(a.effectiveFrom).getTime() : 0
    const bt = b.effectiveFrom ? new Date(b.effectiveFrom).getTime() : 0
    if (bt !== at) return bt - at
    return (a.authority ?? '').localeCompare(b.authority ?? '')
  })
}

/** The uncommitted `tariff_code` the list renders as a phantom row. */
export interface TariffCodeDraft {
  draftId: string
  code: string
  country: string | null
  description: string
  /** Stamped once the create resolves; the draft form stays mounted after it. */
  recordId?: string
}

/** How a resolved rate reads as one badge on the Codes list. */
export interface TariffBadgeSpec {
  label: string
  variant: 'outline' | 'destructive' | 'green'
  /** The tooltip - what the badge means when it is not simply a percentage. */
  title?: string
}

/**
 * The list row's badge.
 *
 * 🛑 Three states get three readings, and none of them is a bare `0.0%`:
 *
 * - `unclassified` - no rows at all. "0%" and "unclassified" produce identical
 *   arithmetic and mean opposite things (a domestic part with no duty versus an
 *   unfinished row), which is exactly why the resolver carries a `status`.
 * - `pending` - rows exist but every one starts in the future. Also 0% today,
 *   also not the same as having no schedule.
 * - `missingBaseRate` - the total is arithmetically right and understated by
 *   the whole base duty, with nothing about the number to give it away.
 */
export function resolutionBadge(view: TariffScheduleView): TariffBadgeSpec {
  if (view.status === 'unclassified') {
    return {
      label: 'No rate',
      variant: 'outline',
      title: 'No rate rows. Offers pointing here are estimated with no duty.',
    }
  }
  if (view.status === 'pending') {
    return {
      label: 'Starts later',
      variant: 'outline',
      title: 'Every row on this code takes effect after today, so nothing is in force yet.',
    }
  }
  if (view.missingBaseRate) {
    return {
      label: `${formatRate(view.total)} - no base`,
      variant: 'destructive',
      title:
        'Every row names an authority, so the ordinary duty on this classification is missing and the total is understated by it.',
    }
  }
  return { label: formatRate(view.total), variant: 'green' }
}
