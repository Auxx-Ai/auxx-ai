// apps/web/src/components/kopilot/ui/blocks/auxx-block.tsx

'use client'

import { AnimatePresence, motion } from 'motion/react'
import { getBlockRenderer } from './block-registry'
import { BLOCK_SCHEMAS } from './block-schemas'
import { BlockSkeleton } from './block-skeleton'
import { FallbackBlock } from './fallback-block'

interface AuxxBlockProps {
  /** Block type from language tag: "auxx:thread-list" → "thread-list" */
  type: string
  /** Raw JSON string from fenced block content */
  rawContent: string
}

/**
 * Tracks block content that has already been shown with an entrance animation.
 * Keyed by `type:rawContent` — survives react-markdown remounts during streaming.
 */
const shownBlocks = new Set<string>()

export function AuxxBlock({ type, rawContent }: AuxxBlockProps) {
  const schema = BLOCK_SCHEMAS[type]
  const Renderer = getBlockRenderer(type)

  let parsed: unknown
  let isValid = false
  try {
    parsed = JSON.parse(rawContent)
    if (schema) {
      const result = schema.safeParse(parsed)
      isValid = result.success
      if (result.success) parsed = result.data
    } else {
      isValid = true
    }
  } catch {
    // Partial/invalid JSON during streaming → skeleton
  }

  const showBlock = isValid && Renderer
  const blockKey = `${type}:${rawContent}`
  const alreadyShown = shownBlocks.has(blockKey)

  if (showBlock && !alreadyShown) {
    shownBlocks.add(blockKey)
  }

  return (
    <AnimatePresence mode='wait'>
      {showBlock ? (
        <motion.div
          key='block'
          initial={alreadyShown ? false : { opacity: 0, scale: 0.95, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}>
          <Renderer data={parsed} skipEntrance={alreadyShown} />
        </motion.div>
      ) : (
        <motion.div
          key='skeleton'
          initial={{ opacity: 0.5 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.15 }}>
          {!Renderer && parsed ? (
            <FallbackBlock type={type} data={parsed} />
          ) : (
            <BlockSkeleton type={type} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
