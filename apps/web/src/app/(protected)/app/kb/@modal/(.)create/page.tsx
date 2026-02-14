'use client'
import type { ArticleCategory } from '@auxx/database/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
// import { ArticleForm } from '../../_components/article-form'
import { api } from '~/trpc/react'

// import { ArticleForm } from '../../_components/article-form';
type CreateArticleProps = {
  categories: ArticleCategory[]
  onCategoryCreated: () => void
  open: boolean
  setOpen: (open: boolean) => void
}
export default function CreateArticleDialog() {
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const defaultValues = { title: '', content: '' }
  async function onSubmit(data) {
    console.log(data)
  }
  const router = useRouter()
  function onCancel() {
    setOpen(false)
  }
  const { categories } = api.article.allCategories.useQuery()
  return (
    // <Dialog open={open} onOpenChange={setOpen}>
    <Dialog open={true}>
      <DialogContent className='sm:max-w-[425px]'>
        <DialogHeader>
          <DialogTitle>Create New Article</DialogTitle>
          <DialogDescription>Add a new article.</DialogDescription>
        </DialogHeader>
        {/* <ArticleForm
          onCancel={onCancel}
          onSubmit={onSubmit}
          isSubmitting={isSubmitting}
          categories={categories}
        /> */}
      </DialogContent>
    </Dialog>
  )
}
