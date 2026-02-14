// apps/web/src/components/workflow/ui/model-parameter/model-name.tsx

import { cn } from '@auxx/ui/lib/utils'
import { Computer, Eye, FileText, Image, MessageCircle, Settings2, Volume2 } from 'lucide-react'
import ModelBadge from './model-badge'
import type { ModelData } from './types'

type ModelNameProps = {
  modelItem: ModelData
  className?: string
  showModelType?: boolean
  modelTypeClassName?: string
  showMode?: boolean
  modeClassName?: string
  showFeatures?: boolean
  featuresClassName?: string
  showContextSize?: boolean
  children?: React.ReactNode
}

const ModelName = ({
  modelItem,
  className,
  showModelType,
  modelTypeClassName,
  showMode,
  modeClassName,
  showFeatures,
  featuresClassName,
  showContextSize,
  children,
}: ModelNameProps): JSX.Element | null => {
  if (!modelItem) return null

  const getFeatureIcon = (feature: string) => {
    const iconMap: Record<string, React.ReactNode> = {
      vision: <Eye className='size-3' />,
      chat: <MessageCircle className='size-3' />,
      text: <FileText className='size-3' />,
      image: <Image className='size-3' />,
      audio: <Volume2 className='size-3' />,
      computer_use: <Computer className='size-3' />,
      tools: <Settings2 className='size-3' />,
    }
    return iconMap[feature] || <MessageCircle className='size-3' />
  }

  const formatModelType = (modelType: string) => {
    const typeMap: Record<string, string> = {
      llm: 'LLM',
      'text-embedding': 'EMBED',
      rerank: 'RANK',
      speech2text: 'STT',
      moderation: 'MOD',
      tts: 'TTS',
    }
    return typeMap[modelType] || modelType.toUpperCase()
  }

  const formatSize = (size: number): string => {
    if (size >= 1000000) {
      return `${(size / 1000000).toFixed(1)}M`
    }
    if (size >= 1000) {
      return `${(size / 1000).toFixed(0)}K`
    }
    return size.toString()
  }

  return (
    <div
      className={cn(
        'text-sm flex items-center gap-0.5 overflow-hidden truncate text-ellipsis text-foreground',
        className
      )}>
      <div className='truncate' title={modelItem.displayName}>
        {modelItem.displayName}
      </div>
      <div className='flex items-center gap-0.5'>
        {showModelType && modelItem.modelType && (
          <ModelBadge className={modelTypeClassName}>
            {formatModelType(modelItem.modelType)}
          </ModelBadge>
        )}
        {showFeatures &&
          modelItem.features?.map((feature) => (
            <ModelBadge key={feature} className={cn('p-1', featuresClassName)}>
              {getFeatureIcon(feature)}
            </ModelBadge>
          ))}
        {showContextSize && modelItem.contextLength && (
          <ModelBadge>{formatSize(modelItem.contextLength as number)}</ModelBadge>
        )}
      </div>
      {children}
    </div>
  )
}

export default ModelName
