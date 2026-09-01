// apps/web/src/components/manufacturing/ui/settings/use-tariff-schedule.ts

// Reads the whole tariff schedule - every `tariff_code` and every `tariff_rate`
// in the org - through the generic record system.
//
// 🛑 BOTH defs are read in full, and the rates are NOT fetched per selected
// code. The Codes list has to show the rate every code resolves to TODAY, so a
// per-selection read would be one round trip per row; and a schedule is a
// reference table (tens of codes, a handful of rows each), which is exactly the
// "small dataset, no pagination" shape `useAllRecords` exists for. Same call
// `use-catalog-groups.ts` makes, for the same reason.
//
// ⚠️ No org-cache key, deliberately. Brief §7: the invalidation graph has no
// event for an ordinary record write, so a cached schedule would fail OPEN and
// serve a stale rate indefinitely. Task 07 hit this and correctly did not build
// one.

import type { FieldOptions } from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { useMemo } from 'react'
import { type AllRecordsItem, useAllRecords } from '~/components/resources/hooks/use-all-records'
import { useField } from '~/components/resources/hooks/use-field'
import type { RecordMeta } from '~/components/resources/store/record-store'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { resolveSystemAttributeRef } from '~/components/resources/utils/resolve-system-attribute'
import {
  sortRatesNewestFirst,
  TARIFF_CODE_ATTRS,
  TARIFF_CODE_SLUG,
  TARIFF_RATE_SLUG,
  type TariffCode,
  type TariffRate,
} from './tariff-types'

/** `tariff_code` as `useAllRecords` hands it back (systemAttribute-keyed). */
interface TariffCodeRecord extends RecordMeta {
  recordId: RecordId
  fieldValues: {
    tariff_code_code?: string | null
    tariff_code_country?: string | string[] | null
    tariff_code_description?: string | null
  }
}

/** `tariff_rate` as `useAllRecords` hands it back. */
interface TariffRateRecord extends RecordMeta {
  recordId: RecordId
  fieldValues: {
    tariff_rate_tariff_code?: string[] | string | null
    tariff_rate_rate?: number | null
    tariff_rate_effective_from?: string | null
    tariff_rate_authority?: string | null
    tariff_rate_chapter99_code?: string | null
    tariff_rate_note?: string | null
  }
}

/**
 * ⚠️ A `SINGLE_SELECT` value arrives as a one-element ARRAY. Unwrap at the
 * boundary or every scalar comparison downstream silently fails - the same
 * normalisation `use-catalog-groups.ts` documents.
 */
function scalarValue<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null
  return value ?? null
}

/** A relationship value is a `RecordId[]`; the instance id is its second half. */
function relatedInstanceId(value: string[] | string | null | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value
  if (!first) return null
  return first.split(':')[1] ?? null
}

function toTariffCode(record: TariffCodeRecord): TariffCode {
  return {
    id: record.id,
    recordId: record.recordId,
    code: record.fieldValues.tariff_code_code ?? record.displayName ?? '',
    country: scalarValue(record.fieldValues.tariff_code_country),
    description: record.fieldValues.tariff_code_description ?? null,
  }
}

function toTariffRate(record: TariffRateRecord): TariffRate {
  return {
    id: record.id,
    recordId: record.recordId,
    tariffCodeId: relatedInstanceId(record.fieldValues.tariff_rate_tariff_code),
    rate: record.fieldValues.tariff_rate_rate ?? 0,
    effectiveFrom: record.fieldValues.tariff_rate_effective_from ?? null,
    authority: record.fieldValues.tariff_rate_authority ?? null,
    chapter99Code: record.fieldValues.tariff_rate_chapter99_code ?? null,
    note: record.fieldValues.tariff_rate_note ?? null,
  }
}

export interface UseTariffScheduleResult {
  /** Every `tariff_code`, ordered by its composed label. */
  codes: TariffCode[]
  /** Rate rows per owning code instance id, already newest-first. */
  ratesByCode: Map<string, TariffRate[]>
  /** Resolved `entityDefinitionId` for `tariff_code`, once the store hydrates. */
  codeDefId: string | null
  /** Resolved `entityDefinitionId` for `tariff_rate`. */
  rateDefId: string | null
  isLoading: boolean
  /** Push a freshly created code into the `listAll` cache - no refetch. */
  appendCode: (item: AllRecordsItem) => void
  removeCode: (id: string) => void
  appendRate: (item: AllRecordsItem) => void
  removeRate: (id: string) => void
  refreshRates: () => void
}

/** The whole schedule, both definitions, in one hook. */
export function useTariffSchedule(): UseTariffScheduleResult {
  const codeQuery = useAllRecords<TariffCodeRecord>({
    apiSlug: TARIFF_CODE_SLUG,
    includeArchived: false,
  })
  const rateQuery = useAllRecords<TariffRateRecord>({
    apiSlug: TARIFF_RATE_SLUG,
    includeArchived: false,
  })

  const codes = useMemo(() => {
    return codeQuery.records
      .map(toTariffCode)
      .sort((a, b) =>
        a.code === b.code
          ? (a.country ?? '').localeCompare(b.country ?? '')
          : a.code.localeCompare(b.code)
      )
  }, [codeQuery.records])

  const ratesByCode = useMemo(() => {
    const map = new Map<string, TariffRate[]>()
    for (const record of rateQuery.records) {
      const rate = toTariffRate(record)
      if (!rate.tariffCodeId) continue
      const bucket = map.get(rate.tariffCodeId) ?? []
      bucket.push(rate)
      map.set(rate.tariffCodeId, bucket)
    }
    for (const [id, rows] of map) map.set(id, sortRatesNewestFirst(rows))
    return map
  }, [rateQuery.records])

  return {
    codes,
    ratesByCode,
    codeDefId: codeQuery.entityDefinitionId,
    rateDefId: rateQuery.entityDefinitionId,
    isLoading: codeQuery.isLoading || rateQuery.isLoading,
    appendCode: codeQuery.appendRecord,
    removeCode: codeQuery.removeRecord,
    appendRate: rateQuery.appendRecord,
    removeRate: rateQuery.removeRecord,
    refreshRates: rateQuery.refresh,
  }
}

/**
 * The `country` field's own options, straight off the definition.
 *
 * 🛑 Read from the registry, never re-declared here. §12 (g) settled that the
 * ISO-3166-1 list is seeded on the def and `configurable: false`; a second copy
 * in the UI would fork on the first amendment, and two spellings of one country
 * fork the `(code, country)` natural key - which is the failure that decision
 * exists to prevent.
 */
export function useTariffCountryFieldOptions(codeDefId: string | null): FieldOptions | undefined {
  const systemAttributeMap = useResourceStore((state) => state.systemAttributeMap)
  const systemAttributeByDef = useResourceStore((state) => state.systemAttributeByDef)
  const ambiguousSystemAttributes = useResourceStore((state) => state.ambiguousSystemAttributes)

  const ref = resolveSystemAttributeRef(
    { systemAttributeMap, systemAttributeByDef, ambiguousSystemAttributes },
    TARIFF_CODE_ATTRS.country,
    codeDefId
  )
  return useField(ref)?.options
}

/** Value -> label for the country select, so a list row can read `China` not `CN`. */
export function useTariffCountryLabels(codeDefId: string | null): Map<string, string> {
  const options = useTariffCountryFieldOptions(codeDefId)
  return useMemo(
    () => new Map((options?.options ?? []).map((option) => [option.value, option.label])),
    [options]
  )
}
