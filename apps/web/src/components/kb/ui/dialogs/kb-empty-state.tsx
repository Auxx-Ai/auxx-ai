// apps/web/src/components/kb/ui/dialogs/kb-empty-state.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Book, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useKnowledgeBaseMutations } from '../../hooks/use-knowledge-base-mutations'
import { KnowledgeBaseDialog, type KnowledgeBaseFormValues } from './kb-knowledge-base-dialog'

export function KBEmptyState() {
  const router = useRouter()
  const [showDialog, setShowDialog] = useState(false)
  const { createKnowledgeBase, isCreating } = useKnowledgeBaseMutations()

  const handleCreate = async (values: KnowledgeBaseFormValues) => {
    const created = await createKnowledgeBase({
      name: values.name,
      slug: values.slug,
      isPublic: values.isPublic ?? false,
    })
    if (created) {
      setShowDialog(false)
      router.push(`/app/kb/${created.id}/editor`)
    }
  }

  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Knowledge base' href='/app/kb' last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent>
        <div className='flex flex-1 flex-col items-center justify-center p-12 text-center'>
          <div className='mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary'>
            <Book className='size-6' />
          </div>
          <h2 className='text-xl font-semibold'>No knowledge bases yet</h2>
          <p className='mt-2 max-w-md text-sm text-muted-foreground'>
            Create your first knowledge base to start publishing articles, FAQs, and how-to guides
            for your customers.
          </p>
          <Button className='mt-6' onClick={() => setShowDialog(true)} loading={isCreating}>
            <Plus className='mr-2 h-4 w-4' />
            Create Knowledge Base
          </Button>
        </div>
      </MainPageContent>

      <KnowledgeBaseDialog
        open={showDialog}
        onOpenChange={setShowDialog}
        onSubmit={handleCreate}
        isSubmitting={isCreating}
        mode='create'
      />
    </MainPage>
  )
}
