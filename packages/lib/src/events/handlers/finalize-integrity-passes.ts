// packages/lib/src/events/handlers/finalize-integrity-passes.ts
//
// Phase 5 of plans/events/03-write-context-and-batch-lane-plan.md (§8 step 4): the
// data-integrity batch passes, fixing bug B-1 — synced/imported writes never run the
// field-change integrity hooks (`skipEvents` suppresses the whole post-hook chain), so
// imported addresses never normalize/geocode, phone geo never derives, and imported
// quote/invoice lines never recompute totals.
//
// STANDALONE module: it executes over a persisted sync-change manifest and is wired into
// the finalize pass by its caller. The CALLER decides which lanes invoke it — per the door
// matrix, integrity hooks are batched at finalize for sync-large AND seed runs (D-10),
// while the small-lane / per-record story is the caller's decision; this module just runs
// the three passes over whatever manifest it is handed. It reuses the hooks' own extracted
// cores (`money/totals-hooks.ts`, `geocoding/address-normalize-hook.ts`,
// `phone-geo/derive-geo-hook.ts`) — no math or merge policy is reimplemented here.
//
// Pass selection reads TIER-1 membership (`manifest.touched` — unconditional, every
// changed record with its changed field keys), not the rule-gated tier-2 `deltas` —
// reading deltas would under-select exactly the way B-1 described (an imported address
// only geocoded when a rule happened to watch the field). Created records appear in
// `touched` too (creates record their written keys). A record degraded to ids-only
// (`touched[rid] === 1` — keys shed under the byte budget) is treated as "any pass may
// apply": every field of the wanted type on its def becomes a target, and the totals
// pass assumes its trigger attrs may have changed.
//
// Value freshness: the totals cores read every input from the store themselves; the
// address and phone passes RE-READ the stored value per (record, field) instead of
// trusting the manifest's `{o, n}` snapshot — a later write may have superseded it, and
// the address core's own stale-write guard depends on comparing against the value the
// run started from.
//
// Idempotency (these passes can re-run on rare redelivery): totals recompute from
// current lines (pure re-derivation), the address pass skips structs that already carry
// a geocode stamp and the core's write-back is guarded, and phone geo fills only blank
// targets.
//
// Keep top-level imports to types/logger/pure constants only; lazy-import everything
// else (the events ↔ money/geocoding/cache boundaries break vi.mock otherwise — same
// rule as `sync-finalize.ts` next door).

import type { Database } from '@auxx/database'
import { FieldType } from '@auxx/database/enums'
import type { CustomFieldEntity } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import type { EntityFieldChangeEvent } from '../../field-hooks/types'
import type { CachedField } from '../../field-values/types'
import type { TotalledDocumentType } from '../../money/totals-hooks'
import type {
  ManifestFieldChange,
  SyncChangeManifest,
} from '../../record-rules/sync-manifest-types'

const logger = createScopedLogger('finalize-integrity')

/**
 * Bounded concurrency for the geocode pass. There is NO geocode job anywhere — the inline
 * hook fire-and-forgets one MapTiler call per write (plan events/03 §3.5b) — so this pass
 * IS the batching: a small worker pool instead of job infra.
 */
const ADDRESS_GEOCODE_CONCURRENCY = 4

/** Actor for the passes' writes — same fallback the sync finalize doors use. */
const SYSTEM_ACTOR = 'system'

export interface IntegrityPassesInput {
  organizationId: string
  manifest: SyncChangeManifest
}

/**
 * Run the three data-integrity batch passes over a sync-change manifest:
 *
 * 1. Totals — changed line-item records map (via the hook's own parent resolution) to
 *    DISTINCT parent quotes/invoices, each recomputed once; lines whose qty/unitPrice
 *    changed get `line_item_line_total` rewritten first. Quote/invoice billing-field
 *    changes recompute that document directly.
 * 2. Address normalize + geocode — changed ADDRESS_STRUCT fields, normalized via the
 *    hook's core under a bounded-concurrency pool.
 * 3. Phone geo — changed PHONE_INTL fields, blank city/region/country/timezone filled
 *    via the hook's core (in-memory lookup, sequential).
 *
 * NEVER throws: each pass — and each record inside a pass — is individually guarded and
 * logged, so one bad record or one failing pass cannot starve the others (mirrors
 * `runSyncFinalize`'s contract).
 */
export async function runIntegrityPasses(db: Database, input: IntegrityPassesInput): Promise<void> {
  const { organizationId, manifest } = input
  try {
    if (Object.keys(manifest.touched).length === 0) return

    const resolveDef = await buildDefFieldResolver(organizationId)
    await totalsPass(db, organizationId, manifest, resolveDef)
    await addressPass(db, organizationId, manifest, resolveDef)
    await phoneGeoPass(db, organizationId, manifest, resolveDef)
  } catch (error) {
    logger.error('integrity passes failed', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// =============================================================================
// Manifest → def/field resolution (shared by all passes)
// =============================================================================

/** Per-def index: canonical ids + the outputKey → field map the manifest keys resolve
 * through. Manifest change keys are outputKeys (`systemAttribute ?? fieldId`), matching
 * the record-rules consumer's convention. */
interface DefFieldIndex {
  entityDefinitionId: string
  entityType: string | null
  entitySlug: string
  byOutputKey: Map<string, CustomFieldEntity>
}

type DefFieldResolver = (rawDefId: string) => Promise<DefFieldIndex | null>

/**
 * Memoizing resolver for the RecordId def prefix (slug for imports, CUID for connectors —
 * `findCachedResource` matches id, entityType, and apiSlug). Null for unknown defs and on
 * cache hiccups — a skipped record beats a thrown pass.
 */
async function buildDefFieldResolver(organizationId: string): Promise<DefFieldResolver> {
  const { findCachedResource, getCachedCustomFields } = await import('../../cache')
  const memo = new Map<string, Promise<DefFieldIndex | null>>()
  return (rawDefId: string) => {
    let pending = memo.get(rawDefId)
    if (!pending) {
      pending = (async () => {
        const resource = await findCachedResource(organizationId, rawDefId)
        if (!resource?.entityDefinitionId) return null
        const fields = await getCachedCustomFields(organizationId, resource.entityDefinitionId)
        const byOutputKey = new Map<string, CustomFieldEntity>()
        for (const field of fields) byOutputKey.set(field.systemAttribute ?? field.id, field)
        return {
          entityDefinitionId: resource.entityDefinitionId,
          entityType: resource.entityType ?? null,
          entitySlug: resource.apiSlug,
          byOutputKey,
        }
      })().catch((error) => {
        logger.warn('integrity passes: def resolution failed — skipping def', {
          organizationId,
          rawDefId,
          error: error instanceof Error ? error.message : String(error),
        })
        return null
      })
      memo.set(rawDefId, pending)
    }
    return pending
  }
}

/** One changed field of a wanted type on one record, with canonical ids for the write path. */
interface FieldTypeTarget {
  /** Canonical-def RecordId (CUID keyspace) for the field-value read/write path. */
  recordId: RecordId
  entityDefinitionId: string
  entityType: string | null
  entitySlug: string
  field: CustomFieldEntity
  /** Tier-2 delta when one was captured for this record+key — values are rule-gated. */
  change?: ManifestFieldChange
}

/**
 * Collect every touched (record, field) in the manifest whose resolved field is of
 * `fieldType`. An ids-only touched record (`1`) contributes EVERY field of the wanted
 * type on its def — its keys were shed, so any pass may apply.
 */
async function collectFieldTypeTargets(
  manifest: SyncChangeManifest,
  fieldType: string,
  resolveDef: DefFieldResolver
): Promise<FieldTypeTarget[]> {
  const targets: FieldTypeTarget[] = []
  for (const [rid, touched] of Object.entries(manifest.touched)) {
    const { entityDefinitionId: rawDefId, entityInstanceId } = parseRecordId(rid as RecordId)
    const def = await resolveDef(rawDefId)
    if (!def) continue
    const deltas = manifest.deltas[rid as RecordId]
    const push = (key: string, field: CustomFieldEntity) =>
      targets.push({
        recordId: toRecordId(def.entityDefinitionId, entityInstanceId),
        entityDefinitionId: def.entityDefinitionId,
        entityType: def.entityType,
        entitySlug: def.entitySlug,
        field,
        change: deltas?.[key],
      })
    if (touched === 1) {
      for (const [key, field] of def.byOutputKey) {
        if (field.type === fieldType) push(key, field)
      }
      continue
    }
    for (const key of touched) {
      const field = def.byOutputKey.get(key)
      if (field && field.type === fieldType) push(key, field)
    }
  }
  return targets
}

/** Synthesize the slice of {@link EntityFieldChangeEvent} the extracted hook cores read.
 * `oldValue` carries the manifest's captured pre-write value when present; `newValue` the
 * freshly re-read stored value (the cores never read these two themselves — listeners might). */
function buildSyntheticEvent(
  organizationId: string,
  target: FieldTypeTarget,
  newValue: unknown
): EntityFieldChangeEvent {
  return {
    recordId: target.recordId,
    entityDefinitionId: target.entityDefinitionId,
    entityType: target.entityType,
    entitySlug: target.entitySlug,
    field: target.field as unknown as CachedField,
    oldValue: target.change?.o ?? null,
    newValue,
    oldDisplay: null,
    newDisplay: null,
    organizationId,
    userId: SYSTEM_ACTOR,
  }
}

/** Minimal worker pool: `limit` lanes pulling from one cursor. Workers guard themselves. */
async function runWithPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++]!
        await worker(item)
      }
    })
  )
}

// =============================================================================
// Pass 1: quote/invoice totals
// =============================================================================

/**
 * Recompute document totals for every quote/invoice a changed line contributes to —
 * DISTINCT parents, one recompute each (two changed lines of one invoice → one recompute).
 * Changed lines with a qty/unitPrice write get their own `line_item_line_total` rewritten
 * first, so the parent recompute sums fresh line totals. Quote/invoice billing-field
 * changes (discount/tax) recompute that document directly — same trigger vocabulary as the
 * inline hooks. Idempotent: `recomputeTotals` is a pure re-derivation from current lines +
 * billing fields; re-running writes the same mirrors.
 */
async function totalsPass(
  db: Database,
  organizationId: string,
  manifest: SyncChangeManifest,
  resolveDef: DefFieldResolver
): Promise<void> {
  try {
    const totalsHooks = await import('../../money/totals-hooks')
    const hasAny = (keys: string[], set: ReadonlySet<SystemAttribute>) =>
      keys.some((key) => set.has(key as SystemAttribute))

    const lineWork: Array<{ lineInstanceId: string; rewriteLineTotal: boolean }> = []
    const parents = new Map<
      string,
      { documentType: TotalledDocumentType; documentInstanceId: string }
    >()
    const addParent = (documentType: TotalledDocumentType, documentInstanceId: string) =>
      parents.set(`${documentType}:${documentInstanceId}`, { documentType, documentInstanceId })

    for (const [rid, touched] of Object.entries(manifest.touched)) {
      const { entityDefinitionId: rawDefId, entityInstanceId } = parseRecordId(rid as RecordId)
      // Ids-only degradation: the keys were shed, so any trigger attr may have
      // changed — the record enters every arm its def qualifies for.
      const idsOnly = touched === 1
      const keys = idsOnly ? [] : touched
      const hasTrigger = (set: ReadonlySet<SystemAttribute>) => idsOnly || hasAny(keys, set)
      const def = await resolveDef(rawDefId)
      // Def entityType, not systemAttribute alone, decides the arm — mirrors the hooks'
      // per-apiSlug registration and keeps a stray attr on another def from mis-writing.
      switch (def?.entityType) {
        case 'line_item':
          if (hasTrigger(totalsHooks.LINE_TRIGGER_ATTRS)) {
            lineWork.push({
              lineInstanceId: entityInstanceId,
              rewriteLineTotal: hasTrigger(totalsHooks.LINE_TOTAL_TRIGGER_ATTRS),
            })
          }
          break
        case 'quote':
          if (hasTrigger(totalsHooks.QUOTE_TRIGGER_ATTRS)) addParent('quote', entityInstanceId)
          break
        case 'invoice':
          if (hasTrigger(totalsHooks.INVOICE_TRIGGER_ATTRS)) {
            addParent('invoice', entityInstanceId)
          }
          break
        case 'order':
          if (hasTrigger(totalsHooks.ORDER_TRIGGER_ATTRS)) addParent('order', entityInstanceId)
          break
      }
    }
    if (lineWork.length === 0 && parents.size === 0) return

    for (const line of lineWork) {
      try {
        if (line.rewriteLineTotal) {
          await totalsHooks.recomputeLineTotal({
            organizationId,
            userId: SYSTEM_ACTOR,
            lineInstanceId: line.lineInstanceId,
          })
        }
        const parent = await totalsHooks.resolveLineParentDocument({
          organizationId,
          userId: SYSTEM_ACTOR,
          lineInstanceId: line.lineInstanceId,
        })
        if (parent) addParent(parent.documentType, parent.documentInstanceId)
      } catch (error) {
        logger.error('integrity totals: line handling failed', {
          organizationId,
          lineInstanceId: line.lineInstanceId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    for (const parent of parents.values()) {
      try {
        await totalsHooks.recomputeTotals({
          organizationId,
          userId: SYSTEM_ACTOR,
          documentType: parent.documentType,
          documentInstanceId: parent.documentInstanceId,
          db,
        })
      } catch (error) {
        logger.error('integrity totals: recompute failed', {
          organizationId,
          ...parent,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    logger.info('integrity totals pass done', {
      organizationId,
      lines: lineWork.length,
      parents: parents.size,
    })
  } catch (error) {
    logger.error('integrity totals pass failed', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// =============================================================================
// Pass 2: address normalize + geocode
// =============================================================================

/**
 * Normalize + geocode every changed ADDRESS_STRUCT value through the hook's core, under a
 * pool of {@link ADDRESS_GEOCODE_CONCURRENCY} workers. The stored value is RE-READ per
 * target — a later write may have superseded the manifest snapshot, and the core's own
 * stale-write guard compares against the value handed in, so it must be fresh. Idempotent
 * on redelivery: a struct already carrying a geocode stamp (only ever written by the
 * normalize core — sync/import sources write raw components) is skipped, and the core's
 * write-back re-reads before writing.
 */
async function addressPass(
  db: Database,
  organizationId: string,
  manifest: SyncChangeManifest,
  resolveDef: DefFieldResolver
): Promise<void> {
  try {
    const targets = await collectFieldTypeTargets(manifest, FieldType.ADDRESS_STRUCT, resolveDef)
    if (targets.length === 0) return

    const { extractStruct, hasStampedGeocode, isNonEmptyStruct, runNormalize } = await import(
      '../../geocoding/address-normalize-hook'
    )
    const { createFieldValueContext } = await import('../../field-values/field-value-helpers')
    const { getValue } = await import('../../field-values/field-value-queries')
    const ctx = createFieldValueContext(organizationId, SYSTEM_ACTOR, db, undefined, {
      skipPreHooks: true,
    })

    let normalized = 0
    await runWithPool(targets, ADDRESS_GEOCODE_CONCURRENCY, async (target) => {
      try {
        const stored = await getValue(
          ctx,
          { recordId: target.recordId, fieldId: target.field.id },
          target.field as unknown as CachedField
        )
        const current = extractStruct(stored)
        if (!isNonEmptyStruct(current)) return
        if (hasStampedGeocode(current)) return
        await runNormalize(buildSyntheticEvent(organizationId, target, stored), current)
        normalized++
      } catch (error) {
        logger.error('integrity address pass: record failed', {
          organizationId,
          recordId: target.recordId,
          fieldId: target.field.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })

    logger.info('integrity address pass done', {
      organizationId,
      targets: targets.length,
      normalized,
    })
  } catch (error) {
    logger.error('integrity address pass failed', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// =============================================================================
// Pass 3: phone geo
// =============================================================================

/**
 * Derive geo fields for every changed PHONE_INTL value through the hook's core. Sequential —
 * the lookup is an in-memory table read; the only I/O is the core's fill-if-blank reads and
 * quiet writes. The phone number is RE-READ from the store (a later write wins over the
 * manifest snapshot). Idempotent: the core fills only BLANK targets, so a redelivered run
 * writes nothing the first run already filled.
 */
async function phoneGeoPass(
  db: Database,
  organizationId: string,
  manifest: SyncChangeManifest,
  resolveDef: DefFieldResolver
): Promise<void> {
  try {
    const targets = await collectFieldTypeTargets(manifest, FieldType.PHONE_INTL, resolveDef)
    if (targets.length === 0) return

    const { extractPrimaryPhone, fillBlankGeoFields } = await import(
      '../../phone-geo/derive-geo-hook'
    )
    const { lookupPhoneGeo } = await import('../../phone-geo/lookup')
    const { createFieldValueContext } = await import('../../field-values/field-value-helpers')
    const { getValue } = await import('../../field-values/field-value-queries')
    const ctx = createFieldValueContext(organizationId, SYSTEM_ACTOR, db, undefined, {
      skipPreHooks: true,
    })

    let derived = 0
    for (const target of targets) {
      try {
        const stored = await getValue(
          ctx,
          { recordId: target.recordId, fieldId: target.field.id },
          target.field as unknown as CachedField
        )
        const phone = extractPrimaryPhone(stored)
        if (!phone) continue
        const geo = lookupPhoneGeo(phone)
        if (!geo) continue
        await fillBlankGeoFields(buildSyntheticEvent(organizationId, target, stored), geo)
        derived++
      } catch (error) {
        logger.error('integrity phone-geo pass: record failed', {
          organizationId,
          recordId: target.recordId,
          fieldId: target.field.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    logger.info('integrity phone-geo pass done', {
      organizationId,
      targets: targets.length,
      derived,
    })
  } catch (error) {
    logger.error('integrity phone-geo pass failed', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
