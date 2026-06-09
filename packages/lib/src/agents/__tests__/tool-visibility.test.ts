// packages/lib/src/agents/__tests__/tool-visibility.test.ts

import { describe, expect, it } from 'vitest'
import { isToolVisibleOn, type ToolVisibilitySurface, toolCategory } from '../tool-visibility'

describe('toolCategory', () => {
  it('defaults to capability when unannotated', () => {
    expect(toolCategory({})).toBe('capability')
    expect(toolCategory({ category: undefined })).toBe('capability')
  })

  it('returns the declared category', () => {
    expect(toolCategory({ category: 'control' })).toBe('control')
    expect(toolCategory({ category: 'system' })).toBe('system')
  })
})

describe('isToolVisibleOn', () => {
  const surfaces: ToolVisibilitySurface[] = [
    'mockEditor',
    'referencePicker',
    'toolsetSettings',
    'trace',
  ]

  it('hides control tools on every surface', () => {
    for (const surface of surfaces) {
      expect(isToolVisibleOn({ category: 'control' }, surface)).toBe(false)
    }
  })

  it('shows capability and system tools on every surface', () => {
    for (const surface of surfaces) {
      expect(isToolVisibleOn({ category: 'capability' }, surface)).toBe(true)
      // system is collapsed at the UI layer on mockEditor, not hidden here
      expect(isToolVisibleOn({ category: 'system' }, surface)).toBe(true)
    }
  })

  it('treats an unannotated tool as capability (visible)', () => {
    expect(isToolVisibleOn({}, 'mockEditor')).toBe(true)
  })
})
