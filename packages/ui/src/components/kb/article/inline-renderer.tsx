// packages/ui/src/components/kb/article/inline-renderer.tsx

import type { Fragment, ReactNode } from 'react'
import type { InlineJSON, MarkJSON, ResolveAuxxHref } from './types'

interface InlineRendererProps {
  content: InlineJSON[] | undefined
  resolveAuxxHref?: ResolveAuxxHref
}

const AUXX_KB_PREFIX = 'auxx://kb/article/'

const defaultResolveAuxxHref: ResolveAuxxHref = (id) => `/r/${id}`

export function InlineRenderer({ content, resolveAuxxHref }: InlineRendererProps) {
  if (!content || content.length === 0) return null
  const resolver = resolveAuxxHref ?? defaultResolveAuxxHref
  return (
    <>
      {content.map((node, idx) => (
        // Tiptap inline nodes share neither id nor stable key; idx is the only option.
        // biome-ignore lint/suspicious/noArrayIndexKey: inline order is stable per render
        <InlineNode key={idx} node={node} resolveAuxxHref={resolver} />
      ))}
    </>
  )
}

interface InlineNodeProps {
  node: InlineJSON
  resolveAuxxHref: ResolveAuxxHref
}

function InlineNode({ node, resolveAuxxHref }: InlineNodeProps) {
  if (node.type === 'placeholder') {
    const label = (node.attrs?.label as string | undefined) ?? ''
    return (
      <span data-kb-placeholder='' className='kb-placeholder'>
        {label ? `{${label}}` : ''}
      </span>
    )
  }

  if (node.type !== 'text') return null
  const text = node.text ?? ''
  if (!text) return null

  return applyMarks(text, node.marks ?? [], resolveAuxxHref)
}

function applyMarks(text: string, marks: MarkJSON[], resolveAuxxHref: ResolveAuxxHref): ReactNode {
  let node: ReactNode = text
  for (const mark of marks) {
    node = wrapMark(node, mark, resolveAuxxHref)
  }
  return node
}

function wrapMark(node: ReactNode, mark: MarkJSON, resolveAuxxHref: ResolveAuxxHref): ReactNode {
  switch (mark.type) {
    case 'bold':
      return <strong>{node}</strong>
    case 'italic':
      return <em>{node}</em>
    case 'underline':
      return <u>{node}</u>
    case 'strike':
      return <s>{node}</s>
    case 'code':
      return <code className='kb-inline-code'>{node}</code>
    case 'highlight':
      return <mark className='kb-mark'>{node}</mark>
    case 'link': {
      const rawHref = (mark.attrs?.href as string | undefined) ?? '#'
      // Internal auxx:// link — the consumer's redirect handler resolves
      // the article id to the canonical URL on click.
      if (rawHref.startsWith(AUXX_KB_PREFIX)) {
        const articleId = rawHref.slice(AUXX_KB_PREFIX.length)
        return (
          <a className='kb-link' href={resolveAuxxHref(articleId)}>
            {node}
          </a>
        )
      }
      const explicitTarget = mark.attrs?.target as string | undefined
      const target = explicitTarget ?? '_blank'
      const rel = target === '_blank' ? 'noopener noreferrer' : undefined
      return (
        <a className='kb-link' href={rawHref} target={target} rel={rel}>
          {node}
        </a>
      )
    }
    default:
      return node
  }
}

export type { Fragment }
