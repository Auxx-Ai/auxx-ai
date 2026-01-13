// apps/web/src/components/tasks/ui/tasks-section.tsx

'use client'

import { useState } from 'react'
import { ListTodo, Plus } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import type { ResourceId } from '@auxx/lib/resources/client'
import { TasksList } from './tasks-list'
import { TaskDialog } from './task-dialog'

/**
 * Props for TasksSection component
 */
interface TasksSectionProps {
  /** Resource ID in format "entityDefinitionId:entityInstanceId" */
  resourceId: ResourceId
}

/**
 * TasksSection renders the tasks section within an entity drawer.
 * Displays a list of tasks linked to the entity with ability to create new tasks.
 */
export function TasksSection({ resourceId }: TasksSectionProps) {
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
            resourceId={resourceId}
            onCreateClick={() => setDialogOpen(true)}
          />
        </Section>
      </ScrollArea>

      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode="create"
        defaultReferencedEntity={resourceId}
      />
    </>
  )
}
