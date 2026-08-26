// apps/web/src/components/records/record-editor-dialog.test.ts
//
// `presetValues` on RecordEditorDialog is keyed by FIELD ID — the shape
// EntityInstanceForm applies (`initValues[fieldId] = value`). The part editor
// used to drop the map entirely; `presetInstanceId` is the translation that
// stopped it, isolated so it can be tested without a resource store
// (plans/products/09-variant-ui.md §2 V2, §9).

import { describe, expect, it } from 'vitest'
import { presetInstanceId } from './record-editor-dialog'

const PRODUCT_FIELD_ID = 'product'
const PRODUCT_DEF_ID = 'def_product_123'
const PRODUCT_INSTANCE_ID = 'inst_abc'
const PRODUCT_RECORD_ID = `${PRODUCT_DEF_ID}:${PRODUCT_INSTANCE_ID}`

describe('presetInstanceId', () => {
  it('unwraps an array-shaped RecordId preset to the bare instance id', () => {
    expect(presetInstanceId({ [PRODUCT_FIELD_ID]: [PRODUCT_RECORD_ID] }, PRODUCT_FIELD_ID)).toBe(
      PRODUCT_INSTANCE_ID
    )
  })

  it('unwraps a scalar RecordId preset — RELATIONSHIP reads are array-shaped on only some paths', () => {
    expect(presetInstanceId({ [PRODUCT_FIELD_ID]: PRODUCT_RECORD_ID }, PRODUCT_FIELD_ID)).toBe(
      PRODUCT_INSTANCE_ID
    )
  })

  it('passes through a bare instance id that is not RecordId-shaped', () => {
    expect(presetInstanceId({ [PRODUCT_FIELD_ID]: PRODUCT_INSTANCE_ID }, PRODUCT_FIELD_ID)).toBe(
      PRODUCT_INSTANCE_ID
    )
  })

  it('ignores an unknown key rather than crashing — other presets are not this editor s business', () => {
    expect(presetInstanceId({ somethingElse: PRODUCT_RECORD_ID }, PRODUCT_FIELD_ID)).toBeUndefined()
  })

  it('returns undefined when the field id has not resolved yet', () => {
    expect(presetInstanceId({ [PRODUCT_FIELD_ID]: PRODUCT_RECORD_ID }, undefined)).toBeUndefined()
  })

  it('returns undefined for no presets at all', () => {
    expect(presetInstanceId(undefined, PRODUCT_FIELD_ID)).toBeUndefined()
  })

  it('treats empty, empty-array and non-string values as absent', () => {
    expect(presetInstanceId({ [PRODUCT_FIELD_ID]: '' }, PRODUCT_FIELD_ID)).toBeUndefined()
    expect(presetInstanceId({ [PRODUCT_FIELD_ID]: [] }, PRODUCT_FIELD_ID)).toBeUndefined()
    expect(presetInstanceId({ [PRODUCT_FIELD_ID]: null }, PRODUCT_FIELD_ID)).toBeUndefined()
    expect(presetInstanceId({ [PRODUCT_FIELD_ID]: 42 }, PRODUCT_FIELD_ID)).toBeUndefined()
  })
})
