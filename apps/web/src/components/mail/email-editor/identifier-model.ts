// apps/web/src/components/mail/email-editor/identifier-model.ts

import { IdentifierType } from '@auxx/database/enums'
import type { IdentifierType as IdentifierTypeType } from '@auxx/database/types'
import type { PlatformCapabilities } from '@auxx/lib/channels/client'
import { formatPhoneNumber } from '@auxx/utils'

/** The shape of identifier a channel addresses — `PlatformCapabilities.recipientModel`. */
export type RecipientModel = PlatformCapabilities['recipientModel']

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

  /** Toast copy for an explicit commit (Enter / comma) of an invalid value. */
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
  invalidTitle: 'Invalid Email',
  invalidDescription: 'Please enter a valid email address.',
  noun: 'email address',
  nounPlural: 'email addresses',
}

const PHONE_SPEC: IdentifierModelSpec = {
  identifierType: IdentifierType.PHONE,
  // `phone` is what the contact registry seeds (contact-fields.ts); older /
  // connector-provisioned orgs can carry `primary_phone`.
  systemAttributes: ['phone', 'primary_phone'],
  rowDataKey: 'phone',
  secondaryInfoIsIdentifier: false,
  // `formatPhoneNumber` is THE phone normalizer (libphonenumber-backed, E.164
  // out, `null` for anything unparseable or impossible). Never hand-roll a
  // second one here — write-path and lookup normalization must not drift.
  normalize: (raw) => formatPhoneNumber(raw),
  invalidTitle: 'Invalid Phone Number',
  invalidDescription: 'Please enter a valid phone number, e.g. +14155551234.',
  noun: 'phone number',
  nounPlural: 'phone numbers',
}

/**
 * Resolve the identifier spec for a channel's `recipientModel`.
 *
 * Defaults to email when the model is absent — every caller without resolved
 * `PlatformCapabilities` is an email composer. `thread_only` and
 * `platform_user` never reach here (the composer hides the recipient field for
 * both); they fall back to email rather than crashing.
 */
export function getIdentifierModel(model?: RecipientModel): IdentifierModelSpec {
  return model === 'phone' ? PHONE_SPEC : EMAIL_SPEC
}

/**
 * Dedupe/exclude key for an identifier of this model. Falls back to the
 * lowercased raw value when normalization fails, so an already-stored value
 * that no longer parses still matches itself.
 */
export function identifierKey(spec: IdentifierModelSpec, value: string): string {
  return (spec.normalize(value) ?? value.trim()).toLowerCase()
}
