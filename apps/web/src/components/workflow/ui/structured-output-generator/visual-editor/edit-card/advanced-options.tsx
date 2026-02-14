// apps/web/src/components/workflow/ui/structured-output-generator/visual-editor/edit-card/advanced-options.tsx

import { Separator } from '@auxx/ui/components/separator'
import { Textarea } from '@auxx/ui/components/textarea'
import React, { type FC, useCallback, useState } from 'react'

export type AdvancedOptionsType = { enum: string }

type AdvancedOptionsProps = {
  options: AdvancedOptionsType
  onChange: (options: AdvancedOptionsType) => void
}

const AdvancedOptions: FC<AdvancedOptionsProps> = ({ onChange, options }) => {
  const [enumValue, setEnumValue] = useState(options.enum)

  const handleEnumChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEnumValue(e.target.value)
  }, [])

  const handleEnumBlur = useCallback(
    (e: React.FocusEvent<HTMLTextAreaElement>) => {
      onChange({ enum: e.target.value })
    },
    [onChange]
  )

  return (
    <div className='border-t border-divider-subtle'>
      <div className='flex flex-col gap-y-1 px-2 py-1.5'>
        <div className='flex w-full items-center gap-x-2'>
          <span className='text-[10px] font-semibold uppercase text-primary-500'>
            STRING VALIDATIONS
          </span>
          <div className='grow'>
            <Separator orientation='horizontal' className='my-0 h-px' />
          </div>
        </div>
        <div className='flex flex-col'>
          <div className='text-xs font-semibold flex h-6 items-center text-primary-500'>Enum</div>
          <Textarea
            className='min-h-6 h-11 text-xs p-1'
            value={enumValue}
            onChange={handleEnumChange}
            onBlur={handleEnumBlur}
            placeholder={'abcd, 1, 1.5, etc.'}
          />
        </div>
      </div>
    </div>
  )
}

export default React.memo(AdvancedOptions)
