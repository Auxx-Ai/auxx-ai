// packages/lib/src/field-hooks/__tests__/name-case-registration.test.ts
//
// That the casing repair is actually ON the chain, and that nothing quietly takes it
// back off. Separate from `records/name-case/__tests__/hook.test.ts` because
// `getFieldPreHooks` self-inits the whole hook bootstrap, which needs the real
// `@auxx/database` module graph.

import { describe, expect, it } from 'vitest'
import { repairNameCasing } from '../../records/name-case/hook'
import { getFieldPreHooks, hasFieldPreHooks } from '../registry'

describe('contact name casing registration', () => {
  // The apiSlug, not the entityType. `fireFieldPreHooks` keys off `resource.apiSlug`,
  // so registering under `contact` would be a silent no-op — the same mistake
  // `delete-guard-registration.test.ts` was written to stop for pre-delete hooks.
  it('is on the field pre-hook chain for both name parts', () => {
    for (const attribute of ['first_name', 'last_name'] as const) {
      expect(hasFieldPreHooks('contacts', attribute)).toBe(true)
      expect(getFieldPreHooks('contacts', attribute)).toContain(repairNameCasing)
    }
  })

  it('is registered under the apiSlug, not the entityType', () => {
    expect(hasFieldPreHooks('contact', 'first_name')).toBe(false)
  })

  it('is not registered globally', () => {
    // Scoped to `contacts` on purpose (plan §4). A `*` registration would reach every
    // entity that reuses `first_name`, which is a deliberate future choice, not today's.
    expect(hasFieldPreHooks('*', 'first_name')).toBe(false)
  })
})

// 🛑 The connector sink must NOT bypass this hook. `connector-sync-source.ts` builds its
// owned-mode `UnifiedCrudHandler` with `bypassFieldGuards: OWNED_BYPASS`, whose name and
// former comment both claim it "skips registered system-field pre-hooks". It does not —
// it is `new Set<never>()`, so it can contain no systemAttribute and
// `fireFieldPreHooks`' `bypassFieldGuards.has(...)` check never matches.
//
// This is what makes the Shopify backfill (13,637 contacts) get repaired casing on the
// way in. If someone ever puts a real attribute in that set, this fails.
describe('the connector sink does not bypass field pre-hooks', () => {
  it('OWNED_BYPASS is empty', async () => {
    const source = await import('node:fs/promises')
    const file = await source.readFile(
      new URL('../../data-connectors/connector-sync-source.ts', import.meta.url),
      'utf8'
    )
    expect(file).toContain('const OWNED_BYPASS: ReadonlySet<never> = new Set<never>()')
  })
})
