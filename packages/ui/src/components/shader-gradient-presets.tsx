// packages/ui/src/components/shader-gradient-presets.tsx
// Preset uniform bundles for <ShaderGradient />. Server-importable so consumers
// can read them without pulling the WebGL component into the RSC graph.

export type ShaderGradientPreset = 'hero' | 'ambient' | 'aurora' | 'liquid' | 'static'

export interface ShaderUniforms {
  timeSpeed: number
  colorBalance: number
  warpStrength: number
  warpFrequency: number
  warpSpeed: number
  warpAmplitude: number
  blendAngle: number
  blendSoftness: number
  rotationAmount: number
  noiseScale: number
  grainAmount: number
  grainScale: number
  grainAnimated: boolean
  contrast: number
  gamma: number
  saturation: number
  centerX: number
  centerY: number
  zoom: number
}

/** Baseline uniforms — every preset is a partial overlay on top of these. */
export const DEFAULT_UNIFORMS: ShaderUniforms = {
  timeSpeed: 0.25,
  colorBalance: 0.0,
  warpStrength: 1.0,
  warpFrequency: 5.0,
  warpSpeed: 2.0,
  warpAmplitude: 50.0,
  blendAngle: 0.0,
  blendSoftness: 0.05,
  rotationAmount: 500.0,
  noiseScale: 2.0,
  grainAmount: 0.1,
  grainScale: 2.0,
  grainAnimated: false,
  contrast: 1.5,
  gamma: 1.0,
  saturation: 1.0,
  centerX: 0.0,
  centerY: 0.0,
  zoom: 0.9,
}

/**
 * Tonality presets — bundle the motion / warp / grain knobs into a vibe.
 *
 * `grainAnimated` is `false` everywhere because the source shader's
 * "animated grain" path regenerates the entire grain pattern per frame
 * (high-frequency twinkle), which fights with the slowly-warping gradient.
 * The reactbits.dev demo also keeps it off. Opt in by passing
 * `grainAnimated` if the twinkle look is wanted.
 */
export const SHADER_PRESETS: Record<ShaderGradientPreset, Partial<ShaderUniforms>> = {
  hero: {
    timeSpeed: 0.25,
    warpStrength: 1.0,
    warpAmplitude: 50,
    grainAmount: 0.12,
    grainScale: 2.0,
    grainAnimated: false,
    contrast: 1.5,
    rotationAmount: 500,
    saturation: 1.0,
  },
  ambient: {
    timeSpeed: 0.05,
    warpStrength: 0.4,
    warpAmplitude: 30,
    grainAmount: 0.05,
    grainScale: 2.5,
    grainAnimated: false,
    contrast: 1.0,
    rotationAmount: 200,
    saturation: 0.9,
  },
  aurora: {
    timeSpeed: 0.4,
    warpStrength: 1.5,
    warpAmplitude: 40,
    grainAmount: 0.09,
    grainScale: 1.8,
    grainAnimated: false,
    contrast: 1.4,
    rotationAmount: 800,
    saturation: 1.1,
    blendAngle: 90,
  },
  liquid: {
    timeSpeed: 0.3,
    warpStrength: 2.0,
    warpAmplitude: 25,
    grainAmount: 0.08,
    grainScale: 1.5,
    grainAnimated: false,
    contrast: 1.3,
    rotationAmount: 600,
    saturation: 1.05,
  },
  static: {
    timeSpeed: 0,
    warpStrength: 1.0,
    warpAmplitude: 50,
    grainAmount: 0.1,
    grainScale: 2.0,
    grainAnimated: false,
    contrast: 1.5,
    rotationAmount: 0,
    saturation: 1.0,
  },
}

export function resolveUniforms(
  preset: ShaderGradientPreset,
  overrides?: Partial<ShaderUniforms>
): ShaderUniforms {
  return { ...DEFAULT_UNIFORMS, ...SHADER_PRESETS[preset], ...overrides }
}
