// apps/web/src/components/manufacturing/hooks/use-offer-tariffs.ts

// The client-side read seam for an offer's duty rate
// (plans/money/tasks/30-tariff-offer-surfaces.md §2).
//
// Every surface that shows a supplier offer - the supplier form, the Suppliers
// tab, the Receive form, the Classification tab - needs the same three things
// per offer: its override, its tariff code, and the rate rows behind that code.
// The first two are one more attribute in each surface's existing read; the
// third is what `useTariffSchedule` already loads, both defs in full, which its
// header defends (a schedule is tens of codes with a handful of rows each).
//
// 🛑 The precedence rule is `resolveOfferTariff` from `@auxx/lib/bom/client` and
// nothing here re-derives it. Six callers each deciding "override, else
// schedule, else zero" is how the landed formula came to live twice.
//
// 🛑 The zone is the org's `bookTimeZone`, read HERE so no caller can forget it.
// `effectiveFrom` is a calendar day and the lookup is an instant; compared in
// UTC a rate starting March 2 puts a March 1 evening on the wrong side of the
// change, silently and by exactly one day.

import { type OfferTariff, type OfferTariffInputs, resolveOfferTariff } from '@auxx/lib/bom/client'
import { useMemo } from 'react'
import { useSettings } from '~/hooks/use-settings'
import { useAccess } from '~/providers/capabilities-provider'
import { composeTariffLabel } from '../tariff-types'
import { useTariffSchedule } from './use-tariff-schedule'

/** One offer, as the surfaces hand it in. `id` is whatever key the caller wants back. */
export interface OfferTariffInput extends OfferTariffInputs {
  id: string
}

export interface UseOfferTariffsResult {
  /** The resolved answer per offer `id`. Every input has an entry. */
  byId: Map<string, OfferTariff>
  /**
   * What the SCHEDULE alone says per offer `id`, override ignored. Same as
   * {@link byId} unless the offer carries both an override and a code - the
   * both-set case 29 §3.1 resolves silently and 30 §3.2 says must be loud.
   */
  scheduleById: Map<string, OfferTariff>
  /** `8481.80.9005 CN`, per `tariff_code` instance id, for chips and tooltips. */
  codeLabelById: Map<string, string>
  /** False once loaded with no `tariff_code` at all - the picker's empty state. */
  hasCodes: boolean
  /** True while the two schedule reads are in flight. */
  isLoading: boolean
  /**
   * The viewer cannot read the schedule, so every classified offer below is
   * resolved as if its code had no rows. Surfaces render the override-only view
   * with a hint rather than a confident `0%`.
   */
  unavailable: boolean
  /** The org's book timezone, for a caller that resolves something else in the same zone. */
  bookTimeZone: string
}

/**
 * Resolve a list of offers at `atDate` (default: now) through the shared rule.
 *
 * `atDate` defaults to a single `Date` per mount, so a list of rows agrees on
 * what "today" is rather than each row straddling midnight on its own. The
 * Receive form passes its `occurredAt`, which is the point of a dated schedule.
 */
export function useOfferTariffs(
  offers: ReadonlyArray<OfferTariffInput>,
  atDate?: Date | string | null
): UseOfferTariffsResult {
  const { canViewEntity } = useAccess()
  const { codes, ratesByCode, codeDefId, rateDefId, isLoading } = useTariffSchedule()

  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const bookTimeZone = (getSetting('accounting.bookTimeZone') as string) || 'UTC'

  // Only asked once the defs are known. Before that the answer is "loading",
  // not "unavailable".
  const unavailable =
    !!codeDefId && !!rateDefId && !(canViewEntity(codeDefId) && canViewEntity(rateDefId))

  // eslint-disable-next-line react-hooks/exhaustive-deps -- one instant per mount when no date is given
  const now = useMemo(() => new Date(), [])
  const resolvedAt = useMemo(() => {
    if (atDate == null || atDate === '') return now
    const parsed = atDate instanceof Date ? atDate : new Date(atDate)
    return Number.isNaN(parsed.getTime()) ? now : parsed
  }, [atDate, now])

  const codeLabelById = useMemo(
    () => new Map(codes.map((code) => [code.id, composeTariffLabel(code.code, code.country)])),
    [codes]
  )

  // `resolveOfferTariff` takes `TariffRateRow`s; the page's `TariffRate` is a
  // superset of that shape, so the map is passed straight through.
  const { byId, scheduleById } = useMemo(() => {
    const byId = new Map<string, OfferTariff>()
    const scheduleById = new Map<string, OfferTariff>()
    for (const offer of offers) {
      byId.set(offer.id, resolveOfferTariff(offer, ratesByCode, resolvedAt, bookTimeZone))
      scheduleById.set(
        offer.id,
        resolveOfferTariff({ ...offer, tariffRate: null }, ratesByCode, resolvedAt, bookTimeZone)
      )
    }
    return { byId, scheduleById }
  }, [offers, ratesByCode, resolvedAt, bookTimeZone])

  return {
    byId,
    scheduleById,
    codeLabelById,
    hasCodes: codes.length > 0,
    isLoading,
    unavailable,
    bookTimeZone,
  }
}

/**
 * The one-line reading of an {@link OfferTariff}: `47% (schedule)`,
 * `12% (override)`, or `none`. For places with room for a single token; the
 * supplier form's Duty row renders the components in full.
 */
export function describeOfferTariff(tariff: OfferTariff): string {
  switch (tariff.source) {
    case 'override':
      return `${formatPercent(tariff.rate)} (override)`
    case 'schedule':
      if (tariff.status === 'resolved') return `${formatPercent(tariff.rate)} (schedule)`
      return tariff.status === 'pending' ? 'Starts later' : 'No rate on code'
    case 'none':
      return 'No duty'
  }
}

/** `25` reads `25%`, `12.375` reads `12.38%`. Trailing zeros dropped. */
export function formatPercent(rate: number): string {
  return `${Math.round(rate * 100) / 100}%`
}
