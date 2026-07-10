// apps/web/src/components/tasks/ui/tasks-section.tsx

'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { ListTodo, Plus } from 'lucide-react'
import { useState } from 'react'
import { useCreateTaskStore } from '../stores/create-task-store'
import { TasksList } from './tasks-list'

/** Recent-N page size for the `variant='section'` preview (04-ui.md §6: "recent-N + more"). */
const SECTION_RECENT_LIMIT = 10

/**
 * Props for TasksSection component
 */
interface TasksSectionProps {
  /** Record ID in format "entityDefinitionId:entityInstanceId" */
  recordId: RecordId
  /**
   * `'tab'` (default, UNCHANGED): full-height `ScrollArea` + own `<Section>` chrome —
   * used by the record drawer and `DetailViewMainTabs` (`layout: 'tabs'`).
   * `'section'`: intrinsic height, no own `ScrollArea` — used inside a
   * `DetailViewSections` `<Section>` (the outer page already owns scroll AND the
   * "Tasks" header), so this renders just a recent-N list + local "Show more"
   * (bumps the fetched page size — `useTasks`' cursor pagination is a no-op today)
   * + its own inline Create action.
   */
  variant?: 'tab' | 'section'
}

/**
 * TasksSection renders the tasks section within an entity drawer.
 * Displays a list of tasks linked to the entity with ability to create new tasks.
 */
export function TasksSection({ recordId, variant = 'tab' }: TasksSectionProps) {
  const openDialog = useCreateTaskStore((s) => s.openDialog)
  const [limit, setLimit] = useState(SECTION_RECENT_LIMIT)

  const handleCreate = () => openDialog({ referencedEntity: recordId })

  if (variant === 'section') {
    return (
      <div className='flex flex-col gap-2'>
        <div className='flex justify-end'>
          <Button variant='ghost' size='sm' onClick={handleCreate}>
            <Plus />
            Create
          </Button>
        </div>
        <TasksList
          viewMode='entity'
          recordId={recordId}
          onCreateClick={handleCreate}
          limit={limit}
          onShowMore={() => setLimit((l) => l + SECTION_RECENT_LIMIT)}
        />
      </div>
    )
  }

  return (
    <ScrollArea className='flex-1'>
      <Section
        title='Tasks'
        className='flex flex-col flex-1 min-h-0 w-full [&_[data-slot=section]]:flex-1 [&_[data-slot=section]]:border-b-0 [&_[data-slot=section-content]]:flex-1'
        collapsible={false}
        icon={<ListTodo className='size-4 text-muted-foreground/50' />}
        actions={
          <Button variant='ghost' size='sm' onClick={handleCreate}>
            <Plus />
            Create
          </Button>
        }>
        <TasksList viewMode='entity' recordId={recordId} onCreateClick={handleCreate} />
      </Section>
    </ScrollArea>
  )
}
