// apps/web/src/components/workflow/ui/model-parameter/model-display.tsx

import ModelName from './model-name'
import type { ModelItem } from './types'

/**
 * Props for the ModelDisplay component.
 */
type ModelDisplayProps = {
  currentModel?: ModelItem
  modelId: string
}

/**
 * Renders either the detailed model name (when the current model is resolved)
 * or a fallback displaying the raw modelId in a subdued style.
 */
const ModelDisplay = ({ currentModel, modelId }: ModelDisplayProps): JSX.Element => {
  return currentModel ? (
    <ModelName
      className='flex grow items-center gap-1 px-1 py-[3px]'
      modelItem={currentModel}
      showMode
      showFeatures
    />
  ) : (
    <div className='flex grow items-center gap-1 truncate px-1 py-[3px] opacity-50'>
      <div className='text-sm overflow-hidden text-ellipsis text-foreground'>{modelId}</div>
    </div>
  )
}

export default ModelDisplay
