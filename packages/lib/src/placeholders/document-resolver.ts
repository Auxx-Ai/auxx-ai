// packages/lib/src/placeholders/document-resolver.ts

import { getOrgCache, getUserCache } from '../cache'
import type { TiptapDoc, TiptapNode } from '../tiptap'
import { decodeFallback, type FallbackPayload, renderFallbackPayload } from './fallback-codec'
import {
  decodePlaceholderFormat,
  getPlaceholderFormatOptions,
  type PlaceholderFormatPayload,
} from './format-codec'
import { type ParsedPlaceholder, tryParsePlaceholderId } from './path-parser'
import {
  formatFieldValueForText,
  type PlaceholderResolutionContext,
  resolveFieldTokens,
} from './resolver'

/** Resolve a persisted TipTap document to a concrete document ready for email rendering. */
export async function resolvePlaceholdersInDocument(
  document: TiptapDoc,
  ctx: PlaceholderResolutionContext
): Promise<TiptapDoc> {
  const ids = new Set<string>()
  let needsOrg = false
  let needsUser = false

  walk(document, (node) => {
    if (node.type !== 'placeholder') return
    const id = node.attrs?.id
    if (typeof id !== 'string' || !id) throw new Error('Placeholder node is missing attrs.id')
    const parsed = tryParsePlaceholderId(id)
    if (!parsed) throw new Error(`Unresolvable placeholder token: ${id}`)
    ids.add(id)
    if (parsed.kind === 'org') needsOrg = true
    if (parsed.kind === 'user') needsUser = true
  })

  const fieldTokens: {
    id: string
    parsed: Extract<ParsedPlaceholder, { kind: 'field' }>
  }[] = []
  for (const id of ids) {
    const parsed = tryParsePlaceholderId(id)!
    if (parsed.kind === 'field') fieldTokens.push({ id, parsed })
  }

  const [fieldValues, orgProfile, userProfile] = await Promise.all([
    resolveFieldTokens(fieldTokens, ctx),
    needsOrg ? getOrgCache().get(ctx.organizationId, 'orgProfile') : Promise.resolve(null),
    needsUser && ctx.senderUserId
      ? getUserCache().get(ctx.senderUserId, 'userProfile')
      : Promise.resolve(null),
  ])
  const now = ctx.now ?? new Date()

  const rebuild = (node: TiptapNode): TiptapNode => {
    if (node.type === 'placeholder') {
      const id = node.attrs?.id as string
      return {
        type: 'text',
        text: resolvePlaceholderNodeText(node, id, fieldValues, orgProfile, userProfile, now, ctx),
        ...(node.marks ? { marks: node.marks.map((mark) => ({ ...mark })) } : {}),
      }
    }
    return {
      ...node,
      ...(node.attrs ? { attrs: { ...node.attrs } } : {}),
      ...(node.marks ? { marks: node.marks.map((mark) => ({ ...mark })) } : {}),
      ...(node.content ? { content: node.content.map(rebuild) } : {}),
    }
  }

  return rebuild(document) as TiptapDoc
}

/** Walk all nodes in a document without mutating persisted JSON. */
function walk(node: TiptapNode, visit: (node: TiptapNode) => void): void {
  visit(node)
  for (const child of node.content ?? []) walk(child, visit)
}

/** Resolve one structural placeholder occurrence, including its own fallback and format. */
function resolvePlaceholderNodeText(
  node: TiptapNode,
  id: string,
  fieldValues: Awaited<ReturnType<typeof resolveFieldTokens>>,
  orgProfile: {
    name: string | null
    handle: string | null
    website: string | null
  } | null,
  userProfile: {
    id: string
    name: string | null
    email: string | null
    firstName: string | null
    lastName: string | null
  } | null,
  now: Date,
  ctx: PlaceholderResolutionContext
): string {
  const parsed = tryParsePlaceholderId(id)
  if (!parsed) throw new Error(`Unresolvable placeholder token: ${id}`)
  if (parsed.kind === 'date') return formatDate(parsed.slug, now)

  const fallback = decodePayload<FallbackPayload>(node.attrs?.fallback, decodeFallback)
  const format = decodePayload<PlaceholderFormatPayload>(
    node.attrs?.format,
    decodePlaceholderFormat
  )
  let value = ''

  if (parsed.kind === 'org') {
    if (!orgProfile) throw new Error(`Organization profile not found for org: ${id}`)
    value = orgValue(orgProfile, parsed.slug) ?? ''
  } else if (parsed.kind === 'user') {
    value = userProfile ? (userValue(userProfile, parsed.slug) ?? '') : ''
  } else {
    const resolved = fieldValues.get(id)
    if (resolved) {
      value = formatFieldValueForText(resolved.value, resolved.fieldType, {
        ...resolved.fieldOptions,
        ...getPlaceholderFormatOptions(format, resolved.fieldType),
        ...(ctx.timezone ? { timeZone: ctx.timezone } : {}),
      })
    }
  }

  return value || (fallback ? renderFallbackPayload(fallback) : '')
}

/** Decode persisted node payloads defensively, using the same codecs as HTML. */
function decodePayload<T>(
  value: unknown,
  decode: (raw: string | null | undefined) => T | null
): T | null {
  if (!value || typeof value !== 'object') return null
  return decode(JSON.stringify(value))
}

function orgValue(
  value: { name: string | null; handle: string | null; website: string | null },
  slug: 'name' | 'handle' | 'website'
): string | null {
  return value[slug]
}

function userValue(
  value: {
    id: string
    name: string | null
    email: string | null
    firstName: string | null
    lastName: string | null
  },
  slug: 'id' | 'email' | 'name' | 'firstName' | 'lastName'
): string | null {
  return value[slug]
}

function formatDate(slug: 'today' | 'now' | 'tomorrow' | 'yesterday', now: Date): string {
  const day = 24 * 60 * 60 * 1000
  if (slug === 'now') return now.toLocaleString()
  const date =
    slug === 'tomorrow'
      ? new Date(now.getTime() + day)
      : slug === 'yesterday'
        ? new Date(now.getTime() - day)
        : now
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
