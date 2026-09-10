// packages/lib/src/banking/feed/descriptor.ts

/**
 * `description` → its STRUCTURE. The read-time counterpart to
 * `normalizeMatchKey`, and deliberately the opposite kind of function.
 *
 * `normalizeMatchKey` throws information away to produce a stable grouping key.
 * This keeps all of it and only says where the seams are, so the review drawer
 * can show a reviewer what a line is made of and let them build a rule out of
 * one part of it.
 *
 * 🛑 **Nothing here is ever stored.** `matchKey` is computed once at ingest and
 * never recomputed, which is why every improvement to it needs a backfill to
 * reach rows already in the table. A second stored derivation would double that
 * debt for something that is pure presentation, so this runs at read time in
 * both the browser and the server and improves for every existing row the
 * moment it changes.
 *
 * Pure and dependency-free, like its neighbour, so `banking/client.ts` can
 * re-export it to browser code.
 *
 * ## What the shapes are
 *
 * US banks print two families of descriptor. The tagged family is a run of
 * `LABEL:value` pairs padded into fixed columns, which is what ACH and wire
 * lines look like:
 *
 * ```
 * FEDERAL EXPRESS  DES:DEBIT      ID:EPA59327850   INDN:LFK Machinery LLC  CO ID:XXXXX27007 WEB
 * ```
 *
 * The untagged family is a merchant string and nothing else (`TABOOLA.COM LTD`,
 * `GOOGLE *ADS3197812385`). There is no delimiter and no quoting in either, so a
 * tag's value is "everything until the next tag starts" and that is the only
 * rule that works.
 */

/** The NACHA SEC codes a US bank prints at the end of an ACH descriptor. */
const SEC_CODES = [
  'WEB',
  'PPD',
  'CCD',
  'CTX',
  'TEL',
  'ARC',
  'BOC',
  'POP',
  'RCK',
  'IAT',
  'MTE',
  'POS',
  'SHR',
]

/**
 * Tag labels, LONGEST FIRST at any shared prefix.
 *
 * ⚠️ The ordering is load-bearing and pinned by tests: regex alternation is
 * leftmost-first at each scan position, so `CO ID` has to precede `ID` and
 * `BNF BK` has to precede `BNF`, or a wire's beneficiary bank is read as the
 * beneficiary and an ACH originator id is read as a trace number.
 */
const TAG_LABELS = [
  'ORIG CO NAME',
  'CO ENTRY DESCR',
  'CONFIRMATION#',
  'CONFIRMATION',
  'SERVICE REF',
  'DESC DATE',
  'PMT INFO',
  'PMT DET',
  'IND NAME',
  'WIRE TYPE',
  'SND BNK',
  'ORIG ID',
  'BNF BK',
  'IND ID',
  'CO ID',
  'TRACE',
  'CONF#',
  'CONF',
  'DATE',
  'TIME',
  'INDN',
  'ORIG',
  'TRN',
  'SEQ',
  'RFB',
  'OBI',
  'BNF',
  'DES',
  'SEC',
  'EED',
  'REF',
  'ID',
]

/**
 * Labels whose value is a per-payment MACHINE REFERENCE rather than something a
 * human reads. These are what {@link displayDescription} drops, and what makes
 * two occurrences of the same payee look like different lines.
 */
const REFERENCE_LABELS = new Set([
  'ID',
  'IND ID',
  'ORIG ID',
  'TRACE',
  'TRN',
  'SEQ',
  'REF',
  'SERVICE REF',
  'DESC DATE',
  'DATE',
  'TIME',
  'EED',
  'CONF',
  'CONF#',
  'CONFIRMATION',
  'CONFIRMATION#',
  'PMT INFO',
])

/** One `LABEL:value` pair, in the order the bank printed it. */
export interface BankDescriptorTag {
  /** Uppercased, internal whitespace collapsed. `CO ID`, never `CO  id`. */
  label: string
  value: string
  /** `true` when the value is a per-payment reference rather than a name. */
  isReference: boolean
}

export type BankDescriptorKind = 'ach' | 'wire' | 'card' | 'check' | 'zelle' | 'fee' | 'plain'

export interface ParsedBankDescriptor {
  /** The bank's line with runs of column padding collapsed. Never re-ordered. */
  text: string
  /** Everything before the first tag. The originator's own name, usually. */
  lead: string
  /**
   * Ordered, and duplicates are KEPT: a wire carries two `ID:` tags, one for
   * the beneficiary and one for their bank, and collapsing them into a record
   * silently discards the second.
   */
  tags: BankDescriptorTag[]
  /** The trailing NACHA entry class, when the line ends in one. */
  sec: string | null
  kind: BankDescriptorKind
}

const TAG_PATTERN = TAG_LABELS.map((label) =>
  label.replace(/ /g, '\\s+').replace(/#/g, '\\#')
).join('|')

const CARD_RE = /^(CHECKCARD|PURCHASE|POS |DEBIT CARD|CREDIT CARD|VISA|MASTERCARD|ATM)\b/i
const CHECK_RE = /^(CHECK|CHK)\s*#?\s*\d+\s*$/i
const ZELLE_RE = /\bZELLE\b/i
const FEE_RE = /\b(FEE|SERVICE CHARGE|WAIVER|INTEREST|REWARDS?|RWDS)\b/i

/** Find the first tag with `label`, or `null`. Labels are uppercase. */
export function findDescriptorTag(
  parsed: ParsedBankDescriptor,
  label: string
): BankDescriptorTag | null {
  return parsed.tags.find((tag) => tag.label === label) ?? null
}

/**
 * Split a bank `description` into its leading text and its `LABEL:value` tags.
 *
 * Never throws and never returns null: an untagged merchant string parses to
 * one lead and no tags, which is a legitimate answer and the common one (43% of
 * the real feed this was written against).
 */
export function parseBankDescriptor(description: string | null | undefined): ParsedBankDescriptor {
  const text = (description ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return { text: '', lead: '', tags: [], sec: null, kind: 'plain' }

  const matcher = new RegExp(`(?:^|\\s|\\b)(${TAG_PATTERN})\\s*:`, 'gi')
  const hits: { label: string; start: number; end: number }[] = []
  for (let match = matcher.exec(text); match; match = matcher.exec(text)) {
    const raw = match[1] ?? ''
    const label = raw.toUpperCase().replace(/\s+/g, ' ')
    hits.push({ label, start: match.index + match[0].indexOf(raw), end: matcher.lastIndex })
  }

  const first = hits[0]
  const lead = (first ? text.slice(0, first.start) : text).trim()
  const tags: BankDescriptorTag[] = hits.map((hit, index) => ({
    label: hit.label,
    value: text.slice(hit.end, hits[index + 1]?.start ?? text.length).trim(),
    isReference: REFERENCE_LABELS.has(hit.label),
  }))

  // The SEC code trails the LAST tag's value, not the raw string, so it is
  // pulled off that value and the value is shortened to match. Requiring a
  // space in the value first is what stops a bare `CO ID:WEB` losing its whole
  // value to a code that was never there.
  let sec: string | null = null
  const last = tags[tags.length - 1]
  const tail = last ? last.value : lead
  const lastToken = tail.split(' ').pop() ?? ''
  if (lastToken && SEC_CODES.includes(lastToken.toUpperCase()) && tail.includes(' ')) {
    sec = lastToken.toUpperCase()
    const trimmed = tail.slice(0, tail.length - lastToken.length).trim()
    if (last) last.value = trimmed
  }

  return { text, lead, tags, sec, kind: classifyDescriptor({ lead, tags, sec, text }) }
}

function classifyDescriptor(parts: {
  lead: string
  tags: BankDescriptorTag[]
  sec: string | null
  text: string
}): BankDescriptorKind {
  const has = (label: string) => parts.tags.some((tag) => tag.label === label)
  if (has('WIRE TYPE') || has('TRN') || has('BNF')) return 'wire'
  if (has('CO ID') || has('DES') || has('INDN') || has('ORIG CO NAME') || parts.sec) return 'ach'
  if (ZELLE_RE.test(parts.text)) return 'zelle'
  if (CHECK_RE.test(parts.text)) return 'check'
  if (CARD_RE.test(parts.text)) return 'card'
  if (FEE_RE.test(parts.text)) return 'fee'
  return 'plain'
}

/**
 * The line with its machine references removed, for DISPLAY only.
 *
 * Returns `null` when there is nothing better to show than the bank's own
 * string, which is the honest answer for the untagged half of a feed:
 * `TABOOLA.COM LTD` is already the best available label. 🛑 Callers render
 * `displayDescription(d) ?? d` and never drop the original.
 *
 * ⚠️ Never a grouping key and never something to reconcile against. Two
 * different originators can produce the same display string; that is fine for a
 * label and would be a miscoding as a key. {@link parseBankDescriptor} is the
 * seam a rule is built from, and `normalizeMatchKey` is the key.
 */
export function displayDescription(description: string | null | undefined): string | null {
  const parsed = parseBankDescriptor(description)
  if (!parsed.text) return null

  if (parsed.kind === 'wire') {
    const party = findDescriptorTag(parsed, 'BNF') ?? findDescriptorTag(parsed, 'ORIG')
    const type = findDescriptorTag(parsed, 'WIRE TYPE')
    const label = type ? titleish(type.value) : 'Wire'
    return party?.value ? `${label} · ${party.value}` : label
  }

  if (parsed.kind === 'ach' && parsed.lead) {
    const entry = findDescriptorTag(parsed, 'DES') ?? findDescriptorTag(parsed, 'CO ENTRY DESCR')
    // A `DES` that merely repeats the originator's name adds nothing:
    // `ADP Tax DES:ADP Tax` should read `ADP Tax`, not `ADP Tax · ADP Tax`.
    if (!entry?.value || sameish(entry.value, parsed.lead)) return parsed.lead
    return `${parsed.lead} · ${entry.value}`
  }

  return null
}

/** `WIRE OUT` → `Wire out`. Only ever applied to the bank's own fixed vocabulary. */
function titleish(value: string): string {
  const lower = value.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

function sameish(a: string, b: string): boolean {
  const fold = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
  return fold(a) === fold(b)
}
