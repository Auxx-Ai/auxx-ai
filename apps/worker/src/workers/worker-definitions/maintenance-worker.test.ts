// apps/worker/src/workers/worker-definitions/maintenance-worker.test.ts
//
// One question: does every job this codebase ENQUEUES onto the maintenance queue
// have a handler here?
//
// ⚠️ Nothing in the type system asks it. `queue.add(NAME, data, opts)` takes a
// string, and `createJobHandler` looks that string up at RUNTIME and throws
// `Job function not found: <name>` when it is missing. So an unregistered job is
// a clean compile, a green suite, a successful enqueue, and a feature that does
// nothing — exactly how retroactive classification shipped inert
// (`plans/mail-filter/07-…§7.5.1`).
//
// ⚠️ **The expected names are string LITERALS on purpose, not imports from
// `@auxx/lib`.** Importing them made this file resolve lib's `dist`, which is
// only as fresh as the last build, so a correct registration reported as
// `undefined` — a test that lies in the same direction as the bug it guards is
// worse than no test. The other half of the contract (that the exported constant
// still equals this literal) is pinned in
// `packages/lib/src/mail-classification/client.test.ts`.

import { describe, expect, it, vi } from 'vitest'

// The module graph reaches `@auxx/database`, which refuses to load without a
// connection string. Nothing here connects — the assertions are about a plain
// object — so a placeholder is enough, set before the graph is pulled in.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'
})

const { jobMappings } = await import('./maintenance-worker')

describe('maintenance worker registrations', () => {
  it.each([
    ['mail reclassify sample', 'mailReclassifySampleJob'],
    ['mail reclassify apply', 'mailReclassifyApplyJob'],
    ['retroactive mail-filter apply', 'mailFilterRetroactiveApplyJob'],
    ['data migrations', 'dataMigrationsJob'],
    // Four doors enqueue this one name — the mutation seam, the sync-manifest
    // consumer, and the 6h scheduler — so a missing registration would silently
    // disable duplicate detection everywhere at once.
    ['duplicate scan', 'duplicateScanJob'],
    // The only time-driven trigger in the three-way match (money P24). A missing
    // registration here restores the exact hole it was built to close — a prepaid
    // bill that never ages out of `awaiting_receipt` — with nothing on screen to
    // say so.
    ['vendor bill aging', 'vendorBillAgingJob'],
  ])('has a handler for the %s job', (_label, name) => {
    expect(Object.keys(jobMappings)).toContain(name)
  })

  // Catches the other shape of the same failure: a mapping entry whose import
  // resolved to `undefined` (a renamed export, a barrel that stopped re-exporting
  // it). The key is present, so the check above passes, and the job still dies at
  // runtime.
  it('maps every key to a callable, so no entry is an accidental undefined import', () => {
    for (const [name, handler] of Object.entries(jobMappings)) {
      expect(typeof handler, `${name} is not a function`).toBe('function')
    }
  })
})
