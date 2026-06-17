// apps/web/src/components/global/copy-input.tsx
'use client'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { useCopy } from '@auxx/ui/hooks/use-copy'
import { Check, Copy, KeyRound } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'

interface CopyInputProps {
  value: string
  /** Toast message shown after a successful copy */
  toastMessage?: string
}

export function CopyInput({ value, toastMessage = 'Copied to clipboard' }: CopyInputProps) {
  const { copied, copy } = useCopy({ toastMessage })

  return (
    <InputGroup>
      <InputGroupAddon align='inline-start'>
        <KeyRound />
      </InputGroupAddon>
      <InputGroupInput
        type='text'
        value={value}
        readOnly
        className='font-mono text-xs'
        onFocus={(e) => e.target.select()}
      />
      <InputGroupAddon align='inline-end' className='gap-0.5'>
        <Tooltip content='Copy'>
          <InputGroupButton
            aria-label='Copy'
            className='rounded-full'
            size='icon-xs'
            onClick={() => copy(value)}>
            {copied ? <Check /> : <Copy />}
          </InputGroupButton>
        </Tooltip>
      </InputGroupAddon>
    </InputGroup>
  )
}
