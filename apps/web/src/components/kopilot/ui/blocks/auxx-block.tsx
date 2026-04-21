// apps/web/src/components/kopilot/ui/blocks/auxx-block.tsx

'use client'

import { motion } from 'motion/react'
import { getBlockRenderer } from './block-registry'
import { BLOCK_SCHEMAS } from './block-schemas'
import { FallbackBlock } from './fallback-block'

interface AuxxBlockProps {
  /** Block type (e.g. 'thread-list', 'entity-list') */
  type: string
  /** Validated block data produced by the tool that emitted this block */
  data: unknown
  /** Skip entrance animation when this block has already been seen (session restore) */
  skipEntrance?: boolean
}

/**
 * Renders a tool-produced rich UI block. Data is validated against the per-type
 * Zod schema registered in BLOCK_SCHEMAS; invalid data falls back to a raw JSON
 * preview so the user still sees *something* instead of a silent drop.
 */
export function AuxxBlock({ type, data, skipEntrance }: AuxxBlockProps) {
  const schema = BLOCK_SCHEMAS[type]
  const Renderer = getBlockRenderer(type)

  let validated: unknown = data
  let isValid = true
  if (schema) {
    const result = schema.safeParse(data)
    isValid = result.success
    if (result.success) validated = result.data
  }

  if (!Renderer || !isValid) {
    return <FallbackBlock type={type} data={data} />
  }

  return (
    <motion.div
      initial={skipEntrance ? false : { opacity: 0, scale: 0.95, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}>
      <Renderer data={validated} skipEntrance={skipEntrance} />
    </motion.div>
  )
}
