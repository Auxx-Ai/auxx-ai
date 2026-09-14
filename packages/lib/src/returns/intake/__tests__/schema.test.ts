// packages/lib/src/returns/intake/__tests__/schema.test.ts
//
// The transcription contract, with no model involved.
//
// Two things are pinned here. First, the JSON Schema the provider enforces and
// the parser that checks what actually came back describe the SAME shape as
// `TranscribedLabel` — a field added to one and not the others is the failure
// this file exists to catch, because it fails silently as a permanently-null
// column on the review screen.
//
// Second, and the reason this file is long: the parser is the seam where a
// sloppy model meets typed code. It is TOLERANT by design (a quote's parser is
// not — see `schema.ts`'s header for why the two differ), and "tolerant" is only
// a virtue if it is specified. Every case below is a shape a real model has
// produced against a schema that told it not to.

import { describe, expect, it } from 'vitest'
import { EMPTY_TRANSCRIBED_LABEL, type TranscribedLabel } from '../client'
import {
  parseTranscribedLabel,
  TRANSCRIBE_LABEL_PROMPT,
  TRANSCRIBED_LABEL_JSON_SCHEMA,
} from '../schema'

/** A clean read of a clean label. */
const LABEL = {
  senderName: 'Jon Meyer',
  senderStreet1: '441 Bryant St',
  senderStreet2: 'Apt 3B',
  senderCity: 'San Francisco',
  senderRegion: 'CA',
  senderPostalCode: '94107',
  senderCountry: 'USA',
  carrier: 'UPS',
  trackingNumber: '1Z 999 AA1 01 2345 6784',
  ourReferenceRaw: 'RMA-4471',
  recipientNameRaw: 'Auxx Lift Returns',
  legible: true,
}

function jsonSchema(): { required: string[]; properties: Record<string, { type: unknown }> } {
  return TRANSCRIBED_LABEL_JSON_SCHEMA as never as {
    required: string[]
    properties: Record<string, { type: unknown }>
  }
}

describe('the label transcription schema', () => {
  it('describes exactly the fields the parser produces', () => {
    const parsed = parseTranscribedLabel(LABEL)
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(jsonSchema().properties).sort())
  })

  it('describes exactly the fields the shared contract declares', () => {
    // `EMPTY_TRANSCRIBED_LABEL` is the coordinator-owned contract in client.ts.
    expect(Object.keys(jsonSchema().properties).sort()).toEqual(
      Object.keys(EMPTY_TRANSCRIBED_LABEL).sort()
    )
  })

  it('requires every field of the model, so an omission is a null not a dropped key', () => {
    const schema = jsonSchema()
    expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort())
  })

  it('🛑 makes every field nullable except legible', () => {
    const { properties } = jsonSchema()
    for (const [field, spec] of Object.entries(properties)) {
      if (field === 'legible') {
        expect(spec.type).toBe('boolean')
      } else {
        expect(spec.type).toEqual(['string', 'null'])
      }
    }
  })
})

describe('TRANSCRIBE_LABEL_PROMPT', () => {
  it('🛑 states the transcribe-never-infer rule the whole feature rests on', () => {
    expect(TRANSCRIBE_LABEL_PROMPT).toContain('Never infer')
    // The two worked examples from §3.2, kept in the prompt so a future edit
    // cannot soften the rule into an abstraction.
    expect(TRANSCRIBE_LABEL_PROMPT).toContain('"Jon" stays "Jon"')
    expect(TRANSCRIBE_LABEL_PROMPT).toMatch(/Do not correct a postal code/)
    expect(TRANSCRIBE_LABEL_PROMPT).toMatch(/Do not guess it from a logo/)
  })

  it('tells the model what legible means and what recipientNameRaw is for', () => {
    expect(TRANSCRIBE_LABEL_PROMPT).toMatch(/Set legible to false when you genuinely cannot read/)
    expect(TRANSCRIBE_LABEL_PROMPT).toMatch(/recipientNameRaw is the TO block/)
  })
})

describe('parseTranscribedLabel — a clean response', () => {
  it('copies every field through untouched', () => {
    expect(parseTranscribedLabel(LABEL)).toEqual<TranscribedLabel>({
      senderName: 'Jon Meyer',
      senderStreet1: '441 Bryant St',
      senderStreet2: 'Apt 3B',
      senderCity: 'San Francisco',
      senderRegion: 'CA',
      senderPostalCode: '94107',
      senderCountry: 'USA',
      carrier: 'UPS',
      trackingNumber: '1Z 999 AA1 01 2345 6784',
      ourReferenceRaw: 'RMA-4471',
      recipientNameRaw: 'Auxx Lift Returns',
      legible: true,
    })
  })

  it('🛑 does not expand, correct, uppercase or normalise anything', () => {
    const parsed = parseTranscribedLabel({
      ...LABEL,
      senderName: 'Jon',
      senderRegion: 'ca',
      senderPostalCode: '9410',
      senderCountry: 'United States of America',
    })
    expect(parsed.senderName).toBe('Jon')
    expect(parsed.senderRegion).toBe('ca')
    expect(parsed.senderPostalCode).toBe('9410')
    expect(parsed.senderCountry).toBe('United States of America')
  })

  it('keeps the internal spacing of a tracking number, trimming only the ends', () => {
    const parsed = parseTranscribedLabel({ ...LABEL, trackingNumber: '  1Z 999  AA1 ' })
    expect(parsed.trackingNumber).toBe('1Z 999  AA1')
  })
})

describe('parseTranscribedLabel — messy model output', () => {
  it('coerces missing keys to null rather than leaving them undefined', () => {
    const parsed = parseTranscribedLabel({ senderName: 'Jon Meyer', legible: true })
    expect(parsed.senderStreet1).toBeNull()
    expect(parsed.carrier).toBeNull()
    expect(parsed.recipientNameRaw).toBeNull()
    // Every key is present, so a consumer can destructure without a guard.
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(EMPTY_TRANSCRIBED_LABEL).sort())
  })

  it('turns an empty or whitespace-only string into null', () => {
    const parsed = parseTranscribedLabel({
      ...LABEL,
      senderStreet2: '',
      senderRegion: '   ',
      carrier: '\n\t ',
    })
    expect(parsed.senderStreet2).toBeNull()
    expect(parsed.senderRegion).toBeNull()
    expect(parsed.carrier).toBeNull()
  })

  it('accepts a number where a string was asked for — a postal code is often digits', () => {
    const parsed = parseTranscribedLabel({ ...LABEL, senderPostalCode: 94107 })
    expect(parsed.senderPostalCode).toBe('94107')
  })

  it('drops a non-finite number rather than writing "NaN" onto the label', () => {
    const parsed = parseTranscribedLabel({ ...LABEL, senderPostalCode: Number.NaN })
    expect(parsed.senderPostalCode).toBeNull()
  })

  it('drops a value whose type the field cannot hold, and does not throw', () => {
    const parsed = parseTranscribedLabel({
      ...LABEL,
      senderName: { first: 'Jon', last: 'Meyer' },
      senderStreet1: ['441 Bryant St', 'Apt 3B'],
      carrier: true,
      trackingNumber: null,
    })
    expect(parsed.senderName).toBeNull()
    expect(parsed.senderStreet1).toBeNull()
    expect(parsed.carrier).toBeNull()
    expect(parsed.trackingNumber).toBeNull()
    // …while the fields it did get right survive.
    expect(parsed.senderCity).toBe('San Francisco')
  })

  it('ignores extra keys the model invented', () => {
    const parsed = parseTranscribedLabel({
      ...LABEL,
      confidence: 0.82,
      notes: 'looks like a UPS label',
      senderAddress: '441 Bryant St, San Francisco CA',
    })
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(EMPTY_TRANSCRIBED_LABEL).sort())
    expect(parsed.senderStreet1).toBe('441 Bryant St')
  })

  it('never throws on anything, however wrong the shape', () => {
    for (const raw of [
      undefined,
      null,
      'not an object',
      42,
      true,
      [],
      [LABEL],
      {},
      { senderName: undefined },
      new Date(),
    ]) {
      expect(() => parseTranscribedLabel(raw)).not.toThrow()
    }
  })

  it('returns the empty label only when there is nothing at all to salvage', () => {
    expect(parseTranscribedLabel(null)).toEqual(EMPTY_TRANSCRIBED_LABEL)
    expect(parseTranscribedLabel('I could not read this label')).toEqual(EMPTY_TRANSCRIBED_LABEL)
    expect(parseTranscribedLabel([LABEL])).toEqual(EMPTY_TRANSCRIBED_LABEL)
    expect(parseTranscribedLabel(undefined)).toEqual(EMPTY_TRANSCRIBED_LABEL)
  })

  it('returns a fresh object, so a caller cannot mutate the shared empty constant', () => {
    const parsed = parseTranscribedLabel(null)
    parsed.senderName = 'mutated'
    expect(EMPTY_TRANSCRIBED_LABEL.senderName).toBeNull()
  })
})

describe('parseTranscribedLabel — legible', () => {
  it('honours an explicit false even when the fields came back full', () => {
    const parsed = parseTranscribedLabel({ ...LABEL, legible: false })
    expect(parsed.legible).toBe(false)
    expect(parsed.senderName).toBe('Jon Meyer')
  })

  it('honours an explicit true', () => {
    expect(parseTranscribedLabel({ ...LABEL, legible: true }).legible).toBe(true)
  })

  it('accepts the string a model emits when told to emit a boolean', () => {
    expect(parseTranscribedLabel({ ...LABEL, legible: 'true' }).legible).toBe(true)
    expect(parseTranscribedLabel({ ...LABEL, legible: 'False' }).legible).toBe(false)
    expect(parseTranscribedLabel({ ...LABEL, legible: ' yes ' }).legible).toBe(true)
    expect(parseTranscribedLabel({ ...LABEL, legible: 'no' }).legible).toBe(false)
    expect(parseTranscribedLabel({ ...LABEL, legible: 1 }).legible).toBe(true)
    expect(parseTranscribedLabel({ ...LABEL, legible: 0 }).legible).toBe(false)
  })

  it('🛑 derives it from the fields when the model gave a null where a boolean was asked for', () => {
    // Something was read, so the label was legible enough to read.
    expect(parseTranscribedLabel({ ...LABEL, legible: null }).legible).toBe(true)
    // Nothing was read. Calling that a legible label would present an unreadable
    // photo as a clean label with an unknown sender.
    expect(parseTranscribedLabel({ legible: null }).legible).toBe(false)
  })

  it('derives it when the key is missing entirely', () => {
    expect(parseTranscribedLabel({ senderName: 'Jon Meyer' }).legible).toBe(true)
    expect(parseTranscribedLabel({}).legible).toBe(false)
  })

  it('derives it from an unparseable answer rather than guessing a default', () => {
    expect(parseTranscribedLabel({ ...LABEL, legible: 'maybe' }).legible).toBe(true)
    expect(parseTranscribedLabel({ ...LABEL, legible: 2 }).legible).toBe(true)
    expect(parseTranscribedLabel({ senderName: '   ', legible: 'partly' }).legible).toBe(false)
  })

  it('counts any transcribed field, not just the sender name', () => {
    expect(parseTranscribedLabel({ trackingNumber: '1Z999' }).legible).toBe(true)
    expect(parseTranscribedLabel({ recipientNameRaw: 'Auxx Lift' }).legible).toBe(true)
  })
})
