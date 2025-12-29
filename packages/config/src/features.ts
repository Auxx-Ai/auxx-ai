// Feature flags for controlling functionality across the monorepo
export const features = {
  // Authentication features
  auth: { enableMagicLink: true, enableTwoFactor: true, enableOAuth: true },

  // UI features
  ui: { enableDarkMode: true, enableAnimations: true },

  // Product features
  product: { enableKnowledgeBase: true, enableChatWidget: true, enableMultipleInboxes: true },

  // Developer features
  dev: {
    enableDebugLogging: process.env.NODE_ENV !== 'production',
    enableMockData: process.env.NODE_ENV === 'development',
  },
}
