// packages/lib/src/participants/channel-identifier-fields.ts
//
// THE map from a channel's `recipientModel` to (a) the `IdentifierType`s its
// participants carry and (b) the contact fields that hold an addressable value.
//
// 🔴 **These two answers must come from the same place.** Anything that filters
// participants to `PHONE` while reading `primary_email` off the contact record is
// serving two different channels in one query — a wrong answer that looks
// entirely plausible, because both halves are individually correct. That is why
// this is one module exporting one pair, and not two switches that happen to
// agree today.
//
// It is keyed on `recipientModel` — a plain string from
// `PlatformCapabilities` — rather than on an `Integration` row or an
// `IntegrationCatalogEntry`, so the composer (client) and the agent path
// (server) can bind the SAME function. Do not add a parameter that only exists
// server-side; that is what forced the duplication this module removes.
//
// ⚠️ **Client-safe: types and pure switches only.** No `db`, no cache, no
// `'use client'` directive (a directive here would break every server import).
// Bound today by:
//   - `ai/kopilot/capabilities/mail/recipient-resolver.ts` (agent sends)
//   - `apps/web/.../email-editor/identifier-model.ts` (the composer)

import type { IdentifierType } from '@auxx/database/types'
import type { PlatformCapabilities } from '../channels/client'

/** The shape of identifier a channel addresses. */
export type RecipientModel = PlatformCapabilities['recipientModel']

/** The contact fields holding an addressable value, plus the type they produce. */
export interface ChannelIdentifierFields {
  /**
   * `systemAttribute` candidates on the contact definition, in preference
   * order — the first that resolves to a field wins.
   */
  readonly systemAttributes: readonly string[]
  /** `IdentifierType` committed for a value read out of those fields. */
  readonly identifierType: IdentifierType
}

export const EMAIL_IDENTIFIER_FIELDS: ChannelIdentifierFields = {
  systemAttributes: ['primary_email'],
  identifierType: 'EMAIL',
}

export const PHONE_IDENTIFIER_FIELDS: ChannelIdentifierFields = {
  // `phone` is what the contact registry seeds (`contact-fields.ts`); older and
  // connector-provisioned orgs can carry `primary_phone`.
  systemAttributes: ['phone', 'primary_phone'],
  identifierType: 'PHONE',
}

/**
 * `IdentifierType`s a channel of this model can address.
 *
 * 🔴 **An empty array means "no valid type", NOT "no filter".** `platform_user`
 * returns `[]`, and a caller that treats an empty list as "unfiltered" hands
 * back every participant in the organization, of every type — the fail-open
 * that `search.participants` shipped with
 * (`identifierTypes.length > 0 ? inArray(...) : undefined`). Callers must
 * distinguish three cases:
 *
 * | value | meaning |
 * |---|---|
 * | `undefined` (never returned here) | caller chose not to filter |
 * | `['PHONE']` | that type only |
 * | `[]` | nothing is addressable → empty result, not every result |
 *
 * The `switch` is exhaustive with no `default`, so adding a `recipientModel`
 * to `PlatformCapabilities` is a type error here rather than a silent `[]`.
 */
export function identifierTypesForModel(model: RecipientModel): readonly IdentifierType[] {
  switch (model) {
    case 'email':
      return [EMAIL_IDENTIFIER_FIELDS.identifierType]
    case 'phone':
      return [PHONE_IDENTIFIER_FIELDS.identifierType]
    case 'thread_only':
      // Facebook/Instagram replies — both PSID variants are accepted, because a
      // thread's participant carries whichever the platform issued.
      return ['FACEBOOK_PSID', 'INSTAGRAM_IGSID']
    case 'platform_user':
      // Internal platform recipients are addressed by user, not by identifier.
      return []
  }
}

/**
 * The contact fields to read an addressable value from, or `undefined` when the
 * model has none.
 *
 * `undefined` is a real answer, not a gap: no contact field holds a Facebook
 * PSID or a platform user id, so a caller reading contact records for those
 * models must **skip that arm entirely** rather than fall back to email — which
 * would offer addresses the channel cannot send to.
 */
export function identifierFieldsForModel(
  model: RecipientModel
): ChannelIdentifierFields | undefined {
  switch (model) {
    case 'email':
      return EMAIL_IDENTIFIER_FIELDS
    case 'phone':
      return PHONE_IDENTIFIER_FIELDS
    case 'thread_only':
    case 'platform_user':
      return undefined
  }
}
