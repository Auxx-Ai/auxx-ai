// packages/lib/src/returns/__tests__/evidence-pack-registration.test.ts

/**
 * The evidence pack's registration in the document-type registry.
 *
 * Two things worth a regression guard, both of which fail silently rather than
 * loudly if they drift:
 *
 * 1. 🛑 **`pointerAttr` must name the real field.** `ensure-pdf.ts` reads the
 *    pointer to decide whether a cached render can be reused; when the lookup
 *    finds nothing, every generation re-renders AND mints a fresh `MediaAsset`
 *    rather than versioning the existing one. That is an asset leak with no
 *    error attached, and the registry's own header says so.
 * 2. 🛑 **The pack must not be emailable.** Its `contactSystemAttribute` names
 *    no CustomField deliberately: `return_contact` is the CUSTOMER, the party
 *    the pack argues against, and resolving a recipient would let
 *    `prepareDocumentEmail` compose our liability verdict and the sentence
 *    explaining why we kept their money straight into their inbox. `markSent`
 *    refusing is not enough - it runs AFTER a confirmed send.
 */

import { describe, expect, it } from 'vitest'
import { DOCUMENT_TYPE_DESCRIPTORS } from '../../documents/client'
import { DOCUMENT_EMAIL_PROFILES } from '../../money/send-email'
import { RETURN_EVIDENCE_PACK_DOCUMENT_TYPE } from '../evidence-pack'

describe('return_evidence_pack is a registered document type', () => {
  it('has a descriptor pointing at the return definition', () => {
    const descriptor = DOCUMENT_TYPE_DESCRIPTORS.find(
      (candidate) => candidate.id === RETURN_EVIDENCE_PACK_DOCUMENT_TYPE
    )
    expect(descriptor).toBeDefined()
    expect(descriptor?.entityType).toBe('return')
  })

  it('is not registered against an entityType another document already claims', () => {
    // `documentTypeOf` resolves a record by the first descriptor whose
    // entityType matches, so a duplicate slug is a registration-order coin flip.
    const slugs = DOCUMENT_TYPE_DESCRIPTORS.map((descriptor) => descriptor.entityType)
    expect(new Set(slugs).size).toBe(slugs.length)
  })
})

describe('the pack refuses to be emailed, and refuses early', () => {
  const profile = DOCUMENT_EMAIL_PROFILES[RETURN_EVIDENCE_PACK_DOCUMENT_TYPE]

  it('names no resolvable contact field, so no recipient is ever found', () => {
    expect(profile.contactSystemAttribute).toBe('return_evidence_pack_contact')
    // The trap this exists to avoid: `return_contact` is real and is the person
    // the pack argues against.
    expect(profile.contactSystemAttribute).not.toBe('return_contact')
  })

  it('refuses at markSent as well, and says where the pack should go instead', async () => {
    await expect(
      profile.markSent({ organizationId: 'org_1', userId: 'u1', instanceId: 'ret_1' })
    ).rejects.toThrow(/not emailed/i)
  })
})
