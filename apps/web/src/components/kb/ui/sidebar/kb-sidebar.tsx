// apps/web/src/components/kb/ui/sidebar/kb-sidebar.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { cn } from '@auxx/ui/lib/utils'
import { Book, Cog, Layout } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useState } from 'react'
import type { KnowledgeBase } from '../../store/knowledge-base-store'
import { GeneralTab } from '../settings/general/general-tab'
import { LayoutTab } from '../settings/layout/layout-tab'
import { submitAllSettings } from '../settings/settings-submit-registry'
import { KBArticlesPanel } from './kb-articles-panel'
import { KBSwitcher } from './kb-switcher'

interface KBSidebarProps {
  knowledgeBaseId: string
  knowledgeBase: KnowledgeBase
}

export function KBSidebar({ knowledgeBaseId, knowledgeBase }: KBSidebarProps) {
  const [activeTab, setActiveTab] = useQueryState('tab', { defaultValue: 'general' })
  const [isSaving, setIsSaving] = useState(false)

  const handleGlobalSave = async () => {
    setIsSaving(true)
    try {
      await submitAllSettings()
    } finally {
      setIsSaving(false)
    }
  }

  const showSave = activeTab !== 'articles'

  return (
    <div
      className={cn(
        'relative flex flex-1 flex-col',
        'max-lg:max-w-full max-lg:flex-1',
        'lg:grow lg:border-r',
        'transition-all duration-300 ease-in-out',
        {
          'lg:max-w-xs': activeTab === 'articles',
          'lg:max-w-lg': activeTab !== 'articles',
        }
      )}>
      <ScrollArea className='flex min-h-0 flex-1 flex-col'>
        <Tabs defaultValue='general' value={activeTab} onValueChange={setActiveTab}>
          <div className='sticky top-0 z-50 bg-background'>
            <div className='p-2'>
              <KBSwitcher />
            </div>

            <TabsList className='z-10 h-auto w-full gap-2 rounded-none border-b bg-transparent px-0 py-1 text-foreground'>
              <TabsTrigger
                value='general'
                className='relative after:absolute after:inset-x-0 after:bottom-0 after:-mb-1 after:h-0.5 hover:bg-accent hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-blue-500 data-[state=active]:shadow-none data-[state=active]:after:bg-blue-500 data-[state=active]:hover:bg-transparent'>
                <Cog className='-ms-0.5 me-1.5 opacity-60' size={16} aria-hidden='true' />
                General
              </TabsTrigger>
              <TabsTrigger
                value='layout'
                className='relative after:absolute after:inset-x-0 after:bottom-0 after:-mb-1 after:h-0.5 hover:bg-accent hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-blue-500 data-[state=active]:shadow-none data-[state=active]:after:bg-blue-500 data-[state=active]:hover:bg-transparent'>
                <Layout className='-ms-0.5 me-1.5 opacity-60' size={16} aria-hidden='true' />
                Layout
              </TabsTrigger>
              <TabsTrigger
                value='articles'
                className='relative after:absolute after:inset-x-0 after:bottom-0 after:-mb-1 after:h-0.5 hover:bg-accent hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-blue-500 data-[state=active]:shadow-none data-[state=active]:after:bg-blue-500 data-[state=active]:hover:bg-transparent'>
                <Book className='-ms-0.5 me-1.5 opacity-60' size={16} aria-hidden='true' />
                Articles
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value='general'>
            <GeneralTab knowledgeBaseId={knowledgeBaseId} knowledgeBase={knowledgeBase} />
          </TabsContent>
          <TabsContent value='layout'>
            <LayoutTab knowledgeBaseId={knowledgeBaseId} knowledgeBase={knowledgeBase} />
          </TabsContent>
          <TabsContent value='articles'>
            <KBArticlesPanel knowledgeBaseId={knowledgeBaseId} />
          </TabsContent>
        </Tabs>
      </ScrollArea>
      {showSave && (
        <div className='absolute bottom-4 right-4'>
          <Button
            size='sm'
            variant='info'
            onClick={handleGlobalSave}
            loading={isSaving}
            loadingText='Saving…'>
            Save changes
          </Button>
        </div>
      )}
    </div>
  )
}
