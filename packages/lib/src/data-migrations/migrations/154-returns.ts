// packages/lib/src/data-migrations/migrations/154-returns.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import type { ResourceField } from '../../resources/registry/field-types'
import { CONTACT_FIELDS } from '../../resources/registry/resources/contact-fields'
import { CREDIT_MEMO_FIELDS } from '../../resources/registry/resources/credit-memo-fields'
import { LINE_ITEM_FIELDS } from '../../resources/registry/resources/line-item-fields'
import { ORDER_FIELDS } from '../../resources/registry/resources/order-fields'
import { PART_FIELDS } from '../../resources/registry/resources/part-fields'
import { RETURN_FIELDS } from '../../resources/registry/resources/return-fields'
import { RETURN_LINE_FIELDS } from '../../resources/registry/resources/return-line-fields'
import { RETURN_PART_LINE_FIELDS } from '../../resources/registry/resources/return-part-line-fields'
import { TICKET_FIELDS } from '../../resources/registry/resources/ticket-fields'
import {
  ensureCustomFields,
  ensureEntityDefinitions,
  linkDisplayFields,
  linkNewRelationships,
  loadExistingState,
} from '../../seed/entity-helpers'
import { SYSTEM_ENTITIES } from '../../seed/entity-seeder/constants'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:154')

/** What {@link ensureCustomFields} returns, keyed `<entityType>:<field id>`. */
type EnsuredFieldMap = Awaited<ReturnType<typeof ensureCustomFields>>

/**
 * The three defs this migration creates.
 *
 * `return` is VISIBLE with a route folder; `return_line` and `return_part_line`
 * are hidden, like `credit_memo_line`. The shape of each row (icon, color,
 * singular/plural, apiSlug, isVisible) is read from {@link SYSTEM_ENTITIES}
 * rather than restated here - the 146/149/153 pattern, so a fresh org and a
 * migrated org cannot end up with different definitions.
 */
const NEW_ENTITY_TYPES = ['return', 'return_line', 'return_part_line'] as const

/** The registry field map for each new def. */
const NEW_DEF_FIELDS: Record<string, Record<string, ResourceField>> = {
  return: RETURN_FIELDS,
  return_line: RETURN_LINE_FIELDS,
  return_part_line: RETURN_PART_LINE_FIELDS,
}

/**
 * Existing defs this migration must find before it does anything.
 *
 * Every one of them carries a new relationship half, so an org short of any of
 * them would get a partially linked graph. Absent rather than failed: an org
 * missing one of these has not been seeded from the current registry at all,
 * and the seeder creates all of it together.
 */
const REQUIRED_ENTITY_TYPES = [
  'contact',
  'order',
  'ticket',
  'line_item',
  'part',
  'credit_memo',
] as const

/**
 * The SEVEN new halves this migration adds to defs that already exist, keyed by
 * the def they land on.
 *
 * Six are has_many inverses; `credit_memo.return` is the odd one and is the
 * OWNING `belongs_to` - the FK is on the memo, because a memo very often has no
 * return at all and on the channel path the connector creates the memo BEFORE
 * anyone records the return (brief §5.1). That is the only direction that
 * works.
 */
const WIDENED_DEF_FIELDS: Record<string, Record<string, ResourceField | undefined>> = {
  contact: { returns: CONTACT_FIELDS.returns },
  order: { returns: ORDER_FIELDS.returns },
  ticket: { returns: TICKET_FIELDS.returns },
  line_item: { returnLines: LINE_ITEM_FIELDS.returnLines },
  part: { returnLines: PART_FIELDS.returnLines, returnPartLines: PART_FIELDS.returnPartLines },
  credit_memo: { return: CREDIT_MEMO_FIELDS.return },
}

/**
 * Every relationship half this migration must LINK, paired with the inverse it
 * points at.
 *
 * Checked explicitly after {@link linkNewRelationships} rather than trusted,
 * because that helper only logs a DEBUG line when it cannot resolve an inverse
 * - the 135 lesson, restated by 136, 149 and 153. An UNLINKED relationship is
 * worse than a missing one: the field exists so writes are accepted, but with
 * no inverse the other side reads empty and every consumer silently sees
 * nothing.
 *
 * 🛑 `return_part_line:movement` is DELIBERATELY ABSENT from this list. It
 * points at `stock_movement` and is one-sided on purpose: the append-only
 * ledger carries no field pointing back at a salvage row, which also keeps this
 * edge out of the ledger's own link set. Its registry declaration says
 * `inverseResourceFieldId: null`, so `linkNewRelationships` skips it and this
 * assertion must not choke on it.
 *
 * ⚠️ `return_part_line:parent` / `return_part_line:children` is
 * SELF-REFERENTIAL. Both halves live in one def's field map, so they resolve
 * inside the single `ensureCustomFields` call for `return_part_line` - but only
 * because that call's output is merged into the SAME `fieldMap` every other
 * pair is resolved from (see below).
 */
const RELATIONSHIP_PAIRS: readonly { owning: string; inverse: string }[] = [
  // return -> the three parties
  { owning: `return:${RETURN_FIELDS.contact?.id}`, inverse: 'contact:returns' },
  { owning: `contact:${CONTACT_FIELDS.returns?.id}`, inverse: 'return:contact' },
  { owning: `return:${RETURN_FIELDS.order?.id}`, inverse: 'order:returns' },
  { owning: `order:${ORDER_FIELDS.returns?.id}`, inverse: 'return:order' },
  { owning: `return:${RETURN_FIELDS.ticket?.id}`, inverse: 'ticket:returns' },
  { owning: `ticket:${TICKET_FIELDS.returns?.id}`, inverse: 'return:ticket' },

  // return -> return_line
  { owning: `return:${RETURN_FIELDS.lines?.id}`, inverse: 'return_line:return' },
  { owning: `return_line:${RETURN_LINE_FIELDS.return?.id}`, inverse: 'return:lines' },

  // return_line -> what was sold, and what it is
  { owning: `return_line:${RETURN_LINE_FIELDS.lineItem?.id}`, inverse: 'line_item:returnLines' },
  { owning: `line_item:${LINE_ITEM_FIELDS.returnLines?.id}`, inverse: 'return_line:lineItem' },
  { owning: `return_line:${RETURN_LINE_FIELDS.part?.id}`, inverse: 'part:returnLines' },
  { owning: `part:${PART_FIELDS.returnLines?.id}`, inverse: 'return_line:part' },

  // return_line -> return_part_line, and the tree under it
  {
    owning: `return_line:${RETURN_LINE_FIELDS.partLines?.id}`,
    inverse: 'return_part_line:returnLine',
  },
  {
    owning: `return_part_line:${RETURN_PART_LINE_FIELDS.returnLine?.id}`,
    inverse: 'return_line:partLines',
  },
  {
    owning: `return_part_line:${RETURN_PART_LINE_FIELDS.parent?.id}`,
    inverse: 'return_part_line:children',
  },
  {
    owning: `return_part_line:${RETURN_PART_LINE_FIELDS.children?.id}`,
    inverse: 'return_part_line:parent',
  },
  {
    owning: `return_part_line:${RETURN_PART_LINE_FIELDS.part?.id}`,
    inverse: 'part:returnPartLines',
  },
  { owning: `part:${PART_FIELDS.returnPartLines?.id}`, inverse: 'return_part_line:part' },

  // the money, whose FK sits on the memo
  { owning: `credit_memo:${CREDIT_MEMO_FIELDS.return?.id}`, inverse: 'return:creditMemos' },
  { owning: `return:${RETURN_FIELDS.creditMemos?.id}`, inverse: 'credit_memo:return' },
]

/**
 * A new def and a new field are invisible to every read path that serves them
 * until the org's caches are dropped. `perOrgMigration` does this after each
 * org and flushes the fleet at the end, but `up()` can also be called directly
 * (`scripts/run-entity-migration.ts`), and a stale cache after a def change
 * makes every read look like an unprovisioned org.
 */
const CACHE_KEYS = ['entityDefs', 'entityDefSlugs', 'customFields', 'resources'] as const

/**
 * Migration 154: the `return`, `return_line` and `return_part_line` defs, their
 * fields, and the seven new halves they need on defs that already exist
 * (`plans/money/tasks/54-returns.md` §3, step 1 of §10).
 *
 * ## Why this migration is the whole point
 *
 * `ensureEntityDefinitions` / `ensureCustomFields` are plain inserts that skip
 * whatever an org already holds, so `SYSTEM_ENTITIES` and `FIELD_REGISTRY`
 * alone reach FRESH orgs and nothing else. This is what reaches the ones that
 * already exist.
 *
 * ## What it adds
 *
 * - **`return`** - one shipment back: one customer, one conversation. VISIBLE
 *   with a route folder, unlike `shipment` / `parcel` / `fulfillment`, because
 *   warehouse staff create these by hand.
 * - **`return_line`** - one sold line returned PER CONDITION, and the evidence
 *   anchor: condition grade, liability, inspector, notes and photos.
 * - **`return_part_line`** - the BOM teardown checklist, quantity and status
 *   only, self-referential through `parent` / `children`.
 * - **`contact.returns` / `order.returns` / `ticket.returns`** - the has_many
 *   inverses of the three parties a return points at.
 * - **`line_item.returnLines` / `part.returnLines` / `part.returnPartLines`** -
 *   the has_many inverses under `return_line` and `return_part_line`.
 * - **`credit_memo.return`** - the OWNING `belongs_to`, inverse of
 *   `return.creditMemos`.
 *
 * ## 🛑 The seeded option sets reach an org exactly ONCE, here
 *
 * `ensureCustomFields` NEVER updates an existing field's options. So the TAGS
 * seed values on `return.reason` and the CLOSED `SINGLE_SELECT` values on
 * `return.origin` land at creation and never again - adding one later needs its
 * own entity migration. Both lists come straight out of the registry
 * (`RETURN_REASON_SEED_OPTIONS`, `RETURN_ORIGIN_OPTIONS`) rather than being
 * restated here, so the two halves cannot disagree, and the test pins their
 * exact contents. This binds `origin` hardest, because that set is closed.
 *
 * ## `return.contact` is NULLABLE, deliberately
 *
 * About 15% of returns are an unannounced pallet on the dock, and the record
 * has to exist before anyone knows whose it is. "Unidentified" is derived from
 * `contact IS NULL`, never a status value. Nothing in this migration tightens
 * it.
 *
 * ## No writers yet
 *
 * This lands with nothing writing to any of the three defs. The ticket block,
 * the status guard, the salvage tree and the salvage writer are separate steps;
 * this migration is the registry contract they build against.
 *
 * ## Ordering
 *
 * MUST sort after 107 (`order`) and after the migrations that created
 * `credit_memo` and `part`. An org short of any of
 * {@link REQUIRED_ENTITY_TYPES} is a SKIP, not a failure - the seeder creates
 * all of this together from the registry.
 *
 * Idempotent: `ensureEntityDefinitions` and `ensureCustomFields` are
 * INSERT-only and skip whatever the org already holds, and
 * `linkNewRelationships` only writes an inverse that is currently unset.
 */
export const migration154Returns: PerOrgMigration = {
  id: '154-returns',
  description:
    'Adds the visible return def plus the hidden return_line and return_part_line defs with ' +
    'all their fields, and the seven new relationship halves they need on contact, order, ' +
    'ticket, line_item, part and credit_memo - so what came back, in what condition and whose ' +
    'fault it was is a record rather than an email thread (plans/money/tasks/54-returns.md)',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const existing = await loadExistingState(db, organizationId)

    // Absent rather than failed: an org short of any of these has not been
    // seeded from the current registry at all.
    const requiredDefIds = new Map<string, string>()
    for (const entityType of REQUIRED_ENTITY_TYPES) {
      const def = existing.entityDefs.get(entityType)
      if (!def) return { ...state, alreadyUpToDate: true }
      requiredDefIds.set(entityType, def.id)
    }

    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      SYSTEM_ENTITIES.filter((e) => (NEW_ENTITY_TYPES as readonly string[]).includes(e.entityType)),
      existing,
      state
    )
    for (const [entityType, defId] of requiredDefIds) entityDefIds.set(entityType, defId)

    // 🛑 ONE field map spanning all three new defs AND the six widened existing
    // ones. `linkNewRelationships` resolves an inverse out of this map by
    // `<entityType>:<field id>`, so linking the halves of a pair in separate
    // calls would leave each unable to see the other and skip the pair with
    // nothing louder than a debug line (the 135 lesson, restated by 136, 149
    // and 153).
    const fieldMap: EnsuredFieldMap = new Map()

    for (const entityType of NEW_ENTITY_TYPES) {
      const defId = entityDefIds.get(entityType)
      if (!defId) continue
      const created = await ensureCustomFields(
        db,
        organizationId,
        entityType,
        defId,
        NEW_DEF_FIELDS[entityType]!,
        existing,
        state
      )
      for (const [key, value] of created) fieldMap.set(key, value)
    }

    for (const [entityType, fields] of Object.entries(WIDENED_DEF_FIELDS)) {
      const defId = entityDefIds.get(entityType)
      if (!defId) continue

      const resolved: Record<string, ResourceField> = {}
      for (const [key, field] of Object.entries(fields)) {
        if (!field) {
          throw new Error(`registry is missing ${entityType}.${key} (migration 154)`)
        }
        resolved[key] = field
      }

      const widened = await ensureCustomFields(
        db,
        organizationId,
        entityType,
        defId,
        resolved,
        existing,
        state
      )
      for (const [key, value] of widened) fieldMap.set(key, value)
    }

    await linkNewRelationships(db, fieldMap, entityDefIds, state)
    await assertInversesLinked(db, fieldMap)

    await linkDisplayFields(db, [...NEW_ENTITY_TYPES], entityDefIds, fieldMap)

    const changed =
      state.entityDefsCreated > 0 || state.fieldsCreated > 0 || state.relationshipsLinked > 0

    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 154 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}

/**
 * Fail loudly when a relationship half was created but never linked.
 *
 * `linkNewRelationships` skips an unresolvable inverse with a debug line, which
 * here would mean, for example, a `return` that accepts credit-memo writes
 * nobody can read back through `creditMemos`, or a salvage tree whose children
 * are invisible from their own parent. `return_part_line.movement` is
 * deliberately NOT checked - see {@link RELATIONSHIP_PAIRS}.
 */
async function assertInversesLinked(
  db: Database,
  fieldMap: Map<string, { id: string }>
): Promise<void> {
  for (const { owning, inverse } of RELATIONSHIP_PAIRS) {
    const field = fieldMap.get(owning)
    if (!field) {
      throw new Error(`migration 154 could not resolve the field ${owning}`)
    }
    const row = await db.query.CustomField.findFirst({
      where: eq(schema.CustomField.id, field.id),
      columns: { options: true },
    })
    const inverseId = (row?.options as { relationship?: { inverseResourceFieldId?: string } })
      ?.relationship?.inverseResourceFieldId
    if (!inverseId) {
      throw new Error(
        `migration 154 created ${owning} but could not link it to ${inverse} - the inverse half ` +
          'is missing, and an unlinked relationship writes rows the other side cannot see'
      )
    }
  }
}
