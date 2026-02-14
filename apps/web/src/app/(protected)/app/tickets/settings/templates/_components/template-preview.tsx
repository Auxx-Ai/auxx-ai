// apps/web/src/app/(protected)/app/tickets/settings/templates/_components/template-preview.tsx
'use client'

import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { CodeIcon, MailIcon } from 'lucide-react'
import { useState } from 'react'

interface TemplatePreviewProps {
  preview: { subject: string; bodyHtml: string; bodyPlain: string }
}

/** Template preview component for displaying email template output */
export default function TemplatePreview({ preview }: TemplatePreviewProps) {
  const [mode, setMode] = useState('html')

  return (
    <div className='space-y-4'>
      <Alert>
        <MailIcon className='h-4 w-4' />
        <AlertTitle>Subject Preview</AlertTitle>
        <AlertDescription>{preview.subject}</AlertDescription>
      </Alert>

      <RadioTab value={mode} onValueChange={setMode} size='sm'>
        <RadioTabItem value='html' size='sm'>
          <MailIcon />
          HTML
        </RadioTabItem>
        <RadioTabItem value='text' size='sm'>
          <CodeIcon />
          Plain Text
        </RadioTabItem>
      </RadioTab>

      {mode === 'html' ? (
        <div className='overflow-hidden rounded-2xl border'>
          <div className='relative bg-white p-4'>
            <iframe
              title='Email HTML Preview'
              className='h-[500px] w-full bg-white dark:bg-white'
              srcDoc={`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Preview</title>
  <style>
    body { font-family: Arial, sans-serif; }
  </style>
</head>
<body>
  ${preview.bodyHtml}
</body>
</html>`}
            />
          </div>
        </div>
      ) : (
        <div className='overflow-auto rounded-2xl border bg-slate-50 p-4 font-mono text-sm dark:bg-slate-900'>
          <pre className='whitespace-pre-wrap'>{preview.bodyPlain}</pre>
        </div>
      )}
    </div>
  )
}
