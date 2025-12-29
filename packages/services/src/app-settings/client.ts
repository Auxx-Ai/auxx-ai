// packages/services/src/app-settings/client.ts
//
// Client-safe exports for app-settings
// This file MUST NOT import any server-only code (database, etc.)
//
// Use this entry point in client components that need validation utilities:
// import { schemaToZod } from '@auxx/services/app-settings/client'

export { schemaToZod } from './schema-to-zod'
export { mergeSettingsWithDefaults, extractDefaults } from './merge-with-defaults'
export type { FormSchema, SettingsSchemaField } from './merge-with-defaults'
