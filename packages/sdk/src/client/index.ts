// packages/sdk/src/client/index.ts

/**
 * Auxx Client SDK
 *
 * This module provides client-side APIs for building Auxx extensions.
 * All implementations are provided by the Auxx platform at runtime.
 */

export * from './alerts.js'
// Components
export * from './components/index.js'
// Re-export all client APIs
export * from './dialogs.js'
// Forms
export * from './forms/index.js'
// Hooks
export * from './hooks/index.js'
export * from './navigation.js'
export * from './record-actions.js'
export * from './toasts.js'
// Types
export * from './types.js'

// Workflow
export * from './workflow/index.js'
