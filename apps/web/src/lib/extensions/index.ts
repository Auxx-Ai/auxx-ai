// apps/web/src/lib/extensions/index.ts

/**
 * Extensions library exports
 * Following the project's module export standards (explicit exports)
 */

// Core infrastructure
export { AppStore, type Asset, type RenderTree, type Surface, type SurfaceMap } from './app-store'
// Component system (Plan 7)
export {
  type ComponentName,
  componentRegistry,
  getAllComponentNames,
  getComponent,
  hasComponent,
} from './component-registry'
export { EventBroker } from './event-broker'
// Platform hooks (Plan 7)
export {
  useExtensionInstallation,
  useExtensionSettings,
  useInstalledExtensions,
  useIsExtensionInstalled,
} from './extension-hooks'
export { MessageClient } from './message-client'
export { reconstructReactTree } from './reconstruct-react-tree'
// Instance management
export { SurfaceInstanceExternalStore } from './surface-instance-external-store'
export { useMessageClient } from './use-message-client'
// React hooks
export { useSurfaces } from './use-surfaces'
export { useWidget } from './use-widget'
