// packages/lib/src/resources/query-builder/__tests__/canonicalize-system-fields.test.ts
//
// The filter UIs address a field on a system resource by the org's merged
// `CustomField` cuid; `SystemConditionBuilder` resolves fields against
// `RESOURCE_FIELD_REGISTRY[tableId]`, which is keyed by the STATIC key. Every
// filter on article/kb/dataset/user/... therefore dropped, and a dropped
// condition widens the result set.
//
// This canonicalizer is the translation layer, run before the builder sees the
// conditions. Four properties matter:
//
//   1. It maps to `key`, never to `systemAttribute` — the registry is keyed by
//      the static field's id (`tags`), not its attribute (`article_tags`).
//   2. It is idempotent. Stored views hold either shape, and the pre-pass will
//      run over already-canonical conditions forever.
//   3. It never invents a resolution. An unknown reference is returned
//      unchanged so the builder keeps dropping it *visibly*, rather than
//      compiling a confidently wrong FieldValue lookup.
//   4. The no-op path allocates nothing — asserted by reference identity, not
//      by deep equality.
//
// Uses the real `article` registry (it genuinely has tags/status/kind), so no
// module mocking is involved.

import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { describe, expect, it } from 'vitest'
import { RESOURCE_FIELD_REGISTRY } from '../../registry/field-registry'
import type { ResourceField } from '../../registry/field-types'
import { BaseType } from '../../types'
import type { ConditionGroup, GenericCondition } from '../base-condition-builder'
import {
  canonicalizeSystemConditions,
  canonicalizeSystemFieldRef,
} from '../canonicalize-system-fields'

const ENTITY_DEF_ID = 'entdef_article'

/** cuid of the org's materialized `CustomField` row for the static `tags` field. */
const TAGS_CUID = 'cf_tags_0000000000000001'
/** cuid of a genuine custom field added to Article by the org. */
const CUSTOM_CUID = 'cf_custom_000000000000001'
/** A cuid that resolves to nothing at all. */
const UNKNOWN_CUID = 'cf_unknown_00000000000001'

function field(overrides: Partial<ResourceField> & Pick<ResourceField, 'key'>): ResourceField {
  return {
    id: toFieldId(overrides.key),
    label: overrides.key,
    type: BaseType.STRING,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    ...overrides,
  }
}

/**
 * The merged shape `mergeSystemAndCustomFields` produces for system resources:
 * `id` is the DB `CustomField.id`, `key` stays the static registry key.
 */
const MERGED_FIELDS: ResourceField[] = [
  field({
    id: toFieldId(TAGS_CUID),
    key: 'tags',
    label: 'Tags',
    type: BaseType.RELATION,
    systemAttribute: 'article_tags',
  }),
  field({
    id: toFieldId(CUSTOM_CUID),
    key: 'Severity',
    label: 'Severity',
  }),
  field({
    id: toFieldId('cf_retired_0000000000001'),
    key: 'retiredField',
    label: 'Retired',
    systemAttribute: 'article_slug',
  }),
]

function condition(overrides: Partial<GenericCondition> = {}): GenericCondition {
  return { id: 'cond-1', fieldId: 'status', operator: 'is', value: 'PUBLISHED', ...overrides }
}

function group(conditions: GenericCondition[], id = 'group-1'): ConditionGroup {
  return { id, conditions, logicalOperator: 'AND' }
}

const canonicalize = (fieldRef: string) =>
  canonicalizeSystemFieldRef(fieldRef, 'article', MERGED_FIELDS)

describe('canonicalizeSystemFieldRef', () => {
  describe('case A — already a static registry key', () => {
    it('returns a bare static key unchanged', () => {
      expect(canonicalize('tags')).toBe('tags')
      expect(canonicalize('status')).toBe('status')
      expect(canonicalize('kind')).toBe('kind')
    })

    it('returns a `<defId>:<key>` reference unchanged (the builder strips it itself)', () => {
      expect(canonicalize(`${ENTITY_DEF_ID}:status`)).toBe(`${ENTITY_DEF_ID}:status`)
    })

    it('leaves an already-`custom_`-prefixed reference alone', () => {
      expect(canonicalize(`custom_${CUSTOM_CUID}`)).toBe(`custom_${CUSTOM_CUID}`)
    })
  })

  describe('case B — merged system field cuid', () => {
    it('rewrites a bare cuid to the static key', () => {
      expect(canonicalize(TAGS_CUID)).toBe('tags')
    })

    it('resolves the `<defId>:<cuid>` form identically to the bare cuid', () => {
      expect(canonicalize(`${ENTITY_DEF_ID}:${TAGS_CUID}`)).toBe(canonicalize(TAGS_CUID))
      expect(canonicalize(`${ENTITY_DEF_ID}:${TAGS_CUID}`)).toBe('tags')
    })

    it('maps to `key`, not `systemAttribute` — the registry is keyed by key', () => {
      const registryKeys = Object.keys(RESOURCE_FIELD_REGISTRY.article ?? {})

      expect(canonicalize(TAGS_CUID)).not.toBe('article_tags')
      expect(registryKeys).toContain('tags')
      expect(registryKeys).not.toContain('article_tags')
    })

    it('lands on a key the builder can actually resolve', () => {
      expect(RESOURCE_FIELD_REGISTRY.article?.[canonicalize(TAGS_CUID)]).toBeDefined()
    })

    it('leaves a system field whose key is absent from the registry unchanged', () => {
      expect(canonicalize('cf_retired_0000000000001')).toBe('cf_retired_0000000000001')
    })
  })

  describe('case C — genuine custom field on a system resource', () => {
    it('rewrites a bare cuid to the `custom_` form the builder routes on', () => {
      expect(canonicalize(CUSTOM_CUID)).toBe(`custom_${CUSTOM_CUID}`)
    })

    it('resolves the `<defId>:<cuid>` form identically to the bare cuid', () => {
      expect(canonicalize(`${ENTITY_DEF_ID}:${CUSTOM_CUID}`)).toBe(`custom_${CUSTOM_CUID}`)
    })

    it('round-trips back to the cuid the builder queries `FieldValue.fieldId` with', () => {
      expect(canonicalize(CUSTOM_CUID).replace(/^custom_/, '')).toBe(CUSTOM_CUID)
    })
  })

  describe('case D — unresolvable', () => {
    it('returns an unknown cuid unchanged', () => {
      expect(canonicalize(UNKNOWN_CUID)).toBe(UNKNOWN_CUID)
    })

    it('returns an unknown prefixed reference unchanged', () => {
      expect(canonicalize(`${ENTITY_DEF_ID}:${UNKNOWN_CUID}`)).toBe(
        `${ENTITY_DEF_ID}:${UNKNOWN_CUID}`
      )
    })

    it('resolves static keys and drops nothing when the org has no merged fields', () => {
      expect(canonicalizeSystemFieldRef('status', 'article', [])).toBe('status')
      expect(canonicalizeSystemFieldRef(TAGS_CUID, 'article', [])).toBe(TAGS_CUID)
    })

    it('returns an empty reference unchanged', () => {
      expect(canonicalize('')).toBe('')
    })
  })

  describe('idempotence', () => {
    it.each([
      ['static key', 'tags'],
      ['prefixed static key', `${ENTITY_DEF_ID}:status`],
      ['system field cuid', TAGS_CUID],
      ['prefixed system field cuid', `${ENTITY_DEF_ID}:${TAGS_CUID}`],
      ['custom field cuid', CUSTOM_CUID],
      ['prefixed custom field cuid', `${ENTITY_DEF_ID}:${CUSTOM_CUID}`],
      ['unknown cuid', UNKNOWN_CUID],
    ])('canonicalizing a %s twice equals canonicalizing it once', (_label, fieldRef) => {
      const once = canonicalize(fieldRef)
      expect(canonicalize(once)).toBe(once)
    })
  })
})

describe('canonicalizeSystemConditions', () => {
  it('rewrites cuid conditions across groups', () => {
    const groups = [
      group([condition({ id: 'c1', fieldId: TAGS_CUID, operator: 'is', value: 'tag_1' })], 'g1'),
      group(
        [condition({ id: 'c2', fieldId: `${ENTITY_DEF_ID}:${CUSTOM_CUID}`, value: 'high' })],
        'g2'
      ),
    ]

    const result = canonicalizeSystemConditions(groups, 'article', MERGED_FIELDS)

    expect(result[0]?.conditions[0]?.fieldId).toBe('tags')
    expect(result[1]?.conditions[0]?.fieldId).toBe(`custom_${CUSTOM_CUID}`)
  })

  it('preserves everything on a condition except its fieldId', () => {
    const original = condition({ id: 'c1', fieldId: TAGS_CUID, operator: 'in', value: ['a', 'b'] })
    const result = canonicalizeSystemConditions([group([original])], 'article', MERGED_FIELDS)

    expect(result[0]?.conditions[0]).toEqual({ ...original, fieldId: 'tags' })
  })

  it('rewrites element 0 of an array fieldId and preserves the rest', () => {
    const path = [TAGS_CUID, 'tag:name', 'name:value'] as ResourceFieldId[]
    const result = canonicalizeSystemConditions(
      [group([condition({ fieldId: path })])],
      'article',
      MERGED_FIELDS
    )

    expect(result[0]?.conditions[0]?.fieldId).toEqual(['tags', 'tag:name', 'name:value'])
  })

  it('leaves an array fieldId reference-identical when element 0 is already canonical', () => {
    const path = ['tags', 'tag:name'] as ResourceFieldId[]
    const original = condition({ fieldId: path })
    const result = canonicalizeSystemConditions([group([original])], 'article', MERGED_FIELDS)

    expect(result[0]?.conditions[0]?.fieldId).toBe(path)
  })

  it('canonicalizes subConditions', () => {
    const original = condition({
      id: 'c1',
      fieldId: 'status',
      subConditions: [condition({ id: 'sub-1', fieldId: TAGS_CUID })],
    })

    const result = canonicalizeSystemConditions([group([original])], 'article', MERGED_FIELDS)

    expect(result[0]?.conditions[0]?.subConditions?.[0]?.fieldId).toBe('tags')
    expect(result[0]?.conditions[0]?.fieldId).toBe('status')
  })

  it('never mutates the input', () => {
    const original = condition({ id: 'c1', fieldId: TAGS_CUID })
    const groups = [group([original])]
    const snapshot = structuredClone(groups)

    canonicalizeSystemConditions(groups, 'article', MERGED_FIELDS)

    expect(groups).toEqual(snapshot)
    expect(original.fieldId).toBe(TAGS_CUID)
  })

  describe('reference identity', () => {
    it('returns the very same array, groups and conditions when nothing changes', () => {
      const first = condition({ id: 'c1', fieldId: 'status' })
      const second = condition({ id: 'c2', fieldId: `${ENTITY_DEF_ID}:kind` })
      const groups = [group([first, second])]

      const result = canonicalizeSystemConditions(groups, 'article', MERGED_FIELDS)

      expect(result).toBe(groups)
      expect(result[0]).toBe(groups[0])
      expect(result[0]?.conditions).toBe(groups[0]?.conditions)
      expect(result[0]?.conditions[0]).toBe(first)
      expect(result[0]?.conditions[1]).toBe(second)
    })

    it('returns the same array for an unresolvable reference (case D allocates nothing)', () => {
      const groups = [group([condition({ fieldId: UNKNOWN_CUID })])]

      expect(canonicalizeSystemConditions(groups, 'article', MERGED_FIELDS)).toBe(groups)
    })

    it('allocates only for the entries that actually change', () => {
      const untouchedGroup = group([condition({ id: 'c0', fieldId: 'status' })], 'g0')
      const sibling = condition({ id: 'c1', fieldId: 'kind', value: 'ARTICLE' })
      const rewritten = condition({ id: 'c2', fieldId: TAGS_CUID })
      const groups = [untouchedGroup, group([sibling, rewritten], 'g1')]

      const result = canonicalizeSystemConditions(groups, 'article', MERGED_FIELDS)

      expect(result).not.toBe(groups)
      expect(result[0]).toBe(untouchedGroup)
      expect(result[1]).not.toBe(groups[1])
      expect(result[1]?.conditions[0]).toBe(sibling)
      expect(result[1]?.conditions[1]).not.toBe(rewritten)
      expect(result[1]?.conditions[1]?.fieldId).toBe('tags')
    })
  })

  it('is idempotent over whole condition groups', () => {
    const groups = [
      group([
        condition({ id: 'c1', fieldId: TAGS_CUID }),
        condition({ id: 'c2', fieldId: `${ENTITY_DEF_ID}:${CUSTOM_CUID}` }),
        condition({ id: 'c3', fieldId: UNKNOWN_CUID }),
      ]),
    ]

    const once = canonicalizeSystemConditions(groups, 'article', MERGED_FIELDS)
    const twice = canonicalizeSystemConditions(once, 'article', MERGED_FIELDS)

    expect(twice).toBe(once)
    expect(twice).toEqual(once)
  })
})
