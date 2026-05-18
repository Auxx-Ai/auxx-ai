// apps/web/src/components/kopilot/ui/messages/user-message.tsx

'use client'

import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import type { ActorId } from '@auxx/types/actor'
import { createElement, useMemo } from 'react'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { ThreadBadge } from '~/components/threads/ui/thread-badge'
import type { KopilotMessage } from '../../stores/kopilot-store'
import { MessageActions } from './message-actions'

interface UserMessageProps {
  message: KopilotMessage
  onEdit?: () => void
  onRetry?: () => void
}

export function UserMessage({ message, onEdit, onRetry }: UserMessageProps) {
  const content = message.content ?? ''
  return (
    <div className='group/message flex flex-col items-end gap-1'>
      <div className='bg-illustration text-muted-foreground max-w-4/5 ring-border-illustration shadow-black/6.5 ml-auto w-fit rounded-l-xl rounded-br rounded-tr-xl px-3 py-2 text-sm/5 shadow ring-1'>
        <UserMessageContent html={content} />
      </div>
      <MessageActions role='user' content={content} onEdit={onEdit} onRetry={onRetry} />
    </div>
  )
}

function UserMessageContent({ html }: { html: string }) {
  const nodes = useMemo(() => parseMessageHtml(html), [html])
  return <>{nodes}</>
}

function parseMessageHtml(html: string): React.ReactNode {
  if (typeof window === 'undefined' || !html) {
    return <span dangerouslySetInnerHTML={{ __html: html }} />
  }
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstElementChild
  if (!root) return null
  return Array.from(root.childNodes).map((n, i) => renderNode(n, String(i)))
}

const REFERENCE_TEXT_PATTERN = /@\[([^\]]+)\]/g

function renderTextWithReferences(text: string, key: string): React.ReactNode {
  if (!text.includes('@[')) return text
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  REFERENCE_TEXT_PATTERN.lastIndex = 0
  let i = 0
  while ((match = REFERENCE_TEXT_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    parts.push(<ReferenceBadge key={`${key}-r${i}`} id={match[1] as string} />)
    lastIndex = match.index + match[0].length
    i++
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts.length === 1 ? parts[0] : <>{parts}</>
}

function renderNode(node: Node, key: string): React.ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return renderTextWithReferences(node.textContent ?? '', key)
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null
  const el = node as Element

  if (el.tagName === 'SPAN' && el.getAttribute('data-type') === 'reference') {
    const id = el.getAttribute('data-id')
    if (id) return <ReferenceBadge key={key} id={id} />
  }

  const tag = el.tagName.toLowerCase()
  const children = Array.from(el.childNodes).map((c, i) => renderNode(c, `${key}-${i}`))
  const props: Record<string, unknown> = { key }
  const style = el.getAttribute('style')
  if (style) props.style = cssTextToObject(style)
  const cls = el.getAttribute('class')
  if (cls) props.className = cls
  return createElement(tag, props, ...children)
}

function ReferenceBadge({ id }: { id: string }) {
  const cls = 'inline-flex align-middle'
  if (id.startsWith('user:') || id.startsWith('group:')) {
    return <ActorBadge actorId={id as ActorId} className={cls} />
  }
  if (id.startsWith('thread:') || id.startsWith('draft:')) {
    try {
      const { entityInstanceId } = parseRecordId(id as RecordId)
      return <ThreadBadge threadId={entityInstanceId} className={cls} />
    } catch {
      return <RecordBadge recordId={id as RecordId} className={cls} />
    }
  }
  return <RecordBadge recordId={id as RecordId} className={cls} />
}

function cssTextToObject(css: string): React.CSSProperties {
  const out: Record<string, string> = {}
  for (const rule of css.split(';')) {
    const idx = rule.indexOf(':')
    if (idx < 0) continue
    const prop = rule.slice(0, idx).trim()
    const value = rule.slice(idx + 1).trim()
    if (!prop || !value) continue
    const camel = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    out[camel] = value
  }
  return out as React.CSSProperties
}
