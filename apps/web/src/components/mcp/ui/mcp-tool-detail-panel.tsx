// apps/web/src/components/mcp/ui/mcp-tool-detail-panel.tsx
'use client'

import { useState } from 'react'
import type { McpDetailServer } from './mcp-server-detail'
import { McpToolRunPanel, type McpToolRunSuccess } from './mcp-tool-run-panel'
import { McpToolSchemaSection } from './mcp-tool-schema-section'

type McpTool = McpDetailServer['tools'][number]

interface McpToolDetailPanelProps {
  serverId: string
  tool: McpTool
  onChanged: () => void
}

/**
 * The selected tool's right-column panel: description → test-run → output schema. Holds the latest
 * run so the schema section can offer "Generate from result" / "Save as example". Mount keyed by
 * tool name so switching tools resets run + result state.
 */
export function McpToolDetailPanel({ serverId, tool, onChanged }: McpToolDetailPanelProps) {
  const [lastResult, setLastResult] = useState<McpToolRunSuccess | null>(null)

  return (
    <div className='flex flex-col gap-3'>
      <div>
        <div className='font-medium text-foreground'>{tool.title ?? tool.name}</div>
        <p className='mt-1 whitespace-pre-wrap break-words text-muted-foreground'>
          {tool.description ?? 'No description provided.'}
        </p>
      </div>
      <div className='border-t pt-3'>
        <McpToolRunPanel serverId={serverId} tool={tool} onResult={setLastResult} />
      </div>
      <div className='border-t pt-3'>
        <McpToolSchemaSection
          serverId={serverId}
          tool={tool}
          lastResult={lastResult}
          onChanged={onChanged}
        />
      </div>
    </div>
  )
}
