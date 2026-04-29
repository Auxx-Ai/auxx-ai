// packages/ui/src/components/kb/theme/kb-theme-provider.tsx

import type { ReactNode } from 'react'
import { buildKBCss, type KBMode, type KBThemeInput } from './kb-theme-tokens'

export interface KBThemeProviderProps {
  kb: KBThemeInput & { defaultMode?: string | null }
  /** Override the mode (admin preview uses this). */
  mode?: KBMode
  children: ReactNode
}

export function KBThemeProvider({ kb, mode, children }: KBThemeProviderProps) {
  const css = buildKBCss(kb)
  const initialMode = mode ?? normalizeMode(kb.defaultMode)
  return (
    <div data-kb-id={kb.id} data-kb-mode={initialMode} style={{ background: 'var(--kb-bg)' }}>
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
