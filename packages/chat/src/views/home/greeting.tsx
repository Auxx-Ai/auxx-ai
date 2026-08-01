// packages/chat/src/views/home/greeting.tsx
//
// Tiptap JSON renderer for the Home greeting. Walks the doc and substitutes
// `placeholder` nodes whose id starts with `visitor:` against the widget's
// identify claims, falling back to the badge's stored fallback payload (or an
// empty string). All other text/inline content renders verbatim.

import type { IdentifyPayload } from '~/identify'
import type { TiptapNode } from '~/transport/config'

interface GreetingProps {
  doc: TiptapNode | null
  identify: IdentifyPayload | null
}

export function Greeting({ doc, identify }: GreetingProps) {
  if (!doc) {
    return <h2 className='text-xl font-semibold leading-tight'>Hi! How can we help?</h2>
  }
  return (
    <h2 className='text-xl font-semibold leading-tight'>
      {renderNodes(doc.content ?? [], identify, true)}
    </h2>
  )
}

/**
 * Render a Tiptap doc as inline content, substituting `visitor:*` placeholder
 * nodes against the identify payload (or their fallback). Exported so the
 * conversation welcome bubble can reuse the same walker as the Home greeting.
 *
 *  - `collapseBlocks` collapses paragraphs into plain spans (no block-level
 *    line break). Pass `false` to render paragraph as a `display:block` span,
 *    matching the editor's visual line breaks.
 */
export function renderGreetingInline(
  doc: TiptapNode | null,
  identify: IdentifyPayload | null,
  options: { collapseBlocks?: boolean } = {}
) {
  if (!doc) return null
  return renderNodes(doc.content ?? [], identify, options.collapseBlocks ?? true)
}

function renderNodes(
  nodes: TiptapNode[],
  identify: IdentifyPayload | null,
  collapseBlocks: boolean
) {
  return nodes.map((node, i) => renderNode(node, identify, collapseBlocks, i))
}

function renderNode(
  node: TiptapNode,
  identify: IdentifyPayload | null,
  collapseBlocks: boolean,
  key: number
) {
  if (node.type === 'text') {
    const text = node.text ?? ''
    return applyMarks(text, node.marks ?? [], key)
  }
  if (node.type === 'placeholder') {
    const id = String(node.attrs?.id ?? '')
    const value = resolveVisitor(id, identify)
    if (value !== null && value !== '') return <span key={key}>{value}</span>
    const fallback = decodeFallbackText(node.attrs?.fallback)
    return <span key={key}>{fallback ?? ''}</span>
  }
  if (node.type === 'paragraph') {
    const children = renderNodes(node.content ?? [], identify, false)
    if (collapseBlocks) return <span key={key}>{children}</span>
    return (
      <span key={key} className='block'>
        {children}
      </span>
    )
  }
  if (node.type === 'hardBreak') {
    return <br key={key} />
  }
  if (node.content) {
    return <span key={key}>{renderNodes(node.content, identify, false)}</span>
  }
  return null
}

function applyMarks(text: string, marks: { type: string }[], key: number) {
  let node: preact.ComponentChildren = text
  for (const mark of marks) {
    if (mark.type === 'bold' || mark.type === 'strong') node = <strong>{node}</strong>
    else if (mark.type === 'italic' || mark.type === 'em') node = <em>{node}</em>
    else if (mark.type === 'underline') node = <u>{node}</u>
    else if (mark.type === 'code') node = <code>{node}</code>
  }
  return <span key={key}>{node}</span>
}

function resolveVisitor(id: string, identify: IdentifyPayload | null): string | null {
  if (!id.startsWith('visitor:')) return null
  const slug = id.slice('visitor:'.length)
  if (!identify) return null
  if (slug === 'name') return identify.name ?? null
  if (slug === 'email') return identify.email ?? null
  if (slug === 'externalId') return identify.externalId ?? null
  return null
}

/**
 * Decode the placeholder node's `fallback` attr. In editor state this is the
 * decoded `FallbackPayload` object (object form); when round-tripped through
 * HTML it can also be a JSON string. Both shapes resolve to plain text.
 */
function decodeFallbackText(raw: unknown): string | null {
  if (!raw) return null
  let decoded: unknown = raw
  if (typeof raw === 'string') {
    try {
      decoded = JSON.parse(raw)
    } catch {
      // Not JSON — the attr already holds plain fallback text.
      return raw
    }
  }
  if (typeof decoded !== 'object' || decoded === null) return null
  const payload = decoded as { v?: number; t?: string; d?: unknown }
  if (payload.v !== 1) return null
  switch (payload.t) {
    case 'TEXT':
    case 'URL':
    case 'EMAIL':
    case 'PHONE_INTL':
    case 'DATE':
    case 'DATETIME':
    case 'TIME':
      return typeof payload.d === 'string' ? payload.d : null
    case 'NUMBER':
    case 'CURRENCY':
      return typeof payload.d === 'number' ? String(payload.d) : null
    case 'CHECKBOX':
      return payload.d ? 'Yes' : 'No'
    case 'NAME': {
      const d = payload.d as { firstName?: string; lastName?: string } | undefined
      if (!d) return null
      return [d.firstName, d.lastName].filter(Boolean).join(' ') || null
    }
    default:
      return null
  }
}
