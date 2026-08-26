// packages/lib/src/entity-templates/template-registry.test.ts
//
// The `order` CRM template was retired with the native `order` system entity
// (plans/products/08-order-build.md §3.5): `templates/order.json` is deleted,
// and the eight templates that referenced it now resolve `@system:order`.
//
// The check that matters is cheap and catches the one failure mode of that
// rewrite — a missed file among the eight. Pass 1 of `template-installer.ts`
// resolves `@template:*` against the OTHER templates selected for the install;
// a ref to a template that no longer exists resolves to nothing and the
// installer silently SKIPS the relationship field. Nothing throws, and the
// field is simply absent from the installed entity.

import { describe, expect, it } from 'vitest'
import { getAllTemplates, getTemplateById } from './template-registry'
import type { EntityTemplate } from './types'

const allTemplates: EntityTemplate[] = getAllTemplates().map((t) => getTemplateById(t.id)!)

describe('template registry — the retired `order` template', () => {
  it('no longer registers an `order` template', () => {
    expect(getTemplateById('order')).toBeNull()
    expect(allTemplates.map((t) => t.id)).not.toContain('order')
  })

  it('no template lists "order" as a companion', () => {
    for (const template of allTemplates) {
      expect(template.companions ?? [], `${template.id} still lists "order"`).not.toContain('order')
    }
  })

  it('no template references `@template:order`', () => {
    for (const template of allTemplates) {
      for (const field of template.fields) {
        expect(
          field.relationship?.relatedResourceId,
          `${template.id}.${field.templateFieldId} still references @template:order`
        ).not.toBe('@template:order')
      }
    }
  })

  it('the seven templates with an order relation now point at `@system:order`', () => {
    const withOrderRelation = allTemplates
      .filter((t) => t.fields.some((f) => f.relationship?.relatedResourceId === '@system:order'))
      .map((t) => t.id)
      .sort()

    expect(withOrderRelation).toEqual([
      'complaint',
      'customer-feedback',
      'exchange-request',
      'invoice',
      'return-request',
      'shipment',
      'warranty-claim',
    ])
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
