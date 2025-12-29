// apps/web/src/providers/extensions/index.ts

/**
 * Extensions provider exports
 * Following the project's module export standards (explicit exports)
 */

export { ExtensionsProvider } from './extensions-provider'
export {
  InternalAppsContextProvider,
  useInternalAppsContext,
} from './internal-apps-context'
export {
  ExtensionsContextProvider,
  useExtensionsContext,
  type AppInstallation,
} from './extensions-context'
export {
  ExtensionDataHandlerContextProvider,
  useExtensionDataHandlerContext,
} from './extension-data-handler-context'
