// packages/lib/src/resources/crud/__tests__/bulk-delete-order.test.ts
//
// `bulkDeleteEntities` sends a definition down one of two lanes, and picking the
// wrong lane is silent: the batched lane skips pre/post-delete hooks entirely,
// so a guarded entity that fell off the list would have its refusals and
// cascades quietly stop running. The parity test below is what makes registering
// a new hook ONE atomic change — add the registration, place the slug in a tier
// — instead of two, one of which is easy to forget.

import { describe, expect, it } from 'vitest'
// Statically imported, like `field-hooks/__tests__/delete-guard-registration.test.ts`:
// reading the registry initialises it, which pulls in every guard module and
// takes seconds. Paid once in this file's import phase — inside a test body it
// blows the 10s timeout whenever the suite runs under contention.
import {
  entityDeleteHookSlugs,
  getEntityPostDeleteHooks,
  getEntityPreDeleteHooks,
} from '../../../field-hooks/registry'
import {
  type BulkDeleteGroup,
  HOOKED_CHILD_DEF_SLUGS,
  HOOKED_PARENT_DEF_SLUGS,
  KNOWN_HOOKED_DEF_SLUGS,
  orderBulkDeleteGroups,
} from '../bulk-delete-order'

const group = (
  apiSlug: string | null,
  lane: 'guarded' | 'batched' = 'guarded'
): BulkDeleteGroup<string> => ({
  entityDefinitionId: apiSlug ?? 'custom_def',
  apiSlug,
  lane,
  items: [`${apiSlug}:1`],
})

const slugs = (groups: BulkDeleteGroup<string>[]) => groups.map((g) => g.apiSlug)

describe('orderBulkDeleteGroups', () => {
  it('runs cascaded children before the parents that would cascade them', () => {
    // The failure this prevents: `cascadeOrderLinesOnDelete` deletes an order's
    // lines, so an order-first batch reaches the lines after they are already
    // gone, `deleteEntity` throws `Entity not found`, and the user is told
    // records failed that were in fact deleted correctly.
    const ordered = orderBulkDeleteGroups([group('orders'), group('line-items')])

    expect(slugs(ordered)).toEqual(['line-items', 'orders'])
  })

  it('keeps vendor bill lines ahead of vendor bills', () => {
    const ordered = orderBulkDeleteGroups([group('vendor-bills'), group('vendor-bill-lines')])

    expect(slugs(ordered)).toEqual(['vendor-bill-lines', 'vendor-bills'])
  })

  it('runs the batched lane last, after every guarded definition', () => {
    // A guarded parent may cascade records of a batchable definition
    // (`guardPartDelete` removes subparts, vendor parts and stock movements).
    // Running batched last means the set-based delete simply removes fewer rows
    // than it named — no error, and the count stays honest.
    const ordered = orderBulkDeleteGroups([
      group('contacts', 'batched'),
      group('parts'),
      group('line-items'),
    ])

    expect(slugs(ordered)).toEqual(['line-items', 'parts', 'contacts'])
  })

  it('places a hooked definition it does not know BETWEEN children and parents', () => {
    // Not first (it may be a parent that cascades a known child) and not last
    // among the guarded ones (it may be a child). Never the batched lane.
    const ordered = orderBulkDeleteGroups([
      group('parts'),
      group('something-new'),
      group('line-items'),
    ])

    expect(slugs(ordered)).toEqual(['line-items', 'something-new', 'parts'])
  })

  it('is stable within a rank', () => {
    const ordered = orderBulkDeleteGroups([group('tags'), group('parts'), group('quotes')])

    expect(slugs(ordered)).toEqual(['tags', 'parts', 'quotes'])
  })

  it('never puts a definition with no apiSlug on the batched lane order', () => {
    // A definition that failed to resolve carries `apiSlug: null` and lane
    // `guarded`; it must not sort as though it were known-safe.
    const ordered = orderBulkDeleteGroups([group(null), group('contacts', 'batched')])

    expect(ordered[0]?.lane).toBe('guarded')
  })
})

describe('KNOWN_HOOKED_DEF_SLUGS — parity with the live hook registry', () => {
  it('names exactly the definitions that have pre- or post-delete hooks', () => {
    const registered = entityDeleteHookSlugs().sort()

    expect(registered).toEqual([...KNOWN_HOOKED_DEF_SLUGS].sort())

    // And every one of them really does answer with hooks, so the list cannot
    // be padded with slugs that would needlessly take the slow lane.
    for (const slug of registered) {
      const hooked =
        getEntityPreDeleteHooks(slug).length > 0 || getEntityPostDeleteHooks(slug).length > 0
      expect(hooked, `${slug} is listed as hooked but registers no delete hooks`).toBe(true)
    }
  })

  it('assigns every hooked definition to exactly one tier', () => {
    const children = new Set<string>(HOOKED_CHILD_DEF_SLUGS)
    const parents = new Set<string>(HOOKED_PARENT_DEF_SLUGS)

    for (const slug of KNOWN_HOOKED_DEF_SLUGS) {
      expect(
        Number(children.has(slug)) + Number(parents.has(slug)),
        `${slug} must be in exactly one tier`
      ).toBe(1)
    }
  })
})
