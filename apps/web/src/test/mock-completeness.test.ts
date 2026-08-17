// apps/web/src/test/mock-completeness.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { APP_ROOT } from './app-root'

/**
 * The tripwire for the `@auxx/database` mock collection hazard.
 *
 * A per-file `vi.mock('@auxx/database', () => ({ … }))` REPLACES the module, so
 * every export the author did not list is dropped. Two shapes then kill the file
 * at COLLECTION — before a single test runs:
 *
 *  - no `database` key → Vitest's named-binding link check fails the moment
 *    anything in the import graph does `import { database } from '@auxx/database'`;
 *  - `schema: {}` → tables read as `undefined`, and modules that touch one at
 *    MODULE SCOPE die inside Drizzle.
 *
 * Vitest reports that as a suite with **0 tests**, which reads as an empty file
 * rather than a regression. #1670 took `search-participant-gate.test.ts` from 17
 * tests to 0 that way and survived review, CI and two subsequent merges.
 *
 * Two properties are pinned here, and both matter:
 *
 *  1. **Behavioral** — the shared helper is actually sufficient for the import
 *     graph every router test pulls in. All 22 converted call sites depend on
 *     that, and it is one lazy-import refactor away from silently becoming false.
 *  2. **Structural** — no NEW hand-written factory creeps back in. Fixing the
 *     current instances without this leaves the hazard fully armed for the next
 *     test file anyone writes.
 *
 * See `plans/testing/database-mock-collection-hazard.md`.
 */

vi.mock('@auxx/database', async () => (await import('~/test/database-mock')).mockAuxxDatabase())
vi.mock('@auxx/logger', async () => (await import('~/test/logger-mock')).mockAuxxLogger())

describe('the shared @auxx/database mock is complete', () => {
  it('supplies `database` and a table-vivifying `schema`', async () => {
    const db = await import('@auxx/database')

    expect(db.database).toBeDefined()
    // Chainable: modules that build a statement at module scope must not die on
    // `db.select is not a function`.
    expect(typeof db.database.select).toBe('function')
    expect(typeof db.database.select().from().where().limit).toBe('function')

    // Any table resolves to a stable object, so `schema.Whatever.column` is
    // never a read off `undefined`.
    const schema = db.schema as unknown as Record<string, Record<string, unknown>>
    expect(schema.SomeTableNobodyPinned).toBeDefined()
    expect(schema.SomeTableNobodyPinned).toBe(schema.SomeTableNobodyPinned)
  })

  /**
   * The real assertion. `@auxx/lib/cache` is the barrel most router tests reach,
   * and its providers pull in a large slice of `packages/lib` — the chain that
   * made a partial mock fatal from anywhere.
   *
   * ⚠ Do NOT "fix" a failure here by pinning another table in the caller. A
   * failure means some module now touches `@auxx/database` at module scope in a
   * way the shared mock cannot satisfy — make that module lazy instead, or every
   * converted call site regresses at once.
   */
  // Generous timeout: this pulls a large slice of `packages/lib` through the
  // transform pipeline on a cold run, which is the point of the assertion.
  it('lets the org-cache barrel import cleanly', { timeout: 30_000 }, async () => {
    await expect(import('@auxx/lib/cache')).resolves.toBeDefined()
  })

  it('lets the files/ service graph import cleanly', async () => {
    await expect(import('@auxx/lib/files')).resolves.toBeDefined()
  })
})

describe('no hand-written @auxx/database or @auxx/logger factories', () => {
  /** Every test file under `apps/web/src`. */
  function testFiles(dir: string, found: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') testFiles(full, found)
      } else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
        found.push(full)
      }
    }
    return found
  }

  const SRC = path.resolve(APP_ROOT, 'src')
  const files = testFiles(SRC)

  it.each([
    ['@auxx/database', 'mockAuxxDatabase', '~/test/database-mock'],
    ['@auxx/logger', 'mockAuxxLogger', '~/test/logger-mock'],
  ])('every vi.mock(%s) routes through %s', (module, helper, helperPath) => {
    // Anchored to the start of a line, so a `vi.mock('…')` quoted inside a doc
    // comment is not mistaken for a call. The factory is then the text up to the
    // next top-level `vi.mock(` (or EOF) — enough to see whether the helper is
    // named inside it, without parsing TypeScript.
    const offenders: string[] = []
    const call = new RegExp(`^vi\\.mock\\('${module.replace('/', '\\/')}'`, 'gm')
    for (const file of files) {
      if (file === __filename) continue
      const src = fs.readFileSync(file, 'utf8')
      for (const match of src.matchAll(call)) {
        const at = match.index
        const next = src.indexOf('\nvi.mock(', at + 1)
        const factory = src.slice(at, next === -1 ? src.length : next)
        if (!factory.includes(helper)) offenders.push(path.relative(SRC, file))
      }
    }

    expect(
      offenders,
      `These files hand-write a \`${module}\` mock factory instead of calling ` +
        `\`${helper}\` from '${helperPath}'. A hand-written factory drops every ` +
        `export it does not list, and the file then reports as 0 TESTS rather ` +
        `than as a failure. See plans/testing/database-mock-collection-hazard.md.`
    ).toEqual([])
  })
})
