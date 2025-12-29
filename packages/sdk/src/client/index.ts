// packages/sdk/src/client/index.ts

/**
 * Auxx Client SDK
 *
 * This module provides client-side APIs for building Auxx extensions.
 * All implementations are provided by the Auxx platform at runtime.
 */

// Re-export all client APIs
export * from './dialogs.js'
export * from './alerts.js'
export * from './toasts.js'
export * from './navigation.js'
export * from './record-actions.js'

// Types
export * from './types.js'

// Components
export * from './components/index.js'

// Hooks
export * from './hooks/index.js'

// Forms
export * from './forms/index.js'

// Workflow
export * from './workflow/index.js'
