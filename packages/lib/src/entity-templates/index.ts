// packages/lib/src/entity-templates/index.ts

export type { InstallTemplatesResult } from './template-installer'
export { installTemplates } from './template-installer'
export type { TemplateSummary } from './template-registry'
export { getAllTemplates, getTemplateById, getTemplatesByIds } from './template-registry'
export type { EntityTemplate, EntityTemplateField } from './types'
