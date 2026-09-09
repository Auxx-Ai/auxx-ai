// packages/lib/scripts/audit-orphaned-children.ts
//
// Finds the child records that were stranded BEFORE the delete engine learned to
// cascade (plans/relationships/01-delete-semantics.md §1.3, §2.1): rows of an
// owned definition that hold no value in any of the relationship fields through
// which a parent owns them. Every such row is invisible in every surface, since
// owned children render only inside their parent, and still counted by every
// aggregate over the definition.
//
// The edge list is not hard-coded. It is read from the registry at run time:
// every has_many / has_one field declaring `onDelete: 'cascade'` names one
// owning field on the child through `inverseResourceFieldId`, and a child is an
// orphan when NONE of its owning fields (a line item can be owned by an order, a
// quote, an invoice or a work order) carries a related id.
//
// Read-only by default. `--purge` deletes what it found through the delete
// engine on a quiet session, so no events, no timeline entries and no realtime
// frames are produced, exactly like a connector teardown. The engine's own
// cascade then removes anything those orphans owned in turn.
//
//   # report, every org
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/audit-orphaned-children.ts
//
//   # one org (name or id)
//   ... audit-orphaned-children.ts --org DemoOrg1
//
//   # delete what the report lists, acting as a user of that org
//   ... audit-orphaned-children.ts --org DemoOrg1 --purge --as <userId>

import { database as db } from '@auxx/database'
import { sql } from 'drizzle-orm'
import { UnifiedCrudHandler } from '../src/resources/crud'
import { quietSession } from '../src/resources/crud/write-origin'
import type { ResourceField } from '../src/resources/registry/field-types'
import { toRecordId } from '../src/resources/resource-id'
import { FIELD_REGISTRY } from '../src/seed/entity-seeder/create-fields'

// =============================================================================
// ARGS
// =============================================================================

const argv = process.argv.slice(2)

function flag(name: string): string | null {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : null
}

const ORG_FILTER = flag('--org')
const PURGE = argv.includes('--purge')
const ACT_AS = flag('--as')

if (PURGE && !ACT_AS) {
  console.error('--purge needs --as <userId>: the delete engine records who deleted the rows')
  process.exit(1)
}

// =============================================================================
// EDGES FROM THE REGISTRY
// =============================================================================

/** One owned child definition and the systemAttributes of every field that can own it. */
interface OwnedChild {
  childType: string
  owningAttributes: string[]
  /** `parentType.fieldKey` per owning field, for the report. */
  owners: string[]
}

/**
 * Every child type some cascade edge points at, with all of its owning fields.
 *
 * The child's owning field is resolved from the parent's `inverseResourceFieldId`
 * (`line_item:order` is the `order` key on `line_item`'s registry) and named by
 * its systemAttribute, which is what the stored `CustomField` row carries.
 */
function collectOwnedChildren(): OwnedChild[] {
  const byChild = new Map<string, OwnedChild>()

  const add = (childType: string, owningAttribute: string, owner: string) => {
    const entry = byChild.get(childType) ?? { childType, owningAttributes: [], owners: [] }
    entry.owningAttributes.push(owningAttribute)
    entry.owners.push(owner)
    byChild.set(childType, entry)
  }

  for (const [parentType, fields] of Object.entries(FIELD_REGISTRY)) {
    for (const [fieldKey, field] of Object.entries(fields as Record<string, ResourceField>)) {
      const owner = `${parentType}.${fieldKey}`

      // Self-relations declare only the seeder block, which names the inverse
      // attribute directly.
      const seed = field.relationshipConfig
      if (seed?.onDelete === 'cascade') {
        add(seed.relatedEntityType, seed.inverseSystemAttribute, owner)
        continue
      }

      const relationship = field.relationship
      // A belongs_to never carries `onDelete`, so this narrowing also excludes it.
      if (!relationship || relationship.onDelete !== 'cascade') continue
      if (!relationship.inverseResourceFieldId) continue

      const [childType, childKey] = relationship.inverseResourceFieldId.split(':')
      if (!childType || !childKey) continue
      const childFields = FIELD_REGISTRY[childType]
      const childField = (childFields as Record<string, ResourceField> | undefined)?.[childKey]
      if (!childField?.systemAttribute) {
        console.warn(`skip ${owner}: ${childType}.${childKey} has no systemAttribute`)
        continue
      }
      add(childType, childField.systemAttribute, owner)
    }
  }

  return [...byChild.values()].sort((a, b) => a.childType.localeCompare(b.childType))
}

// =============================================================================
// DATABASE
// =============================================================================

async function resolveOrgs(): Promise<{ id: string; name: string }[]> {
  const { rows } = await db.execute<{ id: string; name: string }>(sql`
    SELECT o.id, o.name
    FROM "Organization" o
    ${ORG_FILTER ? sql`WHERE o.name = ${ORG_FILTER} OR o.id = ${ORG_FILTER}` : sql``}
    ORDER BY o.name
  `)
  return rows
}

/** The child def id and the stored ids of its owning fields, or null when the org lacks the def. */
async function resolveChild(
  organizationId: string,
  child: OwnedChild
): Promise<{ defId: string; fieldIds: string[] } | null> {
  const { rows: defs } = await db.execute<{ id: string }>(sql`
    SELECT id FROM "EntityDefinition"
    WHERE "organizationId" = ${organizationId} AND "entityType" = ${child.childType}
    LIMIT 1
  `)
  const defId = defs[0]?.id
  if (!defId) return null

  const { rows: fields } = await db.execute<{ id: string }>(sql`
    SELECT id FROM "CustomField"
    WHERE "organizationId" = ${organizationId}
      AND "entityDefinitionId" = ${defId}
      AND "systemAttribute" IN (${sql.join(
        child.owningAttributes.map((attribute) => sql`${attribute}`),
        sql`, `
      )})
  `)
  return { defId, fieldIds: fields.map((row) => row.id) }
}

/**
 * Child instances with no related id in any owning field. Archived rows count:
 * an archived orphan is still an orphan, and a hard delete reaches it.
 */
async function findOrphans(
  organizationId: string,
  defId: string,
  fieldIds: string[]
): Promise<string[]> {
  if (fieldIds.length === 0) return []
  const { rows } = await db.execute<{ id: string }>(sql`
    SELECT i.id
    FROM "EntityInstance" i
    WHERE i."organizationId" = ${organizationId}
      AND i."entityDefinitionId" = ${defId}
      AND NOT EXISTS (
        SELECT 1 FROM "FieldValue" fv
        WHERE fv."entityId" = i.id
          AND fv."organizationId" = i."organizationId"
          AND fv."fieldId" IN (${sql.join(
            fieldIds.map((id) => sql`${id}`),
            sql`, `
          )})
          AND fv."relatedEntityId" IS NOT NULL
      )
  `)
  return rows.map((row) => row.id)
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  const children = collectOwnedChildren()
  console.log(`${children.length} owned child definitions declared in the registry\n`)

  const orgs = await resolveOrgs()
  if (orgs.length === 0) {
    console.log('No org matched')
    return
  }

  let totalOrphans = 0

  for (const org of orgs) {
    const lines: string[] = []
    const toPurge: { defId: string; ids: string[] }[] = []

    for (const child of children) {
      const resolved = await resolveChild(org.id, child)
      if (!resolved) continue
      if (resolved.fieldIds.length < child.owningAttributes.length) {
        lines.push(
          `  ${child.childType}: only ${resolved.fieldIds.length} of ${child.owningAttributes.length} owning fields exist in this org (entity migration pending?)`
        )
      }
      const orphans = await findOrphans(org.id, resolved.defId, resolved.fieldIds)
      if (orphans.length === 0) continue
      totalOrphans += orphans.length
      lines.push(
        `  ${child.childType}: ${orphans.length} orphaned (owners: ${child.owners.join(', ')})`
      )
      toPurge.push({ defId: resolved.defId, ids: orphans })
    }

    if (lines.length === 0) continue
    console.log(`${org.name} (${org.id})`)
    for (const line of lines) console.log(line)

    if (PURGE && toPurge.length > 0) {
      const handler = new UnifiedCrudHandler(org.id, ACT_AS!, db, undefined, {
        session: quietSession('orphaned-children purge'),
      })
      for (const group of toPurge) {
        const result = await handler.bulkDelete(group.ids.map((id) => toRecordId(group.defId, id)))
        console.log(
          `  purged ${result.count} of ${group.ids.length} (${result.errors.length} refused)`
        )
        for (const error of result.errors.slice(0, 5)) {
          console.log(`    ${error.recordId}: ${error.message}`)
        }
      }
    }
    console.log()
  }

  console.log(
    `${totalOrphans} orphaned rows across ${orgs.length} orgs${PURGE ? ' (purge attempted)' : ''}`
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => process.exit())
