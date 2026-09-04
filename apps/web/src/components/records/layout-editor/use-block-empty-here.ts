// apps/web/src/components/records/layout-editor/use-block-empty-here.ts
'use client'

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import { parseRecordsBlockConfig } from '@auxx/lib/record-layout/client'
import type { LayoutBlock, RecordId } from '@auxx/lib/resources/client'
import { useCallback, useMemo } from 'react'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'

/**
 * Mark the sections that would render nothing for the record the dialog was
 * opened from (`plans/drawer/record-layout-system.md` §9.3).
 *
 * This is a NOTE on a row, never a filter. The layout is per definition while
 * the dialog is opened from one record, so a tree built out of what rendered
 * would hide blocks that exist for every other record of the same definition
 * and a block missing from the tree is one the next save silently drops.
 *
 * Two sources, because blocks differ in what can be known about them:
 *
 * 1. A relation-sourced `records` block is answered from the host record's own
 *    mirror value, with `autoFetch` off: the surface the dialog was opened from
 *    has already read these, so this reads the store and never turns opening a
 *    settings dialog into a fan-out of value queries.
 * 2. Everything else, a `card` above all, is answered by asking the LIVE
 *    surface. A card's emptiness is a fact about what its component rendered
 *    and nothing else, which is exactly why the surface hides it with a CSS
 *    `:empty` match rather than a predicate. `LayoutBlockSection` tags each
 *    rendered section with `data-layout-block-id`, so the sections currently on
 *    screen can be scanned once when the dialog opens.
 *
 * The scan is a snapshot taken at open, matching the staged-session model: the
 * dialog seeds on the closed to open transition and does not re-read afterwards.
 * A block with no tagged section on screen reports "not empty", the safe
 * direction, because it may simply live on a tab that is not mounted. An
 * unmarked row is merely uninformative; a wrongly marked one reads as broken.
 */
export function useBlockEmptyHere(
  recordId: string | undefined,
  blocks: Record<string, LayoutBlock>,
  /** Re-scan the live surface whenever this flips to true (the dialog opening). */
  open = true
): (block: LayoutBlock) => boolean {
  const relationAttrs = useMemo(() => {
    const attrs: string[] = []
    for (const block of Object.values(blocks)) {
      if (block.kind !== 'records') continue
      const config = parseRecordsBlockConfig(block.config)
      if (config?.source.kind !== 'relation') continue
      if (!attrs.includes(config.source.relationAttr)) attrs.push(config.source.relationAttr)
    }
    return attrs
  }, [blocks])

  const { values } = useSystemValues(recordId as RecordId | undefined, relationAttrs, {
    autoFetch: false,
    enabled: Boolean(recordId) && relationAttrs.length > 0,
  })

  // Which blocks are ON SCREEN right now, and which of those rendered nothing.
  // Scanned once per opening: `useMemo` on `open` rather than an effect, so the
  // first render of the tree already has the answer and no row flickers from
  // unmarked to marked.
  const domEmpty = useMemo(() => {
    const rendered = new Set<string>()
    const empty = new Set<string>()
    if (!open || typeof document === 'undefined') return { rendered, empty }
    for (const node of document.querySelectorAll('[data-layout-block-id]')) {
      const blockId = node.getAttribute('data-layout-block-id')
      if (!blockId) continue
      rendered.add(blockId)
      const content = node.querySelector('[data-slot=section-content]')
      // Matches the surface's own rule: a deliberate empty state (an `EmptyRow`)
      // is NOT empty and keeps its header, so it must not be marked either.
      if (content && content.childElementCount === 0 && content.textContent?.trim() === '') {
        empty.add(blockId)
      }
    }
    return { rendered, empty }
  }, [open])

  return useCallback(
    (block: LayoutBlock) => {
      if (!recordId) return false

      if (block.kind === 'records') {
        const config = parseRecordsBlockConfig(block.config)
        if (config?.source.kind === 'relation') {
          const value = values[config.source.relationAttr]
          // Unread is not empty: the store simply has not seen this mirror.
          if (value === undefined || value === null) return false
          return extractRelationshipRecordIds(value).length === 0
        }
      }

      // Not on screen is not empty: the block may live on an unmounted tab.
      if (!domEmpty.rendered.has(block.id)) return false
      return domEmpty.empty.has(block.id)
    },
    [recordId, values, domEmpty]
  )
}
