// packages/ui/src/components/kb/theme/kb-theme-tokens.ts

export type KBMode = 'light' | 'dark'
export type KBCornerStyle = 'straight' | 'rounded' | 'pill'
export type KBTheme = 'clean' | 'muted' | 'gradient' | 'bold'

export interface KBColorPair {
  light: string
  dark: string
}

export const KB_TOKEN_DEFAULTS: Record<string, KBColorPair> = {
  primary: { light: '#346ddb', dark: '#346ddb' },
  tint: { light: '#dbeafe', dark: '#1e3a8a' },
  info: { light: '#0ea5e9', dark: '#38bdf8' },
  success: { light: '#16a34a', dark: '#4ade80' },
  warning: { light: '#f59e0b', dark: '#fbbf24' },
  danger: { light: '#dc2626', dark: '#f87171' },
  bg: { light: '#ffffff', dark: '#1d1d1d' },
  fg: { light: '#1d1d1d', dark: '#ffffff' },
  muted: { light: '#f1f3f5', dark: '#2c2c2c' },
  border: { light: '#dee2e6', dark: '#393939' },
}

/**
 * 12-step color scales for primary + neutral families. Each step is paired
 * with a `contrast-*` foreground color suitable for text on that step.
 *
 * Step semantics (Radix Colors convention):
 *  1   app background tint
 *  2   raised surface (cards, header)
 *  3   subtle component bg (hover for step 1, normal for components)
 *  4   component bg (hover for step 3, normal for buttons)
 *  5   component bg pressed
 *  6   subtle border (dividers)
 *  7   border (input outlines)
 *  8   border (hover, focus ring)
 *  9   solid brand bg (buttons) — derived from `--kb-primary` for primary family
 * 10   solid hover
 * 11   low-contrast text (subtle copy, captions)
 * 12   high-contrast text (headings, body)
 *
 * Dark values mirror the reference 'clean dark' palette exactly. Light values
 * are hand-picked Radix-style blue/slate counterparts that share step 9 with
 * dark so the brand color renders identically across modes.
 */
type Scale12 = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
]

interface FamilyScale {
  light: Scale12
  dark: Scale12
  contrastLight: Scale12
  contrastDark: Scale12
}

const PRIMARY_SCALE: FamilyScale = {
  dark: [
    'rgb(29, 29, 29)', // 1
    'rgb(32, 35, 39)', // 2
    'rgb(39, 44, 53)', // 3
    'rgb(40, 48, 62)', // 4
    'rgb(43, 54, 72)', // 5
    'rgb(45, 58, 81)', // 6
    'rgb(52, 68, 96)', // 7
    'rgb(59, 78, 112)', // 8
    'rgb(52, 109, 219)', // 9
    'rgb(80, 139, 252)', // 10
    'rgb(167, 193, 239)', // 11
    'rgb(249, 255, 255)', // 12
  ],
  contrastDark: [
    'rgb(255, 255, 255)',
    'rgb(255, 255, 255)',
    'rgb(255, 255, 255)',
    'rgb(255, 255, 255)',
    'rgb(255, 255, 255)',
    'rgb(255, 255, 255)',
    'rgb(255, 255, 255)',
    'rgb(255, 255, 255)',
    'rgb(255, 255, 255)',
    'rgb(255, 255, 255)',
    'rgb(29, 29, 29)',
    'rgb(29, 29, 29)',
  ],
  light: [
    'rgb(253, 253, 254)', // 1
    'rgb(245, 248, 255)', // 2
    'rgb(234, 241, 255)', // 3
    'rgb(221, 231, 255)', // 4
    'rgb(207, 221, 255)', // 5
    'rgb(188, 207, 250)', // 6
    'rgb(164, 189, 241)', // 7
    'rgb(128, 162, 232)', // 8
    'rgb(52, 109, 219)', // 9 — same as dark
    'rgb(42, 95, 201)', // 10
    'rgb(46, 93, 182)', // 11
    'rgb(20, 42, 87)', // 12
  ],
  contrastLight: [
    'rgb(29, 29, 29)',
    'rgb(29, 29, 29)',
    'rgb(29, 29, 29)',
    'rgb(29, 29, 29)',
    'rgb(29, 29, 29)',
    'rgb(29, 29, 29)',
    'rgb(29, 29, 29)',
    'rgb(29, 29, 29)',
    'rgb(255, 255, 255)',
    'rgb(255, 255, 255)',
    'rgb(255, 255, 255)',
    'rgb(255, 255, 255)',
  ],
}

const NEUTRAL_SCALE: FamilyScale = {
  dark: [
    'rgb(29, 29, 29)', // 1
    'rgb(34, 34, 34)', // 2
    'rgb(44, 44, 44)', // 3
    'rgb(48, 48, 48)', // 4
    'rgb(53, 53, 53)', // 5
    'rgb(57, 57, 57)', // 6
    'rgb(67, 67, 67)', // 7
    'rgb(78, 78, 78)', // 8
    'rgb(120, 120, 120)', // 9
    'rgb(144, 144, 144)', // 10
    'rgb(192, 192, 192)', // 11
    'rgb(255, 255, 255)', // 12
  ],
  contrastDark: [
    'rgb(255, 255, 255)',
    'rgb(255, 255, 255)',
    'rgb(255, 255, 255)',
    'rgb(255, 255, 255)',
    'rgb(255, 255, 255)',
    'rgb(255, 255, 255)',
    'rgb(255, 255, 255)',
    'rgb(255, 255, 255)',
    'rgb(255, 255, 255)',
    'rgb(255, 255, 255)',
    'rgb(29, 29, 29)',
    'rgb(29, 29, 29)',
  ],
  light: [
    'rgb(255, 255, 255)', // 1
    'rgb(248, 249, 250)', // 2
    'rgb(241, 243, 245)', // 3
    'rgb(233, 236, 239)', // 4
    'rgb(222, 226, 230)', // 5
    'rgb(206, 212, 218)', // 6
    'rgb(173, 181, 189)', // 7
    'rgb(134, 142, 150)', // 8
    'rgb(108, 117, 125)', // 9
    'rgb(73, 80, 87)', // 10
    'rgb(52, 58, 64)', // 11
    'rgb(29, 29, 29)', // 12
  ],
  contrastLight: [
    'rgb(29, 29, 29)',
    'rgb(29, 29, 29)',
    'rgb(29, 29, 29)',
    'rgb(29, 29, 29)',
    'rgb(29, 29, 29)',
    'rgb(29, 29, 29)',
    'rgb(29, 29, 29)',
    'rgb(29, 29, 29)',
    'rgb(255, 255, 255)',
    'rgb(255, 255, 255)',
    'rgb(255, 255, 255)',
    'rgb(255, 255, 255)',
  ],
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

export function sanitizeTheme(value: string | null | undefined): KBTheme {
  if (value === 'muted' || value === 'gradient' || value === 'bold') return value
  return 'clean'
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
  theme?: string | null
}

interface ThemeVars {
  pageBg: string
  surfaceBg: string
  sidebarBg: string
  contentBg: string
  surfaceBorder: string
  borderWeight: string
  headingScale: string
}

const KB_THEME_VARS: Record<KBTheme, Record<KBMode, ThemeVars>> = {
  clean: {
    light: {
      pageBg: 'var(--kb-neutral-1)',
      surfaceBg: 'var(--kb-neutral-2)',
      sidebarBg: 'var(--kb-neutral-1)',
      contentBg: 'var(--kb-neutral-2)',
      surfaceBorder: 'var(--kb-neutral-6)',
      borderWeight: '1px',
      headingScale: '1',
    },
    dark: {
      pageBg: 'var(--kb-neutral-1)',
      surfaceBg: 'var(--kb-neutral-2)',
      sidebarBg: 'var(--kb-neutral-1)',
      contentBg: 'var(--kb-neutral-2)',
      surfaceBorder: 'var(--kb-neutral-6)',
      borderWeight: '1px',
      headingScale: '1',
    },
  },
  muted: {
    light: {
      pageBg: '#fafafa',
      surfaceBg: '#ffffff',
      sidebarBg: '#fafafa',
      contentBg: '#ffffff',
      surfaceBorder: '#e5e5e5',
      borderWeight: '1px',
      headingScale: '1',
    },
    dark: {
      pageBg: '#09090b',
      surfaceBg: '#18181b',
      sidebarBg: '#09090b',
      contentBg: '#18181b',
      surfaceBorder: '#27272a',
      borderWeight: '1px',
      headingScale: '1',
    },
  },
  bold: {
    light: {
      pageBg: '#ffffff',
      surfaceBg: '#ffffff',
      sidebarBg: '#ffffff',
      contentBg: '#ffffff',
      surfaceBorder: '#0a0a0a',
      borderWeight: '2px',
      headingScale: '1.15',
    },
    dark: {
      pageBg: '#000000',
      surfaceBg: '#000000',
      sidebarBg: '#000000',
      contentBg: '#000000',
      surfaceBorder: '#ffffff',
      borderWeight: '2px',
      headingScale: '1.15',
    },
  },
  gradient: {
    light: {
      pageBg: 'linear-gradient(180deg, var(--kb-tint) 0%, #ffffff 280px)',
      surfaceBg: 'rgba(255,255,255,0.65)',
      sidebarBg: 'transparent',
      contentBg: '#ffffff',
      surfaceBorder: '#e4e4e7',
      borderWeight: '1px',
      headingScale: '1',
    },
    dark: {
      pageBg: 'linear-gradient(180deg, var(--kb-tint) 0%, #0a0a0a 280px)',
      surfaceBg: 'rgba(10,10,10,0.65)',
      sidebarBg: 'transparent',
      contentBg: '#0a0a0a',
      surfaceBorder: '#27272a',
      borderWeight: '1px',
      headingScale: '1',
    },
  },
}

/** Build a string of CSS rules scoped under [data-kb-id="<id>"]. */
export function buildKBCss(kb: KBThemeInput): string {
  const sel = `[data-kb-id="${escapeAttr(kb.id)}"]`
  const font = sanitizeFontFamily(kb.fontFamily)
  const radius = KB_CORNER_RADIUS[sanitizeCornerStyle(kb.cornerStyle)]
  const theme = sanitizeTheme(kb.theme)

  const lightVars = buildModeVars(kb, 'light', theme)
  const darkVars = buildModeVars(kb, 'dark', theme)

  return [
    `${sel} { --kb-font: ${font}; --kb-radius: ${radius}; }`,
    `${sel}[data-kb-mode="light"] { ${lightVars} }`,
    `${sel}[data-kb-mode="dark"] { ${darkVars} }`,
  ].join('\n')
}

function buildModeVars(kb: KBThemeInput, mode: KBMode, theme: KBTheme): string {
  const get = (
    key: keyof typeof KB_TOKEN_DEFAULTS,
    light: string | null | undefined,
    dark: string | null | undefined
  ) => {
    const fallback = KB_TOKEN_DEFAULTS[key][mode]
    return sanitizeColor(mode === 'light' ? light : dark, fallback)
  }
  const tv = KB_THEME_VARS[theme][mode]
  const primaryBrand = get('primary', kb.primaryColorLight, kb.primaryColorDark)
  const decls: Array<[string, string]> = [
    // 12-step scales (primary + neutral). Step 9 of primary is overridden with
    // the user-supplied brand color so admin-picked colors still drive the
    // solid CTA bg; the rest of the scale uses the curated reference values.
    ...scaleDecls('--kb-primary', PRIMARY_SCALE, mode, { override9: primaryBrand }),
    ...scaleDecls('--kb-neutral', NEUTRAL_SCALE, mode),
    // Flat tokens (info/warning/danger/success keep the single-color shape;
    // tint stays user-supplied for brand-tinted surfaces in the gradient theme).
    ['--kb-tint', get('tint', kb.tintColorLight, kb.tintColorDark)],
    ['--kb-info', get('info', kb.infoColorLight, kb.infoColorDark)],
    ['--kb-success', get('success', kb.successColorLight, kb.successColorDark)],
    ['--kb-warning', get('warning', kb.warningColorLight, kb.warningColorDark)],
    ['--kb-danger', get('danger', kb.dangerColorLight, kb.dangerColorDark)],
    // Backward-compat aliases — existing components consume these. Resolved
    // through the scale so the rest of the codebase picks up the new palette
    // without a sweep.
    ['--kb-primary', 'var(--kb-primary-9)'],
    ['--kb-bg', 'var(--kb-neutral-1)'],
    ['--kb-fg', 'var(--kb-neutral-12)'],
    ['--kb-muted', 'var(--kb-neutral-3)'],
    ['--kb-border', tv.surfaceBorder],
    ['--kb-page-bg', tv.pageBg],
    ['--kb-surface-bg', tv.surfaceBg],
    ['--kb-sidebar-bg', tv.sidebarBg],
    ['--kb-content-bg', tv.contentBg],
    ['--kb-border-weight', tv.borderWeight],
    ['--kb-heading-scale', tv.headingScale],
  ]
  return decls.map(([k, v]) => `${k}: ${v};`).join(' ')
}

function scaleDecls(
  prefix: string,
  scale: FamilyScale,
  mode: KBMode,
  opts: { override9?: string } = {}
): Array<[string, string]> {
  const colors = mode === 'dark' ? scale.dark : scale.light
  const contrasts = mode === 'dark' ? scale.contrastDark : scale.contrastLight
  const out: Array<[string, string]> = []
  for (let i = 0; i < 12; i++) {
    const step = i + 1
    const value = step === 9 && opts.override9 ? opts.override9 : colors[i]
    out.push([`${prefix}-${step}`, value])
    out.push([`${prefix}-contrast-${step}`, contrasts[i]])
  }
  return out
}

function escapeAttr(value: string): string {
  return value.replace(/["\\<>]/g, '')
}
