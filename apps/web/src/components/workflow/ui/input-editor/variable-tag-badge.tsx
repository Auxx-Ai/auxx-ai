// apps/web/src/components/workflow/ui/input-editor/variable-tag-badge.tsx

'use client'

import VariableTag from '../variables/variable-tag'
import type { InlineNodeBadgeProps } from '~/components/editor/inline-picker'

/**
 * Adapter to use VariableTag with the inline-picker system.
 * Maps InlineNodeBadgeProps (id, selected) to VariableTag props (variableId, selected).
 */
export function VariableTagBadge({ id, selected }: InlineNodeBadgeProps) {
  return <VariableTag variableId={id} selected={selected} />
}
