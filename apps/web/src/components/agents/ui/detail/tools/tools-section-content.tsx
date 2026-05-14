// apps/web/src/components/agents/ui/detail/tools/tools-section-content.tsx
'use client'

import type { ToolsetCatalogEntry } from '@auxx/lib/agents/client'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { useCallback, useMemo } from 'react'
import { api } from '~/trpc/react'
import type { AgentDetail } from '../../../store/agent-store'
import type { AutosaveState } from '../../shared/autosave-indicator'
import { ToolsetRow } from './toolset-row'
import { useToolsetMutations } from './use-toolset-mutations'

interface ToolsSectionContentProps {
  agent: AgentDetail
  onAutosaveChange?: (state: AutosaveState) => void
}

type ToolsetRowState = {
  enabled: boolean
  source: 'manual' | 'mention' | 'auto_default'
  disabledTools: string[]
}

/**
 * The Tools tab body. Renders the org toolset catalog grouped by Default /
 * Additional / Apps, with per-toolset enable + per-tool checkboxes. Per-agent
 * state comes from `agent.toolsets`; mutations route through
 * `useToolsetMutations`.
 */
export function ToolsSectionContent({ agent, onAutosaveChange }: ToolsSectionContentProps) {
  const catalogQuery = api.agentToolset.list.useQuery(undefined, {
    staleTime: 60_000,
  })

  const handleSavingChange = useCallback(
    (saving: boolean) => {
      onAutosaveChange?.(saving ? { kind: 'saving' } : { kind: 'saved', at: Date.now() })
    },
    [onAutosaveChange]
  )

  const { toggleToolset, toggleTool } = useToolsetMutations(agent.id, handleSavingChange)

  const stateBySlug = useMemo<Map<string, ToolsetRowState>>(() => {
    const map = new Map<string, ToolsetRowState>()
    for (const row of agent.toolsets) {
      map.set(row.toolsetSlug, {
        enabled: row.enabled,
        source: row.source,
        disabledTools: (row.config?.disabledTools as string[]) ?? [],
      })
    }
    return map
  }, [agent.toolsets])

  if (catalogQuery.isLoading || !catalogQuery.data) {
    return (
      <div className='px-3 pb-6 space-y-3'>
        <Skeleton className='h-12 w-full' />
        <Skeleton className='h-12 w-full' />
        <Skeleton className='h-12 w-full' />
      </div>
    )
  }

  const catalog = catalogQuery.data
  const defaultEntries = catalog.filter((e) => e.group === 'native' && e.isDefault)
  const additionalEntries = catalog.filter((e) => e.group === 'native' && !e.isDefault)
  const appEntries = catalog.filter((e) => e.group === 'app')

  const knownSlugs = new Set(catalog.map((e) => e.slug))
  const unrecognized = agent.toolsets.filter((r) => !knownSlugs.has(r.toolsetSlug))

  const renderRow = (entry: ToolsetCatalogEntry) => {
    const state = stateBySlug.get(entry.slug) ?? {
      enabled: false,
      source: 'manual' as const,
      disabledTools: [],
    }
    return (
      <ToolsetRow
        key={entry.slug}
        slug={entry.slug}
        label={entry.label}
        tools={entry.tools}
        enabled={state.enabled}
        source={state.source}
        disabledTools={state.disabledTools}
        onToolsetToggle={toggleToolset}
        onToolToggle={toggleTool}
      />
    )
  }

  return (
    <div className='pb-6'>
      <Section
        title='Default toolsets'
        description='Pre-enabled toolsets every agent ships with. Uncheck a toolset to remove its tools.'
        initialOpen>
        <div className='divide-y'>{defaultEntries.map(renderRow)}</div>
      </Section>

      <Section
        title='Additional toolsets'
        description='Opt-in toolsets. Tools register only after admin enables the toolset.'
        initialOpen={false}>
        {additionalEntries.length > 0 ? (
          <div className='divide-y'>{additionalEntries.map(renderRow)}</div>
        ) : (
          <p className='text-sm text-muted-foreground py-2'>No additional toolsets available.</p>
        )}
      </Section>

      {appEntries.length > 0 && (
        <Section
          title='Apps'
          description='Toolsets contributed by installed apps.'
          initialOpen={false}>
          <div className='divide-y'>{appEntries.map(renderRow)}</div>
        </Section>
      )}

      {unrecognized.length > 0 && (
        <Section
          title='Unrecognized toolsets'
          description='These slugs are stored on this agent but no longer appear in the org catalog. Remove them or ignore.'
          initialOpen={false}>
          <div className='py-2 text-sm text-muted-foreground space-y-2'>
            {unrecognized.map((row) => (
              <div key={row.toolsetSlug} className='flex items-center justify-between'>
                <span className='font-mono text-xs'>{row.toolsetSlug}</span>
                <button
                  type='button'
                  className='text-xs underline hover:text-foreground'
                  onClick={() => toggleToolset(row.toolsetSlug, false)}>
                  Disable
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}
