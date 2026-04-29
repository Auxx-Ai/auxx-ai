// apps/web/src/components/kb/ui/editor/article-editor-footer.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { ArrowLeft, ArrowRight, Loader2, Save } from 'lucide-react'
import Link from 'next/link'
import { useMemo } from 'react'
import { useArticleList } from '../../hooks/use-article-list'
import type { ArticleMeta } from '../../store/article-store'
import { getFullSlugPath } from '../../utils/article-paths'
import { buildArticleTree, flattenArticleTreePreservingChildren } from '../../utils/article-tree'

interface ArticleEditorFooterProps {
  article: ArticleMeta
  knowledgeBaseId: string
  isSaving?: boolean
  onSave?: () => void
}

export function ArticleEditorFooter({
  article,
  knowledgeBaseId,
  isSaving = false,
  onSave,
}: ArticleEditorFooterProps) {
  const articles = useArticleList(knowledgeBaseId)

  const { prevArticle, nextArticle } = useMemo(() => {
    const tree = buildArticleTree(articles)
    const flat = flattenArticleTreePreservingChildren(tree)
    const idx = flat.findIndex((a) => a.id === article.id)
    return {
      prevArticle: idx > 0 ? flat[idx - 1] : undefined,
      nextArticle: idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : undefined,
    }
  }, [articles, article.id])

  const basePath = `/app/kb/${knowledgeBaseId}`
  const prevHref = prevArticle
    ? `${basePath}/editor/~/${getFullSlugPath(prevArticle, articles)}?tab=articles`
    : '#'
  const nextHref = nextArticle
    ? `${basePath}/editor/~/${getFullSlugPath(nextArticle, articles)}?tab=articles`
    : '#'

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
                  href={prevHref}
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
                  href={nextHref}
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
