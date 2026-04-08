// apps/web/src/components/kopilot/ui/blocks/task-list-block.tsx

'use client'

import type { TaskWithRelations } from '@auxx/lib/tasks'
import { cn } from '@auxx/ui/lib/utils'
import { CheckSquare } from 'lucide-react'
import { motion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useTaskCompletion } from '~/components/tasks/hooks/use-task-completion'
import {
  useTaskEffectiveCompletedAt,
  useTaskHasPendingCompletion,
} from '~/components/tasks/hooks/use-task-effective-state'
import { useTasks } from '~/components/tasks/hooks/use-tasks'
import { TaskCheckbox } from '~/components/tasks/ui/task-checkbox'
import { TaskDialog } from '~/components/tasks/ui/task-dialog'
import { TaskItem } from '~/components/tasks/ui/task-item'
import { BlockCard } from './block-card'
import type { BlockRendererProps } from './block-registry'
import type { TaskListData } from './block-schemas'

export function TaskListBlock({ data, skipEntrance }: BlockRendererProps<TaskListData>) {
  const router = useRouter()
  const [selectedTask, setSelectedTask] = useState<TaskWithRelations | null>(null)

  // Fetch real task data reactively — any mutations (assign, complete, etc.) auto-update
  const { tasks, isLoading } = useTasks({ includeCompleted: true, enabled: data.length > 0 })

  // Filter to only the tasks returned by the AI tool
  const aiTaskIds = new Set(data.map((t) => t.id))
  const filteredTasks = tasks.filter((t) => aiTaskIds.has(t.id))

  const handleTaskClick = useCallback((task: TaskWithRelations) => {
    setSelectedTask(task)
  }, [])

  return (
    <div className='not-prose my-2'>
      <BlockCard
        data-slot='task-list-block'
        indicator={<CheckSquare className='size-3 text-muted-foreground' />}
        primaryText='Tasks'
        secondaryText={
          <span className='text-xs text-muted-foreground'>{filteredTasks.length}</span>
        }
        actions={[
          {
            label: 'Open Tasks',
            onClick: () => router.push('/app/tasks'),
            primary: true,
          },
        ]}>
        <div className='space-y-1'>
          {filteredTasks.map((task, i) => (
            <motion.div
              key={task.id}
              initial={skipEntrance ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                type: 'spring',
                stiffness: 400,
                damping: 22,
                delay: skipEntrance ? 0 : Math.min(i * 0.04, 0.3),
              }}>
              <TaskItem task={task} onClick={() => handleTaskClick(task)} />
            </motion.div>
          ))}
        </div>
      </BlockCard>

      <TaskDialog
        open={!!selectedTask}
        onOpenChange={(open) => !open && setSelectedTask(null)}
        mode='edit'
        task={selectedTask ?? undefined}
      />
    </div>
  )
}
