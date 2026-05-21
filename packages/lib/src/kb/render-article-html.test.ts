// packages/lib/src/kb/render-article-html.test.ts

import { describe, expect, it } from 'vitest'
import type { ArticleNodeJSON, BlockJSON, InlineJSON } from './markdown/types'
import { renderArticleHtml } from './render-article-html'

function block(
  blockType: string,
  attrs: Record<string, unknown> = {},
  content: InlineJSON[] = []
): BlockJSON {
  return { type: 'block', attrs: { blockType, ...attrs } as BlockJSON['attrs'], content }
}

const text = (s: string, marks?: InlineJSON['marks']): InlineJSON =>
  marks ? { type: 'text', text: s, marks } : { type: 'text', text: s }

describe('renderArticleHtml — blocks', () => {
  it('renders paragraphs as <p>', () => {
    const html = renderArticleHtml([block('text', {}, [text('hello')])])
    expect(html).toContain('<p data-auxx-block="text">hello</p>')
  })

  it('renders headings at clamped levels', () => {
    const nodes: ArticleNodeJSON[] = [
      block('heading', { level: 1 }, [text('H1')]),
      block('heading', { level: 2 }, [text('H2')]),
      block('heading', { level: 4 }, [text('H4')]),
    ]
    const html = renderArticleHtml(nodes)
    expect(html).toContain('<h2 data-auxx-block="heading" data-level="1">H1</h2>')
    expect(html).toContain('<h3 data-auxx-block="heading" data-level="2">H2</h3>')
    expect(html).toContain('<h4 data-auxx-block="heading" data-level="3">H4</h4>')
  })

  it('renders bullet and numbered list items', () => {
    const html = renderArticleHtml([
      block('bulletListItem', {}, [text('a')]),
      block('numberedListItem', {}, [text('b')]),
    ])
    expect(html).toContain('<ul data-auxx-block="bullet-list"')
    expect(html).toContain('<ol data-auxx-block="numbered-list"')
  })

  it('renders code blocks with escaped content', () => {
    const html = renderArticleHtml([
      block('codeBlock', { codeLanguage: 'ts' }, [text('const x = <T>(y) => y')]),
    ])
    expect(html).toContain('data-language="ts"')
    expect(html).toContain('<code>const x = &lt;T&gt;(y) =&gt; y</code>')
  })

  it('renders images with safe URLs and drops javascript: srcs', () => {
    const safe = renderArticleHtml([
      block('image', { imageUrl: 'https://example.com/x.png', imageAlign: 'center' }),
    ])
    expect(safe).toContain('<img src="https://example.com/x.png"')

    const unsafe = renderArticleHtml([
      block('image', { imageUrl: 'javascript:alert(1)', imageAlign: 'center' }),
    ])
    expect(unsafe).not.toContain('javascript')
  })

  it('renders dividers, callouts, and quotes', () => {
    const html = renderArticleHtml([
      block('divider'),
      block('callout', { calloutVariant: 'warn' }, [text('careful')]),
      block('quote', {}, [text('q')]),
    ])
    expect(html).toContain('<hr data-auxx-block="divider"')
    expect(html).toContain('data-variant="warn"')
    expect(html).toContain('<blockquote data-auxx-block="quote">q</blockquote>')
  })
})

describe('renderArticleHtml — inline marks', () => {
  it('wraps bold/italic/underline/strike/code/highlight', () => {
    const html = renderArticleHtml([
      block('text', {}, [
        text('a', [{ type: 'bold' }]),
        text('b', [{ type: 'italic' }]),
        text('c', [{ type: 'underline' }]),
        text('d', [{ type: 'strike' }]),
        text('e', [{ type: 'code' }]),
        text('f', [{ type: 'highlight' }]),
      ]),
    ])
    expect(html).toContain('<strong>a</strong>')
    expect(html).toContain('<em>b</em>')
    expect(html).toContain('<u>c</u>')
    expect(html).toContain('<s>d</s>')
    expect(html).toContain('<code data-auxx-inline-code>e</code>')
    expect(html).toContain('<mark>f</mark>')
  })
})

describe('renderArticleHtml — link rewriting', () => {
  it('rewrites external links to target=_blank with rel=noopener noreferrer', () => {
    const html = renderArticleHtml([
      block('text', {}, [text('go', [{ type: 'link', attrs: { href: 'https://example.com' } }])]),
    ])
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('emits data-auxx-article-link for auxx:// internal references', () => {
    const html = renderArticleHtml([
      block('text', {}, [
        text('inner', [{ type: 'link', attrs: { href: 'auxx://kb/article/abc' } }]),
      ]),
    ])
    expect(html).toContain('data-auxx-article-link="abc"')
    expect(html).not.toContain('target="_blank"')
  })

  it('strips javascript: links entirely (keeps the text)', () => {
    const html = renderArticleHtml([
      block('text', {}, [
        text('phish', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]),
      ]),
    ])
    expect(html).not.toContain('javascript')
    expect(html).not.toContain('<a ')
    expect(html).toContain('phish')
  })
})

describe('renderArticleHtml — sanitization', () => {
  it('escapes <script> in text content', () => {
    const html = renderArticleHtml([block('text', {}, [text('<script>alert(1)</script>')])])
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes script-injection attempts inside code blocks', () => {
    const html = renderArticleHtml([block('codeBlock', {}, [text('"</code><script>x</script>')])])
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;/code&gt;')
  })
})

describe('renderArticleHtml — header', () => {
  it('renders nothing for empty header opts', () => {
    expect(renderArticleHtml([])).toBe('')
  })

  it('renders cover + emoji + title together', () => {
    const html = renderArticleHtml([], {
      coverImageUrl: 'https://cdn.example.com/c.png',
      emoji: '📚',
      title: 'Welcome',
    })
    expect(html).toContain('<header data-auxx-article-head>')
    expect(html).toContain('data-auxx-article-cover')
    expect(html).toContain('<h1 data-auxx-article-title>')
    expect(html).toContain('📚')
    expect(html).toContain('Welcome')
  })

  it('renders emoji-only header without collapsing the title block', () => {
    const html = renderArticleHtml([], { emoji: '✨' })
    expect(html).toContain('<h1 data-auxx-article-title>')
    expect(html).toContain('✨')
  })

  it('drops javascript: cover URLs', () => {
    const html = renderArticleHtml([], {
      coverImageUrl: 'javascript:alert(1)',
      title: 'X',
    })
    expect(html).not.toContain('javascript')
  })
})

describe('renderArticleHtml — containers', () => {
  it('flattens tabs to their inner blocks and appends a view-full-article link', () => {
    const nodes: ArticleNodeJSON[] = [
      {
        type: 'tabs',
        attrs: { activeTab: null },
        content: [
          {
            type: 'panel',
            attrs: { id: 'p1', label: 'One' },
            content: [block('text', {}, [text('first')])],
          },
          {
            type: 'panel',
            attrs: { id: 'p2', label: 'Two' },
            content: [block('text', {}, [text('second')])],
          },
        ],
      },
    ]
    const html = renderArticleHtml(nodes, { publicArticleUrl: 'https://kb.example.com/x' })
    expect(html).toContain('first')
    expect(html).toContain('second')
    expect(html).toContain('href="https://kb.example.com/x"')
    expect(html).toContain('View full article')
  })

  it('accepts a doc-wrapped input', () => {
    const html = renderArticleHtml({
      type: 'doc',
      content: [block('text', {}, [text('hi')])],
    })
    expect(html).toContain('<p data-auxx-block="text">hi</p>')
  })
})
