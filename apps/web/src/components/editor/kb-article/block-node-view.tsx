// apps/web/src/components/editor/kb-article/block-node-view.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Input } from '@auxx/ui/components/input'
import type { CalloutVariant, EmbedAspect, EmbedProvider } from '@auxx/ui/components/kb/article'
import { CalloutIcon } from '@auxx/ui/components/kb/article'
import { parseEmbedUrl } from '@auxx/ui/components/kb/utils'
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { Check, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import styles from './block-node-view.module.css'

const CALLOUT_VARIANTS: CalloutVariant[] = ['info', 'tip', 'warn', 'error', 'success']

const CALLOUT_LABELS: Record<CalloutVariant, string> = {
  info: 'Info',
  tip: 'Tip',
  warn: 'Warning',
  error: 'Error',
  success: 'Success',
}

const CODE_LANGUAGES = [
  { id: 'plaintext', label: 'Plain text' },
  { id: 'ts', label: 'TypeScript' },
  { id: 'tsx', label: 'TSX' },
  { id: 'js', label: 'JavaScript' },
  { id: 'jsx', label: 'JSX' },
  { id: 'json', label: 'JSON' },
  { id: 'bash', label: 'Bash' },
  { id: 'sh', label: 'Shell' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'py', label: 'Python' },
  { id: 'go', label: 'Go' },
  { id: 'sql', label: 'SQL' },
] as const

const EMBED_ASPECTS: EmbedAspect[] = ['16:9', '4:3', '1:1']

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
    calloutVariant,
    codeLanguage,
    embedUrl,
    embedAspect,
  } = node.attrs as {
    blockType?: string
    level?: number | null
    checked?: boolean
    imageUrl?: string | null
    imageWidth?: number
    imageAlign?: 'left' | 'center' | 'right'
    calloutVariant?: CalloutVariant
    codeLanguage?: string
    embedUrl?: string | null
    embedProvider?: EmbedProvider
    embedAspect?: EmbedAspect
  }

  const [embedDraft, setEmbedDraft] = useState('')
  const [embedError, setEmbedError] = useState<string | null>(null)

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
  const isCallout = blockType === 'callout'
  const isCodeBlock = blockType === 'codeBlock'
  const isEmbed = blockType === 'embed'
  const hasEmbedUrl = isEmbed && !!embedUrl
  const isEmpty = node.content.size === 0
  const isFirstBlock = pos === 0
  const showPlaceholder =
    isEmpty && !isDivider && !isImage && !isEmbed && !isCallout && (isFocused || isFirstBlock)
  const placeholderText =
    blockType === 'heading' ? `Heading ${level ?? 1}` : "Press '/' for commands"

  const submitEmbed = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    const parsed = parseEmbedUrl(trimmed)
    if (!parsed) {
      setEmbedError('Only YouTube, Loom, and Vimeo URLs are supported')
      return
    }
    setEmbedError(null)
    setEmbedDraft('')
    updateAttributes({ embedUrl: trimmed, embedProvider: parsed.provider })
  }

  const calloutVariantValue: CalloutVariant = calloutVariant ?? 'info'
  const parsedEmbed = hasEmbedUrl ? parseEmbedUrl(embedUrl!) : null

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
    isCodeBlock ? styles['blockContainer--codeBlock'] : '',
    blockType === 'quote' ? styles['blockContainer--quote'] : '',
    isCallout ? styles['blockContainer--callout'] : '',
    isCallout ? styles[`callout--${calloutVariantValue}`] : '',
    isEmbed ? styles['blockContainer--embed'] : '',
  ]
    .filter(Boolean)
    .join(' ')

  const contentWrapperClasses = [
    styles.blockContentWrapper,
    isDivider ? styles['blockContentWrapper--divider'] : '',
    isCodeBlock ? styles['blockContentWrapper--codeBlock'] : '',
    isCallout ? styles['blockContentWrapper--callout'] : '',
    isEmbed ? styles['blockContentWrapper--embed'] : '',
  ]
    .filter(Boolean)
    .join(' ')

  const contentClasses = [
    styles.blockContent,
    blockType === 'heading' && level === 1 ? styles['blockContent--heading1'] : '',
    blockType === 'heading' && level === 2 ? styles['blockContent--heading2'] : '',
    blockType === 'heading' && level === 3 ? styles['blockContent--heading3'] : '',
    blockType === 'quote' ? styles['blockContent--quote'] : '',
    isCodeBlock ? styles['blockContent--codeBlock'] : '',
    isCallout ? styles['blockContent--callout'] : '',
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

          {isCallout && (
            <span className={styles.calloutIcon} contentEditable={false}>
              <CalloutIcon variant={calloutVariantValue} size={16} />
            </span>
          )}

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
          ) : isEmbed ? (
            <>
              {hasEmbedUrl && parsedEmbed ? (
                <div
                  className={styles.embedFrame}
                  data-aspect={embedAspect ?? '16:9'}
                  contentEditable={false}>
                  <iframe
                    src={parsedEmbed.embedSrc}
                    title={`${parsedEmbed.provider} embed`}
                    allowFullScreen
                    sandbox='allow-scripts allow-same-origin allow-presentation'
                  />
                  <div className={styles.embedToolbar}>
                    <button
                      type='button'
                      className={styles.embedSmallButton}
                      onClick={() => updateAttributes({ embedUrl: null, embedProvider: null })}>
                      Edit URL
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type='button' className={styles.embedSmallButton}>
                          {embedAspect ?? '16:9'} <ChevronDown size={12} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end'>
                        {EMBED_ASPECTS.map((aspect) => (
                          <DropdownMenuItem
                            key={aspect}
                            onSelect={() => updateAttributes({ embedAspect: aspect })}>
                            {aspect}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ) : (
                <div className={styles.embedPrompt} contentEditable={false}>
                  <div className={styles.embedPromptRow}>
                    <Input
                      type='url'
                      variant='secondary'
                      className={styles.embedInput}
                      placeholder='Paste YouTube / Loom / Vimeo URL'
                      value={embedDraft}
                      onChange={(e) => {
                        setEmbedDraft(e.target.value)
                        if (embedError) setEmbedError(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          submitEmbed(embedDraft)
                        }
                      }}
                    />
                    <Button type='button' onClick={() => submitEmbed(embedDraft)}>
                      Embed
                    </Button>
                  </div>
                  {embedError && <span className={styles.embedError}>{embedError}</span>}
                </div>
              )}
              <NodeViewContent className={`${styles.blockContent} ${styles.blockContentHidden}`} />
            </>
          ) : (
            <NodeViewContent className={contentClasses} />
          )}

          {isCodeBlock && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type='button' className={styles.codeLanguagePicker} contentEditable={false}>
                  {CODE_LANGUAGES.find((l) => l.id === codeLanguage)?.label ?? 'Plain text'}{' '}
                  <ChevronDown size={12} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                {CODE_LANGUAGES.map((lang) => (
                  <DropdownMenuItem
                    key={lang.id}
                    onSelect={() => updateAttributes({ codeLanguage: lang.id })}>
                    {lang.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {isCallout && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  className={styles.calloutVariantPicker}
                  contentEditable={false}
                  aria-label='Change callout variant'>
                  <CalloutIcon variant={calloutVariantValue} size={14} />
                  <ChevronDown size={12} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                {CALLOUT_VARIANTS.map((variant) => (
                  <DropdownMenuItem
                    key={variant}
                    onSelect={() => updateAttributes({ calloutVariant: variant })}>
                    <CalloutIcon variant={variant} size={14} /> {CALLOUT_LABELS[variant]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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
