// packages/lib/src/documents/__tests__/document-type.test.ts
//
// Coherence guards for the `DocumentType` union and the descriptor array it is supposed to be
// derived from (purchasing plan 07 §2.2), plus the uniqueness `documentTypeOf` depends on.

import { describe, expect, it } from 'vitest'
import { DOCUMENT_TYPE_DESCRIPTORS } from '../client'
// Type-only: `ensure-pdf.ts` pulls bullmq/redis/storage at runtime, and the import is erased.
import type { DocumentType } from '../ensure-pdf'

/**
 * Every literal the `DocumentType` union names — now DERIVED from the descriptors, so this is
 * the whole registry rather than a hand-kept list that silently stopped covering new types.
 *
 * The `satisfies` still earns its place: it is what fails if the derivation ever collapses to
 * `string`, which is the one regression that would make every assertion below vacuous.
 */
const UNION_MEMBERS = DOCUMENT_TYPE_DESCRIPTORS.map((d) => d.id) satisfies readonly DocumentType[]

describe('DocumentType <-> DOCUMENT_TYPE_DESCRIPTORS', () => {
  it('every DocumentType literal has a registered descriptor', () => {
    // The direction that fails at runtime if it drifts: `ensureDocumentPdf` looks the id up in
    // the registry and throws "Unregistered document type" when it is missing.
    const ids = DOCUMENT_TYPE_DESCRIPTORS.map((d) => d.id)
    for (const member of UNION_MEMBERS) {
      expect(ids).toContain(member)
    }
  })

  it('descriptor ids are unique', () => {
    const ids = DOCUMENT_TYPE_DESCRIPTORS.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('descriptor entityType slugs are unique', () => {
    // `documentTypeOf` (money/send-email.ts) resolves a record by finding the first
    // descriptor whose `entityType` matches. Two types sharing a slug would make that a
    // registration-order coin flip, which is the class of silent misclassification the
    // throw-instead-of-default change exists to remove.
    const entityTypes = DOCUMENT_TYPE_DESCRIPTORS.map((d) => d.entityType)
    expect(new Set(entityTypes).size).toBe(entityTypes.length)
  })

  it('every descriptor carries a non-empty id and entityType', () => {
    for (const descriptor of DOCUMENT_TYPE_DESCRIPTORS) {
      expect(descriptor.id).toBeTruthy()
      expect(descriptor.entityType).toBeTruthy()
    }
  })
})
