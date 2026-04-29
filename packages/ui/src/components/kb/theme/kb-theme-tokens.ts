// packages/ui/src/components/kb/theme/kb-theme-tokens.ts

export type KBMode = 'light' | 'dark'
export type KBCornerStyle = 'straight' | 'rounded' | 'pill'

export interface KBColorPair {
  light: string
  dark: string
}

export const KB_TOKEN_DEFAULTS: Record<string, KBColorPair> = {
  primary: { light: '#2563eb', dark: '#60a5fa' },
  tint: { light: '#dbeafe', dark: '#1e3a8a' },
  info: { light: '#0ea5e9', dark: '#38bdf8' },
  success: { light: '#16a34a', dark: '#4ade80' },
  warning: { light: '#f59e0b', dark: '#fbbf24' },
  danger: { light: '#dc2626', dark: '#f87171' },
  bg: { light: '#ffffff', dark: '#0a0a0a' },
  fg: { light: '#0a0a0a', dark: '#ffffff' },
  muted: { light: '#f4f4f5', dark: '#18181b' },
  border: { light: '#e4e4e7', dark: '#27272a' },
}

export const KB_CORNER_RADIUS: Record<KBCornerStyle, string> = {
  straight: '0px',
  rounded: '8px',
  pill: '9999px',
}

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** Sanitize a stored color string to a CSS-safe hex value. Falls back to default. */
export function sanitizeColor(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  const trimmed = value.trim()
  if (HEX_COLOR.test(trimmed)) return trimmed
  return fallback
}

const FONT_ALLOWLIST = new Set([
  'system',
  'inter',
  'roboto',
  'open-sans',
  'lora',
  'merriweather',
  'source-serif-pro',
  'jetbrains-mono',
  'ibm-plex-sans',
])

const FONT_STACK_BY_KEY: Record<string, string> = {
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  inter: '"Inter", system-ui, -apple-system, sans-serif',
  roboto: '"Roboto", system-ui, sans-serif',
  'open-sans': '"Open Sans", system-ui, sans-serif',
  lora: '"Lora", Georgia, serif',
  merriweather: '"Merriweather", Georgia, serif',
  'source-serif-pro': '"Source Serif Pro", Georgia, serif',
  'jetbrains-mono': '"JetBrains Mono", ui-monospace, Menlo, monospace',
  'ibm-plex-sans': '"IBM Plex Sans", system-ui, sans-serif',
}

export function sanitizeFontFamily(value: string | null | undefined): string {
  if (!value) return FONT_STACK_BY_KEY.system
  const key = value.trim().toLowerCase()
  if (FONT_ALLOWLIST.has(key)) return FONT_STACK_BY_KEY[key]
  return FONT_STACK_BY_KEY.system
}

export function sanitizeCornerStyle(value: string | null | undefined): KBCornerStyle {
  if (value === 'straight' || value === 'rounded' || value === 'pill') return value
  return 'rounded'
}

export interface KBThemeInput {
  id: string
  primaryColorLight?: string | null
  primaryColorDark?: string | null
  tintColorLight?: string | null
  tintColorDark?: string | null
  infoColorLight?: string | null
  infoColorDark?: string | null
  successColorLight?: string | null
  successColorDark?: string | null
  warningColorLight?: string | null
  warningColorDark?: string | null
  dangerColorLight?: string | null
  dangerColorDark?: string | null
  fontFamily?: string | null
  cornerStyle?: string | null
}

/** Build a string of CSS rules scoped under [data-kb-id="<id>"]. */
export function buildKBCss(kb: KBThemeInput): string {
  const sel = `[data-kb-id="${escapeAttr(kb.id)}"]`
  const font = sanitizeFontFamily(kb.fontFamily)
  const radius = KB_CORNER_RADIUS[sanitizeCornerStyle(kb.cornerStyle)]

  const lightVars = buildModeVars(kb, 'light')
  const darkVars = buildModeVars(kb, 'dark')

  return [
    `${sel} { --kb-font: ${font}; --kb-radius: ${radius}; }`,
    `${sel}[data-kb-mode="light"] { ${lightVars} }`,
    `${sel}[data-kb-mode="dark"] { ${darkVars} }`,
  ].join('\n')
}

function buildModeVars(kb: KBThemeInput, mode: KBMode): string {
  const get = (
    key: keyof typeof KB_TOKEN_DEFAULTS,
    light: string | null | undefined,
    dark: string | null | undefined
  ) => {
    const fallback = KB_TOKEN_DEFAULTS[key][mode]
    return sanitizeColor(mode === 'light' ? light : dark, fallback)
  }
  const decls: Array<[string, string]> = [
    ['--kb-primary', get('primary', kb.primaryColorLight, kb.primaryColorDark)],
    ['--kb-tint', get('tint', kb.tintColorLight, kb.tintColorDark)],
    ['--kb-info', get('info', kb.infoColorLight, kb.infoColorDark)],
    ['--kb-success', get('success', kb.successColorLight, kb.successColorDark)],
    ['--kb-warning', get('warning', kb.warningColorLight, kb.warningColorDark)],
    ['--kb-danger', get('danger', kb.dangerColorLight, kb.dangerColorDark)],
    ['--kb-bg', KB_TOKEN_DEFAULTS.bg[mode]],
    ['--kb-fg', KB_TOKEN_DEFAULTS.fg[mode]],
    ['--kb-muted', KB_TOKEN_DEFAULTS.muted[mode]],
    ['--kb-border', KB_TOKEN_DEFAULTS.border[mode]],
  ]
  return decls.map(([k, v]) => `${k}: ${v};`).join(' ')
}

function escapeAttr(value: string): string {
  return value.replace(/["\\<>]/g, '')
}
