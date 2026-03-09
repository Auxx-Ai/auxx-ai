// apps/homepage/src/lib/config-context.tsx
'use client'

import { createContext, use } from 'react'
import type { SiteConfig } from './config'

const ConfigContext = createContext<SiteConfig | null>(null)

export function ConfigProvider({
  config,
  children,
}: {
  config: SiteConfig
  children: React.ReactNode
}) {
  return <ConfigContext value={config}>{children}</ConfigContext>
}

export function useConfig(): SiteConfig {
  const config = use(ConfigContext)
  if (!config) {
    throw new Error('useConfig must be used within a ConfigProvider')
  }
  return config
}
