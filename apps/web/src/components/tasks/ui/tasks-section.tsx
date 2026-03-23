// apps/web/src/components/tasks/ui/tasks-section.tsx

'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { ListTodo, Plus } from 'lucide-react'
import { useCreateTaskStore } from '../stores/create-task-store'
import { TasksList } from './tasks-list'

/**
 * Props for TasksSection component
 */
interface TasksSectionProps {
  /** Record ID in format "entityDefinitionId:entityInstanceId" */
  recordId: RecordId
}

/**
 * TasksSection renders the tasks section within an entity drawer.
 * Displays a list of tasks linked to the entity with ability to create new tasks.
 */
export function TasksSection({ recordId }: TasksSectionProps) {
  const openDialog = useCreateTaskStore((s) => s.openDialog)

  const handleCreate = () => openDialog({ referencedEntity: recordId })

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
