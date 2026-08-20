// packages/lib/src/workflows/templates/index.ts
// File-defined workflow templates. These are bundled in the repo (the source of
// truth) and merged at read time with admin-created templates from the DB — they
// are never written to the database. See plans/templates/file-and-admin-templates-plan.md.

import type { WorkflowTemplateDetail, WorkflowTemplateListItem } from '../../workflow-templates'
import { normalizeTemplateGraph } from '../normalize-template-graph'
import fulfillmentFollowUp from './fulfillment-follow-up.template.json'
import informationExtractionAutoReply from './information-extraction-auto-reply.template.json'
import kbAutoResponder from './kb-auto-responder.template.json'
import manualTicketTriage from './manual-ticket-triage.template.json'
import multiLanguageRouter from './multi-language-router.template.json'
import orderIssueTriage from './order-issue-triage.template.json'
import returnRequestProcessor from './return-request-processor.template.json'
import scheduledReportWebhook from './scheduled-report-webhook.template.json'
import shopifyOrderLookup from './shopify-order-lookup.template.json'
import slaBreachEscalation from './sla-breach-escalation.template.json'
import ticketIntentClassifierRouter from './ticket-intent-classifier-router.template.json'
import webhookOrderNotification from './webhook-order-notification.template.json'

/** Synthetic id prefix that distinguishes file templates from DB (cuid) rows. */
export const FILE_TEMPLATE_ID_PREFIX = 'file:'

/** Stable, deterministic timestamp for file templates (they have no DB row). */
const FILE_TEMPLATE_STAMP = new Date('2026-06-15T00:00:00.000Z')

/** Shape of a bundled `*.template.json` file. */
interface FileTemplateJson {
  slug: string
  name: string
  description: string
  categories?: string[]
  status?: string
  popularity?: number
  triggerType?: string | null
  triggerConfig?: Record<string, unknown> | null
  icon?: { iconId: string; color: string }
  imgUrl?: string
  requiredApps?: WorkflowTemplateDetail['requiredApps']
  requiredEntities?: unknown[]
  envVars?: WorkflowTemplateDetail['envVars']
  variables?: unknown[]
  graph: unknown
}

/** A file template carries the same shape as a DB template detail, plus `source`. */
export type FileWorkflowTemplate = WorkflowTemplateDetail & { source: 'file' }
export type FileWorkflowTemplateListItem = WorkflowTemplateListItem & { source: 'file' }

/** Raw bundled templates. Add new templates by dropping a `*.template.json` here. */
const RAW_FILE_TEMPLATES: FileTemplateJson[] = [
  shopifyOrderLookup,
  ticketIntentClassifierRouter,
  informationExtractionAutoReply,
  webhookOrderNotification,
  scheduledReportWebhook,
  manualTicketTriage,
  kbAutoResponder,
  returnRequestProcessor,
  slaBreachEscalation,
  fulfillmentFollowUp,
  multiLanguageRouter,
  orderIssueTriage,
].map((t) => t as unknown as FileTemplateJson)

/** Build a full template detail from a bundled JSON file (AI prompts normalized). */
function toDetail(t: FileTemplateJson): FileWorkflowTemplate {
  return {
    id: `${FILE_TEMPLATE_ID_PREFIX}${t.slug}`,
    name: t.name,
    description: t.description,
    categories: t.categories ?? [],
    imgUrl: t.imgUrl ?? null,
    icon: t.icon ?? null,
    graph: normalizeTemplateGraph(t.graph as never),
    version: 1,
    status: t.status ?? 'public',
    triggerType: t.triggerType ?? null,
    triggerConfig: t.triggerConfig ?? null,
    envVars: t.envVars ?? [],
    variables: (t.variables ?? []) as WorkflowTemplateDetail['variables'],
    requiredApps: t.requiredApps ?? [],
    requiredEntities: t.requiredEntities ?? [],
    popularity: t.popularity ?? 0,
    createdAt: FILE_TEMPLATE_STAMP,
    updatedAt: FILE_TEMPLATE_STAMP,
    source: 'file',
  }
}

/** All file templates, fully built and normalized once at module load. */
export const FILE_TEMPLATES: FileWorkflowTemplate[] = RAW_FILE_TEMPLATES.map(toDetail)

/** True when an id refers to a file template rather than a DB row. */
export function isFileTemplateId(id: string): boolean {
  return id.startsWith(FILE_TEMPLATE_ID_PREFIX)
}

/** Resolve a file template (with full graph) by id, or undefined. */
export function getFileTemplateById(id: string): FileWorkflowTemplate | undefined {
  return FILE_TEMPLATES.find((t) => t.id === id)
}

/** Project a file template to a list item (no graph). */
function toListItem(t: FileWorkflowTemplate): FileWorkflowTemplateListItem {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    categories: t.categories,
    imgUrl: t.imgUrl,
    icon: t.icon,
    version: t.version,
    status: t.status,
    triggerType: t.triggerType,
    requiredApps: t.requiredApps,
    popularity: t.popularity,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    source: 'file',
  }
}

/** Options mirroring the DB `getAllTemplates` query for consistent filtering. */
export interface ListFileTemplatesOptions {
  search?: string
  categories?: string[]
  status?: 'public' | 'private' | 'all'
}

/** List file templates (no graph) filtered the same way the DB query filters. */
export function listFileTemplates(
  opts: ListFileTemplatesOptions = {}
): FileWorkflowTemplateListItem[] {
  const { status = 'public', categories } = opts
  const search = opts.search?.toLowerCase().trim()

  return FILE_TEMPLATES.filter((t) => {
    if (status !== 'all' && t.status !== status) return false
    if (search && !`${t.name} ${t.description}`.toLowerCase().includes(search)) return false
    if (categories?.length && !categories.some((c) => t.categories.includes(c))) return false
    return true
  }).map(toListItem)
}
