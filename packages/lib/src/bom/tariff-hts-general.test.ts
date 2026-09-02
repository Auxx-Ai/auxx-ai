// packages/lib/src/bom/tariff-hts-general.test.ts
//
// The generated catalogue and its lazy loader
// (plans/money/tasks/32-tariff-starter-catalogue.md §1.4, §7 (c), §9).
//
// The plan's illustrative code `8481.80.9005` is not in the generated file
// (verified by grep before writing this test - the real USITC grouping under
// that heading is 4-2-2-2, e.g. `8481.80.10.20`), so the exact-match test
// below uses `8481.80.10.20` instead, a real hand-operated valve line.

import { describe, expect, it } from 'vitest'
import {
  buildFoldedDescription,
  capDescription,
  flattenHtsRows,
  type RawHtsRow,
} from '../../scripts/fetch-hts-general'
import {
  findHtsGeneral,
  type HtsGeneralLine,
  listHtsChildren,
  loadHtsGeneral,
  normalizeHtsCode,
  searchHtsGeneral,
} from './tariff-hts-general'

const KNOWN_CODE = '8481.80.10.20'

describe('loadHtsGeneral', () => {
  it('resolves the generated catalogue', async () => {
    const catalogue = await loadHtsGeneral()
    expect(catalogue.lines.length).toBeGreaterThan(15000)
    expect(catalogue.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(catalogue.source).toContain('hts.usitc.gov')
  })

  it('every line is a well-formed 3-tuple with a unique 10-digit code', async () => {
    const { lines } = await loadHtsGeneral()
    const seen = new Set<string>()
    for (const line of lines) {
      expect(line).toHaveLength(3)
      const [code, rate, description] = line
      const digits = normalizeHtsCode(code)
      expect(digits).toHaveLength(10)
      expect(seen.has(digits)).toBe(false)
      seen.add(digits)

      expect(Number.isFinite(rate)).toBe(true)
      expect(rate).toBeGreaterThanOrEqual(0)

      // The full chain: heading (capped 120) plus the subheading and short
      // label, "Other" folded, capped overall at 200.
      expect(description.length).toBeGreaterThan(0)
      expect(description.length).toBeLessThanOrEqual(200)
    }
  })

  it('every node is a 4- or 6-digit level with at least one leaf under it', async () => {
    const { nodes } = await loadHtsGeneral()
    expect(nodes.length).toBeGreaterThan(0)
    for (const node of nodes) {
      const digits = normalizeHtsCode(node.code)
      expect([4, 6]).toContain(digits.length)
      expect(node.leafCount).toBeGreaterThan(0)
      expect(node.description.length).toBeGreaterThan(0)
    }
  })
})

describe('findHtsGeneral', () => {
  it('finds a known code with dots', async () => {
    const { lines } = await loadHtsGeneral()
    const line = findHtsGeneral(lines, KNOWN_CODE)
    expect(line).toBeDefined()
    expect(line?.[0]).toBe(KNOWN_CODE)
  })

  it('finds the same code without dots', async () => {
    const { lines } = await loadHtsGeneral()
    const line = findHtsGeneral(lines, normalizeHtsCode(KNOWN_CODE))
    expect(line).toBeDefined()
    expect(line?.[0]).toBe(KNOWN_CODE)
  })

  it('returns undefined for a code the catalogue does not carry', async () => {
    const { lines } = await loadHtsGeneral()
    expect(findHtsGeneral(lines, '0000.00.00.00')).toBeUndefined()
  })
})

describe('searchHtsGeneral', () => {
  const LINES: readonly HtsGeneralLine[] = [
    ['0101.21.00.10', 0, 'Purebred breeding animals / Males'],
    ['0101.21.00.20', 0, 'Purebred breeding animals / Females'],
    ['0101.30.00.00', 6.8, 'Asses'],
    ['8481.80.10.20', 4, 'Bath and shower faucets'],
    ['8481.80.30.10', 5.6, 'Gate type'],
  ]

  it('treats a digit query as a prefix match on the normalised code', () => {
    const results = searchHtsGeneral(LINES, '8481.80', 10)
    expect(results.map((line) => line[0])).toEqual(['8481.80.10.20', '8481.80.30.10'])
  })

  it('treats a word query as a case-insensitive description substring match', () => {
    const results = searchHtsGeneral(LINES, 'ASSES', 10)
    expect(results.map((line) => line[0])).toEqual(['0101.30.00.00'])
  })

  it('respects the limit', () => {
    const results = searchHtsGeneral(LINES, '0101', 1)
    expect(results).toHaveLength(1)
    expect(results[0]?.[0]).toBe('0101.21.00.10')
  })

  it('returns the first `limit` lines for an empty query', () => {
    expect(searchHtsGeneral(LINES, '', 2)).toEqual(LINES.slice(0, 2))
    expect(searchHtsGeneral(LINES, '   ', 3)).toEqual(LINES.slice(0, 3))
  })
})

describe('normalizeHtsCode', () => {
  it('strips everything but digits', () => {
    expect(normalizeHtsCode('8481.80.10.20')).toBe('8481801020')
    expect(normalizeHtsCode('8481-80-10-20')).toBe('8481801020')
  })
})

describe('listHtsChildren', () => {
  it('a null parent returns only 4-digit nodes and no leaves', async () => {
    const catalogue = await loadHtsGeneral()
    const { nodes, leaves } = listHtsChildren(catalogue, null)
    expect(nodes.length).toBeGreaterThan(0)
    expect(leaves).toEqual([])
    for (const node of nodes) {
      expect(normalizeHtsCode(node.code)).toHaveLength(4)
    }
  })

  it('a 4-digit parent returns its 6-digit nodes and no leaves', async () => {
    const catalogue = await loadHtsGeneral()
    const { nodes, leaves } = listHtsChildren(catalogue, '8481')
    expect(leaves).toEqual([])
    expect(nodes.length).toBeGreaterThan(0)
    for (const node of nodes) {
      expect(normalizeHtsCode(node.code)).toHaveLength(6)
    }
    expect(nodes.map((node) => node.code)).toContain('8481.80')
  })

  it('a 6-digit parent returns its leaves with a SHORT description and no nodes', async () => {
    const catalogue = await loadHtsGeneral()
    const { nodes, leaves } = listHtsChildren(catalogue, '848180')
    expect(nodes).toEqual([])
    expect(leaves.length).toBeGreaterThan(0)

    const line = leaves.find((leaf) => leaf[0] === '8481.80.90.05')
    expect(line).toBeDefined()
    expect(line?.[2]).not.toMatch(/^Taps, cocks/)
    expect(line?.[2]).toBe('Solenoid valves')

    const { lines } = catalogue
    const fullChain = findHtsGeneral(lines, '8481.80.90.05')
    expect(fullChain?.[2]).toMatch(/^Taps, cocks/)
  })

  it('an unknown code, or an 8-digit code, returns empty on both', async () => {
    const catalogue = await loadHtsGeneral()
    expect(listHtsChildren(catalogue, '0000')).toEqual({ nodes: [], leaves: [] })
    expect(listHtsChildren(catalogue, '8481.80.90')).toEqual({ nodes: [], leaves: [] })
  })
})

// Regression coverage for the coordinator's 2026-09-01 follow-up: deep lines
// used to read as a run of "Other / Other / Other / Other / Other" (e.g.
// 7326.90.86.88), or lost their most informative segment - the heading - to
// the character cap (7318.15.80.30 used to drop it while its sibling
// 7318.15.80.20 kept it, purely because .30's chain was a few characters
// longer). The full chain now always leads with the heading and only drops
// "Other" noise, never the heading or the leaf.
describe('buildDescription regression: real generated lines', () => {
  it('collapses a run of "Other" ancestors down to heading + leaf (7326.90.86.88)', async () => {
    const { lines } = await loadHtsGeneral()
    const line = findHtsGeneral(lines, '7326.90.86.88')
    expect(line).toBeDefined()
    expect(line?.[2]).toBe('Other articles of iron or steel / Other')
  })

  it('both siblings under the same 8-digit code now share the same leading heading', async () => {
    const { lines } = await loadHtsGeneral()
    const short = findHtsGeneral(lines, '7318.15.80.20')
    const long = findHtsGeneral(lines, '7318.15.80.30')
    expect(short).toBeDefined()
    expect(long).toBeDefined()

    const shortHeading = short?.[2].split(' / ')[0]
    const longHeading = long?.[2].split(' / ')[0]
    expect(shortHeading).toBe(longHeading)
    expect(shortHeading?.length).toBeGreaterThan(10)
  })
})

// Pure flattening logic, tested against the script's own exports rather than
// a live fetch. Importing the script module here does not run `main` - its
// entrypoint guard compares `import.meta.url` against `process.argv[1]`,
// which under vitest is the test runner, never this file.
describe('flattenHtsRows (packages/lib/scripts/fetch-hts-general.ts)', () => {
  function row(overrides: Partial<RawHtsRow>): RawHtsRow {
    return { htsno: '', indent: '0', description: '', general: '', ...overrides }
  }

  it('inherits the general rate from the nearest ancestor that states one', () => {
    const rows: RawHtsRow[] = [
      row({ htsno: '0101', indent: '0', description: 'Live horses, asses, mules and hinnies:' }),
      row({ htsno: '', indent: '1', description: 'Horses:' }),
      row({
        htsno: '0101.21.00',
        indent: '2',
        description: 'Purebred breeding animals',
        general: 'Free',
      }),
      row({ htsno: '0101.21.00.10', indent: '3', description: 'Males' }),
      row({ htsno: '0101.21.00.20', indent: '3', description: 'Females' }),
    ]

    const { nodes, lines, stats } = flattenHtsRows(rows)

    expect(nodes).toEqual([
      ['0101', 'Live horses, asses, mules and hinnies'],
      ['0101.21', 'Horses / Purebred breeding animals'],
    ])
    expect(lines).toEqual([
      ['0101.21.00.10', 0, 'Males'],
      ['0101.21.00.20', 0, 'Females'],
    ])
    expect(stats).toMatchObject({
      rowsRead: 5,
      tenDigitLines: 2,
      emitted: 2,
      emittedFree: 2,
      emittedPercent: 0,
      skippedNoRate: 0,
      skippedSpecificOrCompound: 0,
      nodesEmitted: 2,
      nodesSkippedNoLeaves: 0,
    })
  })

  it('emits a stated percentage rate and skips specific/compound and rateless lines', () => {
    const rows: RawHtsRow[] = [
      row({ htsno: '0101', indent: '0', description: 'Live horses:' }),
      row({
        htsno: '0101.30.00.00',
        indent: '1',
        description: 'Asses',
        general: '6.8%',
      }),
      row({
        htsno: '0101.40.00.00',
        indent: '1',
        description: 'Compound duty line',
        general: '20% + 0.4 cents/kg',
      }),
      row({
        htsno: '0101.50.00.00',
        indent: '1',
        description: 'Specific duty line',
        general: '0.4 cents/kg',
      }),
      row({
        htsno: '0101.60.00.00',
        indent: '1',
        description: 'No rate anywhere in its ancestry',
      }),
    ]

    const { nodes, lines, stats } = flattenHtsRows(rows)

    // The heading node and the "0101.30" subheading node (the merged
    // 6/8/10-digit "Asses" row) both survive - each has one leaf. The three
    // 6-digit nodes for the compound-duty, specific-duty and rateless lines
    // do not, since none of them ends up with an emitted leaf.
    expect(nodes).toEqual([
      ['0101', 'Live horses'],
      ['0101.30', 'Asses'],
    ])
    expect(lines).toEqual([['0101.30.00.00', 6.8, 'Asses']])
    expect(stats).toMatchObject({
      rowsRead: 5,
      tenDigitLines: 4,
      emitted: 1,
      emittedFree: 0,
      emittedPercent: 1,
      skippedNoRate: 1,
      skippedSpecificOrCompound: 2,
      nodesEmitted: 2,
      nodesSkippedNoLeaves: 3,
    })
  })

  it('an uncoded chain ahead of an 8-digit item folds into the subheading node, not the leaf', () => {
    const rows: RawHtsRow[] = [
      row({
        htsno: '8481',
        indent: '0',
        description: 'Taps, cocks, valves and similar appliances:',
      }),
      row({ htsno: '', indent: '1', description: 'Other appliances:' }),
      row({ htsno: '', indent: '2', description: 'Hand operated:' }),
      row({
        htsno: '8481.80.10',
        indent: '3',
        description: 'Of copper',
        general: '4%',
      }),
      row({ htsno: '8481.80.10.20', indent: '4', description: 'Bath and shower faucets' }),
    ]

    const { nodes, lines } = flattenHtsRows(rows)

    // No separate 6-digit row exists here - "8481.80.10" (8 digits) is the
    // first row to reach 6+ digits, so IT establishes the subheading node,
    // and its own text ("Of copper") folds into the NODE alongside the
    // uncoded intermediates ahead of it, not into the leaf below it.
    expect(nodes).toEqual([
      ['8481', 'Taps, cocks, valves and similar appliances'],
      ['8481.80', 'Other appliances / Hand operated / Of copper'],
    ])
    // Nothing remains between the establishing row and the leaf, so the
    // short description is the leaf's own text alone.
    expect(lines).toEqual([['8481.80.10.20', 4, 'Bath and shower faucets']])
  })

  it('a genuinely coded 6-digit row establishes the subheading; everything below it, including an 8-digit item, folds into the leaf', () => {
    const rows: RawHtsRow[] = [
      row({ htsno: '8481', indent: '0', description: 'Taps, cocks, valves:' }),
      row({ htsno: '8481.80', indent: '1', description: 'Other appliances:' }),
      row({ htsno: '', indent: '2', description: 'Hand operated:' }),
      row({
        htsno: '8481.80.10',
        indent: '3',
        description: 'Of copper',
        general: '4%',
      }),
      row({ htsno: '8481.80.10.20', indent: '4', description: 'Bath and shower faucets' }),
    ]

    const { nodes, lines } = flattenHtsRows(rows)

    // "8481.80" is coded at exactly 6 digits, so it establishes the
    // subheading node on its own - nothing folds in ahead of it, since it is
    // the immediate child of the heading.
    expect(nodes).toEqual([
      ['8481', 'Taps, cocks, valves'],
      ['8481.80', 'Other appliances'],
    ])
    // Everything below "8481.80" - the uncoded "Hand operated:", the 8-digit
    // item's own text, and the leaf's own text - folds into the short
    // description, in order.
    expect(lines).toEqual([
      ['8481.80.10.20', 4, 'Hand operated / Of copper / Bath and shower faucets'],
    ])
  })

  it('ignores an unrelated sibling branch when truncating the ancestor stack', () => {
    const rows: RawHtsRow[] = [
      row({ htsno: '0101', indent: '0', description: 'Heading:' }),
      row({ htsno: '0101.10.00', indent: '1', description: 'First branch', general: '1%' }),
      row({ htsno: '0101.10.00.10', indent: '2', description: 'First branch line' }),
      row({ htsno: '0101.20.00', indent: '1', description: 'Second branch', general: '2%' }),
      row({ htsno: '0101.20.00.10', indent: '2', description: 'Second branch line' }),
    ]

    const { nodes, lines } = flattenHtsRows(rows)

    expect(nodes).toEqual([
      ['0101', 'Heading'],
      ['0101.10', 'First branch'],
      ['0101.20', 'Second branch'],
    ])
    expect(lines).toEqual([
      ['0101.10.00.10', 1, 'First branch line'],
      ['0101.20.00.10', 2, 'Second branch line'],
    ])
  })

  it('drops a middle "Other" segment but keeps a trailing one (the leaf)', () => {
    const rows: RawHtsRow[] = [
      row({ htsno: '7326', indent: '0', description: 'Other articles of iron or steel:' }),
      row({ htsno: '7326.90', indent: '1', description: 'Other:', general: '2.9%' }),
      row({ htsno: '', indent: '2', description: 'Other:' }),
      row({ htsno: '', indent: '3', description: 'Other:' }),
      row({ htsno: '7326.90.86.88', indent: '4', description: 'Other' }),
    ]

    const { nodes, lines } = flattenHtsRows(rows)

    expect(nodes).toEqual([
      ['7326', 'Other articles of iron or steel'],
      ['7326.90', 'Other'],
    ])
    // Below the subheading: two uncoded "Other:" intermediates plus the
    // leaf's own "Other" - all but the last are dropped.
    expect(lines).toEqual([['7326.90.86.88', 2.9, 'Other']])
  })

  it('handles an indent that jumps by more than one level (real USITC data does this)', () => {
    const rows: RawHtsRow[] = [
      row({ htsno: '8481', indent: '0', description: 'Heading:' }),
      row({
        htsno: '8481.10.00',
        indent: '1',
        description: 'Pressure-reducing valves',
        general: '2%',
      }),
      row({ htsno: '8481.10.00.20', indent: '3', description: 'Hydraulic fluid power type' }),
    ]

    const { nodes, lines } = flattenHtsRows(rows)

    expect(nodes).toEqual([
      ['8481', 'Heading'],
      ['8481.10', 'Pressure-reducing valves'],
    ])
    expect(lines).toEqual([['8481.10.00.20', 2, 'Hydraulic fluid power type']])
  })

  it("falls back to the subheading node's own last segment for a merged 6/8/10-digit row", () => {
    const rows: RawHtsRow[] = [
      row({ htsno: '0101', indent: '0', description: 'Live horses:' }),
      row({ htsno: '0101.30.00.00', indent: '1', description: 'Asses', general: '6.8%' }),
    ]

    const { nodes, lines } = flattenHtsRows(rows)

    expect(nodes).toEqual([
      ['0101', 'Live horses'],
      ['0101.30', 'Asses'],
    ])
    // The subheading and the leaf are the same physical row, so there is no
    // chain "below" it - the short description falls back to the subheading
    // node's own last segment rather than being blank.
    expect(lines).toEqual([['0101.30.00.00', 6.8, 'Asses']])
  })
})

describe('capDescription', () => {
  it('joins segments with " / " when they already fit', () => {
    expect(capDescription(['A', 'B', 'C'], 200)).toBe('A / B / C')
  })

  it('drops middle segments first, keeping the first and last', () => {
    const segments = ['Heading', 'Middle one', 'Middle two', 'Leaf']
    const result = capDescription(segments, 24)
    expect(result.length).toBeLessThanOrEqual(24)
    expect(result).toBe('Heading / Leaf')
  })

  it('truncates the last segment when the first and last alone still exceed the cap', () => {
    const result = capDescription(['Heading', 'w'.repeat(200)], 20)
    expect(result).toHaveLength(20)
    expect(result).toBe(`Heading / ${'w'.repeat(20 - 'Heading'.length - ' / '.length)}`)
  })

  it('returns a single segment as-is when it fits, truncated when it does not', () => {
    expect(capDescription(['Only one'], 200)).toBe('Only one')
    expect(capDescription(['w'.repeat(50)], 20)).toHaveLength(20)
  })

  it('returns an empty string for no segments', () => {
    expect(capDescription([], 200)).toBe('')
  })
})

describe('buildFoldedDescription', () => {
  it('cleans and joins segments, trailing colons stripped', () => {
    const segments = ['Other appliances:', 'Hand operated:', 'Of copper']
    expect(buildFoldedDescription(segments, 160)).toBe(
      'Other appliances / Hand operated / Of copper'
    )
  })

  it('drops every "Other" segment except the last', () => {
    const segments = ['Other:', 'Other:', 'Other']
    expect(buildFoldedDescription(segments, 160)).toBe('Other')
  })

  it('caps the joined result, protecting the first and last segments', () => {
    const segments = ['Heading segment', 'w'.repeat(200), 'Leaf segment']
    const result = buildFoldedDescription(segments, 40)
    expect(result.length).toBeLessThanOrEqual(40)
    expect(result).toBe('Heading segment / Leaf segment')
  })

  it('returns an empty string for no segments', () => {
    expect(buildFoldedDescription([], 160)).toBe('')
  })
})

describe('listHtsChildren with a search term', () => {
  it('prunes every level to nodes with a match and reports the matched count', async () => {
    const catalogue = await loadHtsGeneral()
    const root = listHtsChildren(catalogue, null, '8481.80.90')
    expect(root.nodes.map((n) => n.code)).toEqual(['8481'])
    const sub = listHtsChildren(catalogue, '8481', '8481.80.90')
    expect(sub.nodes.map((n) => n.code)).toEqual(['8481.80'])
    const leaves = listHtsChildren(catalogue, '8481.80', '8481.80.90')
    expect(leaves.leaves.length).toBeGreaterThan(0)
    expect(leaves.leaves.every((l) => l[0].startsWith('8481.80.90'))).toBe(true)
    expect(sub.nodes[0]?.leafCount).toBe(leaves.leaves.length)
  })

  it('matches a heading word against every line beneath it', async () => {
    const catalogue = await loadHtsGeneral()
    const root = listHtsChildren(catalogue, null, 'solenoid')
    expect(root.nodes.some((n) => n.code === '8481')).toBe(true)
    expect(listHtsChildren(catalogue, null, 'zzzz-no-such-thing').nodes).toEqual([])
  })
})

describe('headings the export prints only as `NNNN.00`', () => {
  // Regression: `8503.00.95.20` is in the generated file, but heading 8503 is
  // not split into subheadings so the USITC export prints no 4-digit row for
  // it. Without a synthesized heading node the tree root carried nothing for
  // 8503, and because a search PRUNES the tree, searching the full code
  // matched the leaf and then dropped it - the dialog said "No matches" for a
  // code the catalogue holds.
  it('reaches a line under an unsplit heading by browsing', async () => {
    const catalogue = await loadHtsGeneral()

    const root = listHtsChildren(catalogue, null, '')
    const heading = root.nodes.find((node) => node.code === '8503')
    expect(heading).toBeDefined()
    expect(heading?.leafCount).toBeGreaterThan(0)

    const sub = listHtsChildren(catalogue, '8503', '')
    expect(sub.nodes.map((node) => node.code)).toEqual(['8503.00'])

    const leaves = listHtsChildren(catalogue, '8503.00', '')
    expect(leaves.leaves.map((line) => line[0])).toContain('8503.00.95.20')
  })

  it('finds the same line by searching its full code, in either spelling', async () => {
    const catalogue = await loadHtsGeneral()

    for (const q of ['8503.00.9520', '8503.00.95.20', '8503009520']) {
      expect(listHtsChildren(catalogue, null, q).nodes.map((n) => n.code)).toEqual(['8503'])
      expect(listHtsChildren(catalogue, '8503', q).nodes.map((n) => n.code)).toEqual(['8503.00'])
      expect(listHtsChildren(catalogue, '8503.00', q).leaves.map((l) => l[0])).toEqual([
        '8503.00.95.20',
      ])
    }
  })

  it('every line in the catalogue is reachable from a heading node', async () => {
    const catalogue = await loadHtsGeneral()
    const headings = new Set(
      listHtsChildren(catalogue, null, '').nodes.map((node) => normalizeHtsCode(node.code))
    )
    const orphans = catalogue.lines.filter(
      (line) => !headings.has(normalizeHtsCode(line[0]).slice(0, 4))
    )
    expect(orphans).toEqual([])
  })

  it('a synthesized heading does not repeat itself in a line description', async () => {
    const catalogue = await loadHtsGeneral()
    const line = findHtsGeneral(catalogue.lines, '8503.00.95.20')
    expect(line?.[2]).toBe(
      'Parts suitable for use solely or principally with the machines of heading 8501 or 8502 / Parts of motors'
    )
  })

  it('repeat node rows at one code are deduped', async () => {
    const catalogue = await loadHtsGeneral()
    // Chapter 98 prints `9801.00` fourteen times with different text.
    const seen = new Set<string>()
    for (const node of catalogue.nodes) {
      const digits = normalizeHtsCode(node.code)
      expect(seen.has(digits)).toBe(false)
      seen.add(digits)
    }
  })
})
