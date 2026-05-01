// packages/ui/src/components/kb/article/kb-article-copy-menu.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { ButtonGroup } from '@auxx/ui/components/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { ClaudeAI } from '@auxx/ui/components/logos/claude'
import { OpenAI } from '@auxx/ui/components/logos/open-ai'
import { toastError } from '@auxx/ui/components/toast'
import { Check, ChevronDown, Copy, FileText } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

interface KBArticleCopyMenuProps {
  /**
   * Resolves the article's Markdown text. Lives on the consumer side so the
   * UI package stays free of a dependency on `@auxx/lib`. Apps typically wire
   * a dynamic import of `@auxx/lib/kb/markdown` here.
   */
  getMarkdown?: () => Promise<string>
  /**
   * Public URL to the same article rendered as Markdown (e.g. `/acme/help/x.md`).
   * When set, the dropdown shows "View as Markdown" plus "Open in ChatGPT" /
   * "Open in Claude" items. The LLM items resolve to an absolute URL from
   * `window.location.origin + markdownHref` at click time.
   */
  markdownHref?: string
}

type CopyState = 'idle' | 'copying' | 'copied'

const COPIED_DURATION_MS = 2000
const LLM_SHARE_PROMPT = (url: string) => `Read from ${url} so I can ask questions about it.`

/**
 * Copy + view-as-markdown actions for a rendered KB article. Renders a
 * `ButtonGroup` whose primary action copies the article as Markdown and whose
 * chevron exposes a dropdown with the same Copy entry, an optional link to
 * the `.md` URL of the page, and (on public surfaces) "Open in ChatGPT" and
 * "Open in Claude" items that pre-fill a "Read from <url>" prompt.
 */
export function KBArticleCopyMenu({ getMarkdown, markdownHref }: KBArticleCopyMenuProps) {
  const [state, setState] = useState<CopyState>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const handleCopy = useCallback(async () => {
    if (!getMarkdown || state === 'copying') return
    setState('copying')
    try {
      const md = await getMarkdown()
      await navigator.clipboard.writeText(md)
      setState('copied')
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setState('idle'), COPIED_DURATION_MS)
    } catch (err) {
      setState('idle')
      toastError({
        title: 'Failed to copy',
        description: err instanceof Error ? err.message : 'Clipboard write was rejected.',
      })
    }
  }, [getMarkdown, state])

  const openLLM = useCallback(
    (target: 'chatgpt' | 'claude') => {
      if (!markdownHref) return
      // Resolve to an absolute URL so the LLM crawler can fetch it from
      // outside our origin. Path inputs combine with the current origin.
      const absoluteUrl = new URL(markdownHref, window.location.href).toString()
      const prompt = LLM_SHARE_PROMPT(absoluteUrl)
      const url =
        target === 'chatgpt'
          ? `https://chatgpt.com/?prompt=${encodeURIComponent(prompt)}`
          : `https://claude.ai/new?q=${encodeURIComponent(prompt)}`
      window.open(url, '_blank', 'noopener')
    },
    [markdownHref]
  )

  if (!getMarkdown && !markdownHref) return null

  const primaryLabel = state === 'copied' ? 'Copied' : 'Copy page'
  const PrimaryIcon = state === 'copied' ? Check : Copy
  const showLLMItems = Boolean(markdownHref)

  return (
    <ButtonGroup>
      <Button
        variant='outline'
        size='xs'
        onClick={handleCopy}
        loading={state === 'copying'}
        loadingText='Copying...'
        disabled={!getMarkdown}>
        <PrimaryIcon />
        {primaryLabel}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='outline' size='xs' aria-label='More copy options'>
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-72'>
          {getMarkdown ? (
            <DropdownMenuItem
              className='items-start gap-3 py-2'
              onSelect={(event) => {
                event.preventDefault()
                void handleCopy()
              }}>
              <Copy className='mt-0.5' />
              <div className='flex flex-col'>
                <span>Copy page</span>
                <span className='text-xs text-muted-foreground'>
                  Copy page as Markdown for LLMs
                </span>
              </div>
            </DropdownMenuItem>
          ) : null}
          {markdownHref ? (
            <DropdownMenuItem asChild className='items-start gap-3 py-2'>
              <a href={markdownHref} target='_blank' rel='noopener'>
                <FileText className='mt-0.5' />
                <div className='flex flex-col'>
                  <span>View as Markdown</span>
                  <span className='text-xs text-muted-foreground'>
                    View this page in plain text
                  </span>
                </div>
              </a>
            </DropdownMenuItem>
          ) : null}
          {showLLMItems ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className='items-start gap-3 py-2'
                onSelect={(event) => {
                  event.preventDefault()
                  openLLM('chatgpt')
                }}>
                <OpenAI className='mt-0.5' />
                <div className='flex flex-col'>
                  <span>Open in ChatGPT</span>
                  <span className='text-xs text-muted-foreground'>
                    Ask questions about this page
                  </span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                className='items-start gap-3 py-2'
                onSelect={(event) => {
                  event.preventDefault()
                  openLLM('claude')
                }}>
                <ClaudeAI className='mt-0.5' />
                <div className='flex flex-col'>
                  <span>Open in Claude</span>
                  <span className='text-xs text-muted-foreground'>
                    Ask questions about this page
                  </span>
                </div>
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  )
}
