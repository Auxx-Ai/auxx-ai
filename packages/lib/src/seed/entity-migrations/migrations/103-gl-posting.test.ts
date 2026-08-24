// packages/lib/src/seed/entity-migrations/migrations/103-gl-posting.test.ts
//
// Migration 103 is pure helper composition (the 101 recipe) — the helpers have
// their own coverage. What CAN silently go wrong is the wiring: a new entity
// type touches six hand-edited registries, and a miss in any one of them is a
// no-op rather than an error. These tests pin that wiring.
//
// The icon/color assertions are deliberate. `EntityDefinition.icon` holds an id
// from a CURATED registry, not a Lucide name, and `getIcon` returns undefined
// for an unknown id while `EntityIcon` then renders nothing at all — which is
// exactly how `product` shipped with `package-2` and no icon. `getIconColor`
// does fall back, so a bad colour degrades silently instead. Both are pinned.

import { ModelTypeMeta, ModelTypeValues } from '@auxx/database/enums'
import { isSystemAttribute } from '@auxx/types/system-attribute'
import { describe, expect, it } from 'vitest'
import { GlPostingStatus, GlPostingType } from '../../../resources/registry/enum-values'
import { RESOURCE_FIELD_REGISTRY } from '../../../resources/registry/field-registry'
import { GL_POSTING_FIELDS } from '../../../resources/registry/resources/gl-posting-fields'
import { ALL_ENTITY_MIGRATIONS } from '../../entity-migrations'
import { DISPLAY_FIELD_CONFIG, SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import { migration103GlPosting } from './103-gl-posting'

describe('migration 103 registration', () => {
  it('is registered exactly once, after 102, with a unique id', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === '103-gl-posting')).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.indexOf('103-gl-posting')).toBe(ids.indexOf('102-catalog-relabel') + 1)
    expect(migration103GlPosting.id).toBe('103-gl-posting')
  })
})

describe('gl_posting entity registration wiring', () => {
  it('every GL_POSTING_FIELDS systemAttribute is in the SystemAttribute union', () => {
    for (const [key, field] of Object.entries(GL_POSTING_FIELDS)) {
      expect(field.systemAttribute, `${key} has no systemAttribute`).toBeTruthy()
      expect(
        isSystemAttribute(field.systemAttribute!),
        `${key}: '${field.systemAttribute}' missing from @auxx/types/system-attribute`
      ).toBe(true)
    }
  })

  it('carries exactly the §6.2 field set', () => {
    expect(Object.keys(GL_POSTING_FIELDS).sort()).toEqual([
      'createdAt',
      'docNumber',
      'failureReason',
      'id',
      'periodKey',
      'postedAt',
      'postingType',
      'status',
      'totalDebit',
      'updatedAt',
    ])
  })

  it('carries no relationship fields — a posting summarises a window, not a record', () => {
    for (const [key, field] of Object.entries(GL_POSTING_FIELDS)) {
      expect(field.relationship, `${key} should not be a relationship`).toBeUndefined()
    }
  })

  it('does not model the external QuickBooks id — that is an app-owned identity field', () => {
    const attrs = Object.values(GL_POSTING_FIELDS).map((f) => f.systemAttribute)
    expect(attrs.some((a) => a?.includes('qbo') || a?.includes('quickbooks'))).toBe(false)
  })

  it('is registered in the field registry, ModelTypeValues and SYSTEM_ENTITIES', () => {
    expect(RESOURCE_FIELD_REGISTRY.gl_posting).toBe(GL_POSTING_FIELDS)
    expect(ModelTypeValues).toContain('gl_posting')
    expect(ModelTypeMeta.gl_posting).toEqual({
      label: 'GL Posting',
      plural: 'GL Postings',
      icon: 'book-open',
      color: 'gray',
      apiSlug: 'gl-postings',
      dbTable: 'EntityInstance',
      hasDetailPage: false,
    })

    const entity = SYSTEM_ENTITIES.find((e) => e.entityType === 'gl_posting')
    expect(entity).toMatchObject({
      apiSlug: 'gl-postings',
      singular: 'GL Posting',
      plural: 'GL Postings',
      icon: 'book-open',
      color: 'gray',
      isVisible: false,
    })
  })

  // NOTE: the real check — "does this id exist in @auxx/ui's ICON_DATA?" —
  // cannot live here. `@auxx/ui` is tier 4 and `@auxx/lib` is tier 3, so lib
  // must never import it. These pin the values against the sets as they stood
  // when written; a cross-package test in apps/web (which may import both) is
  // what would actually catch a bad id, and is worth adding — `product` shipped
  // with `package-2`, absent from ICON_DATA, and rendered no icon at all for
  // two days across 28 orgs.
  it('uses an icon id that is in the curated registry', () => {
    const entity = SYSTEM_ENTITIES.find((e) => e.entityType === 'gl_posting')!
    expect(entity.icon).toBe('book-open')
    expect(ModelTypeMeta.gl_posting.icon).toBe(entity.icon)
  })

  it('uses a colour id that is a real ICON_COLORS entry', () => {
    const VALID_COLORS = [
      'gray',
      'red',
      'orange',
      'amber',
      'green',
      'emerald',
      'teal',
      'blue',
      'indigo',
      'purple',
      'pink',
    ]
    const entity = SYSTEM_ENTITIES.find((e) => e.entityType === 'gl_posting')!
    expect(VALID_COLORS).toContain(entity.color)
    expect(VALID_COLORS).toContain(ModelTypeMeta.gl_posting.color)
  })

  it('display fields resolve against real GL_POSTING_FIELDS keys', () => {
    const config = DISPLAY_FIELD_CONFIG.gl_posting
    expect(config?.primaryDisplayField).toBe('docNumber')
    expect(config?.secondaryDisplayField).toBe('periodKey')
    for (const key of [config?.primaryDisplayField, config?.secondaryDisplayField]) {
      expect(
        GL_POSTING_FIELDS[key!],
        `display field '${key}' not in GL_POSTING_FIELDS`
      ).toBeDefined()
    }
  })

  it('the display fields are non-nullable, so a row always renders', () => {
    expect(GL_POSTING_FIELDS.docNumber?.nullable).toBe(false)
    expect(GL_POSTING_FIELDS.periodKey?.nullable).toBe(false)
  })
})

describe('gl_posting enums', () => {
  it('postingType offers exactly the four entry types plus the two other month-end ones', () => {
    expect(GlPostingType.values.map((v) => v.value)).toEqual([
      'fulfillment',
      'payout',
      'build',
      'month_end_deferral',
      'month_end_reversal',
      'month_end_inventory',
    ])
  })

  it('has no `receipt` value — GRNI needs A/P, which does not exist in this file yet', () => {
    expect(GlPostingType.values.map((v) => v.value)).not.toContain('receipt')
  })

  it('status is the three-state posting lifecycle', () => {
    expect(GlPostingStatus.values.map((v) => v.value)).toEqual(['pending', 'posted', 'failed'])
  })

  it('field options are wired to the enum value lists, not re-declared', () => {
    expect(GL_POSTING_FIELDS.postingType?.options).toEqual({ options: GlPostingType.values })
    expect(GL_POSTING_FIELDS.status?.options).toEqual({ options: GlPostingStatus.values })
  })
})
