// app/api/preview/kb/[knowledgeBaseId]/route.ts

import { database as db } from '@auxx/database'
import { KnowledgeBaseModel } from '@auxx/database/models'
import { KBService } from '@auxx/lib/kb'
import { type NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: { knowledgeBaseId: string } }
) {
  // Extract query parameters
  const { searchParams } = new URL(request.url)
  const theme = searchParams.get('theme') || 'light'
  const device = searchParams.get('device') || 'desktop'

  try {
    // Get the knowledge base (for all orgs, this is a preview endpoint)
    const kbModel = new KnowledgeBaseModel()
    const kbRes = await kbModel.findByIdGlobal(params.knowledgeBaseId)
    if (!kbRes.ok) throw kbRes.error
    const knowledgeBase = kbRes.value

    if (!knowledgeBase) {
      return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
    }

    // Get the organization ID from the knowledge base
    const organizationId = knowledgeBase.organizationId

    // Initialize the KB service
    const kbService = new KBService(db, organizationId)

    // Get all articles
    const articles = await kbService.getArticles(params.knowledgeBaseId, {
      includeUnpublished: true, // Include unpublished since this is a preview
    })

    // Generate HTML for the preview
    const html = generatePreviewHtml(knowledgeBase, articles, theme, device)

    return new NextResponse(html, { headers: { 'Content-Type': 'text/html' } })
  } catch (error) {
    console.error('Error generating preview:', error)
    return NextResponse.json({ error: 'Failed to generate preview' }, { status: 500 })
  }
}

function generatePreviewHtml(knowledgeBase, articles, theme, device) {
  // Generate the HTML for the preview
  // This would include the knowledge base layout, navigation, and content

  return `
    <!DOCTYPE html>
    <html lang="en" class="${theme}">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${knowledgeBase.name} - Preview</title>
        <link rel="stylesheet" href="/preview-assets/styles.css">
        <script>
          // Any client-side script needed for the preview
        </script>
      </head>
      <body class="${device === 'mobile' ? 'mobile-view' : 'desktop-view'}">
        <div class="kb-container">
          <!-- Navigation -->
          <nav class="kb-nav">
            <h1>${knowledgeBase.name}</h1>
            <ul>
              ${generateArticleTree(articles)}
            </ul>
          </nav>
          
          <!-- Content -->
          <main class="kb-content">
            <div class="kb-article">
              <h1>Welcome to ${knowledgeBase.name}</h1>
              <p>${knowledgeBase.description || 'Select an article from the navigation to get started.'}</p>
            </div>
          </main>
        </div>
      </body>
    </html>
  `
}

function generateArticleTree(articles) {
  // Build a tree structure from the flat articles array
  // and generate HTML for the navigation menu

  // This is a simplified version - you'd want to build a proper tree
  const rootArticles = articles.filter((a) => !a.parentId)

  return rootArticles
    .map(
      (article) => `
    <li>
      <a href="#${article.slug}">${article.title}</a>
      ${generateChildArticles(articles, article.id)}
    </li>
  `
    )
    .join('')
}

function generateChildArticles(articles, parentId) {
  const children = articles.filter((a) => a.parentId === parentId)

  if (children.length === 0) return ''

  return `
    <ul>
      ${children
        .map(
          (child) => `
        <li>
          <a href="#${child.slug}">${child.title}</a>
          ${generateChildArticles(articles, child.id)}
        </li>
      `
        )
        .join('')}
    </ul>
  `
}
