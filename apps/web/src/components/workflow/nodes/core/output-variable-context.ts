// apps/web/src/components/workflow/nodes/core/output-variable-context.ts

import { staticOutputContext } from '@auxx/lib/workflow-engine/client'

/**
 * Context for nodes whose output variables are derived purely from their own
 * configuration — they resolve no resource and read no upstream variable.
 *
 * The canvas builds a real context in `computeNodeOutputs`; panels that render
 * a definition's outputs inline only need this empty one. Relocated to the
 * catalog (Phase 2); re-exported under the historical name.
 */
export const staticOutputVariableContext = staticOutputContext
