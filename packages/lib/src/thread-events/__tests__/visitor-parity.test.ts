// packages/lib/src/thread-events/__tests__/visitor-parity.test.ts
//
// `packages/chat` has no `@auxx/lib` dependency (the widget bundle cannot pull
// server deps), so its `THREAD_EVENT_TYPES` copy in
// `src/transport/thread-events.ts` is structurally un-collapsible
// (plans/threads/thread-events.md §1.5 site 5). Pin it to the FROZEN
// visitor-facing set instead — NOT to lib's `THREAD_EVENT_TYPES`, which grows
// admin-surface types the widget must never learn about (§13.3.3).
//
// Read as source (the same idiom as the structural pins in
// `mail-instance-access.test.ts`) because no export path can import across the
// lib ↔ chat boundary in either direction.

import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { VISITOR_FACING_THREAD_EVENT_TYPES } from '../client'

const WIDGET_TYPES_FILE = fileURLToPath(
  new URL('../../../../chat/src/transport/thread-events.ts', import.meta.url)
)

describe('visitor-facing thread event vocabulary parity', () => {
  it("packages/chat's THREAD_EVENT_TYPES equals the frozen visitor set", () => {
    const src = fs.readFileSync(WIDGET_TYPES_FILE, 'utf8')
    const block = src.match(/export const THREAD_EVENT_TYPES = \[([\s\S]*?)\]/)?.[1]
    expect(block, 'THREAD_EVENT_TYPES const not found in the widget transport file').toBeTruthy()

    const widgetTypes = [...(block ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(widgetTypes.length).toBeGreaterThan(0)
    expect(new Set(widgetTypes)).toEqual(new Set(VISITOR_FACING_THREAD_EVENT_TYPES))
  })

  it('the frozen set stays frozen at the original six', () => {
    // §13.3.1: `VISITOR_FACING_THREAD_EVENT_TYPES` does not grow. New types are
    // admin-surface only — a visitor must never learn a thread was tagged or
    // merged. If this fails, someone added to the wrong list.
    expect([...VISITOR_FACING_THREAD_EVENT_TYPES].sort()).toEqual([
      'thread:archived',
      'thread:assignee:changed',
      'thread:reopened',
      'thread:returned_to_ai',
      'thread:taken_over',
      'thread:visitor:identified',
    ])
  })
})
