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
      suppressHydrationWarning
      className='flex min-h-0 flex-1 flex-col'
      style={{ background: 'var(--kb-page-bg)' }}>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <NoFlashModeScript kbId={kb.id} />
      {children}
    </div>
  )
}

/**
 * Syncs `data-kb-mode` on the host element from the `kb-mode-{id}` cookie
 * before paint, mirroring `KBModeToggle.applyMode()`. Cached server shells
 * SSR with `kb.defaultMode`; this script flips the attribute to the user's
 * stored preference without a flash, so the cached layout can stay one
 * variant per KB instead of splitting per mode.
 */
function NoFlashModeScript({ kbId }: { kbId: string }) {
  const code = `(function(){try{var id=${JSON.stringify(kbId)};var esc=id.replace(/[-\\/\\\\^$*+?.()|[\\]{}]/g,'\\\\$&');var m=document.cookie.match(new RegExp('(?:^|; )kb-mode-'+esc+'=([^;]*)'));if(!m)return;var v=decodeURIComponent(m[1]);if(v!=='dark'&&v!=='light')return;var el=document.currentScript&&document.currentScript.parentElement;if(el)el.setAttribute('data-kb-mode',v);}catch(_){}})();`
  return <script dangerouslySetInnerHTML={{ __html: code }} />
}

function normalizeMode(value: string | null | undefined): KBMode {
  if (value === 'dark') return 'dark'
  return 'light'
}
