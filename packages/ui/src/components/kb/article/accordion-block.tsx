// packages/ui/src/components/kb/article/accordion-block.tsx
'use client'

import { ChevronDown } from 'lucide-react'
import { type ReactNode, useCallback, useId, useState } from 'react'
import styles from './kb-article-renderer.module.css'

export interface AccordionBlockItem {
  id: string
  label: string
  body: ReactNode
}

interface AccordionBlockProps {
  items: AccordionBlockItem[]
  allowMultiple: boolean
}

export function AccordionBlock({ items, allowMultiple }: AccordionBlockProps) {
  const baseId = useId()
  // Collapsed by default (Q5e). Track the expanded set; empty initially.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const toggle = useCallback(
    (id: string) => {
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(id)) {
          next.delete(id)
          return next
        }
        if (!allowMultiple) next.clear()
        next.add(id)
        return next
      })
    },
    [allowMultiple]
  )

  if (items.length === 0) return null

  return (
    <div className={styles.accordionContainer}>
      {items.map((item) => {
        const isOpen = expanded.has(item.id)
        const headerId = `${baseId}-h-${item.id}`
        const panelId = `${baseId}-p-${item.id}`
        return (
          <div key={item.id} className={styles.accordionItem}>
            <button
              type='button'
              id={headerId}
              aria-expanded={isOpen}
              aria-controls={panelId}
              className={styles.accordionHeader}
              onClick={() => toggle(item.id)}>
              <span className={styles.accordionChevron} aria-hidden='true' data-open={isOpen}>
                <ChevronDown size={16} />
              </span>
              <span className={styles.accordionLabel}>{item.label || 'Untitled'}</span>
            </button>
            <div
              role='region'
              id={panelId}
              aria-labelledby={headerId}
              className={styles.accordionPanel}
              hidden={!isOpen}>
              {item.body}
            </div>
          </div>
        )
      })}
    </div>
  )
}
