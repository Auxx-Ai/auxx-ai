// apps/web/src/components/editor/kb-article/block-node-view.tsx
'use client'

import type { NodeViewProps } from '@tiptap/react'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { Check } from 'lucide-react'
import styles from './block-node-view.module.css'

function formatBullet(depth: number): string {
  const bullets = ['•', '◦', '▪']
  return bullets[depth % bullets.length] ?? '•'
}

function toRoman(n: number): string {
  let value = n
  let result = ''
  const values: [number, string][] = [
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

function formatNumber(index: number, depth: number): string {
  const level = depth % 3
  if (level === 0) return `${index}.`
  if (level === 1) return `${String.fromCharCode(96 + index)}.`
  return `${toRoman(index)}.`
}

export function BlockNodeView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const {
    blockType = 'text',
    level,
    checked,
    imageUrl,
    imageWidth,
    imageAlign,
  } = node.attrs as {
    blockType?: string
    level?: number | null
    checked?: boolean
    imageUrl?: string | null
    imageWidth?: number
    imageAlign?: 'left' | 'center' | 'right'
  }

  const pos = typeof getPos === 'function' ? getPos() : null
  const isListType =
    blockType === 'bulletListItem' ||
    blockType === 'numberedListItem' ||
    blockType === 'todoListItem'
  const indentLevel = isListType ? (level ?? 1) : 0

  let lineNumber: number | null = null
  let numberedIndex = 1
  if (typeof pos === 'number') {
    const doc = editor.state.doc
    const myIndex = doc.resolve(pos).index(0)
    lineNumber = myIndex + 1

    if (blockType === 'numberedListItem') {
      const myLevel = level ?? 1
      let count = 1
      for (let i = myIndex - 1; i >= 0; i--) {
        const sibling = doc.child(i)
        if (sibling.type.name !== 'block') break
        if (sibling.attrs.blockType !== 'numberedListItem') break
        if ((sibling.attrs.level ?? 1) !== myLevel) break
        count++
      }
      numberedIndex = count
    }
  }

  const isFocused =
    typeof pos === 'number' &&
    editor.state.selection.$from.pos >= pos &&
    editor.state.selection.$from.pos <= pos + node.nodeSize

  const isDivider = blockType === 'divider'
  const isImage = blockType === 'image' && !!imageUrl
  const isEmpty = node.content.size === 0
  const isFirstBlock = pos === 0
  const showPlaceholder = isEmpty && !isDivider && !isImage && (isFocused || isFirstBlock)
  const placeholderText =
    blockType === 'heading' ? `Heading ${level ?? 1}` : "Press '/' for commands"

  const wrapperClasses = [styles.blockWrapper, isFocused ? styles.focused : '']
    .filter(Boolean)
    .join(' ')

  const selectThisBlock = (event: React.MouseEvent) => {
    if (typeof pos !== 'number') return
    event.preventDefault()
    event.stopPropagation()
    editor.commands.setNodeSelection(pos)
  }

  const containerClasses = [
    styles.blockContainer,
    isDivider ? styles['blockContainer--divider'] : '',
    blockType === 'heading' && level === 1 ? styles['blockContainer--heading1'] : '',
    blockType === 'heading' && level === 2 ? styles['blockContainer--heading2'] : '',
    blockType === 'heading' && level === 3 ? styles['blockContainer--heading3'] : '',
    blockType === 'codeBlock' ? styles['blockContainer--codeBlock'] : '',
    blockType === 'quote' ? styles['blockContainer--quote'] : '',
  ]
    .filter(Boolean)
    .join(' ')

  const contentWrapperClasses = [
    styles.blockContentWrapper,
    isDivider ? styles['blockContentWrapper--divider'] : '',
    blockType === 'codeBlock' ? styles['blockContentWrapper--codeBlock'] : '',
  ]
    .filter(Boolean)
    .join(' ')

  const contentClasses = [
    styles.blockContent,
    blockType === 'heading' && level === 1 ? styles['blockContent--heading1'] : '',
    blockType === 'heading' && level === 2 ? styles['blockContent--heading2'] : '',
    blockType === 'heading' && level === 3 ? styles['blockContent--heading3'] : '',
    blockType === 'quote' ? styles['blockContent--quote'] : '',
    blockType === 'codeBlock' ? styles['blockContent--codeBlock'] : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <NodeViewWrapper
      className={wrapperClasses}
      data-block=''
      data-indent-level={indentLevel > 0 ? indentLevel : undefined}>
      <div className={containerClasses}>
        <div
          className={styles.lineGutter}
          contentEditable={false}
          draggable={true}
          data-block-drag-handle='true'
          onClick={selectThisBlock}>
          <div className={`${styles.lineNumber} text-xs tabular-nums`}>{lineNumber ?? ''}</div>
        </div>

        <div className={contentWrapperClasses} data-content-wrapper>
          {blockType === 'bulletListItem' && (
            <span className={styles.bulletIndicator} contentEditable={false}>
              {formatBullet(indentLevel)}
            </span>
          )}

          {blockType === 'numberedListItem' && (
            <span className={styles.numberIndicator} contentEditable={false}>
              {formatNumber(numberedIndex, indentLevel)}
            </span>
          )}

          {blockType === 'todoListItem' && (
            <label className={styles.todoCheckbox} contentEditable={false}>
              <input
                type='checkbox'
                checked={!!checked}
                onChange={() => updateAttributes({ checked: !checked })}
              />
              <div className={styles.checkmarkIcon}>
                <Check size={10} strokeWidth={3} />
              </div>
            </label>
          )}

          {blockType === 'quote' && <div className={styles.quoteBar} contentEditable={false} />}

          {isDivider ? (
            <>
              <div
                className={styles.dividerLine}
                role='separator'
                aria-hidden='true'
                contentEditable={false}
                onClick={selectThisBlock}
              />
              <NodeViewContent className={`${styles.blockContent} ${styles.blockContentHidden}`} />
            </>
          ) : (
            <NodeViewContent className={contentClasses} />
          )}

          {isImage && (
            <img
              src={imageUrl ?? ''}
              alt=''
              width={imageWidth ?? 400}
              className={styles[`imageAlign--${imageAlign ?? 'center'}`]}
              contentEditable={false}
            />
          )}

          {showPlaceholder && (
            <span className={styles.placeholder} contentEditable={false} aria-hidden='true'>
              {placeholderText}
            </span>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  )
}
