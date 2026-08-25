// packages/lib/src/resources/registry/named-importers.test.ts

import { describe, expect, it } from 'vitest'
import { RESOURCE_FIELD_REGISTRY } from './field-registry'
import type { ResourceField } from './field-types'
import { findNamedImporter, getImportAuthorityDefId, getNamedImporters } from './field-utils'

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
  it('accepts a target the host actually declares', () => {
    expect(findNamedImporter('part', 'vendor_part')?.label).toBe('Import supplier prices')
    expect(findNamedImporter('part', 'subpart')?.label).toBe('Import BOM')
  })

  // 🛑 The whole point of validating `?target=`: without this the query param is a
  // way to start an import job against any def at all, from a page that never
  // offered it. A hidden def is not an access-controlled one.
  it('refuses a target the host does not declare', () => {
    expect(findNamedImporter('part', 'contact')).toBeNull()
    expect(findNamedImporter('part', 'invoice')).toBeNull()
    expect(findNamedImporter('part', 'part')).toBeNull()
    expect(findNamedImporter('contact', 'vendor_part')).toBeNull()
  })

  it('refuses the reverse BOM direction, which is declared nowhere', () => {
    expect(findNamedImporter('part', 'subpart')).not.toBeNull()
    const usedInTarget = part.fields.find((f) => f.key === 'usedInAssemblies')
    expect(usedInTarget?.namedImporter).toBeUndefined()
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
