// packages/lib/src/entity-templates/template-registry.ts

import campaignTemplate from './templates/campaign.json'
import collectionTemplate from './templates/collection.json'
import complaintTemplate from './templates/complaint.json'
import customerFeedbackTemplate from './templates/customer-feedback.json'
import dealTemplate from './templates/deal.json'
import discountRuleTemplate from './templates/discount-rule.json'
import emailSequenceTemplate from './templates/email-sequence.json'
import exchangeRequestTemplate from './templates/exchange-request.json'
import expenseTemplate from './templates/expense.json'
import faqArticleTemplate from './templates/faq-article.json'
import featureRequestTemplate from './templates/feature-request.json'
import giftCardTemplate from './templates/gift-card.json'
import inventoryLocationTemplate from './templates/inventory-location.json'
import invoiceTemplate from './templates/invoice.json'
import leadTemplate from './templates/lead.json'
import loyaltyMemberTemplate from './templates/loyalty-member.json'
import meetingTemplate from './templates/meeting.json'
import orderTemplate from './templates/order.json'
import productTemplate from './templates/product.json'
import projectTemplate from './templates/project.json'
import qualityInspectionTemplate from './templates/quality-inspection.json'
import quoteTemplate from './templates/quote.json'
import referralTemplate from './templates/referral.json'
import returnRequestTemplate from './templates/return-request.json'
import shipmentTemplate from './templates/shipment.json'
import socialProofTemplate from './templates/social-proof.json'
import subscriptionTemplate from './templates/subscription.json'
import supplierContractTemplate from './templates/supplier-contract.json'
import taskTemplate from './templates/task.json'
import vendorTemplate from './templates/vendor.json'
import warrantyClaimTemplate from './templates/warranty-claim.json'
import wholesaleOrderTemplate from './templates/wholesale-order.json'
import type { EntityTemplate } from './types'
import { isSymbolicRef, parseSymbolicRef } from './types'

/** All available templates indexed by ID */
const templateMap = new Map<string, EntityTemplate>()

const allTemplates: EntityTemplate[] = [
  // Existing
  orderTemplate,
  productTemplate,
  vendorTemplate,
  returnRequestTemplate,
  subscriptionTemplate,
  campaignTemplate,
  warrantyClaimTemplate,
  // E-commerce
  shipmentTemplate,
  giftCardTemplate,
  discountRuleTemplate,
  collectionTemplate,
  inventoryLocationTemplate,
  wholesaleOrderTemplate,
  // CRM
  leadTemplate,
  dealTemplate,
  quoteTemplate,
  referralTemplate,
  loyaltyMemberTemplate,
  // Support
  faqArticleTemplate,
  featureRequestTemplate,
  customerFeedbackTemplate,
  complaintTemplate,
  exchangeRequestTemplate,
  // Operations
  taskTemplate,
  projectTemplate,
  invoiceTemplate,
  expenseTemplate,
  supplierContractTemplate,
  meetingTemplate,
  // Marketing / Other
  emailSequenceTemplate,
  socialProofTemplate,
  qualityInspectionTemplate,
] as EntityTemplate[]

// Index templates and validate at import time
for (const template of allTemplates) {
  if (templateMap.has(template.id)) {
    throw new Error(`Duplicate template ID: ${template.id}`)
  }

  // Validate primary display field exists
  const hasPrimary = template.fields.some((f) => f.templateFieldId === template.primaryDisplayField)
  if (!hasPrimary) {
    throw new Error(
      `Template "${template.id}": primaryDisplayField "${template.primaryDisplayField}" not found in fields`
    )
  }

  // Validate secondary display field if specified
  if (template.secondaryDisplayField) {
    const hasSecondary = template.fields.some(
      (f) => f.templateFieldId === template.secondaryDisplayField
    )
    if (!hasSecondary) {
      throw new Error(
        `Template "${template.id}": secondaryDisplayField "${template.secondaryDisplayField}" not found in fields`
      )
    }
  }

  // Validate avatar field if specified
  if (template.avatarField) {
    const hasAvatar = template.fields.some((f) => f.templateFieldId === template.avatarField)
    if (!hasAvatar) {
      throw new Error(
        `Template "${template.id}": avatarField "${template.avatarField}" not found in fields`
      )
    }
  }

  // Validate symbolic refs point to known templates or system entities
  for (const field of template.fields) {
    if (
      field.relationship?.relatedResourceId &&
      isSymbolicRef(field.relationship.relatedResourceId)
    ) {
      const ref = parseSymbolicRef(field.relationship.relatedResourceId)
      if (ref.type === 'template') {
        // Cross-template ref — will be validated at install time
        // (companion template may or may not be selected)
      }
      // System refs are validated at install time against the org's entity definitions
    }
  }

  templateMap.set(template.id, template)
}

/** Template metadata for list views (without full field details) */
export interface TemplateSummary {
  id: string
  name: string
  description: string
  categories: string[]
  entity: EntityTemplate['entity']
  fieldCount: number
  companions?: string[]
}

/** Get all templates as lightweight summaries for the list view */
export function getAllTemplates(category?: string): TemplateSummary[] {
  let templates = allTemplates

  if (category && category !== 'all') {
    templates = templates.filter((t) => t.categories.includes(category))
  }

  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    categories: t.categories,
    entity: t.entity,
    fieldCount: t.fields.length,
    companions: t.companions,
  }))
}

/** Get a full template by ID (with all field definitions) */
export function getTemplateById(id: string): EntityTemplate | null {
  return templateMap.get(id) ?? null
}

/** Get multiple templates by IDs */
export function getTemplatesByIds(ids: string[]): EntityTemplate[] {
  return ids.map((id) => templateMap.get(id)).filter(Boolean) as EntityTemplate[]
}
