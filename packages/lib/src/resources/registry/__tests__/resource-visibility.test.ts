// packages/lib/src/resources/registry/__tests__/resource-visibility.test.ts
//
// Retrieval sequence step 0.1 (the generic-record half) and step 4.1 / Kopilot
// plan §D3. Moved here from `ai/kopilot/capabilities/entities/shared/` per
// plans/entity/system-entity-behavior-map.md §4.5: these predicates are facts
// about a `Resource`, not facts about Kopilot.
//
// 0.1: `thread` / `message` carry a per-member lens that exists only in
// `mail-query/` — the generic record path applies none, and `canViewEntity` is an
// unconditional pass-through for both. A production turn called
// `query_records({"entity":"threads"})`, PLURAL, so the block has to be keyed on
// the resolved def rather than on the string the model typed.
//
// 4.1: `isVisible` meant "show in the Records nav" and was doubling as the AI's
// capability boundary, which hid 14 of 23 defs in the dev org. The replacement is
// the system-entity behavior map's `aiVisible` / `inPromptCatalog` axes (§4.1b) —
// dropping the old filter outright would have advertised the `NON_RECORD_DEF_SLUGS`
// through a gate that always returns true.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { blockedEntityError } from '../../../ai/kopilot/capabilities/entities/shared/ai-entity-refusals'
import { resolveSystemEntityBehavior } from '../system-entity-behavior'
import type { Resource } from '../types'

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
    fields: [],
    ...resolveSystemEntityBehavior(id),
  } as unknown as Resource
}

/** Def-backed resources key on the org's CUID and carry the system slug as `entityType`. */
function defResource(opts: {
  id: string
  entityType?: string
  apiSlug: string
  label: string
  plural: string
}): Resource {
  return {
    id: opts.id,
    entityDefinitionId: opts.id,
    entityType: opts.entityType,
    apiSlug: opts.apiSlug,
    label: opts.label,
    plural: opts.plural,
    type: 'custom',
    fields: [],
    ...resolveSystemEntityBehavior(opts.entityType),
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
})
const INBOX = defResource({
  id: 'def_inbox',
  entityType: 'inbox',
  apiSlug: 'inboxes',
  label: 'Inbox',
  plural: 'Inboxes',
})
const PAYMENT = defResource({
  id: 'def_payment',
  entityType: 'payment',
  apiSlug: 'payments',
  label: 'Payment',
  plural: 'Payments',
})
const LINE_ITEM = defResource({
  id: 'def_line_item',
  entityType: 'line_item',
  apiSlug: 'line-items',
  label: 'Line item',
  plural: 'Line items',
})
const SIGNATURE = defResource({
  id: 'def_signature',
  entityType: 'signature',
  apiSlug: 'signatures',
  label: 'Signature',
  plural: 'Signatures',
})
// A user-authored def: no `entityType`, keys on its own CUID, resolves to pure DEFAULTS.
const PROJECT = defResource({
  id: 'def_project',
  apiSlug: 'projects',
  label: 'Project',
  plural: 'Projects',
})

const RESOURCES = [THREAD, MESSAGE, ARTICLE, CONTACT, INBOX, PAYMENT, LINE_ITEM, SIGNATURE, PROJECT]

vi.mock('../../../cache/org-cache-helpers', () => ({
  findCachedResource: vi.fn(
    async (_orgId: string, key: string) =>
      RESOURCES.find((r) => r.id === key || r.entityType === key || r.apiSlug === key) ?? null
  ),
  getCachedResources: vi.fn(async () => RESOURCES),
}))

import { resolveEntity } from '../../../ai/kopilot/capabilities/entities/shared/record-filters'
import {
  isAiBlockedDefKey,
  isAiBlockedResource,
  isAiVisibleResource,
  resourceDefKey,
} from '../resource-visibility'

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

  it('isAiBlockedDefKey reads a RecordId prefix directly', () => {
    expect(isAiBlockedDefKey('thread')).toBe(true)
    expect(isAiBlockedDefKey('def_contact')).toBe(false)
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

describe('isAiVisibleResource — resolved from the system-entity behavior map', () => {
  it('keeps every nav-visible def visible', () => {
    expect(isAiVisibleResource(CONTACT)).toBe(true)
  })

  it('un-hides the infra defs the Records nav hides but that carry no aiVisible override', () => {
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

  // Changed from the old isVisible-derived allowlist (§5.5): DEFAULTS is
  // permissive on purpose, so a custom entity with no rule written down for it
  // is AI-visible even when it is nav-hidden. PROJECT has `entityType: undefined`
  // and no SYSTEM_ENTITY_BEHAVIOR entry, so it falls straight through to
  // `aiVisible: true` — this is the intended behavior change, not a regression.
  it('now shows a nav-hidden user-authored def — DEFAULTS is permissive absent a written rule', () => {
    expect(isAiVisibleResource(PROJECT)).toBe(true)
  })

  it('never reports a blocked def as visible, whatever `aiVisible` says', () => {
    expect(isAiVisibleResource(THREAD)).toBe(false)
    expect(isAiVisibleResource(MESSAGE)).toBe(false)
  })

  // Plan §9 test 5: the block composes FIRST (§4.4) — forcing `aiVisible: true`
  // onto a blocked def must not flip the answer, or the mail-lens hole reopens.
  it('the block still wins even with aiVisible forced true on a blocked def', () => {
    const forcedVisibleThread: Resource = { ...THREAD, aiVisible: true }
    expect(isAiVisibleResource(forcedVisibleThread)).toBe(false)
  })
})

// Plan §9 test 6: asserts the `&&` order in agents/agent.ts's catalog filter
// rather than trusting it, since a flipped order fails silently (§4.4).
describe('the two AI tiers compose in one direction (§9 test 6)', () => {
  it('a def with aiVisible: false, inPromptCatalog: true is absent from a catalog-style filter', () => {
    const wronglyCataloged: Resource = { ...CONTACT, aiVisible: false, inPromptCatalog: true }
    const catalog = [wronglyCataloged].filter((r) => isAiVisibleResource(r) && r.inPromptCatalog)
    expect(catalog).toHaveLength(0)
  })
})

// Plan §9 test 7: the one §4.5 mistake that reopens the mail-lens hole
// silently is a call site reading `r.aiVisible` directly instead of going
// through `isAiVisibleResource`. Grep the source rather than trust review.
describe('no ai/kopilot call site reads `.aiVisible` directly (§9 test 7)', () => {
  const KOPILOT_ROOT = join(__dirname, '../../../ai/kopilot')

  function listTsFiles(dir: string): string[] {
    const entries = readdirSync(dir)
    const files: string[] = []
    for (const entry of entries) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        files.push(...listTsFiles(full))
      } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
        files.push(full)
      }
    }
    return files
  }

  it('every `.aiVisible` occurrence under ai/kopilot is inside a comment, not code', () => {
    const offenders: string[] = []
    for (const file of listTsFiles(KOPILOT_ROOT)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (!/\.aiVisible\b/.test(line)) return
        // Drop anything after a `//` before re-testing — a reference inside
        // prose (explaining the invariant) is fine, only real code is not.
        const codePart = line.split('//')[0] ?? ''
        if (/\.aiVisible\b/.test(codePart)) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })
})
