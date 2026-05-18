// apps/web/src/components/kopilot/ui/messages/streaming-text.tsx

'use client'

import { motion, useReducedMotion } from 'motion/react'
import { useMemo } from 'react'
import Markdown, { type Components, type UrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { splitAtHorizon, useSmoothStream } from '../../hooks/use-smooth-stream'

interface Props {
  raw: string
  isStreaming: boolean
  markdownComponents: Components
  urlTransform: UrlTransform
}

export function StreamingText({ raw, isStreaming, markdownComponents, urlTransform }: Props) {
  const reduced = useReducedMotion()
  const { displayed } = useSmoothStream(raw, { isStreaming })
  const { prefix, tail, prefixWordCount } = useMemo(() => splitAtHorizon(displayed), [displayed])
  // Split keeps whitespace as alternating tokens so word indices are derivable:
  // word at even position 2k, whitespace at 2k+1.
  const tailTokens = useMemo(() => tail.split(/(\s+)/), [tail])

  return (
    <div>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
        urlTransform={urlTransform}>
        {prefix}
      </Markdown>
      <span aria-hidden>
        {tailTokens.map((tok, i) => {
          if (!tok) return null
          if (/^\s+$/.test(tok)) {
            return <span key={`s-${prefixWordCount}-${i}`}>{tok}</span>
          }
          const wordIndex = prefixWordCount + Math.floor(i / 2)
          return reduced ? (
            <span key={wordIndex}>{tok}</span>
          ) : (
            <motion.span
              key={wordIndex}
              initial={{ opacity: 0, filter: 'blur(3px)' }}
              animate={{ opacity: 1, filter: 'blur(0px)' }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className='will-change-[filter,opacity]'>
              {tok}
            </motion.span>
          )
        })}
      </span>
    </div>
  )
}
