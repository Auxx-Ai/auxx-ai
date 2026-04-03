// apps/web/src/components/kopilot/ui/blocks/auxx-block.tsx

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

export function AuxxBlock({ type, rawContent }: AuxxBlockProps) {
  const schema = BLOCK_SCHEMAS[type]
  const Renderer = getBlockRenderer(type)

  // Try JSON parse
  let parsed: unknown
  try {
    parsed = JSON.parse(rawContent)
  } catch {
    // Partial/invalid JSON during streaming → show skeleton
    return <BlockSkeleton type={type} />
  }

  // No renderer registered → fallback
  if (!Renderer) {
    return <FallbackBlock type={type} data={parsed} />
  }

  // Validate with Zod if schema exists
  if (schema) {
    const result = schema.safeParse(parsed)
    if (!result.success) {
      return <BlockSkeleton type={type} />
    }
    return <Renderer data={result.data} />
  }

  return <Renderer data={parsed} />
}
