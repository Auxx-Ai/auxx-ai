// apps/web/src/app/(protected)/app/examples/designs/page.tsx

'use client'

import { AiThinking } from '@auxx/ui/components/ai-thinking'

export default function DesignsPage() {
  return (
    <div className='container mx-auto py-6 space-y-6 overflow-y-auto'>
      <div className='space-y-2'>
        <h1 className='text-3xl font-bold'>Designs</h1>
        <p className='text-muted-foreground'>Component design previews.</p>
      </div>

      <div className='flex items-center justify-center py-12'>
        <AiThinking />
      </div>
    </div>
  )
}
