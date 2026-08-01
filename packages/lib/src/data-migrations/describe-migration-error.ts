// packages/lib/src/data-migrations/describe-migration-error.ts

/**
 * Bytes of summary persisted to `DataMigration.error`. The column is `text`, so
 * nothing in the DB stops a multi-megabyte blob from landing there — a failed
 * `UPDATE … FROM (VALUES …)` backfill carries its whole statement in the message.
 * 2 KB is far more than every part below can legitimately fill.
 */
export const MAX_SUMMARY_LENGTH = 2_000
/** Per-error message cap — two of them can appear (wrapper + pg cause). */
const MAX_MESSAGE_LENGTH = 300
/** pg `detail` cap. It is the most useful constraint-violation field and the most verbose. */
const MAX_DETAIL_LENGTH = 200
/** SQL text cap. Enough to identify the statement, not enough to store a bulk VALUES list. */
const MAX_QUERY_LENGTH = 500
/** pg identifiers are capped at 63 bytes by the server; this is slack, not a guess. */
const MAX_IDENTIFIER_LENGTH = 128
/** Depth cap on the `.cause` walk. Drizzle adds one hop; nothing legitimately adds eight. */
const MAX_CAUSE_DEPTH = 8

/** pg SQLSTATE codes are exactly five alphanumerics ('23503'), unlike Node's 'ECONNREFUSED'. */
const PG_ERROR_CODE = /^[0-9A-Z]{5}$/

const PG_IDENTIFIER_FIELDS = ['code', 'constraint', 'table', 'column'] as const

/** The `node-postgres` `DatabaseError` fields that make a failure reproducible. */
export interface PgErrorFields {
  code?: string
  constraint?: string
  /**
   * pg's own explanation, e.g. `Key (inboxId)=(…) is not present in table "Inbox"`.
   * It can echo the offending KEY VALUES — that is the one place customer data can
   * reach the ledger, and it is kept deliberately: without it a duplicate-key or FK
   * failure names no row. Bound to {@link MAX_DETAIL_LENGTH}.
   */
  detail?: string
  table?: string
  column?: string
}

export interface MigrationErrorDetails {
  /** Single-line, bounded summary. This is what goes in the ledger row. */
  summary: string
  /** Structured pg fields for the log line — empty when the failure was not a driver error. */
  pg: PgErrorFields
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(node: Record<string, unknown>, key: string): string | undefined {
  const value = node[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

const TRUNCATION_MARKER = '…[truncated]'

/** Hard bound — the result never exceeds `max`, marker included. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`
}

/**
 * Drizzle's `DrizzleQueryError` message is `Failed query: <sql>\nparams: <values>`.
 * The bound parameters are customer data (emails, bodies, ids) and are never stored
 * or logged; the SQL text is what identifies the statement.
 */
function stripBoundParams(message: string): string {
  const index = message.indexOf('\nparams:')
  return index === -1 ? message : message.slice(0, index)
}

/** Every error on the `.cause` chain, outermost first. Depth- and cycle-bounded. */
function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = []
  const seen = new Set<unknown>()
  let current: unknown = error

  while (current !== undefined && current !== null && chain.length < MAX_CAUSE_DEPTH) {
    if (isRecord(current)) {
      if (seen.has(current)) break
      seen.add(current)
    }
    chain.push(current)
    current = isRecord(current) ? current.cause : undefined
  }

  return chain
}

function readQuery(node: unknown): string | undefined {
  return isRecord(node) ? readString(node, 'query') : undefined
}

/** True for a `node-postgres` `DatabaseError` (or anything shaped like one). */
function isPgErrorLike(node: unknown): node is Record<string, unknown> {
  if (!isRecord(node)) return false
  const code = readString(node, 'code')
  if (code !== undefined && PG_ERROR_CODE.test(code)) return true
  return readString(node, 'constraint') !== undefined
}

function headline(node: unknown): string {
  if (!isRecord(node)) return String(node)
  const name = readString(node, 'name') ?? 'Error'
  const message = readString(node, 'message')
  if (message === undefined) return name
  // The SQL of a DrizzleQueryError is emitted once, in its own `query:` part.
  if (readQuery(node) !== undefined && message.startsWith('Failed query:')) {
    return `${name}: Failed query`
  }
  return `${name}: ${stripBoundParams(message)}`
}

/**
 * Describe a thrown migration failure so the ledger row is diagnosable months later.
 *
 * Reading `error.message` is not enough: Drizzle throws a `DrizzleQueryError` whose
 * message is only `Failed query: …`, and the Postgres error that says *why* — the
 * SQLSTATE code, the constraint, the table and column — sits on `.cause`, sometimes
 * more than one hop down. This walks the whole chain, lifts the pg fields off the
 * first driver error it finds, and renders one bounded line.
 *
 * **Bounded on purpose.** Every variable-length part has its own cap and the joined
 * result is capped at {@link MAX_SUMMARY_LENGTH}; a bulk statement's `VALUES` list
 * can otherwise be megabytes.
 *
 * **Bound query parameters are dropped, never stored or logged.** They are the one
 * part of a query error guaranteed to be customer data, and they are not what makes
 * a failure reproducible — `code`/`constraint`/`table`/`column` are. (pg's `detail`
 * is kept and may echo key values; see {@link PgErrorFields.detail}.)
 */
export function describeMigrationError(error: unknown): MigrationErrorDetails {
  const chain = causeChain(error)
  if (chain.length === 0) return { summary: `Unknown migration failure: ${String(error)}`, pg: {} }

  const head = chain[0]
  const pgNode = chain.find(isPgErrorLike)

  const pg: PgErrorFields = {}
  if (pgNode) {
    for (const key of PG_IDENTIFIER_FIELDS) {
      const value = readString(pgNode, key)
      if (value !== undefined) pg[key] = truncate(collapse(value), MAX_IDENTIFIER_LENGTH)
    }
    const detail = readString(pgNode, 'detail')
    if (detail !== undefined) pg.detail = truncate(collapse(detail), MAX_DETAIL_LENGTH)
  }

  const parts = [truncate(collapse(headline(head)), MAX_MESSAGE_LENGTH)]
  if (pgNode !== undefined && pgNode !== head) {
    parts.push(`cause: ${truncate(collapse(headline(pgNode)), MAX_MESSAGE_LENGTH)}`)
  }

  const tags = PG_IDENTIFIER_FIELDS.filter((key) => pg[key] !== undefined).map(
    (key) => `${key}=${pg[key]}`
  )
  if (tags.length > 0) parts.push(`pg: ${tags.join(' ')}`)
  if (pg.detail !== undefined) parts.push(`detail: ${pg.detail}`)

  const query = chain.map(readQuery).find((value) => value !== undefined)
  if (query !== undefined) parts.push(`query: ${truncate(collapse(query), MAX_QUERY_LENGTH)}`)

  return { summary: truncate(parts.join(' | '), MAX_SUMMARY_LENGTH), pg }
}
