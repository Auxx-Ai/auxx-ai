// apps/web/src/components/mail/utils/sandboxed-email-html.test.ts

import { describe, expect, it } from 'vitest'
import { buildSrcdoc } from './sandboxed-email-html'

describe('buildSrcdoc', () => {
  describe('colour scheme', () => {
    it('forces a light colour scheme so the OS setting cannot reach the document', () => {
      const srcdoc = buildSrcdoc('<p>Test message.</p>')
      expect(srcdoc).toContain('color-scheme: light !important')
    })

    it('forces the scheme on a full document too, not just a fragment', () => {
      const srcdoc = buildSrcdoc('<html><head><title>x</title></head><body><p>Hi</p></body></html>')
      expect(srcdoc).toContain('color-scheme: light !important')
    })

    it('sets an explicit foreground colour instead of `inherit`', () => {
      // `color: inherit` on `body` inside an iframe resolves against that
      // document's own `html`, i.e. the OS-dependent UA default — the bug.
      const srcdoc = buildSrcdoc('<p>Test message.</p>')
      expect(srcdoc).not.toContain('color: inherit')
      expect(srcdoc).toMatch(/body\s*\{[^}]*color:\s*#[0-9a-f]{6}/i)
    })

    it('paints an opaque light canvas on html, not on body', () => {
      // On `html` so a sender's own `body { background }` / `<body bgcolor>`
      // still paints over it.
      const srcdoc = buildSrcdoc('<p>Test message.</p>')
      expect(srcdoc).toMatch(/html\s*\{\s*background-color:\s*#ffffff/i)
      expect(srcdoc).not.toMatch(/body\s*\{[^}]*background/i)
    })
  })

  describe('author styles win', () => {
    it('injects base styles before the sender own <style> block', () => {
      const html =
        '<html><head><style>body { color: #333; }</style></head><body><p>Hi</p></body></html>'
      const srcdoc = buildSrcdoc(html)

      const baseIndex = srcdoc.indexOf('color-scheme: light')
      const authorIndex = srcdoc.indexOf('body { color: #333; }')

      expect(baseIndex).toBeGreaterThanOrEqual(0)
      expect(authorIndex).toBeGreaterThanOrEqual(0)
      // Equal specificity: the later rule wins, so the sender's colour survives.
      expect(baseIndex).toBeLessThan(authorIndex)
    })

    it('never uses !important on colour, only on the scheme', () => {
      const srcdoc = buildSrcdoc('<p>Hi</p>')
      const importantDeclarations = srcdoc.match(/[a-z-]+:[^;]*!important/gi) ?? []
      expect(importantDeclarations).toHaveLength(1)
      expect(importantDeclarations[0]).toContain('color-scheme')
    })

    it('leaves a sender inline colour untouched', () => {
      const srcdoc = buildSrcdoc('<p style="color: #333">Hi</p>')
      expect(srcdoc).toContain('<p style="color: #333">Hi</p>')
    })
  })

  describe('document shape', () => {
    it('wraps a fragment in a full document with the CSP tag', () => {
      const srcdoc = buildSrcdoc('<p>Hi</p>')
      expect(srcdoc).toContain('<!DOCTYPE html>')
      expect(srcdoc).toContain('Content-Security-Policy')
      expect(srcdoc).toContain('<body><p>Hi</p></body>')
    })

    it('injects into an existing head rather than nesting a second document', () => {
      const srcdoc = buildSrcdoc('<html><head></head><body>Hi</body></html>')
      expect(srcdoc.match(/<html/gi)).toHaveLength(1)
      expect(srcdoc).toContain('Content-Security-Policy')
    })
  })
})
