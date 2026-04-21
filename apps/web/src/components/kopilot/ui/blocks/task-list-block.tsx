// apps/web/src/components/kopilot/ui/blocks/task-list-block.tsx

'use client'

import type { TaskWithRelations } from '@auxx/lib/tasks'
import { CheckSquare } from 'lucide-react'
import { motion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import { useTasksByIds } from '~/components/tasks/hooks/use-tasks-by-ids'
import { TaskDialog } from '~/components/tasks/ui/task-dialog'
import { TaskItem } from '~/components/tasks/ui/task-item'
import { BlockCard } from './block-card'
import type { BlockRendererProps } from './block-registry'
import type { TaskListData } from './block-schemas'
import { TaskItemSkeleton } from './task-item-skeleton'

export function TaskListBlock({ data, skipEntrance }: BlockRendererProps<TaskListData>) {
  const router = useRouter()
  const { taskIds, snapshot } = data
  const { tasksByKey, notFoundIds } = useTasksByIds({ taskIds, enabled: taskIds.length > 0 })
  const notFoundSet = useMemo(() => new Set(notFoundIds), [notFoundIds])

  const [selectedTask, setSelectedTask] = useState<TaskWithRelations | null>(null)

  const handleTaskClick = useCallback((task: TaskWithRelations) => {
    setSelectedTask(task)
  }, [])

  return (
    <div className='not-prose my-2'>
      <BlockCard
        data-slot='task-list-block'
        indicator={<CheckSquare className='size-3 text-muted-foreground' />}
        primaryText='Tasks'
        secondaryText={<span className='text-xs text-muted-foreground'>{taskIds.length}</span>}
        actions={[
          {
            label: 'Open Tasks',
            onClick: () => router.push('/app/tasks'),
            primary: true,
          },
        ]}>
        <div className='space-y-1'>
          {taskIds.map((taskId, i) => {
            const live = tasksByKey.get(taskId)
            const snap = snapshot?.[taskId]
            const isDeleted = notFoundSet.has(taskId)

            return (
              <motion.div
                key={taskId}
                initial={skipEntrance ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  type: 'spring',
                  stiffness: 400,
                  damping: 22,
                  delay: skipEntrance ? 0 : Math.min(i * 0.04, 0.3),
                }}>
                {live ? (
                  <TaskItem task={live} onClick={() => handleTaskClick(live)} />
                ) : snap ? (
                  <TaskItemSkeleton snapshot={snap} isDeleted={isDeleted} />
                ) : isDeleted ? (
                  <div className='px-2 py-2 text-xs text-muted-foreground'>
                    Task unavailable — <span className='font-mono'>{taskId}</span>
                  </div>
                ) : (
                  <div className='px-2 py-2 text-xs text-muted-foreground'>Loading…</div>
                )}
              </motion.div>
            )
          })}
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
