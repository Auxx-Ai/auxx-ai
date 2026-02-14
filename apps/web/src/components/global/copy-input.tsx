'use client'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { CopyIcon } from 'lucide-react'
import { useState } from 'react'

export function CopyInput({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <div className='flex w-full flex-1 items-center gap-1'>
      <Input value={value} readOnly className='flex-1' disabled />
      <Button
        variant='outline'
        onClick={() => {
          if (value) {
            navigator.clipboard.writeText(value)
            setCopied(true)
          }
        }}>
        <CopyIcon className='mr-2 size-4' />
        {copied ? 'Copied!' : 'Copy'}
      </Button>
    </div>
  )
}
