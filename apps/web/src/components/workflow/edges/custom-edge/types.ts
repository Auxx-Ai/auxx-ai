// apps/web/src/components/workflow/edges/custom-edge/types.ts

// Import consolidated types from main types directory
import type { Edge, EdgeData, NodeRunningStatus } from '~/components/workflow/types'

// Re-export for backward compatibility
export type { Edge, EdgeData, NodeRunningStatus }

export type OnSelectBlock = (nodeType: string, toolDefaultValue?: any) => void

export interface CustomEdgeLinearGradientProps {
  id: string
  startColor: string
  stopColor: string
  position: { x1: number; x2: number; y1: number; y2: number }
}
