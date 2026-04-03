// apps/web/src/components/kopilot/ui/blocks/approval-card-registry.ts

import type React from 'react'

export interface ApprovalCardProps {
  toolName: string
  toolCallId: string
  args: Record<string, unknown>
  status: 'pending' | 'approved' | 'rejected'
  onApprove: (inputAmendment?: Record<string, unknown>) => void
  onReject: () => void
}

type ApprovalCardComponent = React.ComponentType<ApprovalCardProps>

const APPROVAL_CARDS: Record<string, ApprovalCardComponent> = {}

export function registerApprovalCard(toolName: string, component: ApprovalCardComponent) {
  APPROVAL_CARDS[toolName] = component
}

export function getApprovalCard(toolName: string): ApprovalCardComponent | null {
  return APPROVAL_CARDS[toolName] ?? null
}
