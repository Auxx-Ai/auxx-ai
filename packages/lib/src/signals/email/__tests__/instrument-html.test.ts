// packages/lib/src/signals/email/__tests__/instrument-html.test.ts

import { API_URL, TRACK_URL } from '@auxx/config/urls'
import { describe, expect, it } from 'vitest'
import { instrumentEmailHtml } from '../instrument-html'

const BASE_INPUT = {
  organizationId: 'org_1',
  messageId: 'msg_1',
  contactEntityInstanceId: 'contact_1',
  channelId: 'channel_1',
}

/** Extracts every `href="..."`/`href='...'` value from HTML, in document order. */
function extractHrefs(html: string): string[] {
  return [...html.matchAll(/href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/gi)].map(
    (m) => m[1] ?? m[2] ?? ''
  )
}

describe('instrumentEmailHtml', () => {
  it('injects the open pixel immediately before </body>', async () => {
    const html = '<html><body><p>hi</p></body></html>'
    const out = await instrumentEmailHtml({ ...BASE_INPUT, html, opens: true, clicks: false })
    expect(out).toMatch(/<img src="[^"]+\/t\/o\/[^"]+"[^>]*\/>\s*<\/body>/)
    expect(out.indexOf('</body>')).toBeGreaterThan(out.indexOf('<img'))
  })

  it('appends the open pixel at the end when there is no </body>', async () => {
    const html = '<p>no body tag here</p>'
    const out = await instrumentEmailHtml({ ...BASE_INPUT, html, opens: true, clicks: false })
    expect(out.startsWith(html)).toBe(true)
    expect(out).toMatch(/<img src="[^"]+\/t\/o\/[^"]+"[^>]*\/>$/)
  })

  it('reuses the same token for the same URL appearing twice', async () => {
    const html = `
      <a href="https://example.com/a">first</a>
      <a href="https://example.com/a">second</a>
    `
    const out = await instrumentEmailHtml({ ...BASE_INPUT, html, opens: false, clicks: true })
    const hrefs = extractHrefs(out)
    expect(hrefs).toHaveLength(2)
    expect(hrefs[0]).toBe(hrefs[1])
    expect(hrefs[0]).toContain(`${TRACK_URL}/t/c/`)
  })

  it('skips mailto:, tel:, #fragment, and cid: links', async () => {
    const html = [
      '<a href="mailto:a@example.com">mail</a>',
      '<a href="tel:+15551234567">call</a>',
      '<a href="#section">jump</a>',
      '<a href="cid:logo123">logo</a>',
    ].join('\n')
    const out = await instrumentEmailHtml({ ...BASE_INPUT, html, opens: false, clicks: true })
    expect(extractHrefs(out)).toEqual([
      'mailto:a@example.com',
      'tel:+15551234567',
      '#section',
      'cid:logo123',
    ])
  })

  it('skips caller-supplied skipUrls', async () => {
    const skipUrl = 'https://example.com/keep-plain'
    const html = `<a href="${skipUrl}">keep</a>`
    const out = await instrumentEmailHtml({
      ...BASE_INPUT,
      html,
      opens: false,
      clicks: true,
      skipUrls: [skipUrl],
    })
    expect(extractHrefs(out)).toEqual([skipUrl])
  })

  it('skips unsubscribe links (API_URL/u/...)', async () => {
    const unsubUrl = `${API_URL}/u/some-token`
    const html = `<a href="${unsubUrl}">unsubscribe</a>`
    const out = await instrumentEmailHtml({ ...BASE_INPUT, html, opens: false, clicks: true })
    expect(extractHrefs(out)).toEqual([unsubUrl])
  })

  it('does not re-wrap a link that is already a tracking link', async () => {
    const alreadyTracked = `${TRACK_URL}/t/c/some-existing-token?u=https%3A%2F%2Fexample.com`
    const html = `<a href="${alreadyTracked}">go</a>`
    const out = await instrumentEmailHtml({ ...BASE_INPUT, html, opens: false, clicks: true })
    expect(extractHrefs(out)).toEqual([alreadyTracked])
  })

  it('opens-only: injects a pixel and leaves links untouched', async () => {
    const html = '<body><a href="https://example.com/a">a</a></body>'
    const out = await instrumentEmailHtml({ ...BASE_INPUT, html, opens: true, clicks: false })
    expect(extractHrefs(out)).toEqual(['https://example.com/a'])
    expect(out).toContain('/t/o/')
  })

  it('clicks-only: wraps links and injects no pixel', async () => {
    const html = '<body><a href="https://example.com/a">a</a></body>'
    const out = await instrumentEmailHtml({ ...BASE_INPUT, html, opens: false, clicks: true })
    expect(out).not.toContain('/t/o/')
    expect(extractHrefs(out)[0]).toContain('/t/c/')
  })

  it('returns html unchanged when both opens and clicks are false', async () => {
    const html = '<body><a href="https://example.com/a">a</a></body>'
    const out = await instrumentEmailHtml({ ...BASE_INPUT, html, opens: false, clicks: false })
    expect(out).toBe(html)
  })

  it('preserves other attributes on rewrapped anchors', async () => {
    const html =
      '<a class="btn" href="https://example.com/a" target="_blank" rel="noopener">click</a>'
    const out = await instrumentEmailHtml({ ...BASE_INPUT, html, opens: false, clicks: true })
    expect(out).toContain('class="btn"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener"')
    expect(out).not.toContain('href="https://example.com/a"')
  })

  it('preserves single-quoted href attributes and their quote style', async () => {
    const html = "<a href='https://example.com/a'>click</a>"
    const out = await instrumentEmailHtml({ ...BASE_INPUT, html, opens: false, clicks: true })
    expect(out).toMatch(/href='[^']+\/t\/c\/[^']+'/)
  })
})
