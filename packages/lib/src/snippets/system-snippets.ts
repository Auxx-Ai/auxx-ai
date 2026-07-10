// packages/lib/src/snippets/system-snippets.ts

import { type Database, schema } from '@auxx/database'
import { SnippetSharingType, type SnippetSystemType } from '@auxx/database/enums'
import { and, eq, sql } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { NotFoundError } from '../errors'
import { encodeFallback, type FallbackPayload } from '../placeholders/fallback-codec'

/** A materializable system-snippet row, keyed to a specific org's field-token cuids. */
export interface SystemSnippetTemplate {
  systemType: SnippetSystemType
  /** Plain-text email subject (v1 has no subject-line placeholders — README §open-item-6). */
  title: string
  /** Plain-text mirror of `contentHtml` — Tiptap's `renderText` serializes tokens as `{{id}}`. */
  content: string
  /** Tiptap-compatible HTML with live `data-type="placeholder"` spans. */
  contentHtml: string
}

/**
 * Build a `<span data-type="placeholder" data-id="...">` exactly matching the
 * shape `createPlaceholderNode`'s `renderHTML` emits (inline-node.ts) and
 * `PLACEHOLDER_SPAN_REGEX` (placeholders/resolver.ts) consumes: `data-type`,
 * `data-id`, optional `data-fallback` (JSON, HTML-attribute-escaped), inner
 * text = the `{{id}}` token body (Tiptap's `serialize`).
 */
function placeholderSpan(id: string, fallback?: FallbackPayload): string {
  const fallbackAttr = fallback
    ? ` data-fallback="${escapeHtmlAttr(encodeFallback(fallback))}"`
    : ''
  return `<span data-type="placeholder" data-id="${escapeHtmlAttr(id)}"${fallbackAttr}>{{${id}}}</span>`
}

const HTML_ATTR_ESCAPE_LOOKUP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtmlAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ATTR_ESCAPE_LOOKUP[c] ?? c)
}

/** `${entityDefinitionId}:${fieldId}` — the field-token key form (`keyToFieldRef`/`getRootEntityId`). */
function fieldToken(defId: string, fieldId: string): string {
  return `${defId}:${fieldId}`
}

function buildQuoteEmailTemplate(entityDefs: Record<string, string>): SystemSnippetTemplate | null {
  const quoteDefId = entityDefs.quote
  const contactDefId = entityDefs.contact
  if (!quoteDefId || !contactDefId) return null

  const firstName = fieldToken(contactDefId, 'firstName')
  const number = fieldToken(quoteDefId, 'number')
  const total = fieldToken(quoteDefId, 'total')
  const validUntil = fieldToken(quoteDefId, 'validUntil')

  const firstNameSpan = placeholderSpan(firstName, { v: 1, t: 'TEXT', d: 'there' })
  const numberSpan = placeholderSpan(number)
  const totalSpan = placeholderSpan(total)
  const validUntilSpan = placeholderSpan(validUntil, { v: 1, t: 'TEXT', d: 'no expiration date' })
  const userNameSpan = placeholderSpan('user:name')

  const contentHtml = `<p>Hi ${firstNameSpan},</p><p>Your quote ${numberSpan} is ready — total ${totalSpan}, valid until ${validUntilSpan}. Please see the attached PDF for the full details.</p><p>Let us know if you have any questions.</p><p>Best,<br>${userNameSpan}</p>`

  const content = `Hi {{${firstName}}},

Your quote {{${number}}} is ready — total {{${total}}}, valid until {{${validUntil}}}. Please see the attached PDF for the full details.

Let us know if you have any questions.

Best,
{{user:name}}`

  return {
    systemType: 'quote_email',
    title: 'Your quote is ready',
    content,
    contentHtml,
  }
}

/**
 * Build the system-snippet template rows for an org, given its `entityDefs`
 * cache map (entityType → per-org `EntityDefinition.id`). Placeholder tokens
 * embed the org's real def cuids, so this is a function of that map, not a
 * static constant.
 *
 * `invoice_email` ships with MI1 once the invoice `EntityDefinition` (+
 * number/total/dueDate fields) exists — until then `entityDefs.invoice` is
 * always absent, so only `quote_email` is returned. `getSystemSnippet`
 * surfaces a clear `NotFoundError` if `invoice_email` is requested early.
 */
export function buildSystemSnippetTemplates(
  entityDefs: Record<string, string>
): SystemSnippetTemplate[] {
  const templates: SystemSnippetTemplate[] = []

  const quoteEmail = buildQuoteEmailTemplate(entityDefs)
  if (quoteEmail) templates.push(quoteEmail)

  return templates
}

/**
 * Get-or-create the org's system snippet for `systemType` (`quote_email` /
 * `invoice_email`). Lazily materializes on first call — covers both freshly
 * seeded orgs (the seeder pre-creates the row) and existing orgs (no data
 * migration needed, per the README decision). Idempotent under concurrent
 * calls via `onConflictDoNothing` against the partial unique
 * `(systemType, organizationId) WHERE systemType IS NOT NULL AND isDeleted = false`.
 *
 * Read-only in v1 — `snippet-mutations.ts` forbids editing rows with a
 * non-null `systemType`.
 */
export async function getSystemSnippet(
  db: Database,
  organizationId: string,
  systemType: SnippetSystemType
): Promise<typeof schema.Snippet.$inferSelect> {
  const select = () =>
    db.query.Snippet.findFirst({
      where: and(
        eq(schema.Snippet.organizationId, organizationId),
        eq(schema.Snippet.systemType, systemType),
        eq(schema.Snippet.isDeleted, false)
      ),
    })

  const existing = await select()
  if (existing) return existing

  const entityDefs = await getOrgCache().get(organizationId, 'entityDefs')
  const template = buildSystemSnippetTemplates(entityDefs).find((t) => t.systemType === systemType)
  if (!template) {
    throw new NotFoundError(`System snippet template not available for '${systemType}' yet`)
  }

  const systemUserId = await getOrgCache().get(organizationId, 'systemUser')

  await db
    .insert(schema.Snippet)
    .values({
      title: template.title,
      content: template.content,
      contentHtml: template.contentHtml,
      systemType: template.systemType,
      sharingType: SnippetSharingType.PRIVATE,
      organizationId,
      createdById: systemUserId,
      updatedAt: new Date(),
    })
    .onConflictDoNothing({
      target: [schema.Snippet.systemType, schema.Snippet.organizationId],
      where: sql`${schema.Snippet.systemType} IS NOT NULL AND ${schema.Snippet.isDeleted} = false`,
    })

  const row = await select()
  if (!row) {
    throw new Error(
      `Failed to materialize system snippet '${systemType}' for org ${organizationId}`
    )
  }
  return row
}
