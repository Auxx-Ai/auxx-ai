// apps/web/src/components/workflow/nodes/core/wait/schema.ts

import { type NodeManifest, waitManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import { defineFromManifest } from '../../define-from-manifest'
import { BaseType } from '../if-else'
import type { WaitNodeData } from './types'

// The data half (enums, data interface, zod schema, defaults, validator)
// lives in the node catalog (`@auxx/lib/workflow-engine/catalog/nodes/wait`).
// This file is the merge site: manifest + the web-only output resolver.

/**
 * Get output variables for wait node.
 *
 * All four are advertised unconditionally, because `WaitNodeProcessor` writes all four on
 * both execution paths. Which path a wait takes (setTimeout vs the delay queue) is a
 * RUNTIME decision — a variable duration, delivery-window snapping or dry-run capping can
 * each flip it — so gating `paused_at`/`resume_at` on the configured duration would offer
 * the author a variable that resolves to nothing on half their runs.
 */
const getWaitOutputVariables = (_data: WaitNodeData, nodeId: string): any[] => [
  createUnifiedOutputVariable({
    nodeId,
    path: 'wait_duration_ms',
    type: BaseType.NUMBER,
    description: 'Total wait time in milliseconds',
  }),
  createUnifiedOutputVariable({
    nodeId,
    path: 'wait_method',
    type: BaseType.STRING,
    description: 'Method used for waiting (short_delay or queue_delay)',
  }),
  createUnifiedOutputVariable({
    nodeId,
    path: 'paused_at',
    type: BaseType.STRING,
    description: 'ISO timestamp when the wait started',
  }),
  createUnifiedOutputVariable({
    nodeId,
    path: 'resume_at',
    type: BaseType.STRING,
    description: 'ISO timestamp when execution resumes',
  }),
]

/**
 * Wait node definition.
 *
 * The cast bridges lib's `type: string` to the web `NodeType` narrowing —
 * safe because the manifest's defaults never set `type` (the node factory
 * assigns identity).
 */
export const waitDefinition: NodeDefinition<WaitNodeData> = defineFromManifest(
  waitManifest as unknown as NodeManifest<WaitNodeData>,
  { outputVariables: getWaitOutputVariables }
)

// Back-compat re-exports so no panel or consumer import churns:
export { validateWaitConfig, waitNodeDataSchema } from '@auxx/lib/workflow-engine/client'

/**
 * Default configuration for new wait nodes
 */
export const waitDefaultData = waitManifest.defaultData() as Partial<WaitNodeData>
