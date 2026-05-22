// packages/lib/src/kb/render-article-html.test.ts

import { describe, expect, it } from 'vitest'
import type {
  AccordionJSON,
  ArticleNodeJSON,
  BlockJSON,
  InlineJSON,
  TableJSON,
  TabsJSON,
} from './markdown/types'
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

  it('renders code blocks with escaped content when no highlighted html is present', () => {
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

  it('falls back to escape-only output when codeHighlightedHtml contains script', () => {
    const html = renderArticleHtml([
      block('codeBlock', {
        codeLanguage: 'ts',
        codeHighlightedHtml: '<pre><code><script>alert(1)</script>const x=1</code></pre>',
      }),
    ])
    expect(html).not.toContain('<script>')
  })

  it('passes through allowed shiki spans with class/style', () => {
    const html = renderArticleHtml([
      block('codeBlock', {
        codeLanguage: 'ts',
        codeHighlightedHtml:
          '<pre class="shiki"><code><span style="color:#abcdef">const</span></code></pre>',
      }),
    ])
    expect(html).toContain('data-auxx-block="code"')
    expect(html).toContain('<span style="color:#abcdef">const</span>')
  })
})

describe('renderArticleHtml — header', () => {
  it('renders nothing for empty header opts', () => {
    expect(renderArticleHtml([])).toBe('')
  })

  it('renders cover + icon placeholder + title together', () => {
    const html = renderArticleHtml([], {
      coverImageUrl: 'https://cdn.example.com/c.png',
      emoji: 'home',
      title: 'Welcome',
    })
    expect(html).toContain('<header data-auxx-article-head>')
    expect(html).toContain('data-auxx-article-cover')
    expect(html).toContain('<h1 data-auxx-article-title>')
    expect(html).toContain('data-auxx-icon="home"')
    expect(html).toContain('data-auxx-article-emoji')
    expect(html).toContain('Welcome')
  })

  it('renders emoji-only header without collapsing the title block', () => {
    const html = renderArticleHtml([], { emoji: 'book-open' })
    expect(html).toContain('<h1 data-auxx-article-title>')
    expect(html).toContain('data-auxx-icon="book-open"')
  })

  it('drops javascript: cover URLs', () => {
    const html = renderArticleHtml([], {
      coverImageUrl: 'javascript:alert(1)',
      title: 'X',
    })
    expect(html).not.toContain('javascript')
  })
})

describe('renderArticleHtml — tabs', () => {
  it('renders a tabs container with the first panel active', () => {
    const node: TabsJSON = {
      type: 'tabs',
      attrs: { activeTab: null },
      content: [
        {
          type: 'panel',
          attrs: { id: 'p1', label: 'One', iconId: 'home' },
          content: [block('text', {}, [text('first')])],
        },
        {
          type: 'panel',
          attrs: { id: 'p2', label: 'Two' },
          content: [block('text', {}, [text('second')])],
        },
      ],
    }
    const html = renderArticleHtml([node])
    expect(html).toContain('data-auxx-block="tabs"')
    expect(html).toContain('data-auxx-tab data-target="p1"')
    expect(html).toContain('data-auxx-tab data-target="p2"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('data-auxx-icon="home"')
    expect(html).toContain('data-auxx-tab-panel data-id="p1"')
    expect(html).toContain('data-active="true"')
    expect(html).toContain('first')
    expect(html).toContain('second')
  })

  it('renders Untitled when panel label is missing', () => {
    const node: TabsJSON = {
      type: 'tabs',
      attrs: { activeTab: null },
      content: [
        {
          type: 'panel',
          attrs: { id: 'p1', label: '' },
          content: [block('text', {}, [text('x')])],
        },
      ],
    }
    const html = renderArticleHtml([node])
    expect(html).toContain('Untitled')
  })
})

describe('renderArticleHtml — accordion', () => {
  it('renders details/summary collapsed by default with chevron icon', () => {
    const node: AccordionJSON = {
      type: 'accordion',
      attrs: { allowMultiple: false },
      content: [
        {
          type: 'panel',
          attrs: { id: 'q1', label: 'Q1' },
          content: [block('text', {}, [text('answer1')])],
        },
        {
          type: 'panel',
          attrs: { id: 'q2', label: 'Q2' },
          content: [block('text', {}, [text('answer2')])],
        },
      ],
    }
    const html = renderArticleHtml([node])
    expect(html).toContain('data-auxx-block="accordion"')
    expect(html).toContain('data-allow-multiple="false"')
    expect(html).toContain('<details data-auxx-accordion-item data-id="q1"')
    expect(html).not.toContain(' open>')
    expect(html).toContain('data-auxx-icon="chevron-down"')
    expect(html).toContain('answer1')
    expect(html).toContain('answer2')
  })

  it('defaults allow-multiple to true when attr is missing', () => {
    const node: AccordionJSON = {
      type: 'accordion',
      attrs: { allowMultiple: true },
      content: [
        {
          type: 'panel',
          attrs: { id: 'q1', label: 'Q1' },
          content: [block('text', {}, [text('x')])],
        },
      ],
    }
    const html = renderArticleHtml([node])
    expect(html).toContain('data-allow-multiple="true"')
  })
})

describe('renderArticleHtml — table', () => {
  it('promotes the first row to <thead> when all cells are tableHeader', () => {
    const node: TableJSON = {
      type: 'table',
      attrs: {},
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableHeader',
              attrs: {},
              content: [block('text', {}, [text('Name')])],
            },
            {
              type: 'tableHeader',
              attrs: {},
              content: [block('text', {}, [text('Value')])],
            },
          ],
        },
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              attrs: {},
              content: [block('text', {}, [text('a')])],
            },
            {
              type: 'tableCell',
              attrs: {},
              content: [block('text', {}, [text('1')])],
            },
          ],
        },
      ],
    }
    const html = renderArticleHtml([node])
    expect(html).toContain('data-auxx-block="table"')
    expect(html).toContain('<thead><tr>')
    expect(html).toContain('<th scope="col">')
    expect(html).toContain('<tbody>')
    expect(html).toContain('<td>')
    expect(html).toContain('Name')
    expect(html).toContain('a')
  })

  it('emits colspan and rowspan attrs when > 1', () => {
    const node: TableJSON = {
      type: 'table',
      attrs: {},
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              attrs: { colspan: 2, rowspan: 3 },
              content: [block('text', {}, [text('x')])],
            },
          ],
        },
      ],
    }
    const html = renderArticleHtml([node])
    expect(html).toContain('colspan="2"')
    expect(html).toContain('rowspan="3"')
  })

  it('omits thead when the first row is mixed', () => {
    const node: TableJSON = {
      type: 'table',
      attrs: {},
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              attrs: {},
              content: [block('text', {}, [text('a')])],
            },
            {
              type: 'tableHeader',
              attrs: {},
              content: [block('text', {}, [text('b')])],
            },
          ],
        },
      ],
    }
    const html = renderArticleHtml([node])
    expect(html).not.toContain('<thead>')
    expect(html).toContain('<th scope="row">')
  })
})

describe('renderArticleHtml — embed', () => {
  it('renders a sandboxed iframe for a YouTube URL', () => {
    const html = renderArticleHtml([
      block('embed', {
        embedUrl: 'https://www.youtube.com/watch?v=abcdef1234',
        embedAspect: '4:3',
      }),
    ])
    expect(html).toContain('data-auxx-block="embed"')
    expect(html).toContain('data-aspect="4:3"')
    expect(html).toContain('data-provider="youtube"')
    expect(html).toContain('src="https://www.youtube.com/embed/abcdef1234"')
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-presentation"')
    expect(html).toContain('loading="lazy"')
  })

  it('falls back to a text link for an unknown provider', () => {
    const html = renderArticleHtml([block('embed', { embedUrl: 'https://example.com/video' })])
    expect(html).not.toContain('<iframe')
    expect(html).toContain('href="https://example.com/video"')
    expect(html).toContain('target="_blank"')
  })

  it('emits nothing for a javascript: embed URL', () => {
    const html = renderArticleHtml([block('embed', { embedUrl: 'javascript:alert(1)' })])
    expect(html).not.toContain('javascript')
    expect(html).not.toContain('<iframe')
  })

  it('clamps unknown aspect ratios to 16:9', () => {
    const html = renderArticleHtml([
      block('embed', {
        embedUrl: 'https://www.youtube.com/watch?v=abcdef1234',
        embedAspect: 'bogus' as unknown as undefined,
      }),
    ])
    expect(html).toContain('data-aspect="16:9"')
  })
})

describe('renderArticleHtml — cards', () => {
  it('renders internal-ref cards with data-auxx-article-link and href="#"', () => {
    const html = renderArticleHtml([
      block('cards', {
        cards: [
          {
            id: 'c1',
            title: 'Getting started',
            description: 'Read this first',
            href: 'auxx://kb/article/abc',
            iconId: 'home',
          },
        ],
      }),
    ])
    expect(html).toContain('data-auxx-block="cards"')
    expect(html).toContain('data-auxx-article-link="abc"')
    expect(html).toContain('href="#"')
    expect(html).toContain('Getting started')
    expect(html).toContain('Read this first')
    expect(html).toContain('data-auxx-icon="home"')
  })

  it('renders external-href cards with target=_blank', () => {
    const html = renderArticleHtml([
      block('cards', {
        cards: [{ id: 'c1', title: 'Blog', href: 'https://example.com' }],
      }),
    ])
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('falls back to a non-link wrapper when href is missing or unsafe', () => {
    const html = renderArticleHtml([
      block('cards', {
        cards: [{ id: 'c1', title: 'No link' }],
      }),
    ])
    expect(html).toContain('<div data-auxx-card')
    expect(html).not.toContain('href=')
  })

  it('emits nothing when cards array is empty', () => {
    const html = renderArticleHtml([block('cards', { cards: [] })])
    expect(html).toBe('')
  })
})

describe('renderArticleHtml — doc input', () => {
  it('accepts a doc-wrapped input', () => {
    const html = renderArticleHtml({
      type: 'doc',
      content: [block('text', {}, [text('hi')])],
    })
    expect(html).toContain('<p data-auxx-block="text">hi</p>')
  })
})
