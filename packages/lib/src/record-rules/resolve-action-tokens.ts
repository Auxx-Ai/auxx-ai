// packages/lib/src/record-rules/resolve-action-tokens.ts
// Resolution of `placeholder` token nodes in rule-action docs
// (plans/signals/07-action-placeholders.md). Layering: a rule-specific pre-pass resolves
// the tokens only this module knows (`record:name`, `signal:*` — ids the shared parser
// can't own) plus anything unparseable, then hands the doc to the SHARED
// `resolvePlaceholdersInDocument`, which owns field lookup, fallback, and format —
// nothing re-implemented here.
//
// Heavy dependencies (db, cache, FieldValueService via the placeholders module) are
// lazy-imported — this module is reached from actions.ts, which is reachable from the
// field-hooks registry and must not create import cycles or break vi.mock in unit tests.

import { createScopedLogger } from '@auxx/logger'
import { extractValue } from '@auxx/types'
import { format } from 'date-fns'
import { decodeFallback, renderFallbackPayload } from '../placeholders/fallback-codec'
import { tryParsePlaceholderId } from '../placeholders/path-parser'
import type { PlaceholderResolutionContext } from '../placeholders/resolver'
import { SIGNAL_KINDS, type SignalKindMeta } from '../signals/client'
import { docToText } from '../tiptap/doc-to-text'
import type { TiptapDoc, TiptapNode } from '../tiptap/types'
import { ACTION_TOKEN_RECORD_NAME, isActionDoc, isRuleActionToken } from './client'
import type { RecordRuleFireContext } from './types'

const logger = createScopedLogger('record-rules-action-tokens')

/** Everything rule-action token resolution reads, gathered once per action execution. */
export interface RuleTokenContext {
  /** The fired record's display name (falls back to the raw instance id). */
  recordName: string
  /** Shared resolver context: db, org, sender (org system user), recordIdsByRoot. */
  placeholderCtx: PlaceholderResolutionContext
  /** Signal-door provenance; absent on field/lifecycle firings (signal tokens → `''`). */
  signal?: RecordRuleFireContext['signal']
}

/**
 * Build the {@link RuleTokenContext} for one firing: the record's denormalized display
 * name, and a `PlaceholderResolutionContext` rooted at the fired rule's def — plus the
 * contact def root when the signal carries a distinct contact (mirroring
 * `buildPlaceholderContextForThread`).
 */
export async function buildRuleTokenContext(ctx: RecordRuleFireContext): Promise<RuleTokenContext> {
  const [{ database, schema }, { and, eq }] = await Promise.all([
    import('@auxx/database'),
    import('drizzle-orm'),
  ])
  const [instance] = await database
    .select({ displayName: schema.EntityInstance.displayName })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.id, ctx.entityInstanceId),
        eq(schema.EntityInstance.organizationId, ctx.organizationId)
      )
    )
    .limit(1)
  const recordName = instance?.displayName || ctx.entityInstanceId

  const [{ SystemUserService }, { toRecordId }] = await Promise.all([
    import('../users/system-user-service'),
    import('@auxx/types/resource'),
  ])
  const senderUserId = await SystemUserService.getSystemUserForActions(ctx.organizationId)

  const recordIdsByRoot: PlaceholderResolutionContext['recordIdsByRoot'] = new Map()
  recordIdsByRoot.set(
    ctx.entityDefinitionId,
    toRecordId(ctx.entityDefinitionId, ctx.entityInstanceId)
  )
  const contactInstanceId = ctx.signal?.contactEntityInstanceId
  if (contactInstanceId && contactInstanceId !== ctx.entityInstanceId) {
    const { getOrgCache } = await import('../cache')
    const entityDefs = await getOrgCache().get(ctx.organizationId, 'entityDefs')
    // The fired record's root always wins — only add the contact under its own def.
    if (entityDefs.contact && entityDefs.contact !== ctx.entityDefinitionId) {
      recordIdsByRoot.set(entityDefs.contact, toRecordId('contact', contactInstanceId))
    }
  }

  return {
    recordName,
    signal: ctx.signal,
    placeholderCtx: {
      db: database,
      organizationId: ctx.organizationId,
      senderUserId,
      recordIdsByRoot,
    },
  }
}

/**
 * Resolve a text-bearing action field (`create-task.title`, `notify.message`) to plain
 * text. Docs go pre-pass → shared resolver → `docToText`; a shared-resolver throw
 * degrades to the pre-passed doc with remaining tokens as `''` (one bad token must not
 * kill the action). Defensive guard: a plain string (stale seeded row) passes through
 * verbatim — no interpolation.
 */
export async function resolveActionDocToText(
  value: TiptapDoc | string,
  ctx: RuleTokenContext
): Promise<string> {
  if (typeof value === 'string') return value
  const prepped = prePassRuleTokens(value, ctx) as TiptapDoc
  try {
    const { resolvePlaceholdersInDocument } = await import('../placeholders/document-resolver')
    const resolved = await resolvePlaceholdersInDocument(prepped, ctx.placeholderCtx)
    return docToText(resolved)
  } catch (error) {
    logger.warn('Rule action placeholder resolution failed — degrading to plain text', {
      organizationId: ctx.placeholderCtx.organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return docToText(prepped, { placeholders: () => '' })
  }
}

/**
 * Resolve a `set-field` value. Non-docs (raw static strings/numbers/booleans) pass
 * through verbatim. A doc whose only meaningful content is ONE placeholder node (single
 * paragraph, whitespace-only text ignored) resolves to the RAW value, type preserved:
 * field tokens via the shared `resolveFieldTokens` (empty + fallback → the fallback
 * text), `record:name` → the display name, `signal:*` → its raw value (`occurredAt` as
 * ISO string). Anything else flattens via {@link resolveActionDocToText}, then coerces
 * the final string to a primitive (`'true'`/`'false'` → boolean, numeric → number) so a
 * NUMBER field set to a typed `"42"` still receives a number.
 */
export async function resolveActionValue(value: unknown, ctx: RuleTokenContext): Promise<unknown> {
  if (!isActionDoc(value)) return value
  const solo = singlePlaceholderNode(value)
  if (!solo) return coercePrimitive(await resolveActionDocToText(value, ctx))

  if (isRuleActionToken(solo.id)) {
    const raw = ruleTokenRawValue(solo.id, ctx)
    return raw === undefined || raw === '' ? nodeFallbackText(solo.attrs) : raw
  }

  const parsed = tryParsePlaceholderId(solo.id)
  if (parsed?.kind === 'field') {
    try {
      const { resolveFieldTokens } = await import('../placeholders/resolver')
      const values = await resolveFieldTokens([{ id: solo.id, parsed }], ctx.placeholderCtx)
      const resolved = values.get(solo.id)
      if (!resolved) return nodeFallbackText(solo.attrs)
      return Array.isArray(resolved.value)
        ? resolved.value.map((v) => extractValue(v))
        : extractValue(resolved.value)
    } catch (error) {
      logger.warn('Rule set-field token resolution failed — using fallback', {
        organizationId: ctx.placeholderCtx.organizationId,
        tokenId: solo.id,
        error: error instanceof Error ? error.message : String(error),
      })
      return nodeFallbackText(solo.attrs)
    }
  }

  // org/user/date tokens (and unparseable ids) have no raw form — flatten to text.
  return coercePrimitive(await resolveActionDocToText(value, ctx))
}

/**
 * Coerce a flattened set-field string to its primitive form (the write-side replacement
 * for the token editor's old client-side `coerceValue`): `'true'`/`'false'` → boolean,
 * numeric strings → number, everything else stays a string.
 */
function coercePrimitive(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed)
  return text
}

// ── Pre-pass ────────────────────────────────────────────────────────────────

/**
 * Copy the doc, turning every placeholder node the SHARED resolver must not see into a
 * text node: rule tokens (`record:name`, `signal:*`) get their resolved text, and
 * unparseable ids degrade to their fallback/`''` — `resolvePlaceholdersInDocument`
 * THROWS on ids `tryParsePlaceholderId` rejects, so none may reach it. Parseable shared
 * tokens pass through untouched (fallback + format stay theirs to apply).
 */
function prePassRuleTokens(node: TiptapNode, ctx: RuleTokenContext): TiptapNode {
  if (node.type === 'placeholder') {
    const id = typeof node.attrs?.id === 'string' ? (node.attrs.id as string) : ''
    if (id && !isRuleActionToken(id) && tryParsePlaceholderId(id)) {
      // Shared-catalog token — leave for resolvePlaceholdersInDocument.
      return { ...node, attrs: { ...node.attrs } }
    }
    const text = id && isRuleActionToken(id) ? ruleTokenText(id, ctx) : ''
    return {
      type: 'text',
      text: text || nodeFallbackText(node.attrs),
      ...(node.marks ? { marks: node.marks.map((mark) => ({ ...mark })) } : {}),
    }
  }
  return {
    ...node,
    ...(node.attrs ? { attrs: { ...node.attrs } } : {}),
    ...(node.marks ? { marks: node.marks.map((mark) => ({ ...mark })) } : {}),
    ...(node.content
      ? { content: node.content.map((child) => prePassRuleTokens(child, ctx)) }
      : {}),
  }
}

/** Text form of a rule-specific token (`''` when unresolvable — caller applies fallback). */
function ruleTokenText(id: string, ctx: RuleTokenContext): string {
  if (id === 'signal:occurredAt') {
    const iso = ctx.signal?.occurredAt
    if (!iso) return ''
    const date = new Date(iso)
    return Number.isNaN(date.getTime()) ? iso : format(date, 'MMM d, yyyy')
  }
  const raw = ruleTokenRawValue(id, ctx)
  return raw === undefined ? '' : String(raw)
}

/** Raw form of a rule-specific token (set-field solo tokens; `occurredAt` stays ISO). */
function ruleTokenRawValue(id: string, ctx: RuleTokenContext): unknown {
  if (id === ACTION_TOKEN_RECORD_NAME) return ctx.recordName
  if (id === 'signal:kind') {
    const kind = ctx.signal?.kind
    if (!kind) return undefined
    const meta = (SIGNAL_KINDS as Record<string, SignalKindMeta | undefined>)[kind]
    return meta?.label ?? kind
  }
  if (id === 'signal:subtype') return ctx.signal?.subtype
  if (id === 'signal:occurredAt') return ctx.signal?.occurredAt
  return undefined
}

// ── Shape helpers ───────────────────────────────────────────────────────────

/**
 * The single-token rule: exactly one paragraph whose only meaningful content is one
 * placeholder node (whitespace-only text ignored). Returns its id + attrs, else null.
 */
function singlePlaceholderNode(
  doc: TiptapDoc
): { id: string; attrs?: Record<string, unknown> } | null {
  const blocks = doc.content ?? []
  if (blocks.length !== 1) return null
  const paragraph = blocks[0]
  if (!paragraph || paragraph.type !== 'paragraph') return null
  const meaningful = (paragraph.content ?? []).filter(
    (n) => !(typeof n.text === 'string' && n.text.trim() === '')
  )
  const only = meaningful.length === 1 ? meaningful[0] : undefined
  if (!only || only.type !== 'placeholder') return null
  const id = only.attrs?.id
  return typeof id === 'string' && id.length > 0 ? { id, attrs: only.attrs } : null
}

/** Decode a node's `attrs.fallback` payload to text (same codec path as the shared
 * document resolver's `decodePayload`); `''` when absent/undecodable. */
function nodeFallbackText(attrs: Record<string, unknown> | undefined): string {
  const fallback = attrs?.fallback
  if (!fallback || typeof fallback !== 'object') return ''
  const payload = decodeFallback(JSON.stringify(fallback))
  return payload ? renderFallbackPayload(payload) : ''
}
