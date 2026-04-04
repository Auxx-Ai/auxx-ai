// packages/lib/src/prompt-templates/template-registry.ts

import draftReply from './templates/draft-reply.json'
import escalationAssessment from './templates/escalation-assessment.json'
import extractActionItems from './templates/extract-action-items.json'
import orderStatusLookup from './templates/order-status-lookup.json'
import refundPolicyResponse from './templates/refund-policy-response.json'
import sentimentAnalysis from './templates/sentiment-analysis.json'
import shippingInquiry from './templates/shipping-inquiry.json'
import summarizeThread from './templates/summarize-thread.json'
import summarizeTicket from './templates/summarize-ticket.json'
import translateMessage from './templates/translate-message.json'
import type { PromptTemplateDefinition } from './types'

const allTemplates: PromptTemplateDefinition[] = [
  // Customer Support
  summarizeTicket,
  draftReply,
  escalationAssessment,
  sentimentAnalysis,
  // Shopify
  orderStatusLookup,
  refundPolicyResponse,
  shippingInquiry,
  // General
  summarizeThread,
  translateMessage,
  extractActionItems,
]

const templateMap = new Map<string, PromptTemplateDefinition>(allTemplates.map((t) => [t.id, t]))

/** List all built-in prompt templates, optionally filtered by category */
export function listPromptTemplates(category?: string): PromptTemplateDefinition[] {
  if (!category || category === 'all') return allTemplates
  return allTemplates.filter((t) => t.categories.includes(category))
}

/** Get a single built-in prompt template by ID */
export function getPromptTemplateById(id: string): PromptTemplateDefinition | undefined {
  return templateMap.get(id)
}
