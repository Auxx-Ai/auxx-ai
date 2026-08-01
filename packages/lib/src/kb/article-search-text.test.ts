// packages/lib/src/kb/article-search-text.test.ts
//
// `Article.searchText` is a denormalization, so the risk is not that the SQL is
// wrong once — it is that a later edit changes what the corpus contains while the
// backfill, the write hook and the GIN index keep assuming the old shape. These
// assertions pin the parts that would fail silently: the cap, the order of the
// HTML reductions, and which revision the body is read from.

import { describe, expect, it } from 'vitest'

import {
  ARTICLE_SEARCH_TOTAL_LIMIT,
  articleSearchTextAssignmentSql,
  articleSearchTextExpressionSql,
} from './article-search-text'

describe('article search corpus', () => {
  const expression = articleSearchTextExpressionSql('a')

  it('concatenates title, excerpt and the body — in that order', () => {
    // Order is not cosmetic: the cap clips the TAIL, so the title has to survive
    // truncation of a pathological body.
    const title = expression.indexOf('a."title"')
    const excerpt = expression.indexOf('a."excerpt"')
    const body = expression.indexOf('"ArticleRevision"')

    expect(title).toBeGreaterThan(-1)
    expect(excerpt).toBeGreaterThan(title)
    expect(body).toBeGreaterThan(excerpt)
  })

  it('reads the DRAFT revision, not a published one', () => {
    // The internal articles table lists what authors are working on, and 31 of
    // the dev DB's 90 articles have never been published at all. Switching this
    // to the published revision would make a third of the KB body-unsearchable
    // without any error.
    expect(expression).toContain('r.id = a."draftRevisionId"')
    expect(expression).not.toContain('publishedRevisionId')
  })

  it('removes <script>/<style> WITH their content, before stripping tags', () => {
    // Postgres classifies `<…>` as `tag` tokens the `english` config never
    // indexes, so raw markup contributes no lexemes — but naive tag-stripping
    // PROMOTES CSS to plain text. Verified against the server:
    // to_tsvector('english', '<style>table{border-collapse:collapse}</style>x')
    //   → 'x'
    // to_tsvector('english', <same, tags stripped>)
    //   → 'border-collaps' 'collaps' 'tabl' 'x'
    // This is the reduction that stops KB search from matching `border-collapse`.
    const blockStrip = expression.indexOf('<(script|style)')
    const tagStrip = expression.indexOf("'<[^>]*>'")

    expect(blockStrip).toBeGreaterThan(-1)
    expect(tagStrip).toBeGreaterThan(blockStrip)
  })

  it('drops HTML entities so `&amp;` does not become an `amp` lexeme', () => {
    expect(expression).toContain('&[a-zA-Z]+;|&#[0-9]+;')
  })

  it('collapses whitespace and clips the whole corpus to the cap', () => {
    expect(expression).toContain(`'\\s+', ' ', 'g'`)
    expect(expression).toContain(`, ${ARTICLE_SEARCH_TOTAL_LIMIT})`)
  })

  it('stays far under the 1 MB ceiling where to_tsvector hard-errors', () => {
    // Not a style preference: past 1 MB `to_tsvector` raises "string is too long
    // for tsvector", which fails the WRITE — an article edit that cannot be
    // saved — rather than degrading the search.
    expect(ARTICLE_SEARCH_TOTAL_LIMIT).toBeLessThanOrEqual(250_000)
  })

  it('takes any alias, so the backfill and the write hook can differ', () => {
    expect(articleSearchTextExpressionSql('art')).toContain('art."draftRevisionId"')
    expect(articleSearchTextExpressionSql('art')).not.toContain('a."draftRevisionId"')
  })

  it('exposes the assignment form the write path splices in', () => {
    expect(articleSearchTextAssignmentSql('a')).toBe(`"searchText" = ${expression}`)
  })
})
