// apps/web/src/lib/immer-config.ts

import { enableMapSet } from 'immer'

// Enable Map and Set support in Immer
// This is required for zustand stores that use Map or Set with immer middleware
enableMapSet()

// Export a flag to indicate that Immer has been configured
export const immerConfigured = true
