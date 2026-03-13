// apps/homepage/src/app/_components/sections/workflow-animation/workflow-node.tsx

'use client'

import { Brain, GitBranch, Mail, MessageCircle, Send, Tags } from 'lucide-react'
import { motion } from 'motion/react'
import type { NodeCategory, WorkflowNode as WorkflowNodeType } from './workflow-data'
import { categoryColors, NODE_HEIGHT, NODE_WIDTH } from './workflow-data'

const iconMap: Record<string, React.FC<{ className?: string; style?: React.CSSProperties }>> = {
  mail: Mail,
  tags: Tags,
  'git-branch': GitBranch,
  brain: Brain,
  send: Send,
  'message-circle': MessageCircle,
}

const iconBgMap: Record<NodeCategory, string> = {
  TRIGGER: 'bg-emerald-100 dark:bg-emerald-900/50',
  CONDITION: 'bg-amber-100 dark:bg-amber-900/50',
  TRANSFORM: 'bg-violet-100 dark:bg-violet-900/50',
  ACTION: 'bg-emerald-100 dark:bg-emerald-900/50',
}

interface WorkflowNodeProps {
  node: WorkflowNodeType
  inView: boolean
  isActive?: boolean
}

export function WorkflowNode({ node, inView, isActive }: WorkflowNodeProps) {
  const Icon = iconMap[node.icon]
  const color = categoryColors[node.category]

  return (
    <motion.div
      className='absolute'
      style={{
        left: node.x,
        top: node.y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      }}
      initial={{ opacity: 0, scale: 0.9, y: 10 }}
      animate={inView ? { opacity: 1, scale: 1, y: 0 } : undefined}
      transition={{
        type: 'spring',
        bounce: 0.3,
        delay: node.delay,
        duration: 0.6,
      }}>
      {/* Handle left (target) */}
      <motion.div
        className='absolute top-1/2 -left-1 -translate-y-1/2 rounded-sm'
        style={{ width: 3, height: 10, backgroundColor: '#94a3b8' }}
        animate={isActive ? { backgroundColor: '#10b981' } : { backgroundColor: '#94a3b8' }}
        transition={{ delay: isActive ? 0.1 : 0, duration: 0.3 }}
      />

      {/* Handle right (source) */}
      <motion.div
        className='absolute top-1/2 -right-1 -translate-y-1/2 rounded-sm'
        style={{ width: 3, height: 10, backgroundColor: '#94a3b8' }}
        animate={isActive ? { backgroundColor: '#10b981' } : { backgroundColor: '#94a3b8' }}
        transition={{ delay: isActive ? 0.1 : 0, duration: 0.3 }}
      />

      {/* Node card */}
      <motion.div
        className='flex h-full items-center gap-3 rounded-2xl border-2 bg-background/80 px-3 shadow-xs backdrop-blur-sm'
        style={{ borderColor: color.border }}
        animate={
          isActive
            ? {
                boxShadow: `0 0 16px 2px ${color.border}40`,
              }
            : {
                boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
              }
        }
        transition={{ duration: 0.4, delay: isActive ? 0.1 : 0 }}>
        {/* Icon */}
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${iconBgMap[node.category]}`}>
          {Icon && <Icon className='h-4 w-4' style={{ color: color.border }} />}
        </div>

        {/* Text */}
        <div className='min-w-0'>
          <p className='truncate text-sm font-semibold'>{node.label}</p>
          <p className='truncate text-xs text-muted-foreground'>{node.subtitle}</p>
        </div>
      </motion.div>
    </motion.div>
  )
}
