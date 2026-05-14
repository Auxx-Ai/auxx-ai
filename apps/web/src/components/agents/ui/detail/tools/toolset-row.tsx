// apps/web/src/components/agents/ui/detail/tools/toolset-row.tsx
'use client'

import type { ToolCatalogEntry } from '@auxx/lib/agents/client'
import { Badge } from '@auxx/ui/components/badge'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Field } from '@auxx/ui/components/section'
import { Switch } from '@auxx/ui/components/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'

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
 * One row per toolset: title + enable switch + (when enabled) per-tool
 * checkboxes. Mention-sourced rows show a badge and disable the switch —
 * the prompt reconciler owns them.
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
  const disabledSet = new Set(disabledTools)
  const enabledCount =
    tools.length - disabledTools.filter((d) => tools.some((t) => t.name === d)).length

  return (
    <div className='py-2'>
      <Field
        title={label}
        description={`Slug: ${slug}`}
        actions={
          <div className='flex items-center gap-2'>
            {enabled && (
              <span className='text-xs text-muted-foreground'>
                {enabledCount}/{tools.length} tools
              </span>
            )}
            {source === 'mention' && <Badge variant='secondary'>Pinned by mention</Badge>}
            {source === 'auto_default' && <Badge variant='outline'>Default</Badge>}
            <Switch
              size='sm'
              checked={enabled}
              disabled={source === 'mention'}
              onCheckedChange={(checked) => onToolsetToggle(slug, checked)}
            />
          </div>
        }>
        {enabled && tools.length > 0 && (
          <div className='mt-1 ml-3 space-y-1.5'>
            {tools.map((tool) => (
              <ToolCheckbox
                key={tool.name}
                tool={tool}
                checked={!disabledSet.has(tool.name)}
                onChange={(checked) => onToolToggle(slug, tool.name, checked)}
              />
            ))}
          </div>
        )}
      </Field>
    </div>
  )
}

interface ToolCheckboxProps {
  tool: ToolCatalogEntry
  checked: boolean
  onChange: (checked: boolean) => void
}

function ToolCheckbox({ tool, checked, onChange }: ToolCheckboxProps) {
  return (
    <div className={cn('flex items-center gap-2 text-sm')}>
      <Checkbox
        id={`tool-${tool.name}`}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <label
            htmlFor={`tool-${tool.name}`}
            className='font-mono text-xs cursor-pointer text-foreground hover:underline'>
            {tool.name}
          </label>
        </TooltipTrigger>
        {tool.description && (
          <TooltipContent side='right' className='max-w-xs'>
            {tool.description}
          </TooltipContent>
        )}
      </Tooltip>
    </div>
  )
}
