// packages/utils/src/csv.ts
// Framework-agnostic CSV serialization (Step 9 §2.2). Quoting follows RFC 4180:
// a cell containing a comma, double-quote, or newline is wrapped in double quotes
// and embedded quotes are doubled. Lifted from the audit-log exporter so the
// server (@auxx/lib) and client (apps/web) share one correct serializer. The
// browser-only download helper can't live here — see apps/web/src/lib/csv.ts.

/**
 * Serialize one cell value. `null`/`undefined` → empty string; `Date` → ISO;
 * objects → JSON; everything else → `String()`. The result is quoted only when it
 * contains a comma, double-quote, CR, or LF (embedded quotes doubled).
 */
export function csvCell(value: unknown): string {
  if (value == null) return ''
  const str =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value)
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

/**
 * Serialize `rows` into CSV text. The header line is `columns` verbatim; each row
 * emits `columns.map((col) => csvCell(row[col]))`. Lines are joined with `\n`.
 */
export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const header = columns.join(',')
  const lines = rows.map((row) => columns.map((col) => csvCell(row[col])).join(','))
  return [header, ...lines].join('\n')
}
