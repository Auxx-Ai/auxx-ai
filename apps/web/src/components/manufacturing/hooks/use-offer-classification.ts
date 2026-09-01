// apps/web/src/components/manufacturing/hooks/use-offer-classification.ts

// The Classification tab's read (plans/money/tasks/30-tariff-offer-surfaces.md
// §6.1): every PRICED supplier offer in the org with its part, supplier, code
// and override, resolved through the shared seam.
//
// `vendor_part` is `isVisible: false` and so has no records page; this list is
// the only place "what is still unclassified" is answerable at all. Read in
// full through `useAllRecords` (`record.listAll` does not gate on visibility -
// checked 2026-09-01) - offers are tens to hundreds of rows, the same shape as
// the schedule read beside it.

import type { OfferTariff } from '@auxx/lib/bom/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { useMemo } from 'react'
import { type AllRecordsItem, useAllRecords } from '~/components/resources/hooks/use-all-records'
import type { RecordMeta } from '~/components/resources/store/record-store'
import { type OfferTariffInput, useOfferTariffs } from './use-offer-tariffs'

/** apiSlug of the supplier offer definition. */
export const VENDOR_PART_SLUG = 'vendor-parts'

/** The offer's writable tariff attributes, named once. */
export const VENDOR_PART_TARIFF_ATTRS = {
  tariffCode: 'vendor_part_tariff_code',
  tariffRate: 'vendor_part_tariff_rate',
} as const

interface VendorPartRecord extends RecordMeta {
  recordId: RecordId
  fieldValues: {
    vendor_part_part?: string[] | string | null
    vendor_part_contact?: string[] | string | null
    vendor_part_unit_price?: number | null
    vendor_part_tariff_code?: string[] | string | null
    vendor_part_tariff_rate?: number | null
  }
}

/** One supplier offer as the Classification tab renders and edits it. */
export interface ClassifiedOffer {
  id: string
  recordId: RecordId
  /** The part's `RecordId`, for a badge. */
  partRecordId: RecordId | null
  /** The supplier company's `RecordId`, for a badge. */
  supplierRecordId: RecordId | null
  unitPrice: number | null
  /** `tariff_code` instance id, or `null` when unclassified. */
  tariffCodeId: string | null
  /** The override, `null` when the schedule decides. */
  tariffRate: number | null
  /** ISO-2 origin of the code, for the country filter. */
  country: string | null
  /** `8481.80.9005 CN`. */
  codeLabel: string | null
  tariff: OfferTariff
}

function firstRecordId(value: string[] | string | null | undefined): RecordId | null {
  const first = Array.isArray(value) ? value[0] : value
  return first ? (first as RecordId) : null
}

function instanceIdOf(recordId: RecordId | null): string | null {
  return recordId ? (recordId.split(':')[1] ?? null) : null
}

export interface UseOfferClassificationResult {
  /** Every priced offer, unclassified first, then by part. */
  offers: ClassifiedOffer[]
  /** What the schedule alone says per offer id - `useOfferTariffs().scheduleById`. */
  scheduleById: Map<string, OfferTariff>
  /** Resolved `vendor_part` definition id, once loaded. */
  vendorPartDefId: string | null
  isLoading: boolean
  /** The schedule is not readable by this viewer - see `useOfferTariffs`. */
  unavailable: boolean
  /** ISO-2 -> count of offers classified under that origin, for the filter chips. */
  countries: Map<string, number>
}

/** Every priced offer, classified or not, in one read. */
export function useOfferClassification(
  codeCountryById: Map<string, string | null>
): UseOfferClassificationResult {
  const query = useAllRecords<VendorPartRecord>({
    apiSlug: VENDOR_PART_SLUG,
    includeArchived: false,
  })

  const raw = useMemo(
    () =>
      query.records
        .filter((record) => record.fieldValues.vendor_part_unit_price != null)
        .map((record) => {
          const codeRecordId = firstRecordId(record.fieldValues.vendor_part_tariff_code)
          return {
            id: record.id,
            recordId: record.recordId,
            partRecordId: firstRecordId(record.fieldValues.vendor_part_part),
            supplierRecordId: firstRecordId(record.fieldValues.vendor_part_contact),
            unitPrice: record.fieldValues.vendor_part_unit_price ?? null,
            tariffCodeId: instanceIdOf(codeRecordId),
            tariffRate: record.fieldValues.vendor_part_tariff_rate ?? null,
            displayName: record.displayName ?? '',
          }
        }),
    [query.records]
  )

  const inputs = useMemo<OfferTariffInput[]>(
    () => raw.map(({ id, tariffCodeId, tariffRate }) => ({ id, tariffCodeId, tariffRate })),
    [raw]
  )
  const {
    byId,
    scheduleById,
    codeLabelById,
    isLoading: scheduleLoading,
    unavailable,
  } = useOfferTariffs(inputs)

  const offers = useMemo<ClassifiedOffer[]>(() => {
    const rows = raw.map((offer) => {
      const tariff = byId.get(offer.id) ?? ({ source: 'none', rate: 0 } as OfferTariff)
      return {
        ...offer,
        country: offer.tariffCodeId ? (codeCountryById.get(offer.tariffCodeId) ?? null) : null,
        codeLabel: offer.tariffCodeId ? (codeLabelById.get(offer.tariffCodeId) ?? null) : null,
        tariff,
      }
    })
    // The checklist reads top-down: unclassified first, then by the offer's
    // display name (the part, since migration 115).
    rows.sort((a, b) => {
      const aOpen = a.tariffCodeId || a.tariffRate != null ? 1 : 0
      const bOpen = b.tariffCodeId || b.tariffRate != null ? 1 : 0
      if (aOpen !== bOpen) return aOpen - bOpen
      return a.displayName.localeCompare(b.displayName)
    })
    return rows
  }, [raw, byId, codeLabelById, codeCountryById])

  const countries = useMemo(() => {
    const map = new Map<string, number>()
    for (const offer of offers) {
      if (!offer.country) continue
      map.set(offer.country, (map.get(offer.country) ?? 0) + 1)
    }
    return map
  }, [offers])

  return {
    offers,
    scheduleById,
    vendorPartDefId: query.entityDefinitionId,
    isLoading: query.isLoading || scheduleLoading,
    unavailable,
    countries,
  }
}

export type { AllRecordsItem }
