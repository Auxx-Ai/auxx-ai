// apps/web/src/components/agents/ui/detail/agent-model-badge.tsx
'use client'

import { ModelType } from '@auxx/lib/ai/providers/types'
import { badgeVariants } from '@auxx/ui/components/badge'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { Bot, X } from 'lucide-react'
import { useMemo } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { AiModelPicker } from '~/components/pickers/ai-model-picker'
import ModelIcon from '~/components/workflow/ui/model-parameter/model-icon'
import { api } from '~/trpc/react'
import { useAgentMutations } from '../../hooks/use-agent-mutations'
import type { AgentDetail } from '../../store/agent-store'

interface AgentModelBadgeProps {
  agent: AgentDetail
}

/**
 * Hero badge that pins the agent's main LLM. Stores the picker's
 * `provider:model` id on `Agent.modelId`; `null` means "use the system
 * default" (resolved per turn by `resolveAgentConfig`). Mirrors the master
 * Kopilot `ModelSection` — a separate ✕ clears back to the system default.
 */
export function AgentModelBadge({ agent }: AgentModelBadgeProps) {
  const { updateAgent, isUpdating } = useAgentMutations()
  const modelId = agent.modelId

  // Resolve `provider:model` → display name/icon for the pinned label. Same
  // query params as `AiModelPicker` so the result is shared from cache; only
  // fetched once a model is actually pinned.
  const { data, isLoading } = api.aiIntegration.getUnifiedModelData.useQuery(
    { includeDefaults: true, modelTypes: [ModelType.LLM], includeUnconfigured: false },
    { staleTime: 5 * 60 * 1000, enabled: !!modelId }
  )

  const pinned = useMemo(() => {
    if (!modelId || !data) return null
    for (const provider of data.providers) {
      const model = provider.models.find((m) => `${provider.provider}:${m.modelId}` === modelId)
      if (model) return { provider: provider.provider, model }
    }
    return null
  }, [modelId, data])

  return (
    <div className='flex items-center gap-1 shrink-0'>
      <AiModelPicker
        value={modelId}
        onChange={(model) => updateAgent(agent.id, { modelId: model?.id ?? null })}
        modelTypes={[ModelType.LLM]}
        skipDeprecated>
        <button
          type='button'
          disabled={isUpdating}
          className={cn(
            badgeVariants({ variant: 'outline', size: 'sm' }),
            'cursor-pointer gap-1 hover:bg-muted/40 transition-colors disabled:opacity-50'
          )}>
          {modelId ? (
            isLoading && !pinned ? (
              <Skeleton className='h-3 w-16' />
            ) : pinned ? (
              <>
                <ModelIcon
                  provider={pinned.provider}
                  modelName={pinned.model.modelId}
                  modelData={pinned.model}
                  size='sm'
                />
                <span className='truncate max-w-[12rem]'>{pinned.model.displayName}</span>
              </>
            ) : (
              // Pinned to a model that's no longer in the catalog (provider removed
              // / model retired). Show the raw id so it's at least diagnosable.
              <>
                <Bot />
                <span className='truncate max-w-[12rem]'>{modelId}</span>
              </>
            )
          ) : (
            <>
              <Bot />
              System default
            </>
          )}
        </button>
      </AiModelPicker>
      {modelId ? (
        <Tooltip content='Reset to system default'>
          <button
            type='button'
            disabled={isUpdating}
            onClick={() => updateAgent(agent.id, { modelId: null })}
            aria-label='Reset to system default'
            className='flex items-center justify-center rounded p-0.5 text-neutral-500 hover:bg-muted/40 hover:text-foreground transition-colors disabled:opacity-50'>
            <X className='size-3' />
          </button>
        </Tooltip>
      ) : null}
    </div>
  )
}
