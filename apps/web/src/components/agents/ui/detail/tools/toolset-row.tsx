// apps/web/src/components/agents/ui/detail/tools/toolset-row.tsx
'use client'

import type { ToolCatalogEntry } from '@auxx/lib/agents/client'
import { Badge } from '@auxx/ui/components/badge'
import { Switch } from '@auxx/ui/components/switch'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'

export interface ToolsetRowProps {
  slug: string
  label: string
  tools: ToolCatalogEntry[]
  enabled: boolean
  source: 'manual' | 'mention' | 'auto_default'
  disabledTools: string[]
  onToolsetToggle: (slug: string, enabled: boolean) => void
  onToolToggle: (slug: string, toolName: string, enabled: boolean) => void
}

/**
 * One toolset rendered as a TreeRow with per-tool TreeRow subitems beneath.
 * The toolset Switch lives in the trailing slot; per-tool Switches do the
 * same at depth 1. Rows start collapsed — admins click the chevron to reveal
 * the tool list. Mention-sourced rows show a badge and disable the switch.
 */
export function ToolsetRow({
  slug,
  label,
  tools,
  enabled,
  source,
  disabledTools,
  onToolsetToggle,
  onToolToggle,
}: ToolsetRowProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  // Local state for instant switch feedback. Syncs back to server truth when
  // the parent prop changes (after optimistic update + cache reconciliation).
  const [localEnabled, setLocalEnabled] = useState(enabled)
  const [localDisabled, setLocalDisabled] = useState<Set<string>>(() => new Set(disabledTools))

  useEffect(() => {
    setLocalEnabled(enabled)
  }, [enabled])
  useEffect(() => {
    setLocalDisabled(new Set(disabledTools))
  }, [disabledTools])

  const enabledCount =
    tools.length - [...localDisabled].filter((d) => tools.some((t) => t.name === d)).length

  return (
    <TreeRow
      icon={<Wrench className='size-4' />}
      title={label}
      description={`Slug: ${slug}`}
      expandable={localEnabled && tools.length > 0}
      isOpen={isExpanded}
      onToggleOpen={() => setIsExpanded((v) => !v)}
      actions={
        <>
          {localEnabled && (
            <span className='text-xs text-muted-foreground'>
              {enabledCount}/{tools.length} tools
            </span>
          )}
          {source === 'mention' && <Badge variant='secondary'>Pinned by mention</Badge>}
          {source === 'auto_default' && <Badge variant='outline'>Default</Badge>}
          <Switch
            size='sm'
            checked={localEnabled}
            disabled={source === 'mention'}
            onCheckedChange={(checked) => {
              setLocalEnabled(checked)
              onToolsetToggle(slug, checked)
            }}
          />
        </>
      }>
      {tools.map((tool) => {
        const checked = !localDisabled.has(tool.name)
        return (
          <TreeRow
            key={tool.name}
            depth={1}
            title={<span className='font-mono text-xs'>{tool.name}</span>}
            description={tool.description}
            actions={
              <Switch
                size='sm'
                checked={checked}
                onCheckedChange={(value) => {
                  setLocalDisabled((prev) => {
                    const next = new Set(prev)
                    value ? next.delete(tool.name) : next.add(tool.name)
                    return next
                  })
                  onToolToggle(slug, tool.name, value)
                }}
              />
            }
          />
        )
      })}
    </TreeRow>
  )
}
