'use client'

import { Button } from '@auxx/ui/components/button'
import { ArrowLeft, ArrowRight, Loader2, Save } from 'lucide-react'
import Link from 'next/link'
import { useKnowledgeBase } from './kb-context'

// Extended article type including content properties
interface ArticleWithContent {
  id: string
  title: string
  slug: string
  emoji?: string | null
  parentId: string | null
  isCategory: boolean
  order: number
  isPublished: boolean
  content?: string | null
  contentJson?: any | null
  description?: string | null
  excerpt?: string | null
  children?: ArticleWithContent[]
  path?: string
  orderPath?: string
}

type Props = { article: ArticleWithContent; isSaving?: boolean; onSave?: () => void }

function ArticleEditorFooter({ article, isSaving = false, onSave }: Props) {
  const { getPrevArticle, getNextArticle, getFullSlugPath } = useKnowledgeBase()

  const prevArticle = getPrevArticle(article)
  const nextArticle = getNextArticle(article)

  const prevArticleLink = prevArticle ? getFullSlugPath(prevArticle) : '#'
  const nextArticleLink = nextArticle ? getFullSlugPath(nextArticle) : '#'

  return (
    <div className='page-block-openapi:ml-0 relative mx-auto mt-6 flex w-full max-w-(--block-wrapper-max-width)'>
      <div className='flex flex-1'>
        <div className='flex-1'>
          <div>
            <div className='mb-2 flex justify-end'>
              {onSave && (
                <Button onClick={onSave} disabled={isSaving} className='gap-2'>
                  {isSaving ? (
                    <>
                      <Loader2 size={16} className='animate-spin' />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save size={16} />
                      Save
                    </>
                  )}
                </Button>
              )}
            </div>
            <div className='mb-6 flex gap-4 max-xl:flex-col'>
              {prevArticle && (
                <Link
                  href={prevArticleLink}
                  className='group/page-switch border-page-switch flex h-full flex-1 cursor-pointer items-center justify-between gap-4 rounded border p-4 no-underline transition-all duration-150 hover:translate-y-[-2px] hover:shadow-[rgba(0,0,0,0.02)_0px_12px_13px] focus:border-primary active:border-primary'>
                  <ArrowLeft />
                  <div className='flex flex-1 flex-col items-end'>
                    <span className='font-xs text-muted-foreground'>Previous</span>
                    <span className='text-ui-heading-small max-w-full truncate text-base group-hover/page-switch:text-primary'>
                      {prevArticle.title}
                    </span>
                  </div>
                </Link>
              )}
              {nextArticle && (
                <Link
                  href={nextArticleLink}
                  className='group/page-switch border-page-switch flex h-full flex-1 cursor-pointer items-center justify-between gap-4 rounded border p-4 no-underline transition-all duration-150 hover:translate-y-[-2px] hover:shadow-[rgba(0,0,0,0.02)_0px_12px_13px] focus:border-primary active:border-primary'>
                  <div className='flex flex-1 flex-col items-start'>
                    <span className='font-xs text-muted-foreground'>Next</span>
                    <span className='text-ui-heading-small max-w-full truncate text-base group-hover/page-switch:text-primary'>
                      {nextArticle.title}
                    </span>
                  </div>
                  <ArrowRight />
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ArticleEditorFooter
