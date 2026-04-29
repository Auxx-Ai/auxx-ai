// app/kb/[knowledgeBaseId]/preview/page.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Switch } from '@auxx/ui/components/switch'
import { Monitor, Moon, Smartphone, Sun } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'

// Knowledge base creator:

// We have an existing knowledge base creator.
// The routes should be as follows:
// /app/kb/[knowledgeBaseId]/preview:
// - This will show a preview of the knowledge base how it would look like to the user
// - There will be a topbar with the following buttons: Publish, Toggle to switch between Day and Night mode, Toggle to switch between Desktop and mobile
// - Below this it will show the iframe of the preview
// /app/kb/[knowledgeBaseId]/editor/~/route:
// - This will be the article editor
// - Where ~/route should be the full route of slugs to the nested article.

type KBPreviewParams = { params: Promise<{ knowledgeBaseId: string }> }
export default async function KnowledgeBasePreviewPage({ params }: KBPreviewParams) {
  const { knowledgeBaseId } = await params

  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')

  const { data: knowledgeBase, isLoading } = api.kb.byId.useQuery({
    id: knowledgeBaseId,
  })

  const publishMutation = api.kb.update.useMutation({
    onSuccess: () => {
      // Show success toast
    },
  })

  function handlePublish() {
    publishMutation.mutate({ id: knowledgeBaseId, data: { publishStatus: 'PUBLISHED' } })
  }

  // Construct the preview URL
  const previewUrl = `/api/preview/kb/${knowledgeBaseId}?theme=${theme}&device=${device}`

  return (
    <div className='flex h-screen flex-col'>
      {/* Top bar */}
      <div className='flex items-center justify-between border-b p-4'>
        <h1 className='text-xl font-semibold'>
          {isLoading ? 'Loading...' : `Preview: ${knowledgeBase?.name}`}
        </h1>

        <div className='flex items-center gap-4'>
          {/* Theme toggle */}
          <div className='flex items-center gap-2'>
            <Sun className='size-4' />
            <Switch
              checked={theme === 'dark'}
              onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
            />
            <Moon className='size-4' />
          </div>

          {/* Device toggle */}
          <div className='flex items-center gap-2'>
            <Smartphone className='size-4' />
            <Switch
              checked={device === 'desktop'}
              onCheckedChange={(checked) => setDevice(checked ? 'desktop' : 'mobile')}
            />
            <Monitor className='size-4' />
          </div>

          {/* Publish button */}
          <Button
            onClick={handlePublish}
            disabled={publishMutation.isLoading || knowledgeBase?.publishStatus === 'PUBLISHED'}>
            {knowledgeBase?.publishStatus === 'PUBLISHED' ? 'Published' : 'Publish'}
          </Button>
        </div>
      </div>

      {/* Preview iframe */}
      <div className='flex-1 p-4'>
        <div className={device === 'mobile' ? 'mx-auto max-w-sm' : 'h-full w-full'}>
          <iframe
            src={previewUrl}
            className='h-full w-full rounded-lg border'
            style={{ maxHeight: device === 'mobile' ? '80vh' : '100%' }}
          />
        </div>
      </div>
    </div>
  )
}
