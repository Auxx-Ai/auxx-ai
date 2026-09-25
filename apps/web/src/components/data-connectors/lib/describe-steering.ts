// apps/web/src/components/data-connectors/lib/describe-steering.ts
// Pure, client-safe translator: a stream's `requestConfig.webhookTrigger` (the v9
// steering stamped from the app manifest) → one plain-language line for the read-only
// app-connector webhook summary. Mirrors how the dispatch job actually behaves —
// notably steering with neither `idPath` nor `paths` is rendered bluntly ("full sync per
// delivery") because that shape re-crawls the whole connector on every delivery. No server
// imports; a local structural type avoids pulling a server-only module into the client bundle.

/** Per-stream webhook steering as stamped onto `requestConfig.webhookTrigger` (v9). */
export interface StreamSteering {
  filter?: Record<string, unknown>
  /** Generic REST: payload paths exposed as `{path}` request placeholders. */
  paths?: string[]
  /** App streams: the payload path whose value is fetched as `{ ids: [value] }`. */
  idPath?: string
  /** App streams: the foreign id kind `idPath` holds, when it isn't the stream's own id. */
  idKind?: string
  debounceMs?: number
}

/**
 * One-line human summary of a stream's webhook steering, e.g.
 * `topic = inventory_levels/update · re-fetches by resourceId (inventoryItem id) · 10s debounce`.
 * Filter entries render as `key = value` (no filter → "all deliveries"); no `idPath` and
 * empty `paths` → "full sync per delivery"; the debounce segment is omitted when unset.
 */
export function describeSteering(steering: StreamSteering): string {
  const segments: string[] = []

  const filterEntries = Object.entries(steering.filter ?? {})
  segments.push(
    filterEntries.length > 0
      ? filterEntries.map(([k, v]) => `${k} = ${String(v)}`).join(', ')
      : 'all deliveries'
  )

  if (steering.idPath) {
    const kind = steering.idKind ? ` (${steering.idKind} id)` : ''
    segments.push(`re-fetches by ${steering.idPath}${kind}`)
  } else if (steering.paths?.length) {
    segments.push(`re-fetches by ${steering.paths.join(', ')}`)
  } else {
    segments.push('full sync per delivery')
  }

  const debounceMs = steering.debounceMs ?? 0
  if (debounceMs > 0) {
    segments.push(
      debounceMs % 1000 === 0 ? `${debounceMs / 1000}s debounce` : `${debounceMs}ms debounce`
    )
  }

  return segments.join(' · ')
}
