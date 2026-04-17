// apps/homepage/src/app/free-tools/_components/template-block.tsx
'use client'

import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

export type TemplateBlockProps = {
  /** Title of the template, becomes an h3 */
  title: string
  /** One-line "use when..." guidance shown above the body */
  useWhen: string
  /** The template body with {{placeholders}} */
  body: string
  /** Short note on why this template works */
  whyItWorks?: string
}

export function TemplateBlock({ title, useWhen, body, whyItWorks }: TemplateBlockProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(body)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className='not-prose my-8 rounded-xl border border-border bg-card p-5 shadow-sm'>
      <div className='mb-3 flex items-start justify-between gap-4'>
        <div>
          <h3 className='text-base font-semibold'>{title}</h3>
          <p className='mt-1 text-xs italic text-muted-foreground'>Use when: {useWhen}</p>
        </div>
        <Button type='button' variant='outline' size='sm' onClick={handleCopy} className='shrink-0'>
          {copied ? (
            <>
              <Check className='size-3.5' />
              Copied
            </>
          ) : (
            <>
              <Copy className='size-3.5' />
              Copy
            </>
          )}
        </Button>
      </div>
      <pre className='whitespace-pre-wrap rounded-md bg-muted/50 p-4 font-mono text-xs leading-relaxed text-foreground'>
        {body}
      </pre>
      {whyItWorks ? (
        <p className='mt-3 text-xs text-muted-foreground'>
          <span className='font-medium text-foreground'>Why it works:</span> {whyItWorks}
        </p>
      ) : null}
    </div>
  )
}
