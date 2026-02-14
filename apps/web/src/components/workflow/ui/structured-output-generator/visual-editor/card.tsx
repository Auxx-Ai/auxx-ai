// apps/web/src/components/workflow/ui/structured-output-generator/visual-editor/card.tsx
import React, { type FC } from 'react'

type CardProps = { name: string; type: string; required: boolean; description?: string }

const Card: FC<CardProps> = ({ name, type, required, description }) => {
  return (
    <div className='flex flex-col py-0.5'>
      <div className='flex h-7 items-center gap-x-1 pl-1 pr-0.5'>
        <div className='font-semibold text-sm truncate border border-transparent px-1 py-px text-primary-800'>
          {name}
        </div>
        <div className='text-xs px-1 py-0.5'>{type}</div>
        {required && (
          <div className='text-[10px] font-medium uppercase px-1 py-0.5 text-bad-500'>Required</div>
        )}
      </div>

      {description && <div className='text-xs truncate px-2 pb-1'>{description}</div>}
    </div>
  )
}

export default React.memo(Card)
// 28, 20
