// apps/web/src/components/tasks/ui/tasks-section.tsx

'use client'

import { useState } from 'react'
import { ListTodo, Plus } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { TasksList } from './tasks-list'
import { TaskDialog } from './task-dialog'

/**
 * Props for TasksSection component
 */
interface TasksSectionProps {
  /** Entity instance ID (for filtering tasks linked to this entity) */
  entityInstanceId: string
  /** Entity definition ID (for creating new task references) */
  entityDefinitionId: string
}

/**
 * TasksSection renders the tasks section within an entity drawer.
 * Displays a list of tasks linked to the entity with ability to create new tasks.
 */
export function TasksSection({ entityInstanceId, entityDefinitionId }: TasksSectionProps) {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <>
      <ScrollArea className="flex-1">
        <Section
          title="Tasks"
          className="flex flex-col flex-1 min-h-0 w-full [&_[data-slot=section]]:flex-1 [&_[data-slot=section]]:border-b-0 [&_[data-slot=section-content]]:flex-1"
          collapsible={false}
          icon={<ListTodo className="size-4 text-muted-foreground/50" />}
          actions={
            <Button variant="ghost" size="sm" onClick={() => setDialogOpen(true)}>
              <Plus />
              Create
            </Button>
          }>
          <TasksList
            viewMode="entity"
            entityInstanceId={entityInstanceId}
            entityDefinitionId={entityDefinitionId}
            onCreateClick={() => setDialogOpen(true)}
          />
        </Section>
      </ScrollArea>

      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode="create"
        defaultReferencedEntity={{
          entityInstanceId,
          entityDefinitionId,
        }}
      />
    </>
  )
}
