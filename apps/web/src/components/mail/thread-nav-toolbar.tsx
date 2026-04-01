// apps/web/src/components/mail/thread-nav-toolbar.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Kbd } from '@auxx/ui/components/kbd'
import { useHotkey } from '@tanstack/react-hotkeys'
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { useListThreadIds, useThreadSelectionStore } from '~/components/threads/store'

interface ThreadNavToolbarProps {
  /** Currently viewed thread ID */
  activeThreadId: string
  /** Callback to navigate back to list */
  onBack: () => void
  /** Callback to navigate to a specific thread */
  onNavigate: (threadId: string) => void
}

export function ThreadNavToolbar({ activeThreadId, onBack, onNavigate }: ThreadNavToolbarProps) {
  const listThreadIds = useListThreadIds()

  const currentIndex = useMemo(
    () => listThreadIds.indexOf(activeThreadId),
    [listThreadIds, activeThreadId]
  )

  const hasPrevious = currentIndex > 0
  const hasNext = currentIndex >= 0 && currentIndex < listThreadIds.length - 1

  const goToPrevious = useCallback(() => {
    if (hasPrevious) {
      const prevId = listThreadIds[currentIndex - 1]
      const store = useThreadSelectionStore.getState()
      store.setActiveThread(prevId)
      store.setSelectedThreads([prevId])
      onNavigate(prevId)
    }
  }, [hasPrevious, listThreadIds, currentIndex, onNavigate])

  const goToNext = useCallback(() => {
    if (hasNext) {
      const nextId = listThreadIds[currentIndex + 1]
      const store = useThreadSelectionStore.getState()
      store.setActiveThread(nextId)
      store.setSelectedThreads([nextId])
      onNavigate(nextId)
    }
  }, [hasNext, listThreadIds, currentIndex, onNavigate])

  useHotkey('Q', onBack, { enabled: true })
  useHotkey('ArrowLeft', onBack, { enabled: true })
  useHotkey('K', goToPrevious, { enabled: true })
  useHotkey('J', goToNext, { enabled: true })

  return (
    <div className='flex items-center gap-2 border-b px-3 py-1.5'>
      <Button variant='ghost' size='sm' className='rounded-lg hover:bg-muted' onClick={onBack}>
        <ArrowLeft />
        Back to list
        <Kbd variant='outline' size='sm'>
          Q
        </Kbd>
      </Button>

      <div className='ml-auto flex items-center gap-1'>
        <Tooltip content='Previous' shortcut='K'>
          <Button
            variant='ghost'
            size='icon-sm'
            className='rounded-lg hover:bg-muted'
            disabled={!hasPrevious}
            onClick={goToPrevious}>
            <ChevronUp />
          </Button>
        </Tooltip>
        <Tooltip content='Next' shortcut='J'>
          <Button
            variant='ghost'
            size='icon-sm'
            className='rounded-lg hover:bg-muted'
            disabled={!hasNext}
            onClick={goToNext}>
            <ChevronDown />
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}
