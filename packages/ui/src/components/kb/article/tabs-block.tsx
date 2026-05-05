// packages/ui/src/components/kb/article/tabs-block.tsx
'use client'

import { EntityIcon } from '@auxx/ui/components/icons'
import { type KeyboardEvent, type ReactNode, useCallback, useId, useState } from 'react'
import styles from './kb-article-renderer.module.css'

export interface TabsBlockPanel {
  id: string
  label: string
  iconId?: string
  body: ReactNode
}

interface TabsBlockProps {
  panels: TabsBlockPanel[]
}

export function TabsBlock({ panels }: TabsBlockProps) {
  const baseId = useId()
  const [activeId, setActiveId] = useState<string>(panels[0]?.id ?? '')

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (panels.length === 0) return
      const index = panels.findIndex((p) => p.id === activeId)
      if (index < 0) return
      let next: number | null = null
      if (event.key === 'ArrowRight') next = (index + 1) % panels.length
      else if (event.key === 'ArrowLeft') next = (index - 1 + panels.length) % panels.length
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = panels.length - 1
      if (next == null) return
      event.preventDefault()
      setActiveId(panels[next].id)
      const target = event.currentTarget.querySelector<HTMLButtonElement>(
        `[data-tab-id="${panels[next].id}"]`
      )
      target?.focus()
    },
    [panels, activeId]
  )

  if (panels.length === 0) return null

  return (
    <div className={styles.tabsContainer}>
      <div
        className={styles.tabsHeader}
        role='tablist'
        aria-orientation='horizontal'
        onKeyDown={handleKeyDown}>
        {panels.map((panel) => {
          const isActive = panel.id === activeId
          return (
            <button
              key={panel.id}
              type='button'
              role='tab'
              data-tab-id={panel.id}
              id={`${baseId}-tab-${panel.id}`}
              aria-selected={isActive}
              aria-controls={`${baseId}-panel-${panel.id}`}
              tabIndex={isActive ? 0 : -1}
              className={styles.tabButton}
              onClick={() => setActiveId(panel.id)}>
              {panel.iconId ? <EntityIcon iconId={panel.iconId} variant='bare' size='xs' /> : null}
              <span>{panel.label || 'Untitled'}</span>
            </button>
          )
        })}
      </div>
      <div className={styles.tabsBody}>
        {panels.map((panel) => {
          const isActive = panel.id === activeId
          return (
            <div
              key={panel.id}
              role='tabpanel'
              id={`${baseId}-panel-${panel.id}`}
              aria-labelledby={`${baseId}-tab-${panel.id}`}
              className={styles.tabPanel}
              hidden={!isActive}>
              {panel.body}
            </div>
          )
        })}
      </div>
    </div>
  )
}
