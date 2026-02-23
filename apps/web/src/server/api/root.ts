import type { inferRouterOutputs } from '@trpc/server'
import { createCallerFactory, createTRPCRouter } from '~/server/api/trpc'
import { actorRouter } from './routers/actor'
import { adminRouter } from './routers/admin'
import { aiFeatureRouter } from './routers/aiFeature'
import { aiIntegrationRouter } from './routers/aiIntegration'
import { apiKeyRouter } from './routers/apiKey'
import { approvalRouter } from './routers/approval'
import { appsRouter } from './routers/apps'
import { articleRouter } from './routers/article'
import { attachmentRouter } from './routers/attachment'
import { authRouter } from './routers/auth'
import { billingRouter } from './routers/billing'
import { bomRouter } from './routers/bom'
import { chatRouter } from './routers/chat'
import { commentRouter } from './routers/comment'
import { configVariableRouter } from './routers/config-variable'
import { contactRouter } from './routers/contact'
import { credentialsRouter } from './routers/credentials'
import { customerRouter } from './routers/customer'
import { customFieldRouter } from './routers/customField'
import { dataImportRouter } from './routers/data-import'
import { datasetRouter } from './routers/dataset'
import { documentRouter } from './routers/document'
import { draftRouter } from './routers/draft'
import { emailTemplateRouter } from './routers/emailTemplate'
import { embeddingRouter } from './routers/embedding'
import { entityDefinitionRouter } from './routers/entityDefinition'
import { entityGroupRouter } from './routers/entityGroup'
import { featurePermissionsRouter } from './routers/featurePermissions'
import { fieldValueRouter } from './routers/fieldValue'
import { fileRouter } from './routers/file'
import { folderRouter } from './routers/folder'
import { inboxRouter } from './routers/inbox'
import { integrationRouter } from './routers/integration'
import { integrationReauthRouter } from './routers/integration-reauth'
import { inventoryRouter } from './routers/inventory'
import { knowledgeBaseRouter } from './routers/kb'
import { labelRouter } from './routers/label'
import { mailDomainsRouter } from './routers/mailDomain'
import { mailViewRouter } from './routers/mailView'
import { mediaAssetRouter } from './routers/mediaAsset'
import { memberRouter } from './routers/member'
import { messageRouter } from './routers/message'
import { notificationRouter } from './routers/notification'
import { orderRouter } from './routers/order'
import { organizationRouter } from './routers/organization'
import { partRouter } from './routers/part'
import { participantRouter } from './routers/participant'
import { productRouter } from './routers/product'
import { recordRouter } from './routers/record'
import { resourceRouter } from './routers/resource'
import { resourceAccessRouter } from './routers/resourceAccess'
import { searchRouter } from './routers/search'
import { segmentRouter } from './routers/segment'
import { settingsRouter } from './routers/setting'
import { shopifyRouter } from './routers/shopify'
import { signatureRouter } from './routers/signature'
import { snippetsRouter } from './routers/snippet'
import { subpartRouter } from './routers/subpart'
import { syncHistoryRouter } from './routers/sync-history'
import { tableViewRouter } from './routers/tableView'
import { tagRouter } from './routers/tag'
import { taskRouter } from './routers/task'
import { threadRouter } from './routers/thread'
import { ticketRouter } from './routers/ticket'
import { ticketAgentRouter } from './routers/ticketAgent'
import { ticketSequenceRouter } from './routers/ticketSequence'
import { timelineRouter } from './routers/timeline'
import { userRouter } from './routers/user'
import { vendorPartRouter } from './routers/vendorPart'
import { webhookRouters } from './routers/webhook'
import { widgetRouter } from './routers/widget'
import { workflowRouter } from './routers/workflow'

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  actor: actorRouter,
  admin: adminRouter,
  aiFeature: aiFeatureRouter,
  aiIntegration: aiIntegrationRouter,
  apiKey: apiKeyRouter,
  apps: appsRouter,
  approval: approvalRouter,
  article: articleRouter,
  attachment: attachmentRouter,
  auth: authRouter,
  billing: billingRouter,
  bom: bomRouter,
  chat: chatRouter,
  comment: commentRouter,
  configVariable: configVariableRouter,
  contact: contactRouter,
  credentials: credentialsRouter,
  customField: customFieldRouter,
  dataset: datasetRouter,
  document: documentRouter,
  draft: draftRouter,
  segment: segmentRouter,
  fieldValue: fieldValueRouter,
  file: fileRouter,
  folder: folderRouter,
  mediaAsset: mediaAssetRouter,
  customer: customerRouter,
  emailTemplate: emailTemplateRouter,
  embedding: embeddingRouter,
  entityDefinition: entityDefinitionRouter,
  entityGroup: entityGroupRouter,
  featurePermission: featurePermissionsRouter,
  inbox: inboxRouter,
  integration: integrationRouter,
  integrationReauth: integrationReauthRouter,
  inventory: inventoryRouter,
  kb: knowledgeBaseRouter,
  label: labelRouter,
  mailDomain: mailDomainsRouter,
  mailView: mailViewRouter,
  member: memberRouter,
  message: messageRouter,
  notification: notificationRouter,
  order: orderRouter,
  organization: organizationRouter,
  part: partRouter,
  participant: participantRouter,
  product: productRouter,
  record: recordRouter,
  resource: resourceRouter,
  resourceAccess: resourceAccessRouter,
  search: searchRouter,
  setting: settingsRouter,
  shopify: shopifyRouter,
  signature: signatureRouter,
  snippet: snippetsRouter,
  subpart: subpartRouter,
  syncHistory: syncHistoryRouter,
  tableView: tableViewRouter,
  tag: tagRouter,
  task: taskRouter,
  thread: threadRouter,
  ticket: ticketRouter,
  ticketAgent: ticketAgentRouter,
  ticketSequence: ticketSequenceRouter,
  timeline: timelineRouter,
  user: userRouter,
  vendorPart: vendorPartRouter,
  widget: widgetRouter,
  workflow: workflowRouter,
  webhook: webhookRouters,
  dataImport: dataImportRouter,
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
