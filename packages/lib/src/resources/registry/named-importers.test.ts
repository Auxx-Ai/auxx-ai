// packages/lib/src/resources/registry/named-importers.test.ts

import { describe, expect, it } from 'vitest'
import { RESOURCE_FIELD_REGISTRY } from './field-registry'
import type { ResourceField } from './field-types'
import {
  findNamedImporter,
  findNamedImporterByTarget,
  getImportAuthorityDefId,
  getNamedImporters,
} from './field-utils'

/**
 * NAMED IMPORTERS — the doors to defs that are deliberately hidden.
 *
 * `vendor_part` and `subpart` have no sidebar entry and no records page, so they
 * have nowhere to host the usual Import button. `part` hosts it for them. The
 * declaration lives on the relation field, and the target def is READ from that
 * field's relationship rather than restated, so the two can never drift.
 */
const resources = Object.entries(RESOURCE_FIELD_REGISTRY).map(([id, fields]) => ({
  id,
  fields: Object.values(fields ?? {}) as ResourceField[],
}))

const part = resources.find((r) => r.id === 'part')!

describe('registry named-importer declarations', () => {
  it('parts hosts the supplier-price and BOM importers, targeting the hidden defs', () => {
    expect(getNamedImporters(part).map((i) => [i.label, i.entityDefinitionId])).toEqual([
      ['Import supplier prices', 'vendor_part'],
      ['Import BOM', 'subpart'],
    ])
  })

  // O3 (02-design §6.4). `usedInAssemblies` is the SAME BOM edge as `subparts`,
  // read backwards. Offering both would let one file assert one edge in two
  // senses, and the `(parentPart, childPart)` natural key then collapses those to
  // whichever row landed last — a silently wrong quantity, not an error.
  it('does NOT offer the reverse BOM direction', () => {
    const labels = getNamedImporters(part).map((i) => i.label)
    expect(labels).not.toContain('Import used in assemblies')

    const usedIn = part.fields.find((f) => f.key === 'usedInAssemblies')
    expect(usedIn, 'the field itself must still exist').toBeDefined()
    expect(usedIn?.namedImporter).toBeUndefined()
  })

  it('is empty for every resource that declares none', () => {
    const declaring = resources.filter((r) => getNamedImporters(r).length > 0).map((r) => r.id)
    expect(declaring).toEqual(['part'])
  })

  // A declaration whose relationship does not resolve to a def would put a menu
  // entry on screen that starts a job against `null`. Dropped, not offered.
  it('drops a declaration whose relationship resolves to no def', () => {
    const broken = {
      fields: [
        {
          key: 'orphan',
          namedImporter: { label: 'Import orphans' },
          relationship: { relationshipType: 'has_many', isInverse: true },
        } as unknown as ResourceField,
      ],
    }
    expect(getNamedImporters(broken)).toEqual([])
  })
})

describe('named-importer target validation', () => {
  it('accepts the declaring field key the menu actually links with', () => {
    expect(findNamedImporter('part', 'part_vendor_parts')?.label).toBe('Import supplier prices')
    expect(findNamedImporter('part', 'part_vendor_parts')?.entityDefinitionId).toBe('vendor_part')
    expect(findNamedImporter('part', 'part_subparts')?.label).toBe('Import BOM')
    expect(findNamedImporter('part', 'part_subparts')?.entityDefinitionId).toBe('subpart')
  })

  // 🛑 REGRESSION, shipped broken in #1889 and caught only by clicking the menu.
  //
  // The link used to carry the TARGET DEF ID. In the static registry that reads
  // `vendor_part`; in the org-merged resource the client builds the menu from, the
  // DB row's `inverseResourceFieldId` carries the org's EntityDefinition CUID. So
  // the browser emitted `?target=lmzi8ndslfl31zn13qs61igk`, this lookup compared it
  // against `'vendor_part'`, matched nothing, and the route fell back to `part` —
  // every named importer opened the HOST's importer instead of the satellite's.
  // Silent: the item rendered, the click worked, the wrong wizard opened.
  //
  // ⚠️ A def id is not a stable wire value. A field key is.
  it('refuses a raw def id — the keyspace bug that shipped in #1889', () => {
    expect(findNamedImporter('part', 'vendor_part')).toBeNull()
    expect(findNamedImporter('part', 'subpart')).toBeNull()
    // …and an org's CUID for the same def, which is what actually reached the URL.
    expect(findNamedImporter('part', 'lmzi8ndslfl31zn13qs61igk')).toBeNull()
  })

  // The whole point of validating `?target=`: without it the query param is a way
  // to start an import job against any def at all, from a page that never offered
  // it. A hidden def is not an access-controlled one.
  it('refuses a key the host does not declare', () => {
    expect(findNamedImporter('part', 'contact')).toBeNull()
    expect(findNamedImporter('part', 'part_sku')).toBeNull()
    expect(findNamedImporter('part', 'part')).toBeNull()
    expect(findNamedImporter('contact', 'part_vendor_parts')).toBeNull()
  })

  // Every declared importer must be reachable by the key the menu builds from the
  // ORG-MERGED field, which is `systemAttribute ?? key` — the same expression
  // `getFieldOutputKey` uses, and the one records-view emits.
  it('is reachable by the key the client menu emits, for every declaration', () => {
    for (const resource of resources) {
      for (const field of resource.fields) {
        if (!field.namedImporter) continue
        const clientKey = field.systemAttribute ?? field.key
        expect(
          findNamedImporter(resource.id, clientKey),
          `${resource.id}.${field.key} unreachable via '${clientKey}'`
        ).not.toBeNull()
      }
    }
  })

  it('refuses the reverse BOM direction, which is declared nowhere', () => {
    expect(findNamedImporter('part', 'part_used_in_assemblies')).toBeNull()
    const usedIn = part.fields.find((f) => f.key === 'usedInAssemblies')
    expect(usedIn?.namedImporter).toBeUndefined()
  })
})

describe('import authority inheritance', () => {
  // A hidden satellite has no records page, so no grant anyone would think to
  // give. Asserting on it directly refuses every member who can plainly import
  // parts; asserting on nothing is a side door. It inherits the host's.
  it('routes a hidden satellite to its host def', () => {
    expect(getImportAuthorityDefId('vendor_part')).toBe('part')
    expect(getImportAuthorityDefId('subpart')).toBe('part')
  })

  it('is the identity for every def that is not a declared satellite', () => {
    expect(getImportAuthorityDefId('part')).toBe('part')
    expect(getImportAuthorityDefId('contact')).toBe('contact')
    expect(getImportAuthorityDefId('invoice')).toBe('invoice')
    // A custom entity def id, which no registry entry can ever declare.
    expect(getImportAuthorityDefId('cm5abcd1234')).toBe('cm5abcd1234')
  })

  // Derivation, not a second declaration: the authority follows whoever declares
  // the importer, so it cannot drift from it.
  it('agrees with the declarations for every declared importer', () => {
    for (const resource of resources) {
      for (const importer of getNamedImporters(resource)) {
        expect(getImportAuthorityDefId(importer.entityDefinitionId)).toBe(resource.id)
      }
    }
  })
})

/**
 * The tolerant edge. One canonical wire format (the field key), but a def id or
 * CUID that shows up in `?target=` is RESOLVED rather than refused — the route
 * normalizes the CUID through the org cache first, then asks this.
 */
describe('findNamedImporterByTarget — normalizing a def id', () => {
  it('resolves a def id to its single declared importer', () => {
    expect(findNamedImporterByTarget('part', 'vendor_part')).toMatchObject({
      label: 'Import supplier prices',
      fieldKey: 'part_vendor_parts',
    })
    expect(findNamedImporterByTarget('part', 'subpart')).toMatchObject({
      label: 'Import BOM',
      fieldKey: 'part_subparts',
    })
  })

  // It hands back the FIELD KEY, which is what makes canonicalizing possible: the
  // route rewrites the URL to this and everything downstream speaks one language.
  it('hands back the canonical field key to rewrite the URL with', () => {
    const resolved = findNamedImporterByTarget('part', 'vendor_part')
    expect(resolved).not.toBeNull()
    expect(resolved).not.toBe('ambiguous')
    if (resolved && resolved !== 'ambiguous') {
      expect(findNamedImporter('part', resolved.fieldKey)).toMatchObject({ label: resolved.label })
    }
  })

  it('refuses a def this host declares no importer for', () => {
    expect(findNamedImporterByTarget('part', 'contact')).toBeNull()
    expect(findNamedImporterByTarget('part', 'part')).toBeNull()
    expect(findNamedImporterByTarget('contact', 'vendor_part')).toBeNull()
  })

  // 🛑 The reason the field key is canonical and this is only the fallback.
  // `part.subparts` and `part.usedInAssemblies` BOTH target `subpart`; today only
  // the first declares an importer, so `'subpart'` still resolves. The moment a
  // second declaration lands on one target, a def id stops being an identifier and
  // this must refuse rather than silently pick the first.
  it("answers 'ambiguous' when two importers share one target def", () => {
    const twoDoorsOneDef = {
      fields: [
        {
          key: 'down',
          systemAttribute: 'x_down',
          namedImporter: { label: 'Import components' },
          relationship: { inverseResourceFieldId: 'subpart:parentPart', isInverse: true },
        },
        {
          key: 'up',
          systemAttribute: 'x_up',
          namedImporter: { label: 'Import used-in' },
          relationship: { inverseResourceFieldId: 'subpart:childPart', isInverse: true },
        },
      ] as unknown as ResourceField[],
    }
    // Both legs resolve to the same target def, so getNamedImporters lists two…
    expect(getNamedImporters(twoDoorsOneDef).map((i) => i.entityDefinitionId)).toEqual([
      'subpart',
      'subpart',
    ])
    // …and the field key still distinguishes them, which the def id cannot.
    expect(new Set(getNamedImporters(twoDoorsOneDef).map((i) => i.fieldKey)).size).toBe(2)
  })
})
