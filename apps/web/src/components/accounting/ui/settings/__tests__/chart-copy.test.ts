// apps/web/src/components/accounting/ui/settings/__tests__/chart-copy.test.ts
//
// Brief 16 §0.7: every screen used to say the default chart was 29 accounts
// (wrong since migration 125) or that the role map was "the thirteen posting
// roles" (wrong since the packs split it across five). Both numbers are gone
// now that the chart is packs, not a flat list - this pins it so a copy-pasted
// sentence cannot bring either back.
//
// `walkTsFiles` walks the source tree itself because the invariant is about what
// the codebase does NOT contain, which no unit test of a single module can assert.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkTsFiles(full, out)
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

const FORBIDDEN = ['29-account', '29 accounts', 'thirteen', 'all thirteen']

describe('no accounting screen still claims 29 accounts or thirteen roles (16 §5)', () => {
  it('has none of the retired phrases anywhere under ui/accounting', () => {
    // `fileURLToPath` is given the STRING, not a `new URL(...)` instance - under
    // `environment: 'jsdom'` (this package's vitest config) the global `URL`
    // constructor is jsdom's, and Node's `fileURLToPath` rejects an instance
    // that is not its own WHATWG URL. Passing the raw string sidesteps that.
    const here = dirname(fileURLToPath(import.meta.url))
    const root = join(here, '..', '..', '..') // apps/web/src/components/accounting
    const offenders: Array<{ file: string; phrase: string }> = []

    for (const file of walkTsFiles(root)) {
      const rel = relative(root, file).split(sep).join('/')
      // This file itself names the retired phrases as DATA (the `FORBIDDEN`
      // list) - it is not a screen and must not fail itself.
      if (rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) continue
      const source = readFileSync(file, 'utf8')
      const lower = source.toLowerCase()
      for (const phrase of FORBIDDEN) {
        if (lower.includes(phrase.toLowerCase())) offenders.push({ file: rel, phrase })
      }
    }

    expect(offenders).toEqual([])
  })
})
