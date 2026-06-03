// apps/web/src/components/kb/ui/landing/kb-landing-shell.tsx
'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbDropdown,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Book, Globe } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { ArticlesView } from '../articles/articles-view'
import { KBSwitcherDropdownContent } from '../sidebar/kb-switcher'
import { ConnectSourceButton } from '../sources/connect-source-button'
import { SourcesProvider } from '../sources/sources-provider'
import { SourcesTab } from '../sources/sources-tab'
import { CreateKnowledgeBaseButton } from './create-knowledge-base-button'

/**
 * Landing chrome for `/app/kb`: breadcrumb + KB switcher, an `Articles | Sources`
 * tab strip (mirrors `/app/workflows`), and a header action that swaps with the tab —
 * Create Knowledge Base on Articles, Connect Source on Sources. The tab is persisted
 * in the `t` query param so deep links / refreshes land on the right tab.
 */
export function KBLandingShell() {
  const [tab, setTab] = useQueryState('t', { defaultValue: 'articles' })

  return (
    <MainPage>
      <MainPageHeader
        action={tab === 'sources' ? <ConnectSourceButton /> : <CreateKnowledgeBaseButton />}>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem
            title='Knowledge Bases'
            href='/app/kb'
            className='hidden sm:inline-flex'
          />
          <MainPageBreadcrumbDropdown
            label='Open a knowledge base'
            icon={<Book className='size-3.5' />}
            last
            contentClassName='w-72'>
            <KBSwitcherDropdownContent />
          </MainPageBreadcrumbDropdown>
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent>
        <Tabs value={tab} onValueChange={setTab} className='flex-1 h-full flex flex-col'>
          <TabsList className='border-b w-full justify-start rounded-b-none bg-primary-150'>
            <TabsTrigger value='articles' variant='outline'>
              <Book />
              Articles
            </TabsTrigger>
            <TabsTrigger value='sources' variant='outline'>
              <Globe />
              Sources
            </TabsTrigger>
          </TabsList>

          <TabsContent value='articles' className='flex flex-col flex-1 min-h-0'>
            <ArticlesView />
          </TabsContent>

          <TabsContent value='sources' className='flex flex-col flex-1 min-h-0'>
            <SourcesProvider>
              <SourcesTab />
            </SourcesProvider>
          </TabsContent>
        </Tabs>
      </MainPageContent>
    </MainPage>
  )
}
