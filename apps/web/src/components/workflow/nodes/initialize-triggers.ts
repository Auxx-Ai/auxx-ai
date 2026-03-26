// apps/web/src/components/workflow/nodes/initialize-triggers.ts

import { WorkflowTriggerType } from '@auxx/lib/workflow-engine/client'
import type { ValidationResult } from '../types'
import { ManualTriggerInput } from './shared/manual-trigger-input'
import { MessageReceivedTriggerInput } from './shared/message-received-trigger-input'
import { ResourceTriggerInput } from './shared/resource-trigger-input'
import { ScheduledTriggerInput } from './shared/scheduled-trigger-input'
import { WebhookTriggerInput } from './shared/webhook-trigger-input'
import { registerTriggerInput } from './trigger-registry'

// Track if triggers have been initialized to prevent duplicate registration
let triggersInitialized = false

/**
 * Initialize trigger input configurations
 * This should only be called once to prevent duplicate registrations
 */
export function initializeTriggers() {
  if (triggersInitialized) {
    return
  }

  // Register MESSAGE_RECEIVED trigger input
  registerTriggerInput(WorkflowTriggerType.MESSAGE_RECEIVED, {
    component: MessageReceivedTriggerInput,
    description: 'Triggered when a new message is received',
    requiredData: ['thread', 'message'],

    validate: (inputs: Record<string, any>): ValidationResult => {
      const errors: Array<{ field: string; message: string }> = []

      if (inputs._isAutoMode ?? true) {
        // Auto mode: require thread selection
        if (!inputs._threadId) {
          errors.push({ field: '_threadId', message: 'Please select a thread' })
        }
      } else {
        // Manual mode: require from email and inbox
        if (!inputs.fromEmail) {
          errors.push({ field: 'fromEmail', message: 'From email is required' })
        }
        if (!inputs.integrationId) {
          errors.push({ field: 'integrationId', message: 'Please select an integration' })
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
      }
    },

    getDefaultInputs: () => ({
      _isAutoMode: true,
      _threadId: '',
      integrationId: '',
      fromEmail: '',
      fromName: '',
      ccEmails: '',
      bccEmails: '',
      subject: '',
      body: '',
      isInbound: true,
    }),
  })

  // Register WEBHOOK trigger input
  registerTriggerInput(WorkflowTriggerType.WEBHOOK, {
    component: WebhookTriggerInput,
    description: 'Triggered via HTTP webhook',
    requiredData: [],

    validate: (inputs: Record<string, any>): ValidationResult => {
      const errors: Array<{ field: string; message: string }> = []

      // Validate headers is a valid JSON object
      if (inputs.headers && typeof inputs.headers === 'string') {
        try {
          JSON.parse(inputs.headers)
        } catch {
          errors.push({ field: 'headers', message: 'Headers must be valid JSON' })
        }
      } else if (inputs.headers && typeof inputs.headers !== 'object') {
        errors.push({ field: 'headers', message: 'Headers must be a JSON object' })
      }

      // Validate query is a valid JSON object
      if (inputs.query && typeof inputs.query === 'string') {
        try {
          JSON.parse(inputs.query)
        } catch {
          errors.push({ field: 'query', message: 'Query parameters must be valid JSON' })
        }
      } else if (inputs.query && typeof inputs.query !== 'object') {
        errors.push({ field: 'query', message: 'Query parameters must be a JSON object' })
      }

      // Validate body is valid JSON (only if present)
      if (inputs.body && typeof inputs.body === 'string') {
        try {
          JSON.parse(inputs.body)
        } catch {
          errors.push({ field: 'body', message: 'Request body must be valid JSON' })
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
      }
    },

    getDefaultInputs: () => ({
      headers: {},
      query: {},
      body: {},
      method: 'GET',
    }),
  })

  // Register SCHEDULED trigger input
  registerTriggerInput(WorkflowTriggerType.SCHEDULED, {
    component: ScheduledTriggerInput,
    description: 'Triggered on a schedule',
    requiredData: [],

    validate: (inputs: Record<string, any>): ValidationResult => {
      // No validation needed for scheduled triggers in test mode
      return {
        isValid: true,
        errors: [],
      }
    },

    getDefaultInputs: () => ({
      // No inputs needed for scheduled trigger test runs
    }),
  })

  // Register MANUAL trigger input
  registerTriggerInput(WorkflowTriggerType.MANUAL, {
    component: ManualTriggerInput,
    description: 'Manually trigger workflow with user inputs from connected input nodes',
    requiredData: [],

    validate: (inputs: Record<string, any>): ValidationResult => {
      const errors: Array<{ field: string; message: string }> = []

      // Get connected input nodes to validate against their requirements
      // Note: The ManualTriggerInput component handles reading the connected nodes
      // For now, we'll do basic validation - this could be enhanced to check
      // each connected input node's required property

      return {
        isValid: errors.length === 0,
        errors,
      }
    },

    getDefaultInputs: () => ({
      // Default inputs will be populated based on connected input nodes
      // The ManualTriggerInput component handles this dynamically
    }),
  })

  // Register unified resource trigger input
  registerTriggerInput(WorkflowTriggerType.RESOURCE_TRIGGER, {
    component: ResourceTriggerInput,
    description: 'Triggered when a resource event occurs (create, update, delete)',
    requiredData: ['resourceData'],

    validate: (inputs: Record<string, any>): ValidationResult => {
      // Validation is handled by ResourceTriggerInput component
      // which has access to resourceType and operation from node.data
      const errors: Array<{ field: string; message: string }> = []

      if (!inputs.resourceData) {
        errors.push({ field: 'resourceData', message: 'Resource data is required' })
      }

      return {
        isValid: errors.length === 0,
        errors,
      }
    },

    getDefaultInputs: () => {
      return {
        resourceData: {},
        timestamp: new Date().toISOString(),
      }
    },
  })

  triggersInitialized = true
}
