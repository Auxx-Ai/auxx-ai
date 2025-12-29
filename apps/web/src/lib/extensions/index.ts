// apps/web/src/lib/extensions/index.ts

/**
 * Extensions library exports
 * Following the project's module export standards (explicit exports)
 */

// Core infrastructure
export { AppStore, type Surface, type SurfaceMap, type Asset, type RenderTree } from './app-store'
export { MessageClient } from './message-client'
export { EventBroker } from './event-broker'

// React hooks
export { useSurfaces } from './use-surfaces'
export { useMessageClient } from './use-message-client'
export { useWidget } from './use-widget'

// Component system (Plan 7)
export { componentRegistry, getComponent, hasComponent, getAllComponentNames, type ComponentName } from './component-registry'
export { reconstructReactTree } from './reconstruct-react-tree'

// Instance management
export { SurfaceInstanceExternalStore } from './surface-instance-external-store'

// Platform hooks (Plan 7)
export {
  useExtensionSettings,
  useExtensionInstallation,
  useInstalledExtensions,
  useIsExtensionInstalled,
} from './extension-hooks'
