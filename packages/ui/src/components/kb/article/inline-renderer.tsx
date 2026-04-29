// packages/ui/src/components/kb/article/inline-renderer.tsx

import type { Fragment, ReactNode } from 'react'
import type { InlineJSON, MarkJSON } from './types'

interface InlineRendererProps {
  content: InlineJSON[] | undefined
}

export function InlineRenderer({ content }: InlineRendererProps) {
  if (!content || content.length === 0) return null
  return (
    <>
      {content.map((node, idx) => (
        // Tiptap inline nodes share neither id nor stable key; idx is the only option.
        // biome-ignore lint/suspicious/noArrayIndexKey: inline order is stable per render
        <InlineNode key={idx} node={node} />
      ))}
    </>
  )
}

function InlineNode({ node }: { node: InlineJSON }) {
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

  return applyMarks(text, node.marks ?? [])
}

function applyMarks(text: string, marks: MarkJSON[]): ReactNode {
  let node: ReactNode = text
  for (const mark of marks) {
    node = wrapMark(node, mark)
  }
  return node
}

function wrapMark(node: ReactNode, mark: MarkJSON): ReactNode {
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
      const href = (mark.attrs?.href as string | undefined) ?? '#'
      const target = (mark.attrs?.target as string | undefined) ?? undefined
      const rel = target === '_blank' ? 'noopener noreferrer' : undefined
      return (
        <a className='kb-link' href={href} target={target} rel={rel}>
          {node}
        </a>
      )
    }
    default:
      return node
  }
}

export type { Fragment }
