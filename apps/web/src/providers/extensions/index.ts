// apps/web/src/providers/extensions/index.ts

/**
 * Extensions provider exports
 * Following the project's module export standards (explicit exports)
 */

export {
  ExtensionDataHandlerContextProvider,
  useExtensionDataHandlerContext,
} from './extension-data-handler-context'
export {
  type AppInstallation,
  ExtensionsContextProvider,
  useExtensionsContext,
} from './extensions-context'
export { ExtensionsProvider } from './extensions-provider'
export {
  InternalAppsContextProvider,
  useInternalAppsContext,
} from './internal-apps-context'
