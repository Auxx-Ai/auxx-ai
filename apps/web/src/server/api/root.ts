import type { inferRouterOutputs } from '@trpc/server'
import { createCallerFactory, createTRPCRouter } from '~/server/api/trpc'
import { actorRouter } from './routers/actor'
import { adminRouter } from './routers/admin'
import { agentRouter } from './routers/agent'
import { agentProcedureRouter } from './routers/agent-procedure'
import { agentScopeRouter } from './routers/agent-scope'
import { agentToolsetRouter } from './routers/agent-toolset'
import { agentTriggerRouter } from './routers/agent-trigger'
import { aiFeatureRouter } from './routers/aiFeature'
import { aiIntegrationRouter } from './routers/aiIntegration'
import { apiKeyRouter } from './routers/apiKey'
import { approvalRouter } from './routers/approval'
import { approvalsRouter } from './routers/approvals'
import { appsRouter } from './routers/apps'
import { attachmentRouter } from './routers/attachment'
import { auditLogRouter } from './routers/audit-log'
import { authRouter } from './routers/auth'
import { availabilityRouter } from './routers/availability'
import { billingRouter } from './routers/billing'
import { calendarRouter } from './routers/calendar'
import { channelRouter } from './routers/channel'
import { channelReauthRouter } from './routers/channel-reauth'
import { chatRouter } from './routers/chat'
import { chatDutyRouter } from './routers/chat-duty'
import { commentRouter } from './routers/comment'
import { configVariableRouter } from './routers/config-variable'
import { connectionsRouter } from './routers/connections'
import { contactRouter } from './routers/contact'
import { customFieldRouter } from './routers/customField'
import { dashboardRouter } from './routers/dashboard'
import { dataConnectorRouter } from './routers/data-connectors'
import { dataExportRouter } from './routers/data-export'
import { dataImportRouter } from './routers/data-import'
import { datasetRouter } from './routers/dataset'
import { dispatchRouter } from './routers/dispatch'
import { documentRouter } from './routers/document'
import { draftRouter } from './routers/draft'
import { emailTemplateRouter } from './routers/emailTemplate'
import { entityDefinitionRouter } from './routers/entityDefinition'
import { entityGroupRouter } from './routers/entityGroup'
import { evalRouter } from './routers/eval'
import { extensionRouter } from './routers/extension'
import { favoriteRouter } from './routers/favorite'
import { featurePermissionsRouter } from './routers/featurePermissions'
import { fieldValueRouter } from './routers/fieldValue'
import { fileRouter } from './routers/file'
import { folderRouter } from './routers/folder'
import { gettingStartedRouter } from './routers/getting-started'
import { inboxRouter } from './routers/inbox'
import { inventoryBridgeRouter } from './routers/inventory-bridge'
import { knowledgeBaseRouter } from './routers/kb'
import { knowledgeSourceRouter } from './routers/knowledge-sources'
import { kopilotRouter } from './routers/kopilot'
import { labelRouter } from './routers/label'
import { mailFiltersRouter } from './routers/mail-filters'
import { mailDomainsRouter } from './routers/mailDomain'
import { mailViewRouter } from './routers/mailView'
import { mcpRouter } from './routers/mcp'
import { mediaAssetRouter } from './routers/mediaAsset'
import { memberRouter } from './routers/member'
import { messageRouter } from './routers/message'
import { moneyRouter } from './routers/money'
import { notificationRouter } from './routers/notification'
import { organizationRouter } from './routers/organization'
import { participantRouter } from './routers/participant'
import { permissionsRouter } from './routers/permissions'
import { procedureRouter } from './routers/procedure'
import { promptTemplateRouter } from './routers/promptTemplate'
import { quickActionRouter } from './routers/quick-actions'
import { realtimeRouter } from './routers/realtime'
import { recordRouter } from './routers/record'
import { recordRulesRouter } from './routers/record-rules'
import { recordingRouter } from './routers/recording'
import { resourceRouter } from './routers/resource'
import { resourceAccessRouter } from './routers/resourceAccess'
import { searchRouter } from './routers/search'
import { segmentRouter } from './routers/segment'
import { sequenceRouter } from './routers/sequence'
import { settingsRouter } from './routers/setting'
import { shopifyRouter } from './routers/shopify'
import { signalRouter } from './routers/signal'
import { signatureRouter } from './routers/signature'
import { snippetsRouter } from './routers/snippet'
import { suppressionRouter } from './routers/suppression'
import { syncHistoryRouter } from './routers/sync-history'
import { tableViewRouter } from './routers/tableView'
import { tagRouter } from './routers/tag'
import { taskRouter } from './routers/task'
import { threadRouter } from './routers/thread'
import { ticketSequenceRouter } from './routers/ticketSequence'
import { timelineRouter } from './routers/timeline'
import { usageRouter } from './routers/usage'
import { userRouter } from './routers/user'
import { webhookRouters } from './routers/webhook'
import { webhookEndpointRouter } from './routers/webhook-endpoint'
import { workflowRouter } from './routers/workflow'

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  actor: actorRouter,
  admin: adminRouter,
  agent: agentRouter,
  agentProcedure: agentProcedureRouter,
  agentScope: agentScopeRouter,
  agentToolset: agentToolsetRouter,
  agentTrigger: agentTriggerRouter,
  aiFeature: aiFeatureRouter,
  aiIntegration: aiIntegrationRouter,
  apiKey: apiKeyRouter,
  apps: appsRouter,
  approval: approvalRouter,
  approvals: approvalsRouter,
  attachment: attachmentRouter,
  auditLog: auditLogRouter,
  auth: authRouter,
  availability: availabilityRouter,
  billing: billingRouter,
  calendar: calendarRouter,
  chat: chatRouter,
  chatDuty: chatDutyRouter,
  comment: commentRouter,
  configVariable: configVariableRouter,
  connections: connectionsRouter,
  contact: contactRouter,
  customField: customFieldRouter,
  dataset: datasetRouter,
  document: documentRouter,
  draft: draftRouter,
  segment: segmentRouter,
  fieldValue: fieldValueRouter,
  file: fileRouter,
  folder: folderRouter,
  mediaAsset: mediaAssetRouter,
  emailTemplate: emailTemplateRouter,
  eval: evalRouter,
  entityDefinition: entityDefinitionRouter,
  entityGroup: entityGroupRouter,
  extension: extensionRouter,
  favorite: favoriteRouter,
  featurePermission: featurePermissionsRouter,
  gettingStarted: gettingStartedRouter,
  inbox: inboxRouter,
  channel: channelRouter,
  channelReauth: channelReauthRouter,
  kb: knowledgeBaseRouter,
  knowledgeSource: knowledgeSourceRouter,
  kopilot: kopilotRouter,
  label: labelRouter,
  mailDomain: mailDomainsRouter,
  mailFilters: mailFiltersRouter,
  mailView: mailViewRouter,
  mcp: mcpRouter,
  member: memberRouter,
  message: messageRouter,
  money: moneyRouter,
  notification: notificationRouter,
  organization: organizationRouter,
  participant: participantRouter,
  permissions: permissionsRouter,
  procedure: procedureRouter,
  promptTemplate: promptTemplateRouter,
  quickAction: quickActionRouter,
  realtime: realtimeRouter,
  record: recordRouter,
  recordRules: recordRulesRouter,
  recording: recordingRouter,
  resource: resourceRouter,
  resourceAccess: resourceAccessRouter,
  search: searchRouter,
  sequence: sequenceRouter,
  setting: settingsRouter,
  shopify: shopifyRouter,
  signal: signalRouter,
  signature: signatureRouter,
  snippet: snippetsRouter,
  suppression: suppressionRouter,
  syncHistory: syncHistoryRouter,
  tableView: tableViewRouter,
  tag: tagRouter,
  task: taskRouter,
  thread: threadRouter,
  ticketSequence: ticketSequenceRouter,
  timeline: timelineRouter,
  usage: usageRouter,
  user: userRouter,
  workflow: workflowRouter,
  webhook: webhookRouters,
  webhookEndpoint: webhookEndpointRouter,
  dataImport: dataImportRouter,
  dataExport: dataExportRouter,
  dataConnector: dataConnectorRouter,
  dashboard: dashboardRouter,
  dispatch: dispatchRouter,
  inventoryBridge: inventoryBridgeRouter,
})
// inferReactQueryProcedureOptions
// export type definition of API
export type AppRouter = typeof appRouter

export type RouterOutputs = inferRouterOutputs<AppRouter>

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.post.all();
 *       ^? Post[]
 */
export const createCaller = createCallerFactory(appRouter)
