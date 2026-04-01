// packages/sdk/src/root/quick-actions/types.ts

import type { ComponentType } from 'react'
import type { WorkflowExecuteFunction, WorkflowSchema } from '../workflow/types.js'

/**
 * An entity instance resolved from the thread context.
 * Generic shape — works for any entity definition (ticket, contact, order, company, custom).
 */
export interface QuickActionEntity {
  id: string
  entityDefinitionId: string
  /** Entity definition slug (e.g., "shopify-order", "company") */
  entityDefinitionSlug: string
  displayName: string
  /** Custom field values, keyed by field slug */
  fields: Record<string, unknown>
}

/**
 * A thread participant with optional linked contact entity.
 */
export interface QuickActionParticipant {
  email: string
  name?: string
  isInternal: boolean
  /** Linked contact entity (if resolved) */
  contact?: QuickActionEntity
}

/**
 * Context provided to quick action shouldShow, getDefaults, and execute.
 * Built by the platform — never constructed by the action author.
 */
export interface QuickActionContext {
  /** The thread being replied to */
  threadId: string

  /** Ticket entity instance linked to this thread (if any) */
  ticket?: QuickActionEntity

  /** Thread participants */
  participants: QuickActionParticipant[]

  /**
   * All entity instances associated with the thread context.
   * Includes ticket, contacts, and any entities linked via relationship fields
   * (e.g., a Shopify order linked on the ticket, a company linked on the contact).
   */
  entities: QuickActionEntity[]
}

/**
 * Quick action definition — appears in the email editor's action panel.
 * Uses the same schema system as workflow blocks for input/output typing.
 *
 * All quick actions execute before send (blocking). If execution fails, the
 * send is aborted. Post-send side effects should use workflows instead.
 */
export interface QuickAction<TSchema extends WorkflowSchema = WorkflowSchema> {
  /** Unique identifier (scoped to app) */
  id: string

  /** Display label (e.g., "Refund Order") */
  label: string

  /** Short description shown in the action picker */
  description?: string

  /** Icon — same format as WorkflowBlock.icon */
  icon?: string | ComponentType

  /** Icon color */
  color?: string

  /** Input/output schema — reuses workflow schema system */
  schema: TSchema

  /**
   * Server-side execution function.
   * Receives resolved inputs (user-filled form values).
   * Runs at send-time, blocking — send is aborted on failure.
   */
  execute: WorkflowExecuteFunction<TSchema>

  /**
   * Optional: compact form component for inline configuration.
   * If not provided, the platform auto-generates a form from the schema.
   * Rendered inside the action chip's expanded state.
   */
  form?: ComponentType<QuickActionFormProps<TSchema>>

  /**
   * Optional: determine whether this action should appear for a given context.
   * Runs client-side. If omitted, always shown.
   */
  shouldShow?: (context: QuickActionContext) => boolean

  /**
   * Optional: pre-fill input values from context.
   * Runs client-side when the action is added.
   */
  getDefaults?: (context: QuickActionContext) => Partial<Record<keyof TSchema['inputs'], any>>

  /** Configuration */
  config?: {
    /** Execution timeout in milliseconds (default: 30000) */
    timeout?: number
    /** Whether this action requires an app connection */
    requiresConnection?: boolean
    /** Whether to show a confirmation before executing */
    requiresConfirmation?: boolean
    /** Confirmation message (supports variables from inputs) */
    confirmationMessage?: string
  }
}

export interface QuickActionFormProps<TSchema extends WorkflowSchema = WorkflowSchema> {
  /** Current input values */
  values: Partial<Record<keyof TSchema['inputs'], any>>
  /** Update input values */
  onChange: (values: Partial<Record<keyof TSchema['inputs'], any>>) => void
  /** Quick action context (thread, ticket, participants, entities) */
  context: QuickActionContext
  /** Whether the form is disabled (during execution) */
  disabled?: boolean
}
