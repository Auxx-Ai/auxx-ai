// packages/chat/src/globals.d.ts

declare const __AUXX_API_BASE_URL__: string

interface Window {
  __AUXX_CONFIG__?: {
    apiBase?: string
    userJwt?: string
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
