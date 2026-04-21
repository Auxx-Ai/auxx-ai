// packages/lib/src/placeholders/resolver.ts

import { type Database, schema } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { type FieldReference, fieldRefToKey } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { eq } from 'drizzle-orm'
import { FieldValueService } from '../field-values/field-value-service'
import { toRecordId } from '../resources/resource-id'
import { type OrgSlug, type ParsedPlaceholder, tryParsePlaceholderId } from './path-parser'

/**
 * Caller-provided context for placeholder resolution.
 *
 * The resolver never falls back to ambient state — if a placeholder references
 * a root whose id isn't supplied, resolution hard-fails. Callers (e.g. the
 * `thread.sendMessage` tRPC handler) are responsible for deriving
 * `contactEntityInstanceId` / `ticketId` from the thread record.
 */
export interface PlaceholderResolutionContext {
  db: Database
  organizationId: string
  /** Sender user id — required if any `user:<field>` placeholders appear. */
  senderUserId?: string
  /** Thread record id — required if any `thread:<field>` placeholders appear. */
  threadId?: string
  /** Primary participant's contact entity-instance id. */
  contactEntityInstanceId?: string
  /** Ticket entity-instance id linked to the thread. */
  ticketId?: string
  /** Optional "now" override — defaults to `new Date()`. Useful in tests. */
  now?: Date
}

/**
 * Matches the exact span shape emitted by `createPlaceholderNode`'s
 * `renderHTML`: `<span data-type="placeholder" data-id="..."> {{...}} </span>`.
 * The attribute order is stable because Tiptap's `mergeAttributes` always
 * outputs `data-type` and `data-id` in that order. `data-id` cannot contain
 * unescaped `"` because the picker only yields fieldRefKey / `date:<slug>`.
 */
const PLACEHOLDER_SPAN_REGEX =
  /<span\b[^>]*data-type="placeholder"[^>]*data-id="([^"]*)"[^>]*>[\s\S]*?<\/span>/g

/**
 * Replace every `<span data-type="placeholder" data-id="...">…</span>` in
 * `html` with the resolved text for its token id. Hard-fails on the first
 * unresolvable token.
 *
 * Phase-1 scope: paths only (no formatter / override / ACL layers).
 */
export async function resolvePlaceholdersInHtml(
  html: string,
  ctx: PlaceholderResolutionContext
): Promise<string> {
  if (!html.includes('data-type="placeholder"')) {
    return html
  }

  // Pass 1: collect every token id so we can batch the field-value lookups
  // before doing any string rewriting.
  const unresolved: string[] = []
  const fieldTokens: { id: string; parsed: Extract<ParsedPlaceholder, { kind: 'field' }> }[] = []
  let needsOrg = false
  const seen = new Set<string>()

  for (const match of html.matchAll(PLACEHOLDER_SPAN_REGEX)) {
    const id = match[1]
    if (!id) {
      unresolved.push('<missing data-id>')
      continue
    }
    if (seen.has(id)) continue
    seen.add(id)

    const parsed = tryParsePlaceholderId(id)
    if (!parsed) {
      unresolved.push(id)
      continue
    }
    if (parsed.kind === 'field') {
      fieldTokens.push({ id, parsed })
    } else if (parsed.kind === 'org') {
      needsOrg = true
    }
  }

  if (unresolved.length > 0) {
    throw new Error(`Unresolvable placeholder tokens: ${unresolved.join(', ')}`)
  }

  const fieldValues = await resolveFieldTokens(fieldTokens, ctx)
  const orgRow = needsOrg ? await loadOrganization(ctx) : null
  const now = ctx.now ?? new Date()

  // Pass 2: rewrite. `replace` evaluates the callback fresh for every match so
  // duplicate tokens all get the same resolved text.
  return html.replace(PLACEHOLDER_SPAN_REGEX, (_match, id: string) => {
    const parsed = tryParsePlaceholderId(id)
    if (!parsed) {
      // Already guarded in pass 1; repeated here for type-narrowing.
      throw new Error(`Unresolvable placeholder token: ${id}`)
    }
    if (parsed.kind === 'date') {
      return escapeHtml(formatDate(parsed.slug, now))
    }
    if (parsed.kind === 'org') {
      if (!orgRow) throw new Error(`Organization row not found for org: ${id}`)
      const value = orgColumn(orgRow, parsed.slug)
      if (value === null || value === '') {
        throw new Error(`Placeholder '${id}' resolved to no value`)
      }
      return escapeHtml(value)
    }
    const resolved = fieldValues.get(id)
    if (resolved === undefined) {
      throw new Error(`Placeholder value missing after resolution: ${id}`)
    }
    return escapeHtml(resolved)
  })
}

async function loadOrganization(
  ctx: PlaceholderResolutionContext
): Promise<{ name: string | null; handle: string | null; website: string | null } | null> {
  const rows = await ctx.db
    .select({
      name: schema.Organization.name,
      handle: schema.Organization.handle,
      website: schema.Organization.website,
    })
    .from(schema.Organization)
    .where(eq(schema.Organization.id, ctx.organizationId))
    .limit(1)
  return rows[0] ?? null
}

function orgColumn(
  row: { name: string | null; handle: string | null; website: string | null },
  slug: OrgSlug
): string | null {
  switch (slug) {
    case 'name':
      return row.name
    case 'handle':
      return row.handle
    case 'website':
      return row.website
  }
}

async function resolveFieldTokens(
  tokens: { id: string; parsed: Extract<ParsedPlaceholder, { kind: 'field' }> }[],
  ctx: PlaceholderResolutionContext
): Promise<Map<string, string>> {
  if (tokens.length === 0) return new Map()

  // Group by starting record id so we can batch per-record.
  const byRecordId = new Map<RecordId, { id: string; fieldRef: FieldReference }[]>()
  for (const { id, parsed } of tokens) {
    const recordId = recordIdForRoot(parsed.rootEntityDefinitionId, ctx)
    if (!recordId) {
      throw new Error(
        `Cannot resolve placeholder '${id}': no context for root '${parsed.rootEntityDefinitionId}'`
      )
    }
    const entry = byRecordId.get(recordId) ?? []
    entry.push({ id, fieldRef: parsed.fieldRef })
    byRecordId.set(recordId, entry)
  }

  const service = new FieldValueService(ctx.organizationId, ctx.senderUserId, ctx.db)
  const result = new Map<string, string>()

  for (const [recordId, entries] of byRecordId) {
    const fieldRefs = entries.map((e) => e.fieldRef)
    const batch = await service.batchGetValues({
      recordIds: [recordId],
      fieldReferences: fieldRefs,
    })

    // Index batch results by fieldRefKey for lookup.
    const byKey = new Map<string, TypedFieldValue | TypedFieldValue[] | null>()
    for (const v of batch.values) {
      byKey.set(fieldRefToKey(v.fieldRef), v.value)
    }

    for (const { id, fieldRef } of entries) {
      const key = fieldRefToKey(fieldRef)
      const raw = byKey.get(key)
      if (raw === undefined || raw === null) {
        throw new Error(`Placeholder '${id}' resolved to no value`)
      }
      result.set(id, typedValueToString(raw))
    }
  }

  return result
}

/**
 * Derive the starting `RecordId` for a root entity-definition from the context.
 * Returns `null` when the required id is missing — caller hard-fails.
 */
function recordIdForRoot(root: string, ctx: PlaceholderResolutionContext): RecordId | null {
  switch (root) {
    case 'thread':
      return ctx.threadId ? toRecordId('thread', ctx.threadId) : null
    case 'ticket':
      return ctx.ticketId ? toRecordId('ticket', ctx.ticketId) : null
    case 'contact':
      return ctx.contactEntityInstanceId ? toRecordId('contact', ctx.contactEntityInstanceId) : null
    case 'organization':
      return toRecordId('organization', ctx.organizationId)
    case 'user':
      return ctx.senderUserId ? toRecordId('user', ctx.senderUserId) : null
    default:
      // Any other root is reachable only via relationship traversal as a
      // *subsequent* segment — it can't be a starting record id. Reject.
      return null
  }
}

function formatDate(slug: 'today' | 'now' | 'tomorrow' | 'yesterday', now: Date): string {
  const day = 24 * 60 * 60 * 1000
  switch (slug) {
    case 'today':
      return formatDateOnly(now)
    case 'now':
      return now.toLocaleString()
    case 'tomorrow':
      return formatDateOnly(new Date(now.getTime() + day))
    case 'yesterday':
      return formatDateOnly(new Date(now.getTime() - day))
  }
}

function formatDateOnly(d: Date): string {
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * Minimal stringifier for a `TypedFieldValue`. Phase 2 will replace this with
 * `formatToDisplayValue(...)` from `../field-values/formatter` + formatter
 * pipeline. For phase 1 we use the primitive the converter already stored.
 */
function typedValueToString(value: TypedFieldValue | TypedFieldValue[]): string {
  if (Array.isArray(value)) {
    return value.map(typedSingleToString).join(', ')
  }
  return typedSingleToString(value)
}

function typedSingleToString(v: TypedFieldValue): string {
  switch (v.type) {
    case 'text':
      return v.value
    case 'number':
      return String(v.value)
    case 'boolean':
      return v.value ? 'true' : 'false'
    case 'date':
      return v.value
    case 'option':
      return v.label ?? v.optionId
    case 'relationship':
      return v.displayName ?? v.recordId
    case 'actor':
      return v.displayName ?? v.actorId
    case 'json':
      return JSON.stringify(v.value)
    default:
      return ''
  }
}

const HTML_ESCAPE_LOOKUP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPE_LOOKUP[c] ?? c)
}
