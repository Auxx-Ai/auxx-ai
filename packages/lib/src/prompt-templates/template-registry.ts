// packages/lib/src/prompt-templates/template-registry.ts

import { compileMdTemplate } from './compile-md-template'
import accountResearchMd from './templates/account-research.md'
import dealBriefMd from './templates/deal-brief.md'
import draftReplyMd from './templates/draft-reply.md'
import escalationAssessmentMd from './templates/escalation-assessment.md'
import extractActionItemsMd from './templates/extract-action-items.md'
import orderStatusLookupMd from './templates/order-status-lookup.md'
import refundPolicyResponseMd from './templates/refund-policy-response.md'
import salesCoachMd from './templates/sales-coach.md'
import sentimentAnalysisMd from './templates/sentiment-analysis.md'
import shippingInquiryMd from './templates/shipping-inquiry.md'
import summarizeThreadMd from './templates/summarize-thread.md'
import summarizeTicketMd from './templates/summarize-ticket.md'
import translateMessageMd from './templates/translate-message.md'
import type { PromptTemplateDefinition } from './types'

const allTemplates: PromptTemplateDefinition[] = [
  // Customer Support
  compileMdTemplate(summarizeTicketMd),
  compileMdTemplate(draftReplyMd),
  compileMdTemplate(escalationAssessmentMd),
  compileMdTemplate(sentimentAnalysisMd),
  // Shopify
  compileMdTemplate(orderStatusLookupMd),
  compileMdTemplate(refundPolicyResponseMd),
  compileMdTemplate(shippingInquiryMd),
  // Sales
  compileMdTemplate(salesCoachMd),
  compileMdTemplate(accountResearchMd),
  compileMdTemplate(dealBriefMd),
  // General
  compileMdTemplate(summarizeThreadMd),
  compileMdTemplate(translateMessageMd),
  compileMdTemplate(extractActionItemsMd),
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
