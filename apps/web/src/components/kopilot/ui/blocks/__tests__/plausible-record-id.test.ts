// apps/web/src/components/kopilot/ui/blocks/__tests__/plausible-record-id.test.ts
//
// Plan 17 live-run defect: Kopilot answered a question about a WORKFLOW NODE
// with `auxx:entity-card {"recordId": "<appId>:<blockId>-<nanoid>"}`, and the
// card rendered "Record unavailable" over the raw node id. The shared
// `isRecordId` cannot catch that — it is a colon test, on purpose — so the
// block renderers carry this local plausibility filter instead.

import { describe, expect, it } from 'vitest'
import { isPlausibleRecordId } from '../plausible-record-id'

describe('isPlausibleRecordId', () => {
  it('accepts a real `<defId>:<instId>` record id', () => {
    expect(isPlausibleRecordId('i5aezsg4bc6n8gof2uan3wcf:lk6jz2jsyiqwusswhrf187du')).toBe(true)
  })

  it('accepts a slug-prefixed system record id', () => {
    // System tables address rows by ModelType slug, not a cuid2 definition id —
    // tightening the definition segment would drop these.
    expect(isPlausibleRecordId('contact:lk6jz2jsyiqwusswhrf187du')).toBe(true)
    expect(isPlausibleRecordId('personal_inbox:lk6jz2jsyiqwusswhrf187du')).toBe(true)
  })

  it('rejects an app-block workflow node id — the id that caused the defect', () => {
    // `generateId('<appId>:<blockId>')` → `<appId>:<blockId>-<nanoid>`.
    expect(isPlausibleRecordId('z3prnwpd3rt31mp7f9yxo5m6:fedex-DmJuCD8M2cAE0Hqdua0Ns')).toBe(false)
  })

  it('rejects a core workflow node id (no colon at all)', () => {
    expect(isPlausibleRecordId('crud-YPeyf8rneRJPTBBbpVm0z')).toBe(false)
  })

  it('rejects half-formed and over-segmented ids', () => {
    expect(isPlausibleRecordId(':lk6jz2jsyiqwusswhrf187du')).toBe(false)
    expect(isPlausibleRecordId('i5aezsg4bc6n8gof2uan3wcf:')).toBe(false)
    // The model's known prefix mistake — `contacts:<defId>:<instId>`.
    expect(isPlausibleRecordId('contacts:i5aezsg4bc6n8gof2uan3wcf:lk6jz2jsyiqwusswhrf187du')).toBe(
      false
    )
  })

  it('rejects non-strings and anything without a colon', () => {
    expect(isPlausibleRecordId(undefined)).toBe(false)
    expect(isPlausibleRecordId(null)).toBe(false)
    expect(isPlausibleRecordId(42)).toBe(false)
    expect(isPlausibleRecordId('')).toBe(false)
    expect(isPlausibleRecordId('no-colon-here')).toBe(false)
  })
})
