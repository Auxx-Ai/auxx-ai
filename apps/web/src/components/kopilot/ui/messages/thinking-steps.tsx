// apps/web/src/components/kopilot/ui/messages/thinking-steps.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { ChevronRight, Loader2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type React from 'react'
import { useState } from 'react'
import type { KopilotMessage, ToolCallPart } from '../../stores/kopilot-store'
import { type ApprovalCardProps, getApprovalCard } from '../blocks/approval-card-registry'
import { GenericApprovalCard } from '../blocks/generic-approval-card'
import { summarizeToolResult } from '../blocks/summarize-tool-result'
import { ToolStatusPill } from './tool-status-pill'

type ApprovalCardComponent = React.ComponentType<ApprovalCardProps>

/**
 * Callback invoked when the user approves or rejects an inline approval
 * card. `messageId` is the persisted approval system message's id (the
 * server's source of truth for the approval record); the engine uses the
 * accompanying action to flip the linked tool_call part.
 */
export type InlineApprovalHandler = (
  messageId: string,
  action: 'approved' | 'rejected',
  inputAmendment?: Record<string, unknown>
) => void

type InlineApprovalLookup = (toolCallId: string) => KopilotMessage | undefined

/**
 * A step row inside the thinking pill — one `tool_call` part plus the optional
 * preceding thinking text. The renderer in `assistant-message.tsx` builds
 * this array via `partitionParts(parts)` and threads any `thinking` parts
 * that appear immediately before a `tool_call` into the step's `thinking`
 * field.
 */
export interface ThinkingPillStep {
  /** Stable id for animations — use `toolCall.toolCallId`. */
  id: string
  toolCall: ToolCallPart
  /** Italic reasoning text that preceded this tool call. */
  thinking?: string
}

interface ThinkingStepsProps {
  steps: ThinkingPillStep[]
  /** Drives the spinning header + auto-expand. */
  isRunning: boolean
  /** Trailing thinking text not yet attached to a tool call (mid-stream). */
  pendingThinking?: string
  /** Lookup the persisted approval system message for a tool_call. */
  approvalForToolCall?: InlineApprovalLookup
  /** Approve/reject callback for inline approval cards. */
  onApproval?: InlineApprovalHandler
}

export function ThinkingSteps({
  steps,
  isRunning,
  pendingThinking,
  approvalForToolCall,
  onApproval,
}: ThinkingStepsProps) {
  const [isOpen, setIsOpen] = useState(isRunning)

  const totalCount = steps.length
  const completedCount = steps.filter(
    (s) => s.toolCall.status === 'completed' || s.toolCall.status === 'error'
  ).length

  if (totalCount === 0 && !pendingThinking?.trim()) return null

  const headerLabel = isRunning
    ? `Working… (${completedCount}/${totalCount})`
    : totalCount === 1
      ? '1 step completed'
      : `${totalCount} steps completed`

  const expanded = isRunning || isOpen

  // Approval cards render outside the collapsible region so they remain
  // visible after the pill collapses (the card morphs through pending →
  // approved/rejected and carries the final digest like "Sent" / "Cancelled").
  const inlineApprovals: Array<{
    step: ThinkingPillStep
    msg: KopilotMessage
    Card: ApprovalCardComponent
  }> = []
  if (approvalForToolCall) {
    for (const step of steps) {
      const msg = approvalForToolCall(step.toolCall.toolCallId)
      if (!msg?.approval) continue
      const Card = getApprovalCard(msg.approval.toolName) ?? GenericApprovalCard
      inlineApprovals.push({ step, msg, Card })
    }
  }

  return (
    <div className='mb-1'>
      <button
        type='button'
        onClick={() => setIsOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1 rounded-md px-1 py-0.5 text-xs',
          'text-muted-foreground hover:bg-muted/50'
        )}>
        {isRunning && <Loader2 className='size-3 animate-spin' />}
        <AnimatePresence mode='popLayout'>
          <motion.span
            key={headerLabel}
            initial={{ filter: 'blur(3px)', opacity: 0, y: 6 }}
            animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
            exit={{ filter: 'blur(3px)', opacity: 0, y: -6 }}
            transition={{ type: 'spring', stiffness: 200, damping: 25 }}>
            {headerLabel}
          </motion.span>
        </AnimatePresence>
        <motion.span
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
          <ChevronRight className='size-3' />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0, filter: 'blur(3px)' }}
            animate={{ height: 'auto', opacity: 1, filter: 'blur(0px)' }}
            exit={{ height: 0, opacity: 0, filter: 'blur(3px)' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            style={{ overflow: 'hidden' }}>
            <div className='flex flex-col gap-1 py-1.5 pl-2'>
              <AnimatePresence initial={false}>
                {steps.map((step) => {
                  const { toolCall } = step
                  // Map ToolCallStatus → ToolStatusPill's expected shape.
                  const pillStatus =
                    toolCall.status === 'completed'
                      ? 'completed'
                      : toolCall.status === 'error' || toolCall.status === 'rejected'
                        ? 'error'
                        : 'running'
                  const { summary, entities } = summarizeToolResult(
                    toolCall.name,
                    toolCall.output,
                    toolCall.digest
                  )
                  return (
                    <motion.div
                      key={step.id}
                      initial={{ filter: 'blur(3px)', opacity: 0, y: 6 }}
                      animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
                      transition={{ type: 'spring', stiffness: 200, damping: 25 }}>
                      <ToolStatusPill
                        step={{
                          id: step.id,
                          tool: {
                            name: toolCall.name,
                            args: toolCall.args,
                            status: pillStatus,
                            summary,
                            entities,
                          },
                        }}
                      />
                      {step.thinking?.trim() && (
                        <p className='py-1 pl-2 text-xs text-muted-foreground/70 italic leading-relaxed'>
                          {step.thinking.trim()}
                        </p>
                      )}
                    </motion.div>
                  )
                })}
              </AnimatePresence>

              {/* Pending thinking while running (no tool to attach it to yet) */}
              {isRunning && pendingThinking?.trim() && (
                <motion.p
                  initial={{ filter: 'blur(3px)', opacity: 0 }}
                  animate={{ filter: 'blur(0px)', opacity: 0.7 }}
                  transition={{ type: 'spring', stiffness: 200, damping: 25 }}
                  className='pl-2 text-xs text-muted-foreground/70 italic leading-relaxed'>
                  {pendingThinking.trim()}
                </motion.p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {inlineApprovals.length > 0 && (
        <div className='mt-1 flex flex-col gap-2'>
          {inlineApprovals.map(({ step, msg, Card }) => {
            if (!msg.approval) return null
            return (
              <motion.div
                key={`approval-${step.id}`}
                initial={{ opacity: 0, scale: 0.95, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}>
                <Card
                  toolName={msg.approval.toolName}
                  toolCallId={msg.approval.toolCallId}
                  args={msg.approval.args}
                  status={msg.approval.status}
                  digest={step.toolCall.digest}
                  onApprove={(inputAmendment) => onApproval?.(msg.id, 'approved', inputAmendment)}
                  onReject={() => onApproval?.(msg.id, 'rejected')}
                />
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}
