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

export function registerBlockRenderer(type: string, component: BlockRenderer) {
  BLOCK_RENDERERS[type] = component
}

export function getBlockRenderer(type: string): BlockRenderer | null {
  return BLOCK_RENDERERS[type] ?? null
}
