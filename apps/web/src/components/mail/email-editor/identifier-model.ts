// apps/web/src/components/mail/email-editor/identifier-model.ts

import { IdentifierType } from '@auxx/database/enums'
import type { IdentifierType as IdentifierTypeType } from '@auxx/database/types'
import type { PlatformCapabilities } from '@auxx/lib/channels/client'
import { formatPhoneNumber } from '@auxx/utils'
import { type CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js'

/** The shape of identifier a channel addresses — `PlatformCapabilities.recipientModel`. */
export type RecipientModel = PlatformCapabilities['recipientModel']

/**
 * ISO-3166 region a national (no `+`) phone number is parsed against.
 * Re-exported so callers don't have to reach into `libphonenumber-js`.
 */
export type PhoneRegion = CountryCode

/** Region assumed when the sending channel has no parseable E.164 number. */
export const DEFAULT_PHONE_REGION: PhoneRegion = 'US'

/**
 * Region implied by a channel's OWN sending number.
 *
 * There is no `country` on the org profile, and an org with a German and a US
 * number should parse national input differently depending on which one it is
 * sending from — so the From channel's E.164 identifier is both the cheaper
 * and the more correct source. Falls back to {@link DEFAULT_PHONE_REGION} when
 * the channel carries no number (every email channel) or it doesn't parse.
 */
export function regionFromIdentifier(identifier?: string | null): PhoneRegion {
  if (!identifier) return DEFAULT_PHONE_REGION
  return parsePhoneNumberFromString(identifier.trim())?.country ?? DEFAULT_PHONE_REGION
}

/**
 * Everything the recipient input needs to know about ONE identifier shape:
 * how to validate/normalize a typed value, which `IdentifierType` to commit,
 * which contact field holds the candidate values, and what to call the thing
 * in copy.
 *
 * Keyed by `recipientModel` so the composer stays capability-driven — the same
 * switch the agent path uses in
 * `packages/lib/src/ai/kopilot/capabilities/mail/recipient-resolver.ts`
 * (`identifierTypesForIntegration` / `systemAttributeForChannel`).
 */
export interface IdentifierModelSpec {
  /** `IdentifierType` committed on every recipient of this model. */
  identifierType: IdentifierTypeType

  /**
   * `systemAttribute` candidates on the contact definition, in preference
   * order. The first one that resolves to a field wins. Mirrors
   * `systemAttributeForChannel` in the kopilot recipient resolver.
   */
  systemAttributes: string[]

  /**
   * Key on the picker row's raw `data` holding the record's primary value —
   * the fallback when the field read fails or returns nothing.
   */
  rowDataKey: string

  /**
   * Whether the picker row's `secondaryInfo` (the secondary display field) is
   * a value of THIS model. True for email — contacts render their address as
   * the subtitle — and false for everything else, where the subtitle is still
   * an email and would poison a phone recipient list.
   */
  secondaryInfoIsIdentifier: boolean

  /**
   * Canonical form of a raw typed/stored value, or `null` when it is not a
   * valid identifier of this model. Doubles as the validator.
   */
  normalize: (raw: string) => string | null

  /**
   * Human-facing rendering of an ALREADY-normalized identifier — what the
   * badge shows. The committed `identifier` stays the canonical form
   * (`Participant.identifier` is a routing key and must remain E.164); this is
   * display only. Identity for email.
   */
  formatDisplay: (value: string) => string

  /** Inline copy for an explicit commit (Enter / comma) of an invalid value. */
  invalidTitle: string
  invalidDescription: string

  /** Singular/plural noun used in the "which one?" popover. */
  noun: string
  nounPlural: string
}

const EMAIL_RE = /\S+@\S+\.\S+/

const EMAIL_SPEC: IdentifierModelSpec = {
  identifierType: IdentifierType.EMAIL,
  systemAttributes: ['primary_email'],
  rowDataKey: 'email',
  secondaryInfoIsIdentifier: true,
  normalize: (raw) => {
    const trimmed = raw.trim()
    return trimmed && EMAIL_RE.test(trimmed) ? trimmed.toLowerCase() : null
  },
  formatDisplay: (value) => value,
  invalidTitle: 'Invalid Email',
  invalidDescription: 'Please enter a valid email address.',
  noun: 'email address',
  nounPlural: 'email addresses',
}

/**
 * Phone spec for one default region. Loosening phone entry means passing a
 * BETTER region here — never hand-rolling a second parser and never relaxing
 * `isValid()` to a length check, which would bless impossible numbers with a
 * `+1` and mint un-mergeable contacts.
 */
function createPhoneSpec(region: PhoneRegion): IdentifierModelSpec {
  return {
    identifierType: IdentifierType.PHONE,
    // `phone` is what the contact registry seeds (contact-fields.ts); older /
    // connector-provisioned orgs can carry `primary_phone`.
    systemAttributes: ['phone', 'primary_phone'],
    rowDataKey: 'phone',
    secondaryInfoIsIdentifier: false,
    // `formatPhoneNumber` is THE phone normalizer (libphonenumber-backed, E.164
    // out, `null` for anything unparseable or impossible). Never hand-roll a
    // second one here — write-path and lookup normalization must not drift.
    normalize: (raw) => formatPhoneNumber(raw, region),
    // National form for a number of the sending channel's own region
    // (`(415) 555-1234`), international for anything else
    // (`+44 20 7183 8750`). Never reaches the committed identifier.
    formatDisplay: (value) => {
      const parsed = parsePhoneNumberFromString(value, region)
      if (!parsed) return value
      return parsed.country === region ? parsed.formatNational() : parsed.formatInternational()
    },
    invalidTitle: 'Invalid Phone Number',
    invalidDescription: 'Please enter a valid phone number, e.g. +14155551234.',
    noun: 'phone number',
    nounPlural: 'phone numbers',
  }
}

/** One spec instance per region, so `getIdentifierModel` stays referentially stable. */
const PHONE_SPECS = new Map<PhoneRegion, IdentifierModelSpec>()

/**
 * Resolve the identifier spec for a channel's `recipientModel`.
 *
 * Defaults to email when the model is absent — every caller without resolved
 * `PlatformCapabilities` is an email composer. `thread_only` and
 * `platform_user` never reach here (the composer hides the recipient field for
 * both); they fall back to email rather than crashing.
 *
 * @param defaultRegion Region national (no `+`) numbers are parsed against —
 *   derive it from the sending channel with {@link regionFromIdentifier}.
 */
export function getIdentifierModel(
  model?: RecipientModel,
  defaultRegion: PhoneRegion = DEFAULT_PHONE_REGION
): IdentifierModelSpec {
  if (model !== 'phone') return EMAIL_SPEC
  const cached = PHONE_SPECS.get(defaultRegion)
  if (cached) return cached
  const spec = createPhoneSpec(defaultRegion)
  PHONE_SPECS.set(defaultRegion, spec)
  return spec
}

/**
 * Dedupe/exclude key for an identifier of this model. Falls back to the
 * lowercased raw value when normalization fails, so an already-stored value
 * that no longer parses still matches itself.
 */
export function identifierKey(spec: IdentifierModelSpec, value: string): string {
  return (spec.normalize(value) ?? value.trim()).toLowerCase()
}
