// apps/web/src/components/workflow/nodes/core/output-variable-context.ts

import type { OutputVariableContext } from '~/components/workflow/types/output-variables'

/**
 * Context for nodes whose output variables are derived purely from their own
 * configuration — they resolve no resource and read no upstream variable.
 *
 * The canvas builds a real context in `computeNodeOutputs`; panels that render
 * a definition's outputs inline only need this empty one.
 */
export const staticOutputVariableContext: OutputVariableContext = {
  allResources: [],
  resolveVariable: () => undefined,
}
