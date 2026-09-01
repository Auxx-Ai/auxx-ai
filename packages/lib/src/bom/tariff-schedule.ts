// packages/lib/src/bom/tariff-schedule.ts

/**
 * The server-side read of the tariff schedule
 * (plans/money/tasks/30-tariff-offer-surfaces.md §1, §2).
 *
 * Reads only. Returns the shape `resolveOfferTariff` / `resolveTariffRate` take,
 * grouped by `tariff_code` instance id, so a caller resolves any number of
 * offers from one load. The browser reads the same rows through
 * `record.listAll` and never through this module.
 *
 * ⚠️ **No org-cache key, deliberately** (29 §7). The invalidation graph has no
 * event for an ordinary record write, so a cached schedule would fail OPEN and
 * serve a stale rate indefinitely. A schedule is tens of codes with a handful of
 * rows each; one indexed query per recalculation is the honest cost.
 */

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getCachedEntityDefId, getOrgCache } from '../cache'
import type { TariffRateRow } from './vendor-cost'

/**
 * Every live `tariff_rate` row in the org, grouped by the `tariff_code` it
 * belongs to.
 *
 * `codeInstanceIds` narrows the read to the codes named. Pass it when one offer
 * is being priced (the receipt path); leave it out when the whole org is being
 * recalculated, where the calculator wants every code once.
 *
 * Empty map when the org has no `tariff_rate` definition or its fields are not
 * materialised yet, which an org mid-migration reaches. Every offer then
 * resolves as `unclassified`, the safe reading.
 */
export async function loadTariffSchedule(
  db: Database,
  organizationId: string,
  codeInstanceIds?: readonly string[]
): Promise<Map<string, TariffRateRow[]>> {
  const byCode = new Map<string, TariffRateRow[]>()
  if (codeInstanceIds && codeInstanceIds.length === 0) return byCode

  const rateDefId = await getCachedEntityDefId(organizationId, 'tariff_rate')
  if (!rateDefId) return byCode

  // The four rate attributes the resolver reads, plus the pointer that groups them.
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'tariff_rate_tariff_code',
      'tariff_rate_rate',
      'tariff_rate_effective_from',
      'tariff_rate_authority',
      'tariff_rate_chapter99_code',
    ] as const)
  const codeField = fields.tariff_rate_tariff_code
  const rateField = fields.tariff_rate_rate
  const fromField = fields.tariff_rate_effective_from
  if (!codeField || !rateField || !fromField) return byCode

  const rows = await db
    .select({
      instanceId: schema.EntityInstance.id,
      fieldId: schema.FieldValue.fieldId,
      valueNumber: schema.FieldValue.valueNumber,
      valueText: schema.FieldValue.valueText,
      valueDate: schema.FieldValue.valueDate,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.EntityInstance)
    .innerJoin(
      schema.FieldValue,
      and(
        eq(schema.FieldValue.entityId, schema.EntityInstance.id),
        eq(schema.FieldValue.organizationId, schema.EntityInstance.organizationId)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, rateDefId),
        isNull(schema.EntityInstance.archivedAt),
        inArray(schema.FieldValue.fieldId, [
          codeField.id,
          rateField.id,
          fromField.id,
          ...(fields.tariff_rate_authority ? [fields.tariff_rate_authority.id] : []),
          ...(fields.tariff_rate_chapter99_code ? [fields.tariff_rate_chapter99_code.id] : []),
        ])
      )
    )

  // One `tariff_rate` is several FieldValue rows; fold them back into one row.
  const byInstance = new Map<string, TariffRateRow & { codeId: string | null }>()
  for (const row of rows) {
    let entry = byInstance.get(row.instanceId)
    if (!entry) {
      entry = {
        id: row.instanceId,
        codeId: null,
        authority: null,
        rate: null,
        effectiveFrom: null,
        chapter99Code: null,
      }
      byInstance.set(row.instanceId, entry)
    }
    if (row.fieldId === codeField.id) entry.codeId = row.relatedEntityId
    else if (row.fieldId === rateField.id) entry.rate = row.valueNumber
    else if (row.fieldId === fromField.id) entry.effectiveFrom = row.valueDate
    else if (row.fieldId === fields.tariff_rate_authority?.id) entry.authority = row.valueText
    else if (row.fieldId === fields.tariff_rate_chapter99_code?.id) {
      entry.chapter99Code = row.valueText
    }
  }

  const wanted = codeInstanceIds ? new Set(codeInstanceIds) : null
  for (const { codeId, ...rate } of byInstance.values()) {
    if (!codeId) continue
    if (wanted && !wanted.has(codeId)) continue
    const bucket = byCode.get(codeId) ?? []
    bucket.push(rate)
    byCode.set(codeId, bucket)
  }
  return byCode
}

/**
 * The org's `accounting.bookTimeZone`, or `UTC` when it has never been set.
 *
 * The zone every schedule lookup on the server resolves in - the same rule
 * `gather-month-end-inventory.ts` applies to period membership. Imported lazily
 * the way `bom-cost-triggers.ts` reaches the settings service: the setting
 * graph is not something the cost calculator should load for orgs that have
 * never classified an offer.
 */
export async function readBookTimeZone(organizationId: string): Promise<string> {
  const { getOrganizationSetting } = await import('../settings/settings-service')
  const value = await getOrganizationSetting({ organizationId, key: 'accounting.bookTimeZone' })
  return typeof value === 'string' && value.trim().length > 0 ? value : 'UTC'
}
