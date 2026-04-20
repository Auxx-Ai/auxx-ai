// packages/ui/src/components/gradient-palettes.tsx
// Non-client module so server components can read palette values directly.
// The RandomGradient component is client-only; importing palettes from there
// turns them into RSC client references, which are not iterable.

/**
 * Curated color palettes for `<RandomGradient>`. First color is the background,
 * remaining colors form the peak palette.
 */
export const GRADIENT_PALETTES = {
  pastel: ['#f8fafc', '#ddd6fe', '#f9a8d4', '#fbbf24'],
  sunset: ['#1a0b2e', '#ff6b9d', '#c44569', '#f8b500'],
  ocean: ['#0b132b', '#1c7ed6', '#22d3ee', '#a7f3d0'],
  dusk: ['#0b0b12', '#6366f1', '#ec4899', '#f59e0b'],
  aurora: ['#0f172a', '#34d399', '#60a5fa', '#c084fc'],
  candy: ['#fef3c7', '#fbcfe8', '#c7d2fe', '#99f6e4'],
  dawn: ['#d9d6e3', '#f5c59a', '#d98c80', '#8a5e6e'],
  meadow: ['#3a4028', '#7a4bd2', '#e8d93c', '#b8c84b'],
  blossom: ['#efe1dc', '#e8a8b5', '#b8d4d6', '#d38870'],
  twilight: ['#2d3f5e', '#7a95b8', '#f29070', '#f5b5b0'],
  openai: ['#5135FF', '#FF5828', '#F69CFF', '#FFA50F'],
  orchid: ['#FE69B7', '#BC0A6F', '#E6E6FA', '#6495ED'],
} as const satisfies Record<string, readonly string[]>

export type GradientPaletteName = keyof typeof GRADIENT_PALETTES

export type GradientPaletteMode = 'dark' | 'light'

/**
 * Whether each palette's background is dark (use light text) or light
 * (use dark text). Consumers flip their foreground color based on this.
 */
export const GRADIENT_PALETTE_MODES: Record<GradientPaletteName, GradientPaletteMode> = {
  pastel: 'light',
  sunset: 'dark',
  ocean: 'dark',
  dusk: 'dark',
  aurora: 'dark',
  candy: 'light',
  dawn: 'light',
  meadow: 'dark',
  blossom: 'light',
  twilight: 'dark',
  openai: 'dark',
  orchid: 'light',
}
