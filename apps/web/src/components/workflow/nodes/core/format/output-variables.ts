// apps/web/src/components/workflow/nodes/core/format/output-variables.ts

import { FormatOperation } from '@auxx/lib/workflow-engine/constants'
import type { UnifiedVariable } from '~/components/workflow/types'
import { BaseType } from '~/components/workflow/types'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import type { FormatNodeData } from './types'

/**
 * Compute output variables for the format node.
 * All operations output STRING except `split` which outputs ARRAY.
 */
export function computeFormatOutputVariables(
  data: FormatNodeData,
  nodeId: string
): UnifiedVariable[] {
  if (data.operation === FormatOperation.SPLIT) {
    return [
      createUnifiedOutputVariable({
        nodeId,
        path: 'result',
        type: BaseType.ARRAY,
        description: 'Split result array',
        items: {
          id: `${nodeId}.result[*]`,
          type: BaseType.STRING,
          label: 'Item',
          category: 'node',
        },
      }),
    ]
  }

  return [
    createUnifiedOutputVariable({
      nodeId,
      path: 'result',
      type: BaseType.STRING,
      description: `Formatted result (${data.operation})`,
    }),
  ]
}
