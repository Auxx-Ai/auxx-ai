// packages/lib/src/documents/__tests__/pdf-pointer-ref.test.ts

import { describe, expect, it } from 'vitest'
import { assetIdFromFileValue } from '../ensure-pdf'

/**
 * The pointer field became a single FILE value in
 * plans/purchasing/08-documents-on-records.md §4. Every case below is a way the
 * read half can quietly return the wrong thing, and the symptom is always the
 * same and always silent: `existingAssetId` comes back `undefined`, so the
 * document re-renders and mints a SECOND MediaAsset on every single call —
 * no throw, no log, and the "sent documents snapshot naturally" guarantee gone
 * because the customer's version now lives on an asset nothing points at.
 */
describe('assetIdFromFileValue', () => {
  it('reads the id out of a single-element FILE array', () => {
    expect(assetIdFromFileValue([{ ref: 'asset:clx7abc' }])).toBe('clx7abc')
  })

  it('reads a bare envelope too — FILE is array-return, but the scalar shape must not crash', () => {
    expect(assetIdFromFileValue({ ref: 'asset:clx7abc' })).toBe('clx7abc')
  })

  it('takes the FIRST element, since the field is single-valued', () => {
    expect(assetIdFromFileValue([{ ref: 'asset:first' }, { ref: 'asset:second' }])).toBe('first')
  })

  // 🛑 A `file:` ref names a FolderFile, not a MediaAsset. Parsing it would hand
  // the caller an id that `MediaAsset.findFirst` cannot find, and the render
  // would then try to version an asset that does not exist.
  it('treats a `file:` ref as NO pointer rather than parsing it', () => {
    expect(assetIdFromFileValue([{ ref: 'file:clx7abc' }])).toBeUndefined()
  })

  it('rejects a bare id with no scheme — the old TEXT shape', () => {
    expect(assetIdFromFileValue('clx7abc')).toBeUndefined()
    expect(assetIdFromFileValue(['clx7abc'])).toBeUndefined()
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty array', []],
    ['empty object', {}],
    ['prefix with no id', [{ ref: 'asset:' }]],
    ['non-string ref', [{ ref: 42 }]],
  ])('returns undefined for %s', (_label, value) => {
    expect(assetIdFromFileValue(value)).toBeUndefined()
  })
})
