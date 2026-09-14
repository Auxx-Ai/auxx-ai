// packages/lib/src/returns/intake/schema.ts

/**
 * The transcription contract for one return label, in the three shapes it is
 * needed in: the instruction the model reads, the JSON Schema the provider
 * enforces, and the parser that checks what actually came back.
 *
 * 🛑 All three are needed and none is redundant. `LLMInvocationRequest.structuredOutput`
 * takes a JSON Schema and the providers do enforce it (Anthropic through a forced
 * synthetic tool, OpenAI through `response_format: json_schema`), but enforcement is
 * the provider's word for it: a BYO model whose `supports.structured` is unknown
 * fails the gate OPEN, and `LLMOrchestrator.parseStructuredOutput` will happily
 * hand back whatever JSON it could scrape out of the prose.
 *
 * 🔀 **This is where this file deliberately differs from
 * `purchasing/intake/schema.ts`.** There, a malformed response is an
 * `UnprocessableEntityError`, because half a quote is indistinguishable on the
 * review screen from a quote whose other half was genuinely blank, and the wrong
 * half is *money*. Here every field is already nullable and a blank field is a
 * stated fact (`TranscribedLabel`), so there is no half-read to mistake for a
 * read: the parser is TOLERANT and returns the fields it could salvage, with
 * `legible` carrying the "could I read this" answer the review screen renders.
 * A label the model garbled goes to manual entry with the photo beside the
 * fields — which is a better outcome than a thrown error that costs the worker
 * the other nine labels' worth of context.
 *
 * 🛑 Nothing here reconciles, expands or corrects. The model writes what is
 * printed; this file trims whitespace off it and nothing else. No ZIP is
 * validated, no country name is normalised to an ISO code, no carrier is
 * inferred from a tracking-number prefix. Every one of those is a fact
 * destroyed.
 */

import { EMPTY_TRANSCRIBED_LABEL, type TranscribedLabel } from './client'

/**
 * The instruction that rides in front of the photograph.
 *
 * 🛑 **"Transcribe, never infer" is the whole prompt.** The same rule
 * `purchasing/intake/schema.ts` states for a quote's totals, restated for an
 * address: a printed `Jon` expanded to `Jonathan` and a ZIP quietly corrected
 * from `94107` to `94170` are both the model destroying the only evidence the
 * §4 ladder has to match on. A blank field is a fact; a filled-in guess is a
 * fact destroyed.
 */
export const TRANSCRIBE_LABEL_PROMPT = [
  'You are transcribing a shipping label on a returned parcel into structured data.',
  '',
  'Rules:',
  '1. Transcribe what is PRINTED or handwritten on the label. Never infer, expand,',
  '   correct, normalise or complete anything.',
  '2. Do not expand an abbreviated or shortened name. "Jon" stays "Jon"; "Wm." stays',
  '   "Wm."; "Co" stays "Co". Copy the name exactly as it appears.',
  '3. Do not correct a postal code, a street number or a spelling that looks wrong.',
  '   Copy what is there, wrong or not.',
  '4. Only fill carrier when the carrier NAME is printed. Do not guess it from a logo,',
  '   a colour scheme, a barcode format or the shape of the tracking number.',
  '5. Use null for anything the label does not show. A blank field is an answer.',
  '   Never invent a value and never carry a value over from another field.',
  '6. senderName and the sender address fields are the FROM block — the person or',
  '   company who sent the parcel back to us.',
  '7. recipientNameRaw is the TO block — who the parcel was addressed to. Fill it in',
  '   even though it is usually us; it is how we catch a photo of an outbound label.',
  '8. ourReferenceRaw is any RMA, return, ticket or order number written or printed',
  '   anywhere on the label, including handwriting. Copy it character for character.',
  '9. Set legible to false when you genuinely cannot read the label — it is crumpled,',
  '   blurred, torn, out of frame or in shadow. Set it to true when you can read it,',
  '   even if parts of it are blank. Do not set it to false merely because a field is',
  '   missing.',
].join('\n')

/**
 * The JSON Schema handed to the provider.
 *
 * Kept as a literal rather than generated from a zod schema: `structuredOutput.schema`
 * is `JSON.stringify`d straight onto the wire, and a generator's output would be
 * one dependency upgrade away from changing what the model is told without
 * anything in this repo changing. `__tests__/schema.test.ts` pins this and the
 * parser in lockstep against `TranscribedLabel`.
 *
 * Every field is `required` so an omission is a stated `null` rather than a key
 * the model silently dropped, and every field is nullable EXCEPT `legible` —
 * which is the one answer the model must actually commit to.
 */
export const TRANSCRIBED_LABEL_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'senderName',
    'senderStreet1',
    'senderStreet2',
    'senderCity',
    'senderRegion',
    'senderPostalCode',
    'senderCountry',
    'carrier',
    'trackingNumber',
    'ourReferenceRaw',
    'recipientNameRaw',
    'legible',
  ],
  properties: {
    senderName: {
      type: ['string', 'null'],
      description:
        'The person or company in the FROM block, exactly as printed. Never expanded or corrected.',
    },
    senderStreet1: {
      type: ['string', 'null'],
      description: 'First address line of the FROM block',
    },
    senderStreet2: {
      type: ['string', 'null'],
      description: 'Second address line (apartment, suite, care-of) or null',
    },
    senderCity: { type: ['string', 'null'] },
    senderRegion: {
      type: ['string', 'null'],
      description: 'State, province or county, as printed. Do not expand an abbreviation.',
    },
    senderPostalCode: {
      type: ['string', 'null'],
      description: 'As printed, including any letters and spaces. Never corrected.',
    },
    senderCountry: {
      type: ['string', 'null'],
      description: 'As printed. Do not convert a country name into a code, or a code into a name.',
    },
    carrier: {
      type: ['string', 'null'],
      description:
        'The carrier NAME, only when it is printed. Null when you would have to guess it from a logo, a colour or a barcode.',
    },
    trackingNumber: {
      type: ['string', 'null'],
      description: 'The tracking or consignment number as printed, including spaces and dashes',
    },
    ourReferenceRaw: {
      type: ['string', 'null'],
      description:
        'Any RMA, return, ticket or order number written or printed on the label, including handwriting',
    },
    recipientNameRaw: {
      type: ['string', 'null'],
      description: 'Who the parcel was addressed TO — the TO block, as printed',
    },
    legible: {
      type: 'boolean',
      description:
        'False when you genuinely cannot read the label (crumpled, blurred, torn, out of frame). Not false merely because a field is blank.',
    },
  },
}

/** The keys the parser reads, in the order {@link TranscribedLabel} declares them. */
const TEXT_FIELDS = [
  'senderName',
  'senderStreet1',
  'senderStreet2',
  'senderCity',
  'senderRegion',
  'senderPostalCode',
  'senderCountry',
  'carrier',
  'trackingNumber',
  'ourReferenceRaw',
  'recipientNameRaw',
] as const satisfies readonly (keyof TranscribedLabel)[]

/**
 * One text field, out of whatever the model put there.
 *
 * Accepts a string or a number, because a postal code, a house number or a
 * tracking number printed as digits comes back as a JSON number often enough to
 * matter — `94107` and `"94107"` are the same label. Anything else (a boolean,
 * an object, an array, `undefined`) is the model having lost the plot for that
 * field, and `null` says so honestly.
 *
 * 🛑 The only transformation is `trim()`. Not uppercasing, not stripping
 * punctuation, not collapsing internal whitespace — the ladder matches on this
 * text and normalisation is that module's decision to make, once, where a test
 * can see it.
 */
function text(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * The model's `legible` answer, or `undefined` when it did not give one.
 *
 * `undefined` is distinct from `false` on purpose: it is the difference between
 * "the model said it could not read this" and "the model did not answer", and
 * {@link parseTranscribedLabel} resolves the second case from the fields rather
 * than guessing a default.
 *
 * The string arms exist because a model told to emit a boolean emits `"true"`
 * often enough to be worth one line here rather than a mystery on the review
 * screen.
 */
function legibleFlag(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
    return undefined
  }
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true' || normalized === 'yes' || normalized === 'y') return true
  if (normalized === 'false' || normalized === 'no' || normalized === 'n') return false
  return undefined
}

/**
 * Validate one model response into a {@link TranscribedLabel}.
 *
 * **Tolerant by design** — see this file's header for why, and why
 * `parseTranscribedQuote` is not. A missing key becomes `null`, an empty or
 * whitespace-only string becomes `null`, a number becomes its digits, a value of
 * a type this field cannot hold becomes `null`, and an extra key the model
 * invented is dropped. Nothing here throws.
 *
 * 🔑 **`legible` is derived only when the model did not answer.** An explicit
 * `false` is honoured even when fields came back filled (the model is allowed to
 * say "I read some of it but I do not trust it"), and an explicit `true` is
 * honoured too. When the key is missing or unparseable, a transcription in which
 * *every* field is null resolves to `legible: false` — a blank read is not a
 * legible label, and calling it legible would send an unreadable photo to the
 * review screen as a clean label with an unknown sender, which is the one
 * confusion `legible` exists to prevent.
 *
 * @param raw The parsed `structured_output`, or `JSON.parse` of the content.
 * @returns {@link EMPTY_TRANSCRIBED_LABEL} when `raw` is not an object at all —
 *   a string, an array, `null` — i.e. when there is nothing to salvage.
 */
export function parseTranscribedLabel(raw: unknown): TranscribedLabel {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...EMPTY_TRANSCRIBED_LABEL }
  }

  const source = raw as Record<string, unknown>
  const label: TranscribedLabel = { ...EMPTY_TRANSCRIBED_LABEL }
  let anyField = false

  for (const field of TEXT_FIELDS) {
    const value = text(source[field])
    label[field] = value
    if (value !== null) anyField = true
  }

  label.legible = legibleFlag(source.legible) ?? anyField
  return label
}
