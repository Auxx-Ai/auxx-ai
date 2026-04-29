// packages/ui/src/components/kb/article/block-renderer.tsx

import { walkInlineToText } from '../utils/inline-text'
import { InlineRenderer } from './inline-renderer'
import styles from './kb-article-renderer.module.css'
import type { BlockJSON, DocJSON } from './types'

interface BlockRendererProps {
  node: BlockJSON
  idx: number
  doc: DocJSON
  headingIds?: Record<number, string>
}

export function BlockRenderer({ node, idx, doc, headingIds }: BlockRendererProps) {
  const inline = <InlineRenderer content={node.content} />
  const blockType = node.attrs?.blockType ?? 'text'

  switch (blockType) {
    case 'heading': {
      const level = clampHeading(node.attrs?.level ?? 1)
      const id = headingIds?.[idx] ?? fallbackAnchorId(node, idx)
      const className = styles[`h${level}`] ?? styles.h1
      if (level === 1) {
        return (
          <h2 id={id} className={className}>
            {inline}
          </h2>
        )
      }
      if (level === 2) {
        return (
          <h3 id={id} className={className}>
            {inline}
          </h3>
        )
      }
      return (
        <h4 id={id} className={className}>
          {inline}
        </h4>
      )
    }

    case 'bulletListItem': {
      const indent = clampIndent(node.attrs?.level ?? 1)
      return (
        <div className={styles.list} data-indent-level={indent}>
          <span className={styles.bullet}>{formatBullet(indent - 1)}</span>
          <div>{inline}</div>
        </div>
      )
    }

    case 'numberedListItem': {
      const indent = clampIndent(node.attrs?.level ?? 1)
      const number = computeNumber(doc, idx)
      return (
        <div className={styles.list} data-indent-level={indent}>
          <span className={styles.numberMarker}>{formatNumber(number, indent - 1)}</span>
          <div>{inline}</div>
        </div>
      )
    }

    case 'todoListItem': {
      const indent = clampIndent(node.attrs?.level ?? 1)
      const checked = !!node.attrs?.checked
      return (
        <div className={styles.list} data-indent-level={indent}>
          <span
            className={styles.todoCheckbox}
            data-checked={checked ? 'true' : 'false'}
            aria-hidden='true'>
            {checked ? '✓' : ''}
          </span>
          <div className={styles.todoLabel} data-checked={checked ? 'true' : 'false'}>
            {inline}
          </div>
        </div>
      )
    }

    case 'quote':
      return <blockquote className={styles.quote}>{inline}</blockquote>

    case 'codeBlock':
      return (
        <pre className={styles.code}>
          <code>{walkInlineToText(node.content)}</code>
        </pre>
      )

    case 'divider':
      return <hr className={styles.divider} />

    case 'image': {
      const url = node.attrs?.imageUrl
      if (!url) return null
      const align = node.attrs?.imageAlign ?? 'center'
      const width = node.attrs?.imageWidth ?? 400
      return (
        <div className={`${styles.imageWrapper} ${styles[`imageAlign_${align}`] ?? ''}`}>
          {/** biome-ignore lint/performance/noImgElement: Next/Image not used cross-package; consumers can override */}
          <img src={url} width={width} alt='' />
        </div>
      )
    }

    case 'text':
    default:
      return <p className={styles.text}>{inline}</p>
  }
}

function clampHeading(level: number): 1 | 2 | 3 {
  if (level <= 1) return 1
  if (level === 2) return 2
  return 3
}

function clampIndent(level: number): number {
  if (level < 1) return 1
  if (level > 5) return 5
  return level
}

function fallbackAnchorId(node: BlockJSON, idx: number): string {
  const text = walkInlineToText(node.content)
  if (!text) return `h-${idx}`
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 64)
}

function computeNumber(doc: DocJSON, idx: number): number {
  const target = doc.content[idx]
  if (!target) return 1
  const targetLevel = target.attrs?.level ?? 1
  let count = 1
  for (let i = idx - 1; i >= 0; i--) {
    const sibling = doc.content[i]
    if (!sibling) break
    if (sibling.attrs?.blockType !== 'numberedListItem') break
    if ((sibling.attrs?.level ?? 1) !== targetLevel) break
    count++
  }
  return count
}

function formatBullet(depth: number): string {
  const bullets = ['•', '◦', '▪']
  return bullets[depth % bullets.length] ?? '•'
}

function formatNumber(index: number, depth: number): string {
  const level = depth % 3
  if (level === 0) return `${index}.`
  if (level === 1) return `${String.fromCharCode(96 + index)}.`
  return `${toRoman(index)}.`
}

function toRoman(n: number): string {
  let value = n
  let result = ''
  const values: Array<[number, string]> = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ]
  for (const [v, sym] of values) {
    while (value >= v) {
      result += sym
      value -= v
    }
  }
  return result
}
