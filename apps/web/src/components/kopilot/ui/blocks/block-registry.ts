// apps/web/src/components/kopilot/ui/blocks/block-registry.ts

import type React from 'react'

export interface BlockRendererProps<T = unknown> {
  data: T
  /**
   * True when `data` came from a partial streaming parse whose JSON currently
   * ends inside an unterminated string — the last streamed string value is a
   * truncated prefix. Blocks that fetch by id should withhold the trailing id
   * while this is set (see `useStreamSafeIds`).
   */
  lastValueTruncated?: boolean
  /** True when this block was already shown — skip entrance animations */
  skipEntrance?: boolean
}

type BlockRenderer = React.ComponentType<BlockRendererProps>

const BLOCK_RENDERERS: Record<string, BlockRenderer> = {}

/**
 * Register the renderer for a block type. `T` is the block's validated data
 * shape (the `z.infer` of the schema registered under the same `type` key in
 * `BLOCK_SCHEMAS`).
 *
 * The table stores renderers type-erased: `AuxxBlock` parses `data` with that
 * schema and only mounts the renderer on success, so `T` is guaranteed by the
 * schema pairing rather than by this signature. The erasure cast is the single
 * place that assumption lives.
 */
export function registerBlockRenderer<T>(
  type: string,
  component: React.ComponentType<BlockRendererProps<T>>
) {
  BLOCK_RENDERERS[type] = component as BlockRenderer
}

export function getBlockRenderer(type: string): BlockRenderer | null {
  return BLOCK_RENDERERS[type] ?? null
}
