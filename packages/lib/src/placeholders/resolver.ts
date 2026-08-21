// packages/lib/src/placeholders/resolver.ts

import type { Database } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import type { TypedFieldValue } from '@auxx/types'
import { type FieldReference, fieldRefToKey } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { getOrgCache, getUserCache } from '../cache'
import type { FieldOptions } from '../custom-fields/field-options'
import { FieldValueService } from '../field-values/field-value-service'
import { formatToDisplayValue } from '../field-values/formatter'
import { getOrgCurrencyCode, withOrgCurrency } from '../field-values/org-currency'
import { decodeFallback, renderFallbackPayload } from './fallback-codec'
import { decodePlaceholderFormat, getPlaceholderFormatOptions } from './format-codec'
import {
  type OrgSlug,
  type ParsedPlaceholder,
  tryParsePlaceholderId,
  type UserSlug,
} from './path-parser'

/**
 * Caller-provided context for placeholder resolution.
 *
 * `recordIdsByRoot` is the authoritative dispatch table: it maps a token's
 * parsed root (cuid for EntityDefinitions, slug for `thread` / `user`) to
 * the ambient RecordId the resolver should read from. Callers are
 * responsible for populating the entries they can support.
 *
 * A root absent from the map → the token hard-fails. No switches, no
 * entityType lookups, no hidden defaults.
 */
export interface PlaceholderResolutionContext {
  db: Database
  organizationId: string
  /** Sender user id — threaded into `FieldValueService` for audit. */
  senderUserId?: string
  /** Optional "now" override — defaults to `new Date()`. Useful in tests. */
  now?: Date
  /** Optional timezone for presentation-only fields such as Visit date and times. */
  timezone?: string
  /**
   * Root id → RecordId map. Populated by `buildPlaceholderContextForThread`
   * (or any other context builder). Slug-rooted entries use the slug
   * literal; cuid-rooted entries use `EntityDefinition.id`.
   */
  recordIdsByRoot: Map<string, RecordId>
}

/** Typed field metadata retained until each placeholder span is rendered. */
/** Typed field metadata retained until a placeholder occurrence is rendered. */
export interface ResolvedFieldToken {
  value: TypedFieldValue | TypedFieldValue[]
  fieldType: FieldType
  fieldOptions?: FieldOptions
}

/**
 * Matches the exact span shape emitted by `createPlaceholderNode`'s
 * `renderHTML`: `<span data-type="placeholder" data-id="..."> {{...}} </span>`.
 */
const PLACEHOLDER_SPAN_REGEX =
  /<span\b[^>]*data-type="placeholder"[^>]*data-id="([^"]*)"[^>]*>[\s\S]*?<\/span>/g

/**
 * Extract a `data-*` attribute value from a matched span's open-tag HTML.
 * Returns the HTML-entity-decoded string, or `null` if the attribute is
 * absent. The attribute value in the source is always double-quoted (Tiptap
 * serializer invariant), so `[^"]*` captures up to the closing quote.
 */
function extractAttr(spanHtml: string, name: string): string | null {
  const pattern = new RegExp(`\\b${name}="([^"]*)"`)
  const m = spanHtml.match(pattern)
  return m ? decodeHtmlEntities(m[1] ?? '') : null
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16))
    }
    if (body.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(body.slice(1), 10))
    }
    return NAMED_ENTITIES[body] ?? `&${body};`
  })
}

/**
 * Replace every `<span data-type="placeholder" data-id="...">…</span>` in
 * `html` with the resolved text for its token id. Substitutes a typed
 * `data-fallback` payload when the resolved value is null / empty;
 * hard-fails otherwise.
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
  let needsUser = false
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
    } else if (parsed.kind === 'user') {
      needsUser = true
    }
  }

  if (unresolved.length > 0) {
    throw new Error(`Unresolvable placeholder tokens: ${unresolved.join(', ')}`)
  }

  const fieldValues = await resolveFieldTokens(fieldTokens, ctx)
  const orgProfile = needsOrg ? await getOrgCache().get(ctx.organizationId, 'orgProfile') : null
  const userProfile =
    needsUser && ctx.senderUserId ? await getUserCache().get(ctx.senderUserId, 'userProfile') : null
  const now = ctx.now ?? new Date()

  // Pass 2: rewrite. `replace` evaluates the callback fresh for every match
  // so duplicate tokens with different `data-fallback` values are each
  // resolved independently.
  return html.replace(PLACEHOLDER_SPAN_REGEX, (fullMatch, id: string) => {
    const parsed = tryParsePlaceholderId(id)
    if (!parsed) {
      throw new Error(`Unresolvable placeholder token: ${id}`)
    }
    if (parsed.kind === 'date') {
      return escapeHtml(formatDate(parsed.slug, now))
    }

    const raw = extractAttr(fullMatch, 'data-fallback')
    const fallback = decodeFallback(raw)
    const format = decodePlaceholderFormat(extractAttr(fullMatch, 'data-format'))

    if (parsed.kind === 'org') {
      if (!orgProfile) throw new Error(`Organization profile not found for org: ${id}`)
      const value = orgColumn(orgProfile, parsed.slug)
      if (value === null || value === '') {
        return fallback ? escapeHtml(renderFallbackPayload(fallback)) : ''
      }
      return escapeHtml(value)
    }

    if (parsed.kind === 'user') {
      // userProfile is null when senderUserId is absent — treat same as an
      // empty value so placeholders gracefully degrade without a sender.
      const value = userProfile ? userColumn(userProfile, parsed.slug) : null
      if (value === null || value === '') {
        return fallback ? escapeHtml(renderFallbackPayload(fallback)) : ''
      }
      return escapeHtml(value)
    }

    const resolved = fieldValues.get(id)
    if (resolved === null || resolved === undefined) {
      return fallback ? escapeHtml(renderFallbackPayload(fallback)) : ''
    }
    const value = formatFieldValueForText(resolved.value, resolved.fieldType, {
      ...resolved.fieldOptions,
      ...getPlaceholderFormatOptions(format, resolved.fieldType),
      ...(ctx.timezone ? { timeZone: ctx.timezone } : {}),
    })
    if (value === '') return fallback ? escapeHtml(renderFallbackPayload(fallback)) : ''
    return escapeHtml(value)
  })
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

function userColumn(
  row: {
    id: string
    name: string | null
    email: string | null
    firstName: string | null
    lastName: string | null
  },
  slug: UserSlug
): string | null {
  switch (slug) {
    case 'id':
      return row.id
    case 'email':
      return row.email
    case 'name':
      return row.name
    case 'firstName':
      return row.firstName
    case 'lastName':
      return row.lastName
  }
}

/**
 * Batch-resolve field-backed placeholder ids without committing to an output
 * representation. Both the legacy HTML adapter and structural document
 * resolver use this so field reads and display metadata stay identical.
 */
export async function resolveFieldTokens(
  tokens: { id: string; parsed: Extract<ParsedPlaceholder, { kind: 'field' }> }[],
  ctx: PlaceholderResolutionContext
): Promise<Map<string, ResolvedFieldToken | null>> {
  if (tokens.length === 0) return new Map()

  // Group by starting record id so we can batch per-record.
  const byRecordId = new Map<RecordId, { id: string; fieldRef: FieldReference }[]>()
  for (const { id, parsed } of tokens) {
    const recordId = ctx.recordIdsByRoot.get(parsed.rootEntityDefinitionId)
    if (!recordId) {
      throw new Error(
        `Cannot resolve placeholder '${id}': no record for root ` +
          `'${parsed.rootEntityDefinitionId}' in the current context`
      )
    }
    const entry = byRecordId.get(recordId) ?? []
    entry.push({ id, fieldRef: parsed.fieldRef })
    byRecordId.set(recordId, entry)
  }

  const service = new FieldValueService(ctx.organizationId, ctx.senderUserId, ctx.db)
  const result = new Map<string, ResolvedFieldToken | null>()

  for (const [recordId, entries] of byRecordId) {
    const fieldRefs = entries.map((e) => e.fieldRef)
    const batch = await service.batchGetValues({
      recordIds: [recordId],
      fieldReferences: fieldRefs,
    })

    // Index batch results by fieldRefKey for lookup. Typed metadata remains
    // intact until Pass 2 because duplicate spans may apply distinct display
    // overrides to the same field reference.
    const byKey = new Map<string, (typeof batch.values)[number]>()
    for (const v of batch.values) {
      byKey.set(fieldRefToKey(v.fieldRef), v)
    }

    for (const { id, fieldRef } of entries) {
      const key = fieldRefToKey(fieldRef)
      const entry = byKey.get(key)
      const raw = entry?.value
      // Null/undefined → let Pass 2 apply the span's fallback (or empty value).
      result.set(
        id,
        raw === undefined || raw === null
          ? null
          : {
              value: raw,
              fieldType: entry!.fieldType,
              fieldOptions: entry!.fieldOptions,
            }
      )
    }
  }

  // The org rung for CURRENCY, applied in one pass over the finished map.
  // Doing it HERE is what keeps the HTML adapter and the structural document
  // resolver identical — both consume this map, so a field that never picked
  // its own code renders in `organization.currency` in an email and in a PDF
  // alike. Skipped entirely when no currency token resolved.
  const currencyIds = [...result].filter(([, r]) => r?.fieldType === 'CURRENCY').map(([id]) => id)
  if (currencyIds.length > 0) {
    const orgCurrencyCode = await getOrgCurrencyCode(ctx.organizationId, ctx.db)
    for (const id of currencyIds) {
      const resolved = result.get(id)!
      result.set(id, {
        ...resolved,
        fieldOptions: withOrgCurrency(resolved.fieldOptions, 'CURRENCY', orgCurrencyCode),
      })
    }
  }

  return result
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
 * Format a `TypedFieldValue` for plain-text/HTML email placeholders using the
 * same type-aware formatter the UI uses (`formatToDisplayValue`), so a
 * `CURRENCY` total renders `$250.00` rather than the raw `25000`, dates render
 * `Jan 15, 2024`, options render their label, etc.
 *
 * One deliberate deviation from `formatToDisplayValue`:
 * - `RELATIONSHIP` / `ACTOR` resolve to a human display name (the shared
 *   converter returns the raw id/object for frontend hydration, which is
 *   useless in an email).
 */
export function formatFieldValueForText(
  value: TypedFieldValue | TypedFieldValue[],
  fieldType: FieldType,
  options?: FieldOptions
): string {
  if (Array.isArray(value)) {
    return value.map((v) => formatSingleForText(v, fieldType, options)).join(', ')
  }
  return formatSingleForText(value, fieldType, options)
}

function formatSingleForText(
  v: TypedFieldValue,
  fieldType: FieldType,
  options?: FieldOptions
): string {
  // Human-readable name for links/people — never the raw id.
  if (v.type === 'relationship') return v.displayName ?? v.recordId
  if (v.type === 'actor') return v.displayName ?? ''

  const display = formatToDisplayValue(v, fieldType, options)
  return display === null || display === undefined ? '' : String(display)
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
