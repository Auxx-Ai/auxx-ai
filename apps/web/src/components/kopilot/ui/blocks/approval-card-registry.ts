// apps/web/src/components/kopilot/ui/blocks/approval-card-registry.ts

import type React from 'react'

/**
 * Display-only projection of a recipient resolved by the mail recipient
 * resolver. Surfaced through `ApprovalCardProps.resolvedRecipients` so the
 * pending approval card can render real emails/phones rather than the raw
 * recordIds / participantIds the LLM passed.
 */
export interface ApprovalRecipient {
  identifier: string
  identifierType?: string
  displayName?: string
  role?: 'to' | 'cc' | 'bcc'
}

export interface ApprovalCardProps {
  toolName: string
  toolCallId: string
  args: Record<string, unknown>
  status: 'pending' | 'approved' | 'rejected'
  /**
   * Display digest produced by the tool's `buildDigest`. Available after the
   * tool executes (post-approval) so the card can render completed-state info
   * — sent timestamp, draft id, etc. Undefined while pending.
   */
  digest?: unknown
  onApprove: (inputAmendment?: Record<string, unknown>) => void
  onReject: () => void
  /**
   * Optional list of recipients resolved by the tool prior to approval. Mail
   * tools populate this; other approval cards leave it undefined.
   */
  resolvedRecipients?: ApprovalRecipient[]
}

type ApprovalCardComponent = React.ComponentType<ApprovalCardProps>

const APPROVAL_CARDS: Record<string, ApprovalCardComponent> = {}

export function registerApprovalCard(toolName: string, component: ApprovalCardComponent) {
  APPROVAL_CARDS[toolName] = component
}

export function getApprovalCard(toolName: string): ApprovalCardComponent | null {
  return APPROVAL_CARDS[toolName] ?? null
}
