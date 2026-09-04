// packages/lib/src/import/ofx.ts

/**
 * OFX / QFX / QBO statement parsing, hand-written
 * (plans/bank-connection/05-file-import.md §5).
 *
 * All three formats parse identically: QFX is OFX plus `<INTU.BID>`, QBO is OFX
 * plus a QuickBooks bank id, and both extra tags are ignored here. What differs
 * is the SERIALISATION, and only in one way that matters:
 *
 * - **OFX 1.x is SGML.** Leaf elements are frequently unclosed
 *   (`<TRNAMT>-124.50` with no `</TRNAMT>`), so an XML parser fails outright.
 *   Aggregates (`<STMTTRN>`, `<LEDGERBAL>`, `<BANKACCTFROM>`) always close.
 * - **OFX 2.x is real XML.** Every element closes.
 *
 * A leaf read of `<TAG>` up to the next `<` covers both, so there is one code
 * path and no preprocessing step that could reorder or drop a transaction.
 *
 * ⚠️ **No dependency, deliberately.** The format is small and the two things a
 * general-purpose library gets subtly wrong - the decimal-to-minor-units parse
 * and the timezone-suffixed date - are exactly the two things this module is
 * careful about (05 §5 trap 5).
 *
 * 🛑 **Pure.** No database, no `crypto`, no Node built-ins, so this module is
 * reachable from `@auxx/lib/import/client` and the browser parses a dropped file
 * without a round trip. The router exposes the same function as
 * `banking.bankingImport.parseFile` so both sides run ONE parser.
 */

import { UnprocessableEntityError } from '../errors'

/**
 * The columns {@link toOfxImportRows} emits, in order.
 *
 * Deliberately the OFX tag names rather than our field keys: the wizard's
 * mapping step (and a saved header signature) then reads a stable, bank-neutral
 * header row that is the same for every institution.
 */
export const OFX_COLUMNS = [
  'FITID',
  'DTPOSTED',
  'TRNAMT',
  'NAME',
  'MEMO',
  'TRNTYPE',
  // Synthetic, and the one column that is not a tag: `bank_transaction` has ONE
  // `description` where OFX has two text fields, and dropping `MEMO` would throw
  // away `INVOICE 4432` - which is exactly the string a match is made on. Emitted
  // as its own column rather than folded into `NAME` so the mapping table still
  // shows what the bank actually sent in each field.
  'DESCRIPTION',
] as const
export type OfxColumn = (typeof OFX_COLUMNS)[number]

/** Which message set the statement came from. Bank and credit card differ. */
export type OfxAccountKind = 'bank' | 'creditcard'

/** The `<BANKACCTFROM>` / `<CCACCTFROM>` block, as far as it was given. */
export interface OfxAccount {
  kind: OfxAccountKind
  /** `<ACCTID>`. The account number, as text - a leading zero is part of it. */
  accountId: string | null
  /** `<BANKID>`, the routing number. Never present on a credit card. */
  routingNumber: string | null
  /** `<ACCTTYPE>`: CHECKING, SAVINGS, MONEYMRKT, CREDITLINE. */
  accountType: string | null
  /** The last four of {@link accountId}, which is what a bank account record holds. */
  last4: string | null
}

/**
 * `<LEDGERBAL>`: the statement balance and the date it was true.
 *
 * ✅ This is the reconciliation target from `03` §6, free - Stripe FC has no
 * running balance and the Balances product costs 10¢ a call.
 */
export interface OfxLedgerBalance {
  amountMinor: number
  asOf: string | null
}

/** One `<STMTTRN>`. */
export interface OfxTransaction {
  /** `<FITID>`, the bank-assigned id, unique within the account. */
  fitId: string | null
  /** `<DTPOSTED>` as a wall-clock `YYYY-MM-DD`. See {@link parseOfxDate}. */
  postedAt: string | null
  /**
   * `<TRNAMT>` in signed integer minor units, verbatim from the bank.
   *
   * 🛑 The sign is NOT flipped for a credit card. `amountMinor` on
   * `bank_transaction` mirrors what the bank said, and reconciling is comparing
   * the two; the liability half is handled by mapping the account to a liability
   * GL code (`BANK_ACCOUNT_GL_TYPES`), not by rewriting the statement.
   */
  amountMinor: number | null
  /** `<NAME>`, the payee. */
  name: string | null
  /** `<MEMO>`, often absent. */
  memo: string | null
  /** `<TRNTYPE>`: DEBIT, CREDIT, CHECK, FEE, XFER, ... */
  trnType: string | null
  /** 0-based position in the file, which is what makes two identical rows two rows. */
  ordinal: number
}

/** What {@link parseOfx} answers. */
export interface OfxDocument {
  form: 'sgml' | 'xml'
  account: OfxAccount | null
  /** `<CURDEF>`, upper-cased. */
  currency: string | null
  ledgerBalance: OfxLedgerBalance | null
  transactions: OfxTransaction[]
  /**
   * FITIDs that occur more than once IN THIS FILE, first-seen order.
   *
   * 🛑 Reported, never merged. A `FITID` is only promised to be unique within an
   * account at one institution, and a bank that reuses one is telling us its ids
   * cannot carry the dedupe on their own - collapsing the rows would lose money.
   * The importer's identity key would UPDATE the first row with the second, so
   * the upload surface warns before that happens.
   */
  duplicateFitIds: string[]
  /** True when every transaction carries a `FITID`, which is what lets mapping be skipped. */
  hasFitIds: boolean
}

/** The rows the shared importer consumes, identical in shape to the CSV path. */
export interface OfxImportRows {
  headers: { index: number; name: string }[]
  rows: string[][]
}

/**
 * Does this text look like OFX, QFX or QBO?
 *
 * ⚠️ **By content, never by filename** (05 §4). A `.txt` a customer renamed and
 * a `.qbo` that is really a CSV both have to land in the right parser.
 */
export function isOfxContent(text: string): boolean {
  const head = text.slice(0, 4096)
  return /OFXHEADER/i.test(head) || /<OFX[\s>]/i.test(head)
}

/**
 * Parse a whole OFX/QFX/QBO document.
 *
 * Throws `UnprocessableEntityError` when the text is not OFX at all or carries
 * no `<STMTTRN>` - both are states a person can fix by exporting again, and
 * answering an empty document instead would import nothing and say nothing.
 */
export function parseOfx(text: string): OfxDocument {
  if (!isOfxContent(text)) {
    throw new UnprocessableEntityError(
      'This file is not an OFX, QFX or QBO statement. It carries neither an OFXHEADER line ' +
        'nor an <OFX> element.'
    )
  }

  const body = sliceBody(text)
  const form = detectForm(text)
  const segments = splitAggregates(body, 'STMTTRN')

  if (segments.length === 0) {
    throw new UnprocessableEntityError(
      'This OFX file carries no <STMTTRN> transactions. Re-export it with a date range that ' +
        'contains activity.'
    )
  }

  const transactions = segments.map((segment, ordinal) => ({
    fitId: readLeaf(segment, 'FITID'),
    postedAt: parseOfxDate(readLeaf(segment, 'DTPOSTED')),
    amountMinor: parseOfxAmountToMinor(readLeaf(segment, 'TRNAMT')),
    name: readLeaf(segment, 'NAME'),
    memo: readLeaf(segment, 'MEMO'),
    trnType: readLeaf(segment, 'TRNTYPE'),
    ordinal,
  }))

  return {
    form,
    account: readAccount(body),
    currency: readLeaf(body, 'CURDEF')?.toUpperCase() ?? null,
    ledgerBalance: readLedgerBalance(body),
    transactions,
    duplicateFitIds: findDuplicateFitIds(transactions),
    hasFitIds: transactions.length > 0 && transactions.every((tx) => !!tx.fitId),
  }
}

/**
 * The parsed document as the wizard's `headers` + `rows`.
 *
 * 🛑 `TRNAMT` is emitted as **signed integer minor units**, not the decimal the
 * file held, and the bank importer maps it with `number:integer`. The
 * decimal-to-minor conversion is {@link parseOfxAmountToMinor}'s and happens
 * exactly once, in a tested function that never touches a float - handing the
 * decimal string on for `currency:major` to re-parse would put a second
 * conversion on the one boundary where the temptation is highest (05 §5 trap 2).
 *
 * A row whose amount or date did not parse keeps an EMPTY cell rather than being
 * dropped: the wizard's review step is where a bad cell is meant to surface, and
 * silently losing a statement line is the failure this whole subsystem exists to
 * prevent.
 */
export function toOfxImportRows(doc: OfxDocument): OfxImportRows {
  return {
    headers: OFX_COLUMNS.map((name, index) => ({ index, name })),
    rows: doc.transactions.map((tx) => [
      tx.fitId ?? '',
      tx.postedAt ?? '',
      tx.amountMinor == null ? '' : String(tx.amountMinor),
      tx.name ?? '',
      tx.memo ?? '',
      tx.trnType ?? '',
      joinDescription(tx),
    ]),
  }
}

/**
 * `NAME` and `MEMO` as the one string `bank_transaction.description` holds.
 *
 * A memo that merely repeats the payee is dropped, because a description of
 * `ACME SUPPLY CO ACME SUPPLY CO` normalises to a different match key than
 * `ACME SUPPLY CO` and would put the same merchant in two buckets.
 */
function joinDescription(tx: OfxTransaction): string {
  const name = tx.name?.trim() ?? ''
  const memo = tx.memo?.trim() ?? ''
  if (!memo || memo.toLowerCase() === name.toLowerCase()) return name
  if (!name) return memo
  return `${name} ${memo}`
}

/**
 * `<TRNAMT>` / `<BALAMT>` to signed integer minor units, without a float.
 *
 * 🛑 **Never through `Number()` on the decimal.** This is the one boundary where
 * data arrives as text and the temptation is highest (05 §5 trap 2, rule `G2`):
 * `Number('-124.50') * 100` is `-12450.000000000002` on some inputs, and a cent
 * lost here is a reconciliation that never ties and no way to find out why.
 *
 * Accepts what emitters actually produce:
 * - `-124.50`, `+124.50`, `124.50`
 * - `124.50-` (a trailing sign, seen in older exports)
 * - `-124,50` (a comma decimal point; OFX permits it and forbids grouping)
 * - `1,234.50` / `1.234,50` (grouping, which the spec forbids and banks emit
 *   anyway - the LAST separator is the decimal point and the other is grouping)
 *
 * More than `decimals` fraction digits rounds half away from zero on the
 * absolute value rather than truncating, so a `1.005` fee becomes `101`, not
 * `100`. Anything else answers `null`, which the caller renders as an empty cell
 * for the review step to catch.
 */
export function parseOfxAmountToMinor(raw: string | null | undefined, decimals = 2): number | null {
  if (raw == null) return null
  let text = String(raw).trim()
  if (!text) return null

  const negative = text.startsWith('-') || text.endsWith('-')
  text = text.replace(/^[+-]/, '').replace(/-$/, '').trim()
  if (!text) return null

  const dot = text.lastIndexOf('.')
  const comma = text.lastIndexOf(',')
  if (dot >= 0 && comma >= 0) {
    // Both present: the later one is the decimal point, the other is grouping.
    text = text.split(dot > comma ? ',' : '.').join('')
  }

  const point = Math.max(text.lastIndexOf('.'), text.lastIndexOf(','))
  const integerPart = point >= 0 ? text.slice(0, point) : text
  const fractionPart = point >= 0 ? text.slice(point + 1) : ''

  if (!/^\d*$/.test(integerPart) || !/^\d*$/.test(fractionPart)) return null
  if (!integerPart && !fractionPart) return null

  // One guard digit past the target precision decides the rounding.
  const padded = `${fractionPart}${'0'.repeat(decimals + 1)}`.slice(0, decimals + 1)
  const kept = padded.slice(0, decimals) || '0'
  const guard = Number(padded.slice(decimals) || '0')

  let minor = BigInt(integerPart || '0') * 10n ** BigInt(decimals) + BigInt(kept)
  if (guard >= 5) minor += 1n
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null

  return negative ? -Number(minor) : Number(minor)
}

/**
 * `<DTPOSTED>` to a wall-clock `YYYY-MM-DD`.
 *
 * 🛑 **The offset is read and DISCARDED, deliberately** (05 §5 trap 3). OFX
 * dates look like `20260115`, `20260115120000` or
 * `20260115120000.000[-5:EST]`, and the offset is optional and unreliable. The
 * digits before it are the bank's own local calendar date - the date printed on
 * the statement a person is reconciling against - so converting to UTC and back
 * would move a 20:00 EST transaction into the next day and, at a month
 * boundary, into the next accounting PERIOD (§9.5).
 *
 * Declared here rather than left to a date library, which is the whole point of
 * the trap: nothing may guess.
 *
 * Also accepts an already-formatted `YYYY-MM-DD`, so a hand-edited file works.
 * Answers `null` for anything else, including an impossible calendar date like
 * `20260230`.
 */
export function parseOfxDate(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const text = String(raw).trim()
  if (!text) return null

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text) ?? /^(\d{4})(\d{2})(\d{2})/.exec(text)
  if (!match) return null

  const [, year, month, day] = match as unknown as [string, string, string, string]
  const key = `${year}-${month}-${day}`
  // Round-trip through UTC so 20260230 and 20261301 are refused rather than
  // silently rolled forward into March and January.
  const parsed = new Date(`${key}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10) === key ? key : null
}

// ── internals ─────────────────────────────────────────────────────────────

/** Everything from the first `<OFX` on, so a header value can never read as a tag. */
function sliceBody(text: string): string {
  const start = text.search(/<OFX[\s>]/i)
  return start >= 0 ? text.slice(start) : text
}

/**
 * SGML (1.x) or XML (2.x).
 *
 * Informational only - the leaf reader handles both - but it is what an upload
 * card shows when a bank's export changes shape between two downloads.
 */
function detectForm(text: string): 'sgml' | 'xml' {
  const head = text.slice(0, 4096)
  if (/<\?xml/i.test(head)) return 'xml'
  if (/OFXHEADER\s*=\s*"2/i.test(head)) return 'xml'
  if (/VERSION\s*:\s*2/i.test(head)) return 'xml'
  return 'sgml'
}

/**
 * The text of a leaf element, or null.
 *
 * `([^<]*)` is what makes one reader cover both forms: in XML it stops at
 * `</TAG>`, in SGML at whatever element comes next.
 */
function readLeaf(segment: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<]*)`, 'i').exec(segment)
  const value = match?.[1]?.trim()
  return value ? decodeEntities(value) : null
}

/**
 * The five XML entities plus numeric references.
 *
 * OFX 2.x escapes them and 1.x sometimes does too, so a payee called `AT&T`
 * arrives as `AT&amp;T` and would otherwise be stored, normalised into a
 * `matchKey`, and matched against verbatim - three places carrying the escape.
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
}

/**
 * Every occurrence of an aggregate's body.
 *
 * Closed pairs first, which is what OFX promises for aggregates in both forms.
 * The fallback splits on the open tag for the one file that omits the close -
 * losing every transaction because a bank forgot a `</STMTTRN>` is not an
 * acceptable failure mode for the ingest path a vendor cannot switch off.
 */
function splitAggregates(text: string, tag: string): string[] {
  const closed = [...text.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'gi'))]
    .map((match) => match[1] ?? '')
    .filter((segment) => segment.trim().length > 0)
  if (closed.length > 0) return closed

  const open = new RegExp(`<${tag}>`, 'gi')
  const starts = [...text.matchAll(open)].map((match) => match.index ?? 0)
  return starts
    .map((start, i) => {
      const from = start + `<${tag}>`.length
      const to = i + 1 < starts.length ? (starts[i + 1] ?? text.length) : text.length
      return text.slice(from, to)
    })
    .filter((segment) => segment.trim().length > 0)
}

/**
 * The account block, bank or credit card.
 *
 * ⚠️ A credit card statement uses `CREDITCARDMSGSRSV1` / `CCSTMTRS` /
 * `CCACCTFROM` and has no routing number (05 §5 trap 4). The `kind` is what the
 * upload card uses to warn when the file is being imported onto a `depository`
 * account, since mapping a card to an asset code produces a balance sheet that
 * balances and is wrong by twice the card balance.
 */
function readAccount(body: string): OfxAccount | null {
  const bank = splitAggregates(body, 'BANKACCTFROM')[0]
  const card = splitAggregates(body, 'CCACCTFROM')[0]
  const segment = bank ?? card
  if (!segment) return null

  const isCard = !bank || /<(CREDITCARDMSGSRSV1|CCSTMTRS)[\s>]/i.test(body)
  const accountId = readLeaf(segment, 'ACCTID')
  return {
    kind: isCard ? 'creditcard' : 'bank',
    accountId,
    routingNumber: readLeaf(segment, 'BANKID'),
    accountType: readLeaf(segment, 'ACCTTYPE')?.toUpperCase() ?? null,
    last4: accountId ? accountId.replace(/\D/g, '').slice(-4) || null : null,
  }
}

/** `<LEDGERBAL>`, when the file carries one. */
function readLedgerBalance(body: string): OfxLedgerBalance | null {
  const segment = splitAggregates(body, 'LEDGERBAL')[0]
  if (!segment) return null
  const amountMinor = parseOfxAmountToMinor(readLeaf(segment, 'BALAMT'))
  if (amountMinor == null) return null
  return { amountMinor, asOf: parseOfxDate(readLeaf(segment, 'DTASOF')) }
}

/** FITIDs seen more than once, in first-seen order. */
function findDuplicateFitIds(transactions: readonly OfxTransaction[]): string[] {
  const seen = new Map<string, number>()
  for (const tx of transactions) {
    if (!tx.fitId) continue
    seen.set(tx.fitId, (seen.get(tx.fitId) ?? 0) + 1)
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([fitId]) => fitId)
}
