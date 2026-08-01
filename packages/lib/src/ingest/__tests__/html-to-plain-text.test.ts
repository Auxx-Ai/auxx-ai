// packages/lib/src/ingest/__tests__/html-to-plain-text.test.ts

import { describe, expect, it } from 'vitest'
import { deriveSnippet, deriveTextFromHtml } from '../html-to-plain-text'

describe('deriveTextFromHtml', () => {
  it('strips tags and keeps the text content', () => {
    expect(deriveTextFromHtml('<div><span>inline</span> text</div>')).toBe('inline text')
  })

  it('drops <style> contents, not just the tags', () => {
    const html =
      '<html><head><style>.promo { color: red; font-size: 12px }</style></head><body><p>Hello</p></body></html>'

    const text = deriveTextFromHtml(html)

    expect(text).toBe('Hello')
    expect(text).not.toContain('color')
    expect(text).not.toContain('promo')
  })

  it('drops <script> contents, not just the tags', () => {
    const html = '<div><script>var x = 1; alert("boom")</script><p>Hi</p></div>'

    const text = deriveTextFromHtml(html)

    expect(text).toBe('Hi')
    expect(text).not.toContain('alert')
    expect(text).not.toContain('var x')
  })

  it('keeps link text but not the href', () => {
    const text = deriveTextFromHtml(
      '<p>Go <a href="https://example.com/x?y=1">click here</a> now</p>'
    )

    expect(text).toBe('Go click here now')
    expect(text).not.toContain('example.com')
  })

  it('preserves paragraph newlines', () => {
    expect(deriveTextFromHtml('<p>First</p><p>Second</p>')).toBe('First\n\nSecond')
  })

  it('skips images entirely, including alt text', () => {
    expect(deriveTextFromHtml('<p>a<img src="x.png" alt="ALT">b</p>')).toBe('ab')
  })

  it('returns an empty string for empty HTML', () => {
    expect(deriveTextFromHtml('')).toBe('')
  })

  it('returns an empty string for whitespace-only HTML', () => {
    expect(deriveTextFromHtml('   \n\t  ')).toBe('')
    expect(deriveTextFromHtml('<p>  </p>')).toBe('')
  })

  it('does not throw on malformed / unclosed HTML', () => {
    expect(() => deriveTextFromHtml('<div><p>unclosed <b>bold <a href="x">link')).not.toThrow()
    expect(deriveTextFromHtml('<div><p>unclosed <b>bold <a href="x">link')).toBe(
      'unclosed bold link'
    )

    expect(() => deriveTextFromHtml('<p>a</p></div></div>')).not.toThrow()
    expect(() => deriveTextFromHtml('<<< not really markup >>>')).not.toThrow()
  })

  it('does not strip quoted reply history', () => {
    const html =
      '<p>My reply</p><blockquote><p>&gt; On Mon, someone wrote:</p><p>&gt; original text</p></blockquote>'

    const text = deriveTextFromHtml(html)

    expect(text).toContain('My reply')
    expect(text).toContain('original text')
  })
})

describe('deriveSnippet', () => {
  it('collapses runs of whitespace to single spaces', () => {
    expect(deriveSnippet('  hello \n\n  there \t world  ')).toBe('hello there world')
  })

  it('returns the whole string when it fits within max', () => {
    expect(deriveSnippet('short', 200)).toBe('short')
    expect(deriveSnippet('abcde', 5)).toBe('abcde')
  })

  it('truncates with an ellipsis at exactly max characters', () => {
    const snippet = deriveSnippet('a'.repeat(500))

    expect(snippet).toHaveLength(200)
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet).toBe(`${'a'.repeat(199)}…`)
  })

  it('honours a custom max', () => {
    const snippet = deriveSnippet('abcdefghij', 5)

    expect(snippet).toBe('abcd…')
    expect(snippet).toHaveLength(5)
  })

  it('measures length after collapsing, not before', () => {
    expect(deriveSnippet('a     b', 3)).toBe('a b')
  })

  it('returns an empty string for empty or whitespace-only input', () => {
    expect(deriveSnippet('')).toBe('')
    expect(deriveSnippet('   \n\t ')).toBe('')
  })
})
