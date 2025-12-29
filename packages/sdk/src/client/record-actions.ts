// packages/sdk/src/client/record-actions.ts

/**
 * Context provided when a record action is triggered
 */
export interface RecordActionContext {
  /** The ID of the record the action was triggered on */
  recordId: string
  /** The type of the record (e.g., 'ticket', 'customer') */
  recordType: string
  /** Additional context data */
  metadata?: Record<string, any>
}

/**
 * Definition of a record action that appears in the UI
 */
export interface RecordAction {
  /** Unique identifier for the action */
  readonly id: string
  /** Display label for the action */
  readonly label: string
  /** Optional icon for the action */
  readonly icon?: string
  /** Function called when the action is triggered */
  onTrigger: (context: RecordActionContext) => Promise<void> | void
  /** Optional condition to determine if the action should be shown */
  shouldShow?: (context: RecordActionContext) => boolean | Promise<boolean>
  /**
   * Optional description of the action
   */
  readonly description?: string
}

export interface BulkRecordAction {
  readonly id: string
  onTrigger: (context: RecordActionContext) => Promise<void> | void
  readonly label: string
  readonly icon?: string
}

export interface RecordWidget {
  /**
   * A unique identifier for the widget.
   *
   * Only used internally.
   */
  readonly id: string
  /**
   * The base hexadecimal color of the gradient displayed in the background of the widget
   */
  readonly color?: `#${string}`
  /**
   * A human-readable label of the widget that will be shown to the user in the widget picker.
   */
  readonly label: string
}
