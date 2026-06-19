// packages/lib/src/data-connectors/templates/index.ts
// First-party connector templates (05c) — public surface.

export {
  getAllConnectorTemplates,
  getConnectorTemplateById,
} from './connector-template-registry'
export type {
  ConnectorTemplate,
  ConnectorTemplateConnection,
  ConnectorTemplateStream,
  ConnectorTemplateSummary,
} from './types'
