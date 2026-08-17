// packages/lib/src/phone-geo/types.ts

/**
 * Location derived from a phone number's numbering-plan prefix.
 *
 * This is geographic **origin** data, not the contact's location: a `+1 212`
 * number can belong to someone who moved to Denver fifteen years ago, and
 * mobile numbers — the bulk of what we hold — are the most-ported of all.
 * Every consumer must treat these as a hint that may only ever fill a blank,
 * never overwrite a value sourced from IP geolocation or a human.
 *
 * Every field is independently optional: NANP numbers almost always resolve a
 * `region`, only ~70% of area codes carry city-level data, and `timezone` is
 * omitted whenever the prefix spans more than one zone.
 */
export interface PhoneGeo {
  /** e.g. `Los Angeles`. Absent when the prefix only resolves to a state/province. */
  city?: string
  /** State, province or region — expanded to its full name, e.g. `California`. */
  region?: string
  /** Full English country name, e.g. `United States`. */
  country?: string
  /** IANA zone, e.g. `America/Los_Angeles`. Absent when the prefix is ambiguous. */
  timezone?: string
}
