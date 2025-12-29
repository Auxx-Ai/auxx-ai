// packages/sdk/src/root/app.ts

import type { BulkRecordAction, RecordAction, RecordWidget } from '../client/record-actions.js'
// import type { WorkflowStepBlock, WorkflowTriggerBlock } from '../server/workflow/index.js'
import type { ScopedSettingsSchema } from './settings/settings-schema.js'
import type { WorkflowBlock, WorkflowTrigger } from './workflow/types.js'
/**
 * Permission definition for app access control
 */
export interface Permission {
  /** Resource type */
  resource: 'records' | 'workflows' | 'api' | 'storage' | 'users'
  /** Actions allowed on this resource */
  actions: ('read' | 'write' | 'delete')[]
  /** Description of why this permission is needed */
  description?: string
}

/**
 * App settings and metadata
 */
export interface AppSettings {
  /** App name */
  name: string
  /** App description */
  description?: string
  /** App icon URL or emoji */
  icon?: string
  /** App version (semver) */
  version?: string
  /** Permissions required by the app */
  permissions?: Permission[]
  /** App author */
  author?: string
  /** App homepage URL */
  homepage?: string
}

/**
 * Main app configuration interface.
 * Export an object of this type from your app's entry point.
 *
 * @example
 * ```typescript
 * import type { App } from '@auxx/sdk'
 *
 * export const app: App = {
 *   recordActions: [myAction],
 *   workflows: {
 *     steps: [myStep]
 *   },
 *   settings: {
 *     name: 'My App',
 *     version: '1.0.0'
 *   }
 * }
 * ```
 */

export declare namespace App {
  namespace Record {
    type Action = RecordAction
    type BulkAction = BulkRecordAction
    type Widget = RecordWidget
  }
  namespace Workflow {}
  namespace Settings {}
}

export interface App {
  readonly record?: {
    readonly actions?: Array<App.Record.Action>
    readonly bulkActions?: Array<App.Record.BulkAction>
    readonly widgets?: Array<App.Record.Widget>
  }

  readonly callRecording?: {
    readonly insight?: {
      readonly textActions: Array<string>
    }
    readonly summary?: {
      readonly textActions?: Array<string>
    }
    readonly transcript?: {
      readonly textActions: Array<string>
    }
  }

  readonly workflow?: {
    /** New workflow blocks using schema-based API */
    readonly blocks?: WorkflowBlock[]
    /** New workflow triggers using schema-based API */
    readonly triggers?: WorkflowTrigger[]
  }
  readonly settings?: {
    readonly organization?: ScopedSettingsSchema
  }

  /** App metadata and configuration */
  // settings?: SettingsSchema
}
