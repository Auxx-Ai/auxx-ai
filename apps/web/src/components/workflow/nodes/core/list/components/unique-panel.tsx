// apps/web/src/components/workflow/nodes/core/list/components/unique-panel.tsx

'use client'

import React from 'react'
import { type ListNodeConfig } from '../types'

interface UniquePanelProps {
  config: ListNodeConfig
  onChange: (updates: Partial<ListNodeConfig>) => void
  isReadOnly: boolean
  nodeId: string
}

/**
 * Unique operation configuration panel
 */
export const UniquePanel: React.FC<UniquePanelProps> = ({ config, onChange, isReadOnly, nodeId }) => {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Unique configuration coming soon...</p>
    </div>
  )
}
