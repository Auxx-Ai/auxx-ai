// apps/web/src/components/icons/__tests__/visual-icon.test.ts

import { describe, expect, it } from 'vitest'
import { parseVisualRef } from '../ui/visual-icon'

describe('parseVisualRef', () => {
  it('parses the explicit prefixes', () => {
    expect(parseVisualRef('brand:shopify')).toEqual({ type: 'brand', slug: 'shopify' })
    expect(parseVisualRef('url:https://a.test/x.png')).toEqual({
      type: 'url',
      value: 'https://a.test/x.png',
    })
    expect(parseVisualRef('color:blue')).toEqual({ type: 'color', color: 'blue' })
    expect(parseVisualRef('icon:user:red')).toEqual({ type: 'icon', iconId: 'user', color: 'red' })
  })

  it('treats every <img src>-renderable string as a url ref', () => {
    // Anything landing on `lucide` here resolves to an unknown icon id, and
    // EntityIcon renders `null` for those — the avatar frame disappears.
    for (const value of [
      'https://cdn.auxx.ai/a.png',
      'http://cdn.auxx.ai/a.png',
      'blob:https://app.auxx.ai/0f0b-4c1a', // optimistic preview during upload
      'data:image/png;base64,iVBORw0KGgo=',
      '/api/files/download/asset:q4p0y2kdx6rpng9ztwbhblcr', // just-saved FILE field
    ]) {
      expect(parseVisualRef(value)).toEqual({ type: 'url', value })
    }
  })

  it('still falls back to emoji and bare lucide ids', () => {
    expect(parseVisualRef('🎉')).toEqual({ type: 'emoji', value: '🎉' })
    expect(parseVisualRef('user')).toEqual({ type: 'lucide', value: 'user' })
    expect(parseVisualRef(null)).toBeNull()
    expect(parseVisualRef('')).toBeNull()
  })
})
