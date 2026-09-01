// packages/lib/src/bom/tariff-hts-general.ts

/**
 * The generated half of the tariff starter catalogue
 * (plans/money/tasks/32-tariff-starter-catalogue.md §1.4, §7 (c), §9).
 *
 * `tariff-hts-general.json` is a flattening of the whole HTSUS Column 1
 * general schedule into a three-level tree - a 4-digit heading, a 6-digit
 * subheading, and the 10-digit lines under it - written by
 * `packages/lib/scripts/fetch-hts-general.ts` and checked in. It is
 * generated, never edited by hand: rerun the script on a new HTS revision and
 * commit the diff.
 *
 * **Lazy on purpose.** The JSON parses in a few milliseconds, but most
 * process boots (a web request, a worker job unrelated to tariffs, a script)
 * never touch it, so there is no reason to pay that parse on every boot of
 * every process. `loadHtsGeneral` imports it on first call, composes the
 * full-chain `lines` and the children index from the on-disk shape, and
 * memoises the result for the lifetime of the process.
 *
 * 🛑 **Never export this module (or the JSON) through `bom/client.ts`.** The
 * whole point of the split in §1.4 is that the web bundle never carries the
 * generated schedule; the browser reaches it through the router, which calls
 * `loadHtsGeneral` and `listHtsChildren` server-side.
 */

/**
 * One 10-digit HTSUS line: the code as printed, the Column 1 general rate as
 * a percentage (0 = Free), a description. In `HtsGeneralCatalogue.lines` the
 * description is the FULL chain (heading / subheading / short label); from
 * `listHtsChildren`'s `leaves` it is the SHORT label alone.
 */
export type HtsGeneralLine = readonly [code: string, rate: number, description: string]

/** A 4- or 6-digit level of the schedule, for browsing. */
export interface HtsNode {
  /** As printed: `'0101'` for a heading, `'0101.21'` for a subheading. */
  code: string
  description: string
  /** 10-digit lines under this node, after the generator's skip rules. */
  leafCount: number
}

/** The generated catalogue's shape on disk: `nodes` before `lines`, both document order. */
interface RawHtsGeneralCatalogue {
  fetchedAt: string
  source: string
  nodes: readonly (readonly [code: string, description: string])[]
  lines: readonly HtsGeneralLine[]
}

/** The composed, in-memory catalogue `loadHtsGeneral` returns. */
export interface HtsGeneralCatalogue {
  fetchedAt: string
  source: string
  /** Full-chain descriptions (heading / subheading / short label), unchanged contract. */
  lines: readonly HtsGeneralLine[]
  /** 4- and 6-digit nodes, document order. */
  nodes: readonly HtsNode[]
}

/**
 * The children of one catalogue level, kept alongside the composed catalogue
 * so `listHtsChildren` never has to re-derive a short label from a full
 * chain (lossy - `capDescription` drops segments, and "Other" folding is not
 * invertible).
 */
interface CatalogueChildIndex {
  headingNodes: readonly HtsNode[]
  subheadingNodesByHeading: ReadonlyMap<string, HtsNode[]>
  /** Keyed by 6-digit subheading digits. Lines here carry the SHORT label. */
  shortLeavesBySubheading: ReadonlyMap<string, HtsGeneralLine[]>
}

/** `childIndexes.get(catalogue)` is set once, by `loadHtsGeneral`, for its own return value only. */
const childIndexes = new WeakMap<HtsGeneralCatalogue, CatalogueChildIndex>()

let cached: HtsGeneralCatalogue | undefined

/** `true` for a segment that is exactly "Other" once trimmed, case-insensitive. */
function isOtherSegment(segment: string): boolean {
  return segment.trim().toLowerCase() === 'other'
}

/**
 * Joins segments with ` / `, capped at `maxLength` characters, protecting the
 * first and last segments - mirrors `capDescription` in
 * `scripts/fetch-hts-general.ts`, kept as a private copy here so the loader
 * has no runtime dependency on the maintainer's script.
 */
function capDescription(segments: readonly string[], maxLength: number): string {
  const parts = segments.filter((segment) => segment.length > 0)
  if (parts.length === 0) return ''
  if (parts.length === 1) {
    const only = parts[0] ?? ''
    return only.length > maxLength ? only.slice(0, maxLength) : only
  }

  const kept = [...parts]
  let joined = kept.join(' / ')
  while (joined.length > maxLength && kept.length > 2) {
    kept.splice(1, 1)
    joined = kept.join(' / ')
  }
  if (joined.length > maxLength) {
    const first = kept[0] ?? ''
    const last = kept[kept.length - 1] ?? ''
    const budget = maxLength - first.length - ' / '.length
    joined = budget > 0 ? `${first} / ${last.slice(0, budget)}` : first.slice(0, maxLength)
  }
  return joined
}

/**
 * The full chain for one line: the heading, then the subheading and the
 * short label with a bare "Other" dropped unless it is the last of those two
 * - the subheading node's own text is often just "Other" once the leaf below
 * it says more, and repeating it reads as noise (regression case:
 * `7326.90.86.88` reads "Other articles of iron or steel / Other", not
 * "... / Other / Other"). Capped at 200, protecting the heading and the leaf.
 */
function composeFullChain(
  headingDescription: string,
  subheadingDescription: string,
  shortDescription: string
): string {
  const tail = [subheadingDescription, shortDescription].filter((segment) => segment.length > 0)
  const lastIndex = tail.length - 1
  const filteredTail = tail.filter(
    (segment, index) => index === lastIndex || !isOtherSegment(segment)
  )
  const segments = headingDescription ? [headingDescription, ...filteredTail] : filteredTail
  return capDescription(segments, 200)
}

/** Composes the in-memory catalogue and its children index from the on-disk shape. */
function composeCatalogue(raw: RawHtsGeneralCatalogue): HtsGeneralCatalogue {
  const headingDescByCode = new Map<string, string>()
  const subheadingDescByCode = new Map<string, string>()
  for (const [code, description] of raw.nodes) {
    const digits = normalizeHtsCode(code)
    if (digits.length === 4) headingDescByCode.set(digits, description)
    else if (digits.length === 6) subheadingDescByCode.set(digits, description)
  }

  const leafCounts = new Map<string, number>()
  const shortLeavesBySubheading = new Map<string, HtsGeneralLine[]>()
  for (const line of raw.lines) {
    const digits = normalizeHtsCode(line[0])
    const headingDigits = digits.slice(0, 4)
    const subheadingDigits = digits.slice(0, 6)
    leafCounts.set(headingDigits, (leafCounts.get(headingDigits) ?? 0) + 1)
    leafCounts.set(subheadingDigits, (leafCounts.get(subheadingDigits) ?? 0) + 1)
    const bucket = shortLeavesBySubheading.get(subheadingDigits)
    if (bucket) bucket.push(line)
    else shortLeavesBySubheading.set(subheadingDigits, [line])
  }

  const nodes: HtsNode[] = raw.nodes.map(([code, description]) => {
    const digits = normalizeHtsCode(code)
    return { code, description, leafCount: leafCounts.get(digits) ?? 0 }
  })

  const lines: HtsGeneralLine[] = raw.lines.map(([code, rate, shortDescription]) => {
    const digits = normalizeHtsCode(code)
    const headingDescription = headingDescByCode.get(digits.slice(0, 4)) ?? ''
    const subheadingDescription = subheadingDescByCode.get(digits.slice(0, 6)) ?? ''
    return [
      code,
      rate,
      composeFullChain(headingDescription, subheadingDescription, shortDescription),
    ]
  })

  const catalogue: HtsGeneralCatalogue = {
    fetchedAt: raw.fetchedAt,
    source: raw.source,
    lines,
    nodes,
  }

  const headingNodes = nodes.filter((node) => normalizeHtsCode(node.code).length === 4)
  const subheadingNodesByHeading = new Map<string, HtsNode[]>()
  for (const node of nodes) {
    const digits = normalizeHtsCode(node.code)
    if (digits.length !== 6) continue
    const headingDigits = digits.slice(0, 4)
    const bucket = subheadingNodesByHeading.get(headingDigits)
    if (bucket) bucket.push(node)
    else subheadingNodesByHeading.set(headingDigits, [node])
  }

  childIndexes.set(catalogue, { headingNodes, subheadingNodesByHeading, shortLeavesBySubheading })
  return catalogue
}

/**
 * Lazily imports the generated JSON on first call, composes the full-chain
 * `lines` and the children index, and memoises the result. Every subsequent
 * call in the same process returns the cached catalogue.
 */
export async function loadHtsGeneral(): Promise<HtsGeneralCatalogue> {
  if (!cached) {
    const mod = await import('./tariff-hts-general.json')
    const data = ((mod as { default?: unknown }).default ?? mod) as RawHtsGeneralCatalogue
    cached = composeCatalogue(data)
  }
  return cached
}

/** Strip everything but digits. */
export function normalizeHtsCode(code: string): string {
  return code.replace(/\D/g, '')
}

/** Exact match on normalised digits. */
export function findHtsGeneral(
  lines: readonly HtsGeneralLine[],
  code: string
): HtsGeneralLine | undefined {
  const normalized = normalizeHtsCode(code)
  return lines.find((line) => normalizeHtsCode(line[0]) === normalized)
}

/**
 * `q` with any digits in it is a PREFIX search on the normalised code;
 * otherwise a case-insensitive substring search on the description. Empty or
 * whitespace `q` returns the first `limit` lines. Results keep catalogue
 * order.
 */
export function searchHtsGeneral(
  lines: readonly HtsGeneralLine[],
  q: string,
  limit: number
): HtsGeneralLine[] {
  const trimmed = q.trim()
  if (!trimmed) return lines.slice(0, limit)

  if (/\d/.test(trimmed)) {
    const prefix = normalizeHtsCode(trimmed)
    const results: HtsGeneralLine[] = []
    for (const line of lines) {
      if (normalizeHtsCode(line[0]).startsWith(prefix)) {
        results.push(line)
        if (results.length >= limit) break
      }
    }
    return results
  }

  const needle = trimmed.toLowerCase()
  const results: HtsGeneralLine[] = []
  for (const line of lines) {
    if (line[2].toLowerCase().includes(needle)) {
      results.push(line)
      if (results.length >= limit) break
    }
  }
  return results
}

/**
 * The children of one level, for browsing the schedule as a tree: `parent`
 * `null` returns every 4-digit node; a 4-digit code returns its 6-digit
 * nodes; a 6-digit code returns its 10-digit lines, whose `description` is
 * the SHORT label (the chain below the subheading), not the full chain.
 * Anything else - an 8-digit code, an unknown code - returns empty on both.
 * Codes are matched on normalised digits, so either dotted spelling works.
 *
 * `catalogue` must come from `loadHtsGeneral` - the children index is built
 * once alongside the composed `lines` and keyed on that exact object, which
 * is also why this stays a plain lookup rather than a re-derivation from
 * `lines` (the short label a leaf carries here cannot be recovered from the
 * full chain `lines` composes it into).
 */
export function listHtsChildren(
  catalogue: HtsGeneralCatalogue,
  parent: string | null,
  q = ''
): { nodes: HtsNode[]; leaves: HtsGeneralLine[] } {
  const index = childIndexes.get(catalogue)
  if (!index) return { nodes: [], leaves: [] }

  // A search PRUNES the tree rather than flattening it: a node survives when at
  // least one line under it matches, and reports how many; a leaf survives when
  // it matches. Matching is `searchHtsGeneral`'s rule over the FULL chain, so a
  // word from the heading finds every line beneath it.
  const filter = q.trim() ? matchedLeafCounts(catalogue, q) : null
  const keep = (node: HtsNode): HtsNode | null => {
    if (!filter) return node
    const count = filter.byPrefix.get(normalizeHtsCode(node.code)) ?? 0
    return count > 0 ? { ...node, leafCount: count } : null
  }

  if (parent === null) {
    return { nodes: index.headingNodes.flatMap((n) => keep(n) ?? []), leaves: [] }
  }

  const digits = normalizeHtsCode(parent)
  if (digits.length === 4) {
    const nodes = index.subheadingNodesByHeading.get(digits) ?? []
    return { nodes: nodes.flatMap((n) => keep(n) ?? []), leaves: [] }
  }
  if (digits.length === 6) {
    const leaves = index.shortLeavesBySubheading.get(digits) ?? []
    return {
      nodes: [],
      leaves: filter
        ? leaves.filter((l) => filter.leaves.has(normalizeHtsCode(l[0])))
        : [...leaves],
    }
  }
  return { nodes: [], leaves: [] }
}

/** The lines `q` matches, and how many fall under each 4- and 6-digit prefix. */
function matchedLeafCounts(
  catalogue: HtsGeneralCatalogue,
  q: string
): { leaves: Set<string>; byPrefix: Map<string, number> } {
  const leaves = new Set<string>()
  const byPrefix = new Map<string, number>()
  for (const line of searchHtsGeneral(catalogue.lines, q, Number.POSITIVE_INFINITY)) {
    const digits = normalizeHtsCode(line[0])
    leaves.add(digits)
    for (const prefix of [digits.slice(0, 4), digits.slice(0, 6)]) {
      byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1)
    }
  }
  return { leaves, byPrefix }
}
