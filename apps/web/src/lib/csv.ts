// apps/web/src/lib/csv.ts
// Browser-only CSV download (Step 9 §2.2). The framework-agnostic serializer lives
// in `@auxx/utils/csv` (`toCsv`/`csvCell`, shared server + client); this is the
// `Blob → createObjectURL → <a download> → revokeObjectURL` half, which can only run
// in the browser. Pair them: `downloadCsv(toCsv(rows, columns), filename)`.

/** Trigger a client-side download of `content` as a CSV file named `filename`. */
export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
