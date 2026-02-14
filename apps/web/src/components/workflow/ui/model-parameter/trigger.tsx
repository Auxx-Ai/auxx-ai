// apps/web/src/components/workflow/ui/model-parameter/trigger.tsx

import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, ChevronDown, SlidersHorizontal } from 'lucide-react'
import type { FC } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import ModelIcon from './model-icon'
import ModelName from './model-name'
import { MODEL_STATUS_TEXT, type TriggerProps } from './types'

const Trigger: FC<TriggerProps> = ({
  disabled,
  currentProvider,
  currentModel,
  providerName,
  modelId,
  hasDeprecated,
  modelDisabled,
  isInWorkflow,
}) => {
  return (
    <div
      className={cn(
        'relative flex h-8 cursor-pointer items-center rounded-lg px-2',
        !isInWorkflow && 'border ring-inset hover:ring-[0.5px]',
        !isInWorkflow &&
          (disabled
            ? 'border-yellow-500 bg-yellow-50 ring-yellow-500 dark:bg-yellow-950/20'
            : 'border-blue-600 bg-blue-50 ring-blue-600 dark:bg-blue-950/20'),
        isInWorkflow && 'border border-border bg-muted pr-[30px] hover:border-primary-300'
      )}>
      {currentProvider && (
        <ModelIcon
          className='mr-1.5 !h-5 !w-5'
          provider={currentProvider}
          modelName={currentModel?.modelId}
          modelData={currentModel}
        />
      )}
      {!currentProvider && providerName && (
        <ModelIcon
          className='mr-1.5 !h-5 !w-5'
          provider={{ provider: providerName, label: providerName }}
          modelName={modelId}
        />
      )}
      {currentModel && (
        <ModelName
          className='mr-1.5 text-foreground'
          modelItem={currentModel}
          showMode
          showModelType
          showFeatures
        />
      )}
      {!currentModel && modelId && (
        <div className='mr-1 truncate text-[13px] font-medium text-foreground'>{modelId}</div>
      )}
      {disabled ? (
        <Tooltip
          contentComponent={
            <p>
              {hasDeprecated
                ? 'Model provider is deprecated'
                : modelDisabled && currentModel
                  ? `Model ${currentModel.status}` // Use status directly from ModelData
                  : 'Provider not configured'}
            </p>
          }>
          <AlertTriangle className='size-4 text-bad-400' />
        </Tooltip>
      ) : (
        <SlidersHorizontal
          className={cn(
            !isInWorkflow ? 'text-blue-600' : 'text-muted-foreground',
            'size-4 shrink-0'
          )}
        />
      )}
      {isInWorkflow && (
        <ChevronDown className='absolute right-2 top-[9px] h-3.5 w-3.5 text-muted-foreground' />
      )}
    </div>
  )
}

export default Trigger
