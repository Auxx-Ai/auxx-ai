// apps/web/src/components/kopilot/ui/blocks/block-registry.ts

import type React from 'react'

export interface BlockRendererProps<T = unknown> {
  data: T
  /** True when data is from a partial streaming parse */
  isPartial?: boolean
}

type BlockRenderer = React.ComponentType<BlockRendererProps>

const BLOCK_RENDERERS: Record<string, BlockRenderer> = {}

export function registerBlockRenderer(type: string, component: BlockRenderer) {
  BLOCK_RENDERERS[type] = component
}

export function getBlockRenderer(type: string): BlockRenderer | null {
  return BLOCK_RENDERERS[type] ?? null
}
