// apps/web/src/components/workflow/nodes/core/text-classifier/utils/preview-text.ts

import React from 'react'
import VariableTag from '~/components/workflow/ui/variables/variable-tag'

/**
 * Generate preview React elements with highlighted variables
 */
export function generatePreviewElements(
  text: string | undefined,
  nodeId: string,
  maxLength: number = 100
): React.ReactNode[] {
  const displayText = text || ''

  if (!displayText) {
    return [React.createElement('span', { key: 0 }, 'No text configured')]
  }

  // Split text by variable patterns and create elements
  const parts: React.ReactNode[] = []
  const variableRegex = /(\{\{[^}]+\}\})/g
  const segments = displayText.split(variableRegex)

  let currentLength = 0
  let truncated = false

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    if (!segment) continue

    if (segment.match(variableRegex)) {
      // Extract variable ID by removing {{ and }}
      const variableId = segment.replace(/^\{\{|\}\}$/g, '').trim()

      // This is a variable - render with VariableTag
      // Variables don't count much toward length (use a fixed cost)
      const variableCost = 20
      if (currentLength + variableCost > maxLength) {
        truncated = true
        break
      }

      parts.push(
        React.createElement(VariableTag, {
          key: index,
          variableId,
          nodeId,
        })
      )
      currentLength += variableCost
    } else {
      // Regular text - apply smart truncation
      if (currentLength + segment.length > maxLength) {
        const remaining = maxLength - currentLength
        if (remaining > 0) {
          parts.push(React.createElement('span', { key: index }, segment.substring(0, remaining)))
        }
        truncated = true
        break
      }

      parts.push(React.createElement('span', { key: index }, segment))
      currentLength += segment.length
    }
  }

  // Add ellipsis if we truncated
  if (truncated) {
    parts.push(React.createElement('span', { key: 'ellipsis' }, '...'))
  }

  return parts
}
