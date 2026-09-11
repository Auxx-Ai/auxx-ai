// packages/lib/src/postings/reports/__tests__/groups-by-identity.test.ts
//
// Task 15 §3's own negative: a report groups posted lines by `glAccountId` -
// the account's IDENTITY - never by `accountCode`, which is a label the org
// may rename or renumber at will. This is the test that stops the change
// being half-applied: a single report file reverting to `GROUP BY accountCode`
// (or filtering a chart-scoped read by it) would silently re-fragment that
// account's history the moment somebody renumbers it, exactly as `trial-
// balance.test.ts`'s renumber regression demonstrates the read itself no
// longer does.
//
// `walkTsFiles` borrows the house style from
// `data-migrations/migrations/108-purchasing.test.ts`'s own source
// scan (the "inert payment entities stay inert" pin).

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    // `__tests__` is excluded so this file's own description of the pattern
    // (in prose, above) can never trip its own scan.
    if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkTsFiles(full, out)
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

/**
 * Matches a Drizzle `.groupBy(...)` call, or an `eq(...)`/`inArray(...)`
 * filter, whose argument names `GlPostingLine.accountCode` - the shape a
 * report read used before task 15, and the shape a regression would look
 * exactly like again. `[^)]*` spans newlines (it excludes only the closing
 * paren), so a call formatted across several lines still matches.
 */
const GROUPS_OR_FILTERS_BY_CODE = /\.(?:groupBy|eq|inArray)\(\s*[^)]*GlPostingLine\.accountCode/

describe('no report under postings/reports/ groups or filters by accountCode (task 15 §3)', () => {
  it('every chart-scoped read keys on glAccountId, the identity, not the label', () => {
    const reportsDir = join(fileURLToPath(new URL('.', import.meta.url)), '..')
    const offenders: string[] = []

    for (const file of walkTsFiles(reportsDir)) {
      const source = readFileSync(file, 'utf8')
      if (GROUPS_OR_FILTERS_BY_CODE.test(source)) {
        offenders.push(file)
      }
    }

    expect(offenders).toEqual([])
  })
})
