// packages/lib/src/entity-templates/template-registry.test.ts
//
// Seven templates have been retired as the platform grew a native equivalent:
// `order` with the native `order` system entity (plans/products/08-order-build.md
// §3.5), then `product`, `quote` and `invoice` once those became system entity
// definitions, then `vendor`, `email-sequence` and `task` once Companies, the
// Sequence tables and the Task tables became the real home for each.
//
// The check that matters is cheap and catches the one failure mode of that
// rewrite — a missed file among the referencing templates. Pass 1 of
// `template-installer.ts` resolves `@template:*` against the OTHER templates
// selected for the install; a ref to a template that no longer exists resolves
// to nothing and the installer silently SKIPS the relationship field. Nothing
// throws, and the field is simply absent from the installed entity.

import { describe, expect, it } from 'vitest'
import { getAllTemplates, getTemplateById } from './template-registry'
import type { EntityTemplate } from './types'

const allTemplates: EntityTemplate[] = getAllTemplates().map((t) => getTemplateById(t.id)!)

/**
 * Every retired template id, with the `@system:` ref that replaced its
 * `@template:` relations (null where the native feature is not an
 * EntityDefinition and the relationship field was dropped outright).
 */
const RETIRED = [
  { id: 'order', replacedBy: '@system:order' },
  { id: 'product', replacedBy: '@system:product' },
  { id: 'quote', replacedBy: null },
  { id: 'invoice', replacedBy: null },
  // A vendor IS a Company everywhere in purchasing — the vendor leg of a
  // purchase order, a vendor bill and a vendor part all carry
  // `relatedEntityType: 'company'` (see the resource field registries).
  { id: 'vendor', replacedBy: '@system:company' },
  // Outbound cadences live in the `Sequence` tables + `packages/lib/src/sequences`.
  { id: 'email-sequence', replacedBy: null },
  // Tasks are their own tables, not an EntityDefinition — so there is no
  // `@system:task` to point at. A task attaches to ANY record through
  // `TaskReference`, and `detail-view-tab-registry` registers `'*:tasks'` as a
  // wildcard tab, so `project.tasks` was deleted rather than rewritten.
  { id: 'task', replacedBy: null },
] as const

describe.each(RETIRED)('template registry — the retired `$id` template', ({ id, replacedBy }) => {
  it('is no longer registered', () => {
    expect(getTemplateById(id)).toBeNull()
    expect(allTemplates.map((t) => t.id)).not.toContain(id)
  })

  it('is not listed as a companion by any template', () => {
    for (const template of allTemplates) {
      expect(template.companions ?? [], `${template.id} still lists "${id}"`).not.toContain(id)
    }
  })

  it('is not the target of any `@template:` relation', () => {
    for (const template of allTemplates) {
      for (const field of template.fields) {
        expect(
          field.relationship?.relatedResourceId,
          `${template.id}.${field.templateFieldId} still references @template:${id}`
        ).not.toBe(`@template:${id}`)
      }
    }
  })

  it.skipIf(replacedBy === null)(`has its relations rewritten to ${replacedBy}`, () => {
    const users = allTemplates.filter((t) =>
      t.fields.some((f) => f.relationship?.relatedResourceId === replacedBy)
    )
    expect(users.length, `nothing references ${replacedBy}`).toBeGreaterThan(0)
  })
})

describe('template registry — the templates behind each system ref', () => {
  // Pinned so that dropping a relation during an unrelated edit is loud. A ref
  // resolving to nothing is silent at install time, which is the whole point.
  it.each([
    [
      '@system:order',
      [
        'complaint',
        'customer-feedback',
        'exchange-request',
        'return-request',
        'shipment',
        'warranty-claim',
      ],
    ],
    [
      '@system:product',
      [
        'campaign',
        'collection',
        'customer-feedback',
        'inventory-location',
        'quality-inspection',
        'social-proof',
        'subscription',
        'warranty-claim',
      ],
    ],
    [
      '@system:company',
      [
        'deal',
        'expense',
        'lead',
        'project',
        'quality-inspection',
        'subscription',
        'supplier-contract',
        'wholesale-order',
      ],
    ],
  ])('%s is referenced by exactly the expected templates', (ref, expected) => {
    const actual = allTemplates
      .filter((t) => t.fields.some((f) => f.relationship?.relatedResourceId === ref))
      .map((t) => t.id)
      .sort()
    expect(actual).toEqual(expected)
  })
})

describe('template registry — companion integrity', () => {
  // A companion naming a template that no longer exists is the same silent
  // failure as a dangling `@template:` ref, one level up: the install dialog
  // offers a companion the registry cannot resolve.
  it('every companion resolves to a registered template', () => {
    const ids = new Set(allTemplates.map((t) => t.id))
    for (const template of allTemplates) {
      for (const companion of template.companions ?? []) {
        expect(
          ids.has(companion),
          `${template.id} companions unknown template "${companion}"`
        ).toBe(true)
      }
    }
  })

  it('every `@template:` relation ref resolves to a registered template', () => {
    const ids = new Set(allTemplates.map((t) => t.id))
    for (const template of allTemplates) {
      for (const field of template.fields) {
        const ref = field.relationship?.relatedResourceId
        if (!ref?.startsWith('@template:')) continue
        const target = ref.slice('@template:'.length)
        expect(
          ids.has(target),
          `${template.id}.${field.templateFieldId} references unknown template "${target}"`
        ).toBe(true)
      }
    }
  })
})
