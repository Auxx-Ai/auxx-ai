// packages/lib/src/ai/kopilot/capabilities/entities/shared/__tests__/ai-entity-visibility.test.ts
//
// Retrieval sequence step 0.1 (the generic-record half) and step 4.1 / Kopilot
// plan §D3.
//
// 0.1: `thread` / `message` carry a per-member lens that exists only in
// `mail-query/` — the generic record path applies none, and `canViewEntity` is an
// unconditional pass-through for both. A production turn called
// `query_records({"entity":"threads"})`, PLURAL, so the block has to be keyed on
// the resolved def rather than on the string the model typed.
//
// 4.1: `isVisible` means "show in the Records nav" and was doubling as the AI's
// capability boundary, which hid 14 of 23 defs in the dev org. The replacement is
// a curated allowlist — dropping the filter outright would advertise the ten
// `NON_RECORD_DEF_SLUGS` through a gate that always returns true.

import { describe, expect, it, vi } from 'vitest'
import type { Resource } from '../../../../../../resources/registry/types'

/** System resources have no EntityDefinition row: `entityType === id`, never nav-visible. */
function systemResource(id: string, apiSlug: string, label: string, plural: string): Resource {
  return {
    id,
    entityDefinitionId: id,
    entityType: id,
    apiSlug,
    label,
    plural,
    type: 'system',
    isVisible: false,
    fields: [],
  } as unknown as Resource
}

/** Def-backed resources key on the org's CUID and carry the system slug as `entityType`. */
function defResource(opts: {
  id: string
  entityType?: string
  apiSlug: string
  label: string
  plural: string
  isVisible: boolean
}): Resource {
  return {
    id: opts.id,
    entityDefinitionId: opts.id,
    entityType: opts.entityType,
    apiSlug: opts.apiSlug,
    label: opts.label,
    plural: opts.plural,
    type: 'custom',
    isVisible: opts.isVisible,
    fields: [],
  } as unknown as Resource
}

const THREAD = systemResource('thread', 'threads', 'Thread', 'Threads')
const MESSAGE = systemResource('message', 'messages', 'Message', 'Messages')
const ARTICLE = systemResource('article', 'articles', 'Article', 'Articles')
const CONTACT = defResource({
  id: 'def_contact',
  entityType: 'contact',
  apiSlug: 'contacts',
  label: 'Contact',
  plural: 'Contacts',
  isVisible: true,
})
const INBOX = defResource({
  id: 'def_inbox',
  entityType: 'inbox',
  apiSlug: 'inboxes',
  label: 'Inbox',
  plural: 'Inboxes',
  isVisible: false,
})
const PAYMENT = defResource({
  id: 'def_payment',
  entityType: 'payment',
  apiSlug: 'payments',
  label: 'Payment',
  plural: 'Payments',
  isVisible: false,
})
const LINE_ITEM = defResource({
  id: 'def_line_item',
  entityType: 'line_item',
  apiSlug: 'line-items',
  label: 'Line item',
  plural: 'Line items',
  isVisible: false,
})
const SIGNATURE = defResource({
  id: 'def_signature',
  entityType: 'signature',
  apiSlug: 'signatures',
  label: 'Signature',
  plural: 'Signatures',
  isVisible: false,
})
const PROJECT = defResource({
  id: 'def_project',
  apiSlug: 'projects',
  label: 'Project',
  plural: 'Projects',
  isVisible: false,
})

const RESOURCES = [THREAD, MESSAGE, ARTICLE, CONTACT, INBOX, PAYMENT, LINE_ITEM, SIGNATURE, PROJECT]

vi.mock('../../../../../../cache/org-cache-helpers', () => ({
  findCachedResource: vi.fn(
    async (_orgId: string, key: string) =>
      RESOURCES.find((r) => r.id === key || r.entityType === key || r.apiSlug === key) ?? null
  ),
  getCachedResources: vi.fn(async () => RESOURCES),
}))

import {
  AI_VISIBLE_INFRA_DEFS,
  blockedEntityError,
  isAiBlockedDefKey,
  isAiBlockedResource,
  isAiVisibleResource,
  resourceDefKey,
} from '../ai-entity-visibility'
import { resolveEntity } from '../record-filters'

describe('resourceDefKey', () => {
  it('keys a system resource on its table id', () => {
    expect(resourceDefKey(THREAD)).toBe('thread')
  })

  it('keys a def-backed system type on its entityType, not its org CUID', () => {
    expect(resourceDefKey(INBOX)).toBe('inbox')
  })

  it('keys a user-authored def on its CUID, so it can never hit a curated entry', () => {
    expect(resourceDefKey(PROJECT)).toBe('def_project')
  })
})

describe('the mail-lens block', () => {
  it('blocks thread and message', () => {
    expect(isAiBlockedResource(THREAD)).toBe(true)
    expect(isAiBlockedResource(MESSAGE)).toBe(true)
  })

  it('blocks nothing else — inboxes and articles are a visibility question, not a lens one', () => {
    for (const resource of [ARTICLE, CONTACT, INBOX, PAYMENT, LINE_ITEM, SIGNATURE, PROJECT]) {
      expect(isAiBlockedResource(resource)).toBe(false)
    }
  })

  it('names the mail tools in the refusal so the model can self-correct in one turn', () => {
    const error = blockedEntityError('threads')
    expect(error).toContain('threads')
    expect(error).toContain('find_threads')
    expect(error).toContain('get_thread_detail')
  })
})

describe('resolveEntity — normalization-proof blocking', () => {
  // The live failure was `{"entity":"threads"}`: plural, matched by apiSlug.
  const namings = [
    'thread',
    'threads',
    'Threads',
    'THREADS',
    'Thread',
    'message',
    'messages',
    'Messages',
  ]

  for (const naming of namings) {
    it(`blocks "${naming}"`, async () => {
      const resolution = await resolveEntity('org_1', naming)
      expect(resolution.kind).toBe('blocked')
    })
  }

  it('still resolves an ordinary record type', async () => {
    expect(await resolveEntity('org_1', 'contacts')).toMatchObject({ kind: 'exact' })
    expect(await resolveEntity('org_1', 'Contacts')).toMatchObject({ kind: 'normalized' })
  })

  it('does not block a nav-hidden def that merely lacks a curated entry', async () => {
    expect(await resolveEntity('org_1', 'projects')).toMatchObject({ kind: 'exact' })
  })
})

describe('the curated AI-visible allowlist', () => {
  it('keeps every nav-visible def visible', () => {
    expect(isAiVisibleResource(CONTACT)).toBe(true)
  })

  it('un-hides the curated infra defs the Records nav hides', () => {
    expect(isAiVisibleResource(INBOX)).toBe(true)
  })

  // Decided by the user on 2026-07-31: the money-adjacent defs ship AI-visible.
  // They are ordinary EntityInstance defs, so the per-def and per-record gates
  // apply to them exactly as to the rest of the curated set.
  it('includes the money-adjacent defs', () => {
    expect(isAiVisibleResource(PAYMENT)).toBe(true)
    expect(isAiVisibleResource(LINE_ITEM)).toBe(true)
  })

  it('leaves signatures hidden — the exact def plan 36 had to close', () => {
    expect(isAiVisibleResource(SIGNATURE)).toBe(false)
  })

  it('leaves articles hidden — they have their own tools and a pass-through gate', () => {
    expect(isAiVisibleResource(ARTICLE)).toBe(false)
  })

  it('leaves a nav-hidden user-authored def hidden', () => {
    expect(isAiVisibleResource(PROJECT)).toBe(false)
  })

  it('never reports a blocked def as visible, whatever the allowlist says', () => {
    expect(isAiVisibleResource(THREAD)).toBe(false)
    expect(isAiVisibleResource(MESSAGE)).toBe(false)
    expect(AI_VISIBLE_INFRA_DEFS.has('thread')).toBe(false)
    expect(AI_VISIBLE_INFRA_DEFS.has('message')).toBe(false)
  })

  it('excludes the defs that own a pass-through gate and their own tools', () => {
    for (const key of ['article', 'kb', 'dataset', 'dashboard', 'workflow', 'personal_inbox']) {
      expect(AI_VISIBLE_INFRA_DEFS.has(key)).toBe(false)
    }
  })

  // One settled array, no provisional half — the allowlist is what ships.
  it('the shipped allowlist is exactly the curated set', () => {
    expect([...AI_VISIBLE_INFRA_DEFS].sort()).toEqual([
      'catalog_group',
      'catalog_item',
      'inbox',
      'line_item',
      'meeting',
      'payment',
      'tag',
    ])
  })

  it('isAiBlockedDefKey reads a RecordId prefix directly', () => {
    expect(isAiBlockedDefKey('thread')).toBe(true)
    expect(isAiBlockedDefKey('def_contact')).toBe(false)
  })
})
