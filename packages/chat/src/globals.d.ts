// packages/chat/src/globals.d.ts

declare const __AUXX_API_BASE_URL__: string

interface Window {
  __AUXX_CONFIG__?: {
    apiBase?: string
    userJwt?: string
    attributes?: Record<string, unknown>
    /** Force the widget open on mount. Used by in-app preview surfaces. */
    open?: boolean
    /**
     * Keep rounded corners in the mobile-fullscreen layout (<640px viewport).
     * Used by the settings preview pane so the phone-shaped iframe doesn't
     * render with the production square-edge mobile chrome.
     */
    previewRounded?: boolean
    /**
     * Force the launcher to render even on `users`-audience channels with no
     * `userJwt`. Used by the admin settings preview iframe so customers can
     * see how the widget looks without first signing a fake JWT. Visual only;
     * the server still rejects anonymous passport mints on enforced channels.
     */
    previewBypassAudience?: boolean
  }
}

declare module '*.css' {
  const content: string
  export default content
}

declare module '*.css?inline' {
  const content: string
  export default content
}
