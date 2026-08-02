// packages/lib/src/kb/knowledge-base-kind.test.ts

import { describe, expect, it } from 'vitest'
import { isSystemProvisionedKnowledgeBase } from './knowledge-base-kind'

describe('isSystemProvisionedKnowledgeBase (plan v3/06 P4)', () => {
  it('is true for `learned` — the KB `ensureLearnedMemory` re-provisions', () => {
    expect(isSystemProvisionedKnowledgeBase('learned')).toBe(true)
  })

  it('is false for `standard` — a member created it and may delete it', () => {
    expect(isSystemProvisionedKnowledgeBase('standard')).toBe(false)
  })

  it('is false for `source`, and that is not an oversight', () => {
    // Source KBs are platform-owned too, but they never reach a member-facing
    // surface (`listKnowledgeBases` excludes them, so does `HIDDEN_KB_KINDS`),
    // so there is no affordance on them to narrow. Their teardown runs through
    // `knowledge-sources/source-service.ts`, which deletes the owned container
    // deliberately — putting `source` in this set would read as "also protect
    // these" and mislead the next reader into guarding that path too.
    expect(isSystemProvisionedKnowledgeBase('source')).toBe(false)
  })

  it('fails safe on a missing kind — an unknown row is not treated as protected', () => {
    // Deliberately the permissive direction: this gates a DELETE affordance, not
    // a read. A row whose kind did not load must not silently become
    // undeletable, which would look like a broken button with no explanation.
    expect(isSystemProvisionedKnowledgeBase(null)).toBe(false)
    expect(isSystemProvisionedKnowledgeBase(undefined)).toBe(false)
    expect(isSystemProvisionedKnowledgeBase('')).toBe(false)
  })
})
