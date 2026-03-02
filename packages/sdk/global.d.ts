// packages/sdk/global.d.ts

/**
 * Global runtime SDK types injected by the Auxx platform
 */

declare global {
  interface Window {
    /**
     * Client SDK implementation provided by the Auxx platform
     */
    AUXX_CLIENT_EXTENSION_SDK: {
      // Dialogs
      showDialog: (options: any) => Promise<void>
      closeDialog: () => Promise<void>

      // Alerts
      alert: (options: any) => Promise<void>
      confirm: (options: any) => Promise<boolean>

      // Toasts
      showToast: (options: any) => void

      // Navigation
      navigateTo: (path: string) => void
      openRecord: (recordId: string) => void
      openUrl: (url: string, newTab?: boolean) => void
    }

    /**
     * Root SDK (if needed for runtime type checking)
     */
    AUXX_ROOT_SDK: Record<string, any>

    /**
     * React library made available globally
     */
    React: typeof import('react')
  }

  namespace NodeJS {
    interface Global {
      /**
       * Server SDK implementation provided by the Auxx platform
       */
      AUXX_SERVER_SDK: {
        // Database
        query: (options: any) => Promise<any[]>
        queryOne: (options: any) => Promise<any | null>

        // External API
        fetch: (options: any) => Promise<any>

        // Auth
        getCurrentUser: () => Promise<any>
        getApiToken: () => Promise<string>

        // Storage
        storage: {
          get: (key: string) => Promise<string | null>
          set: (key: string, value: string) => Promise<void>
          delete: (key: string) => Promise<void>
        }
      }
    }
  }
}

/** Allow importing PNG files — esbuild resolves them to base64 data URLs at build time. */
declare module '*.png' {
  const content: string
  export default content
}

export {}
