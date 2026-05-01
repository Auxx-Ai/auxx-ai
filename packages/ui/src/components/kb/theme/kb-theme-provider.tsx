// packages/ui/src/components/kb/theme/kb-theme-provider.tsx

import type { ReactNode } from 'react'
import { buildKBCss, type KBMode, type KBThemeInput, sanitizeTheme } from './kb-theme-tokens'

export interface KBThemeProviderProps {
  kb: KBThemeInput & { defaultMode?: string | null }
  /** Override the mode (admin preview uses this). */
  mode?: KBMode
  children: ReactNode
}

export function KBThemeProvider({ kb, mode, children }: KBThemeProviderProps) {
  const css = buildKBCss(kb)
  const initialMode = mode ?? normalizeMode(kb.defaultMode)
  const theme = sanitizeTheme(kb.theme)
  return (
    <div
      data-slot='kb-theme'
      data-kb-id={kb.id}
      data-kb-mode={initialMode}
      data-kb-theme={theme}
      className='flex min-h-0 flex-1 flex-col'
      style={{ background: 'var(--kb-page-bg)' }}>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: values are sanitized via buildKBCss */}
      <style dangerouslySetInnerHTML={{ __html: css }} />
      {children}
    </div>
  )
}

function normalizeMode(value: string | null | undefined): KBMode {
  if (value === 'dark') return 'dark'
  return 'light'
}
