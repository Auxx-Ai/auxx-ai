// packages/sdk/src/root/app.ts

import type { BulkRecordAction, RecordAction, RecordWidget } from '../client/record-actions.js'
import type { DataConnectorDefinition } from './data-connectors/types.js'
import type { AppFieldDefinition } from './fields/index.js'
import type { ScopedSettingsSchema } from './settings/settings-schema.js'
import type { ToolDefinition, Toolset } from './tools/types.js'
import type { Trigger, WorkflowBlock } from './workflow/types.js'
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
    /** Workflow blocks — composite UI containers that dispatch to tools. */
    readonly blocks?: WorkflowBlock[]
    /** Triggers with a `workflow` surface key. */
    readonly triggers?: Trigger[]
  }

  /**
   * Atomic units of behavior. Each tool opts into agent / action surfaces
   * via the corresponding key on its definition. Tools without any surface
   * key are internal (invocable from block dispatchers only).
   */
  readonly tools?: ReadonlyArray<ToolDefinition>

  /**
   * Toolsets that group `tools` for agent-side enablement filters.
   */
  readonly toolsets?: ReadonlyArray<Toolset>

  /**
   * Custom fields this app owns on the platform's entities. Declared via
   * `defineFields([...])`, provisioned on install (`installation` scope) or per
   * connected account (`connection` scope), optionally hidden, and removed on
   * uninstall. See app-registered custom fields.
   */
  readonly fields?: ReadonlyArray<AppFieldDefinition>

  /**
   * Data Connectors this app declares — structured-data sources that sync into
   * the platform's entity model. Declared via `defineDataConnector(...)`. The
   * build extractor serializes each into `AppDeployment.catalog.dataConnectors`;
   * the org may set one up to provision owned defs + contribute to existing
   * ones. See plans/data-connectors/claude/03-connectors-and-sources.md §4.
   */
  readonly dataConnectors?: ReadonlyArray<DataConnectorDefinition>

  readonly settings?: {
    readonly organization?: ScopedSettingsSchema
  }

  /** App metadata and configuration */
  // settings?: SettingsSchema
}
