// apps/web/src/components/workflow/ui/model-parameter/model-node-view.tsx

import type { FC } from 'react'
import { z } from 'zod'
import ModelIcon from './model-icon'
import ModelDisplay from './model-display'
import { AiModelMode } from '../../nodes/core/ai'
// import { AiModelMode } from '~/lib/workflow/core/nodes/ai/config'

// Schema for completion params
const completionParamsSchema = z.object({
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  top_p: z.number().optional(),
  top_k: z.number().optional(),
  presence_penalty: z.number().optional(),
  frequency_penalty: z.number().optional(),
})

// Model schema matching the AI node's model structure
const modelSchema = z.object({
  provider: z.string().min(1),
  name: z.string().min(1),
  mode: z.enum(AiModelMode).default(AiModelMode.CHAT),
  completion_params: completionParamsSchema,
})

// Alternative schema for new format (provider:model ID)
const newModelSchema = z.object({
  id: z.string().min(1), // "provider:model" format
  mode: z.enum(AiModelMode).default(AiModelMode.CHAT),
  completion_params: completionParamsSchema,
})

export type ModelNodeViewProps = {
  model: z.infer<typeof modelSchema> | z.infer<typeof newModelSchema>
}

/**
 * Component that displays model information inside the AI node
 */
const ModelNodeView: FC<ModelNodeViewProps> = ({ model }) => {
  if (!model) return null

  // Handle both old and new format
  let provider: string
  let modelName: string
  let displayName: string

  if ('id' in model) {
    // New format: provider:model
    const parts = model.id.split(':')
    provider = parts[0] || ''
    modelName = parts[1] || ''
    displayName = model.id
  } else {
    // Old format: provider/name
    provider = model.provider
    modelName = model.name
    displayName = `${model.provider}/${model.name}`
  }

  return (
    <div className="group flex h-6 items-center gap-0.5 rounded-md bg-primary-100 p-1">
      <div className="flex items-center gap-1">
        <ModelIcon
          provider={{ provider, label: provider }}
          modelName={modelName}
          className="!h-4 !w-4"
        />
        <ModelDisplay modelId={displayName} />
      </div>
    </div>
  )
}

export default ModelNodeView
