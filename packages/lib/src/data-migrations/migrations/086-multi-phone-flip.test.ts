// packages/lib/src/data-migrations/migrations/086-multi-phone-flip.test.ts

import { describe, expect, it } from 'vitest'
import { CONTACT_FIELDS } from '../../resources/registry/resources/contact-fields'
import { MULTI_FLIP_SYSTEM_ATTRIBUTES } from './085-multi-email-website-flip'
import {
  MULTI_PHONE_ENTITY_TYPE,
  MULTI_PHONE_SYSTEM_ATTRIBUTE,
  migration086MultiPhoneFlip,
} from './086-multi-phone-flip'

/**
 * The merge logic itself is 085's (`mergeMultiIntoOptions`, covered there); 086
 * reuses it verbatim. What's worth pinning here is the pairing between the
 * migration and the registry — the flip only works when BOTH sides agree, and a
 * one-sided change is exactly the failure mode that leaves newly seeded orgs
 * multi-value while existing orgs stay scalar (or vice versa).
 */
describe('migration086MultiPhoneFlip', () => {
  const phoneField = CONTACT_FIELDS.phone

  it('targets the seeded contact phone system attribute', () => {
    expect(MULTI_PHONE_SYSTEM_ATTRIBUTE).toBe('phone')
    expect(MULTI_PHONE_SYSTEM_ATTRIBUTE).toBe(phoneField?.systemAttribute)
  })

  it('matches the registry — the field it flips is declared multi', () => {
    expect(phoneField?.options).toMatchObject({ multi: true })
  })

  it('does not re-flip what 085 already handled', () => {
    expect(MULTI_FLIP_SYSTEM_ATTRIBUTES).not.toContain(MULTI_PHONE_SYSTEM_ATTRIBUTE)
  })

  it('arms no uniqueness gate — phone is deliberately non-unique', () => {
    expect(phoneField?.capabilities?.unique).toBeUndefined()
  })

  it('is registered with the id its filename claims', () => {
    expect(migration086MultiPhoneFlip.id).toBe('086-multi-phone-flip')
  })

  /**
   * Load-bearing: `phone` is a generic attribute name that ORG-CREATED defs
   * reuse (dev DB carries it on `leads` and `vendors`). Those defs are in no
   * field registry, so flipping them would make existing orgs multi-value while
   * newly created ones stay scalar. The `entityType` join is the only thing
   * keeping the migration to the seeded contact field — dropping it silently
   * widens the blast radius, which no other assertion here would catch.
   */
  it('is scoped to the seeded contact def, not every def using the name', () => {
    expect(MULTI_PHONE_ENTITY_TYPE).toBe('contact')
    expect(migration086MultiPhoneFlip.run.toString()).toContain('EntityDefinition')
    expect(migration086MultiPhoneFlip.run.toString()).toContain('entityType')
  })
})
