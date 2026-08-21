// packages/lib/src/field-values/__tests__/search-text.test.ts

import { FieldTypeValues } from '@auxx/database/enums'
import { BaseType } from '../../workflow-engine/core/types'
import { mapFieldTypeToBaseType } from '../../workflow-engine/utils/field-type-mapper'
import {
  isSearchTextIndexedFieldType,
  SEARCH_TEXT_ADDRESS_KEYS,
  SEARCH_TEXT_INDEXED_FIELD_TYPES,
  SEARCH_TEXT_MAX_VALUES,
  SEARCH_TEXT_TOTAL_LIMIT,
  SEARCH_TEXT_VALUE_LIMIT,
  searchTextExpressionSql,
} from '../search-text'

/**
 * The `searchText` corpus is a *user-facing* search index over records. The
 * tests that matter here are the exclusions: what must never end up in it, and
 * that the column stays bounded so `to_tsvector` (and therefore the GIN index
 * from migration 0058) can't be handed something it refuses.
 */

describe('field-type policy', () => {
  it('names only real FieldType values', () => {
    for (const type of SEARCH_TEXT_INDEXED_FIELD_TYPES) {
      expect(FieldTypeValues as readonly string[]).toContain(type)
    }
  })

  it('never indexes a type that maps to BaseType.SECRET', () => {
    for (const type of SEARCH_TEXT_INDEXED_FIELD_TYPES) {
      expect(mapFieldTypeToBaseType(type)).not.toBe(BaseType.SECRET)
    }
  })

  it('has no SECRET member to index in the first place — it is workflow-only', () => {
    // Belt and braces for the assertion above: `SECRET` is not part of the
    // persisted field vocabulary at all, so no CustomField row can carry it.
    expect(FieldTypeValues as readonly string[]).not.toContain('SECRET')
    expect(SEARCH_TEXT_INDEXED_FIELD_TYPES as readonly string[]).not.toContain('SECRET')
  })

  it('excludes reference, file, opaque-json and numeric/temporal types', () => {
    const denied = [
      'ACTOR', // reference to a person — PII copied onto every record they touch
      'FILE', // opaque asset ref
      'JSON', // arbitrary app payload; also the AI-metadata piggyback column
      'CALC', // derived at read time
      'NUMBER',
      'CURRENCY',
      'CHECKBOX',
      'DATE',
      'DATETIME',
      'TIME',
    ]
    for (const type of denied) {
      expect(SEARCH_TEXT_INDEXED_FIELD_TYPES as readonly string[]).not.toContain(type)
      expect(isSearchTextIndexedFieldType(type)).toBe(false)
    }
  })

  it('fails closed for unknown and empty field types', () => {
    expect(isSearchTextIndexedFieldType('SOME_FUTURE_TYPE')).toBe(false)
    expect(isSearchTextIndexedFieldType(undefined)).toBe(false)
    expect(isSearchTextIndexedFieldType(null)).toBe(false)
    expect(isSearchTextIndexedFieldType('')).toBe(false)
  })

  it('indexes the text, option, closed-json and relationship families', () => {
    for (const type of ['TEXT', 'RICH_TEXT', 'EMAIL', 'URL', 'PHONE_INTL', 'ADDRESS']) {
      expect(isSearchTextIndexedFieldType(type)).toBe(true)
    }
    for (const type of ['SINGLE_SELECT', 'MULTI_SELECT', 'TAGS']) {
      expect(isSearchTextIndexedFieldType(type)).toBe(true)
    }
    expect(isSearchTextIndexedFieldType('NAME')).toBe(true)
    expect(isSearchTextIndexedFieldType('ADDRESS_STRUCT')).toBe(true)
    expect(isSearchTextIndexedFieldType('RELATIONSHIP')).toBe(true)
  })

  it('still treats the DB-only legacy PHONE value as text', () => {
    // `PHONE` is commented out of `FieldType` but remains a `ContactFieldType`
    // member, so pre-existing rows must not silently drop out of the corpus.
    expect(isSearchTextIndexedFieldType('PHONE')).toBe(true)
  })
})

describe('searchTextExpressionSql', () => {
  const expression = searchTextExpressionSql('ei')

  it('reads valueJson only through the two closed-shape key allowlists', () => {
    // `valueJson` is the `{ v, meta }` envelope — every value read goes through
    // `->'v'`. Reading the root would return NULL, silently and typecheck-clean.
    const jsonReads = expression.match(/fv\."valueJson"->'v'->>'(\w+)'/g) ?? []
    const keys = jsonReads.map((m) => m.replace(/.*->>'(\w+)'/, '$1'))

    expect(keys.length).toBeGreaterThan(0)
    expect(new Set(keys)).toEqual(new Set(['firstName', 'lastName', ...SEARCH_TEXT_ADDRESS_KEYS]))
    // No blanket serialization of the document.
    expect(expression).not.toMatch(/fv\."valueJson"(::text|#>>|\s*::\s*text)/)
  })

  it('never reads a value at the envelope root', () => {
    // A root read is the pre-envelope shape: it yields NULL for every row the
    // migration wrapped, and nothing type-checks it.
    expect(expression).not.toMatch(/fv\."valueJson"->>'/)
  })

  it('never reads geo coordinates out of a structured address', () => {
    for (const key of ['lat', 'lng', 'geocodedAt']) {
      expect(expression).not.toContain(`->>'${key}'`)
    }
  })

  it('never touches the actor reference columns', () => {
    expect(expression).not.toContain('actorId')
    expect(expression).not.toContain('"aiStatus"')
  })

  it('excludes retired, hidden and external-identity fields', () => {
    expect(expression).toContain('cf."active"')
    expect(expression).toContain('NOT cf."isHidden"')
    expect(expression).toContain('NOT cf."isIdentity"')
  })

  it('scopes the field-value lookup to the same record and org', () => {
    expect(expression).toContain('fv."entityId" = ei.id')
    expect(expression).toContain('fv."organizationId" = ei."organizationId"')
    expect(expression).toContain('rel."organizationId" = fv."organizationId"')
  })

  it('keeps the display fields first so truncation can only eat field values', () => {
    const displayName = expression.indexOf('ei."displayName"')
    const secondary = expression.indexOf('ei."secondaryDisplayValue"')
    const fieldValues = expression.indexOf('"FieldValue"')

    expect(displayName).toBeGreaterThanOrEqual(0)
    expect(displayName).toBeLessThan(secondary)
    expect(secondary).toBeLessThan(fieldValues)
  })

  it('bounds per value, per record and overall', () => {
    expect(expression).toContain(`LEFT(btrim(v.val), ${SEARCH_TEXT_VALUE_LIMIT})`)
    expect(expression).toContain(`LIMIT ${SEARCH_TEXT_MAX_VALUES}`)
    expect(expression).toContain(`), ${SEARCH_TEXT_TOTAL_LIMIT})`)
  })

  it('stays far below the 1MB tsvector ceiling that would break the GIN index', () => {
    expect(SEARCH_TEXT_TOTAL_LIMIT).toBeLessThan(1_048_576 / 100)
    // The cap has to actually bind: values alone can exceed it.
    expect(SEARCH_TEXT_MAX_VALUES * SEARCH_TEXT_VALUE_LIMIT).toBeGreaterThan(
      SEARCH_TEXT_TOTAL_LIMIT
    )
  })

  it('orders values deterministically so a re-run is a no-op', () => {
    expect(expression).toContain("string_agg(t.txt, ' ' ORDER BY length(t.txt), t.txt)")
    expect(searchTextExpressionSql('ei')).toBe(expression)
  })

  it('honours the alias so the same expression serves single-row and batch updates', () => {
    const aliased = searchTextExpressionSql('target')
    expect(aliased).toContain('fv."entityId" = target.id')
    expect(aliased).not.toContain('ei."displayName"')
  })
})
