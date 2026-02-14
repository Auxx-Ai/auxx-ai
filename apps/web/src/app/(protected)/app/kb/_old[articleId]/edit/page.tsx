// 'use client'

import { Button } from '@auxx/ui/components/button'
import { Separator } from '@auxx/ui/components/separator'
import Link from 'next/link'
import React from 'react'
import { api } from '~/trpc/server'
import { ArticleForm } from '../../_components/article-form'

type Props = { params: Promise<{ articleId: string }> }

async function EditArticlePage({ params }: Props) {
  const { articleId } = await params
  const defaultValues = { title: '', content: '' }
  function onSubmit() {
    // 'use server'
  }

  const { article } = await api.article.byId({ id: articleId })
  const { categories } = await api.article.allCategories()

  if (!article) {
    return <div>Article not found</div>
  }

  return (
    <>
      <div className='flex items-center space-x-2 px-4 py-2'>
        <Button variant='outline' size='sm' asChild>
          <Link href={`/app/kb/${articleId}`}>Back</Link>
        </Button>

        <span className='text-sm text-muted-foreground'>Edit Article</span>
      </div>
      <Separator />

      <div className='p-4'>
        <div>
          {/* <h1>Edit Article</h1> */}
          <ArticleForm
            defaultValues={defaultValues}
            onCancel={`/app/kb/${articleId}`}
            article={article}
            categories={categories}
          />
        </div>
      </div>
    </>
  )
}

export default EditArticlePage
