'use client'

import { Button } from '@auxx/ui/components/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { cn } from '@auxx/ui/lib/utils'
import { Book, Cog, Layout, Loader2 } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useRef, useState } from 'react'
// import KBTabArticles from './kb-tab-articles'
import type { RouterOutputs } from '~/trpc/react'
import { KBSwitcher } from './kb-switcher'
import KBTabArticles from './kb-tab-articles'
import KBTabGeneral, { type KBTabGeneralRef } from './kb-tab-general'
import KBTabLayout, { type KBTabLayoutRef } from './kb-tab-layout'

// Types
export interface Article {
  id: string
  title: string
  slug: string
  emoji?: string | null
  parentId: string | null
  isCategory: boolean
  order: number
  children?: Article[]
  isPublished: boolean
  knowledgeBaseId: string
}
type KBType = RouterOutputs['kb']['byId'] // Or adjust if using a combined type

interface KBSidebarProps {
  knowledgeBaseId: string
  knowledgeBase: KBType
  // articles: Article[]
}

/**
 * Main knowledge base sidebar component
 */
export function KBSidebar({ knowledgeBaseId, knowledgeBase }: KBSidebarProps) {
  // const router = useRouter()
  // const pathname = usePathname()
  // const {
  //   data: knowledgeBases,
  //   isLoading,
  //   refetch,
  // } = api.kb.list.useQuery(undefined, { enabled: !knowledgeBaseId })
  // const [activeKBId, setActiveKBId] = useState<string>(knowledgeBaseId)

  // useEffect(() => {
  //   if (knowledgeBases && knowledgeBases.length > 0 && !activeKBId) {
  //     console.log('Setting active KB ID:', knowledgeBases[0].id)
  //     setActiveKBId(knowledgeBases[0].id)
  //   }
  // }, [knowledgeBases, activeKBId])

  const [activeTab, setActiveTab] = useQueryState('tab', { defaultValue: 'general' })
  const [isSaving, setIsSaving] = useState(false) // Global saving state for the button
  // const [activeTab, setActiveTab] = useState('general') // State to track active tab

  const generalTabRef = useRef<KBTabGeneralRef>(null)
  const layoutTabRef = useRef<KBTabLayoutRef>(null) // Add refs for other tabs if they have forms
  // console.log(knowledgeBase, knowledgeBaseId)
  const handleGlobalSave = async () => {
    setIsSaving(true)
    try {
      if (activeTab === 'general' && generalTabRef.current) {
        await generalTabRef.current.submitForm()
      } else if (activeTab === 'layout' && layoutTabRef.current) {
        await layoutTabRef.current.submitForm() // Call submit for layout tab
        console.log('Saving Layout Tab (implement submitForm)')
      } else if (activeTab === 'articles' /* && articlesTabRef.current */) {
        // await articlesTabRef.current.submitForm(); // Call submit for articles tab
        console.log('Saving Articles Tab (implement submitForm)')
      }
      // Add more else if blocks for other tabs
      // Optionally add a success toast here if the child doesn't handle it
    } catch (error) {
      console.error('Save failed:', error)
      // Optionally add an error toast here
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      className={cn(
        'relative flex flex-1 flex-col', // Base flex styles
        'max-lg:max-w-full max-lg:flex-1', // Responsive styles below lg
        'lg:grow lg:border-r', // Base large screen styles
        'transition-all duration-300 ease-in-out', // Add smooth transition
        {
          // Conditional max-width for large screens
          'lg:max-w-xs': activeTab === 'articles', // Shrink for articles tab
          'lg:max-w-lg': activeTab !== 'articles', // Default width for other tabs
        }
      )}>
      <div className='flex min-h-0 flex-1 flex-col overflow-auto'>
        <Tabs
          defaultValue='general'
          value={activeTab} // Control the active tab
          onValueChange={setActiveTab} // Update state when tab changes
        >
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
          <TabsContent value='general' className=''>
            {knowledgeBase && (
              <KBTabGeneral
                ref={generalTabRef}
                knowledgeBase={knowledgeBase}
                knowledgeBaseId={knowledgeBaseId}
              />
            )}
          </TabsContent>
          <TabsContent value='layout'>
            <KBTabLayout
              ref={layoutTabRef}
              knowledgeBase={knowledgeBase}
              knowledgeBaseId={knowledgeBaseId}
            />
          </TabsContent>
          <TabsContent value='articles'>
            <KBTabArticles knowledgeBase={knowledgeBase} knowledgeBaseId={knowledgeBaseId} />
          </TabsContent>
        </Tabs>
      </div>
      <div className='absolute bottom-4 right-4'>
        {/* Use sticky positioning */}
        <Button
          className='' // Make button full width or adjust as needed
          size='sm'
          variant='info'
          onClick={handleGlobalSave}
          disabled={isSaving} // Disable button while saving
        >
          {isSaving ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}
          Save Changes
        </Button>
      </div>
    </div>
  )
}
