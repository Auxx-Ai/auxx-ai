// apps/web/src/components/workflow/ui/model-parameter/presets-parameter.tsx

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, Palette, Scale, Target } from 'lucide-react'
import type { FC } from 'react'
import { useCallback } from 'react'
import { TONE_LIST } from './constants'
import type { PresetsParameterProps } from './types'

const PresetsParameter: FC<PresetsParameterProps> = ({ onSelect }) => {
  const getToneIcon = (toneId: number) => {
    const className = 'mr-2 w-[14px] h-[14px]'
    const iconMap = {
      1: <Palette className={`${className} text-purple-600`} />,
      2: <Scale className={`${className} text-indigo-600`} />,
      3: <Target className={`${className} text-green-600`} />,
    }
    return iconMap[toneId as keyof typeof iconMap] || <Palette className={className} />
  }

  const getToneName = (toneName: string) => {
    const nameMap: Record<string, string> = {
      creative: 'Creative',
      balanced: 'Balanced',
      precise: 'Precise',
    }
    return nameMap[toneName] || toneName.charAt(0).toUpperCase() + toneName.slice(1)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size='sm' variant='outline' className='h-6 px-2 text-xs'>
          Load Presets
          <ChevronDown className='ml-0.5 size-2 text-muted-foreground' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-40 z-61'>
        {TONE_LIST.slice(0, 3).map((tone) => (
          <DropdownMenuItem
            key={tone.id}
            onClick={() => onSelect(tone.id)}
            className='cursor-pointer'>
            <div className='flex h-full items-center'>
              {getToneIcon(tone.id)}
              {getToneName(tone.name)}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default PresetsParameter
