import { createCallerFactory, createTRPCRouter } from '~/server/api/trpc'
import { organizationRouter } from './routers/organization'
import { userRouter } from './routers/user'
import { searchRouter } from './routers/search'
import { customerRouter } from './routers/customer'
import { orderRouter } from './routers/order'
import { productRouter } from './routers/product'
import { webhookRouters } from './routers/webhook'
import { labelRouter } from './routers/label'
import { apiKeyRouter } from './routers/apiKey'

import type { inferRouterOutputs } from '@trpc/server'
import { shopifyRouter } from './routers/shopify'
import { syncHistoryRouter } from './routers/sync-history'
import { articleRouter } from './routers/article'
import { partRouter } from './routers/part'
import { subpartRouter } from './routers/subpart'
import { vendorPartRouter } from './routers/vendorPart'
import { inventoryRouter } from './routers/inventory'
import { bomRouter } from './routers/bom'
import { ticketRouter } from './routers/ticket'
import { ticketAgentRouter } from './routers/ticketAgent'
import { integrationRouter } from './routers/integration'
import { googleOAuthRouter } from './routers/googleOAuth'
import { ticketSequenceRouter } from './routers/ticketSequence'
import { mailDomainsRouter } from './routers/mailDomain'
import { emailTemplateRouter } from './routers/emailTemplate'
import { contactRouter } from './routers/contact'
import { settingsRouter } from './routers/setting'
import { customFieldRouter } from './routers/customField'
import { groupRouter } from './routers/group'
import { snippetsRouter } from './routers/snippet'
import { embeddingRouter } from './routers/embedding'
import { commentRouter } from './routers/comment'
import { notificationRouter } from './routers/notification'
import { tagRouter } from './routers/tag'
import { signatureRouter } from './routers/signature'
import { inboxRouter } from './routers/inbox'
import { mailViewRouter } from './routers/mailView'
import { threadRouter } from './routers/thread'
import { widgetRouter } from './routers/widget'
import { chatRouter } from './routers/chat'
import { billingRouter } from './routers/billing'
import { featurePermissionsRouter } from './routers/featurePermissions'
import { authRouter } from './routers/auth'
import { knowledgeBaseRouter } from './routers/kb'
import { tableViewRouter } from './routers/tableView'
import { integrationReauthRouter } from './routers/integration-reauth'
import { workflowRouter } from './routers/workflow'
import { aiIntegrationRouter } from './routers/aiIntegration'
import { aiFeatureRouter } from './routers/aiFeature'
import { approvalRouter } from './routers/approval'
import { credentialsRouter } from './routers/credentials'
import { datasetRouter } from './routers/dataset'
import { documentRouter } from './routers/document'
import { segmentRouter } from './routers/segment'
import { fileRouter } from './routers/file'
import { folderRouter } from './routers/folder'
import { memberRouter } from './routers/member'
import { adminRouter } from './routers/admin'
import { timelineRouter } from './routers/timeline'
import { appsRouter } from './routers/apps'
import { resourceRouter } from './routers/resource'
import { recordRouter } from './routers/record'
import { attachmentRouter } from './routers/attachment'
import { mediaAssetRouter } from './routers/mediaAsset'
import { entityDefinitionRouter } from './routers/entityDefinition'
import { dataImportRouter } from './routers/data-import'
import { fieldValueRouter } from './routers/fieldValue'
import { taskRouter } from './routers/task'

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
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
  contact: contactRouter,
  credentials: credentialsRouter,
  customField: customFieldRouter,
  dataset: datasetRouter,
  document: documentRouter,
  segment: segmentRouter,
  fieldValue: fieldValueRouter,
  file: fileRouter,
  folder: folderRouter,
  mediaAsset: mediaAssetRouter,
  customer: customerRouter,
  emailTemplate: emailTemplateRouter,
  embedding: embeddingRouter,
  entityDefinition: entityDefinitionRouter,
  featurePermission: featurePermissionsRouter,
  googleOAuth: googleOAuthRouter,
  group: groupRouter,
  inbox: inboxRouter,
  integration: integrationRouter,
  integrationReauth: integrationReauthRouter,
  inventory: inventoryRouter,
  kb: knowledgeBaseRouter,
  label: labelRouter,
  mailDomain: mailDomainsRouter,
  mailView: mailViewRouter,
  member: memberRouter,
  notification: notificationRouter,
  order: orderRouter,
  organization: organizationRouter,
  part: partRouter,
  product: productRouter,
  record: recordRouter,
  resource: resourceRouter,
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
