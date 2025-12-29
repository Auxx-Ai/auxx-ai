// apps/web/src/components/workflow/nodes/core/chunker/index.ts

export { ChunkerPanel } from './panel'
export { ChunkerNode } from './node'
export {
  chunkerDefinition,
  chunkerNodeDataSchema,
  chunkerDefaultData,
  extractChunkerVariables,
} from './schema'
export type { ChunkerNodeData, ChunkerNode as ChunkerNodeType } from './types'
export { getChunkerOutputVariables } from './output-variables'
