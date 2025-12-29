import React from 'react'
// import { ArticleViewer } from '../_components/article-viewer'

type Props = { params: Promise<{ articleId: string }> }

async function ArticlePage({ params }: Props) {
  const { articleId } = await params

  // return <ArticleViewer articleId={articleId} />
}

export default ArticlePage
