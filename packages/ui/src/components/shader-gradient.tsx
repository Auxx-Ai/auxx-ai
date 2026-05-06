// packages/ui/src/components/shader-gradient.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Mesh, Program, Renderer, Triangle } from 'ogl'
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { type GradientPaletteName, paletteToShaderColors } from './gradient-palettes'
import {
  DEFAULT_UNIFORMS,
  resolveUniforms,
  SHADER_PRESETS,
  type ShaderGradientPreset,
  type ShaderUniforms,
} from './shader-gradient-presets'

export type { ShaderGradientPreset, ShaderUniforms } from './shader-gradient-presets'

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const vertexShader = /* glsl */ `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const fragmentShader = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uTimeSpeed;
uniform float uColorBalance;
uniform float uWarpStrength;
uniform float uWarpFrequency;
uniform float uWarpSpeed;
uniform float uWarpAmplitude;
uniform float uBlendAngle;
uniform float uBlendSoftness;
uniform float uRotationAmount;
uniform float uNoiseScale;
uniform float uGrainAmount;
uniform float uGrainScale;
uniform float uGrainAnimated;
uniform float uContrast;
uniform float uGamma;
uniform float uSaturation;
uniform vec2 uCenterOffset;
uniform float uZoom;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
out vec4 fragColor;

#define S(a,b,t) smoothstep(a,b,t)
mat2 Rot(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}
vec2 hash(vec2 p){p=vec2(dot(p,vec2(2127.1,81.17)),dot(p,vec2(1269.5,283.37)));return fract(sin(p)*43758.5453);}
float noise(vec2 p){
  vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);
  float n=mix(
    mix(dot(-1.0+2.0*hash(i+vec2(0.0,0.0)),f-vec2(0.0,0.0)),
        dot(-1.0+2.0*hash(i+vec2(1.0,0.0)),f-vec2(1.0,0.0)),u.x),
    mix(dot(-1.0+2.0*hash(i+vec2(0.0,1.0)),f-vec2(0.0,1.0)),
        dot(-1.0+2.0*hash(i+vec2(1.0,1.0)),f-vec2(1.0,1.0)),u.x),
    u.y);
  return 0.5+0.5*n;
}

void mainImage(out vec4 o, vec2 C){
  float t=iTime*uTimeSpeed;
  vec2 uv=C/iResolution.xy;
  float ratio=iResolution.x/iResolution.y;
  vec2 tuv=uv-0.5+uCenterOffset;
  tuv/=max(uZoom,0.001);

  float degree=noise(vec2(t*0.1,tuv.x*tuv.y)*uNoiseScale);
  tuv.y*=1.0/ratio;
  tuv*=Rot(radians((degree-0.5)*uRotationAmount+180.0));
  tuv.y*=ratio;

  float frequency=uWarpFrequency;
  float ws=max(uWarpStrength,0.001);
  float amplitude=uWarpAmplitude/ws;
  float warpTime=t*uWarpSpeed;
  tuv.x+=sin(tuv.y*frequency+warpTime)/amplitude;
  tuv.y+=sin(tuv.x*(frequency*1.5)+warpTime)/(amplitude*0.5);

  vec3 colLav=uColor1;
  vec3 colOrg=uColor2;
  vec3 colDark=uColor3;
  float b=uColorBalance;
  float s=max(uBlendSoftness,0.0);
  mat2 blendRot=Rot(radians(uBlendAngle));
  float blendX=(tuv*blendRot).x;
  float edge0=-0.3-b-s;
  float edge1=0.2-b+s;
  float v0=0.5-b+s;
  float v1=-0.3-b-s;
  vec3 layer1=mix(colDark,colOrg,S(edge0,edge1,blendX));
  vec3 layer2=mix(colOrg,colLav,S(edge0,edge1,blendX));
  vec3 col=mix(layer1,layer2,S(v0,v1,tuv.y));

  vec2 grainUv=uv*max(uGrainScale,0.001);
  if(uGrainAnimated>0.5){grainUv+=vec2(iTime*0.05);}
  float grain=fract(sin(dot(grainUv,vec2(12.9898,78.233)))*43758.5453);
  col+=(grain-0.5)*uGrainAmount;

  col=(col-0.5)*uContrast+0.5;
  float luma=dot(col,vec3(0.2126,0.7152,0.0722));
  col=mix(vec3(luma),col,uSaturation);
  col=pow(max(col,0.0),vec3(1.0/max(uGamma,0.001)));
  col=clamp(col,0.0,1.0);

  o=vec4(col,1.0);
}

void main(){
  vec4 o=vec4(0.0);
  mainImage(o,gl_FragCoord.xy);
  fragColor=o;
}
`

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ShaderGradientProps {
  /** Tonality preset bundle. Default `'hero'`. */
  preset?: ShaderGradientPreset
  /** Pick colors from a named palette. Mutually exclusive with `colors`. */
  palette?: GradientPaletteName
  /** Three explicit hex colors. Mutually exclusive with `palette`. */
  colors?: [string, string, string]
  /**
   * Pause the shader. Always paused when `prefers-reduced-motion: reduce` —
   * in that case we render only the linear-gradient placeholder.
   */
  animated?: boolean

  /** Convenience for the signature feature; alias for `uniforms.grainAmount`. */
  grain?: number
  /** Alias for `uniforms.grainScale`. */
  grainScale?: number
  /** Alias for `uniforms.grainAnimated`. */
  grainAnimated?: boolean

  /** Per-uniform overrides on top of the preset. Wins over `grain*` shorthand. */
  uniforms?: Partial<ShaderUniforms>

  className?: string
  style?: CSSProperties
}

const DEFAULT_PALETTE: GradientPaletteName = 'dusk'

/**
 * Animated WebGL gradient with film-grain texture, powered by `ogl`.
 *
 * Renders an SSR-friendly CSS linear-gradient placeholder; the canvas mounts
 * client-side and fades in once it has its first frame. The shader is paused
 * when offscreen (IntersectionObserver) and when the tab is hidden (Page
 * Visibility API). Honors `prefers-reduced-motion: reduce` by skipping the
 * canvas entirely.
 *
 * Sized by its container — drop into a `position: relative` parent and it
 * fills the box.
 */
export function ShaderGradient({
  preset = 'hero',
  palette,
  colors,
  animated = true,
  grain,
  grainScale,
  grainAnimated,
  uniforms,
  className,
  style,
}: ShaderGradientProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const reducedMotion = usePrefersReducedMotion()
  const shouldAnimate = animated && !reducedMotion

  const resolvedColors = useMemo<[string, string, string]>(() => {
    if (colors) return colors
    return paletteToShaderColors(palette ?? DEFAULT_PALETTE)
  }, [colors, palette])

  const resolvedUniforms = useMemo<ShaderUniforms>(() => {
    const grainOverrides: Partial<ShaderUniforms> = {}
    if (grain !== undefined) grainOverrides.grainAmount = grain
    if (grainScale !== undefined) grainOverrides.grainScale = grainScale
    if (grainAnimated !== undefined) grainOverrides.grainAnimated = grainAnimated
    return resolveUniforms(preset, { ...grainOverrides, ...uniforms })
  }, [preset, grain, grainScale, grainAnimated, uniforms])

  // Live values read by the rAF loop. Updating these does NOT rebuild the
  // GL context (matches the pattern in iridescence.tsx).
  const propsRef = useRef({ uniforms: resolvedUniforms, colors: resolvedColors })
  propsRef.current = { uniforms: resolvedUniforms, colors: resolvedColors }

  const placeholderBackground = useMemo(
    () =>
      `linear-gradient(135deg, ${resolvedColors[0]} 0%, ${resolvedColors[1]} 50%, ${resolvedColors[2]} 100%)`,
    [resolvedColors]
  )

  useEffect(() => {
    if (!shouldAnimate) return
    const container = containerRef.current
    if (!container) return

    let renderer: Renderer
    try {
      renderer = new Renderer({
        webgl: 2,
        alpha: true,
        antialias: false,
        dpr: Math.min(window.devicePixelRatio || 1, 2),
      })
    } catch {
      // No WebGL2 — leave the placeholder visible.
      return
    }

    const gl = renderer.gl
    const canvas = gl.canvas as HTMLCanvasElement
    canvas.classList.add('shader-gradient__canvas')
    container.appendChild(canvas)

    const initial = propsRef.current
    const program = new Program(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new Float32Array([1, 1]) },
        uTimeSpeed: { value: initial.uniforms.timeSpeed },
        uColorBalance: { value: initial.uniforms.colorBalance },
        uWarpStrength: { value: initial.uniforms.warpStrength },
        uWarpFrequency: { value: initial.uniforms.warpFrequency },
        uWarpSpeed: { value: initial.uniforms.warpSpeed },
        uWarpAmplitude: { value: initial.uniforms.warpAmplitude },
        uBlendAngle: { value: initial.uniforms.blendAngle },
        uBlendSoftness: { value: initial.uniforms.blendSoftness },
        uRotationAmount: { value: initial.uniforms.rotationAmount },
        uNoiseScale: { value: initial.uniforms.noiseScale },
        uGrainAmount: { value: initial.uniforms.grainAmount },
        uGrainScale: { value: initial.uniforms.grainScale },
        uGrainAnimated: { value: initial.uniforms.grainAnimated ? 1 : 0 },
        uContrast: { value: initial.uniforms.contrast },
        uGamma: { value: initial.uniforms.gamma },
        uSaturation: { value: initial.uniforms.saturation },
        uCenterOffset: {
          value: new Float32Array([initial.uniforms.centerX, initial.uniforms.centerY]),
        },
        uZoom: { value: initial.uniforms.zoom },
        uColor1: { value: new Float32Array(hexToRgb(initial.colors[0])) },
        uColor2: { value: new Float32Array(hexToRgb(initial.colors[1])) },
        uColor3: { value: new Float32Array(hexToRgb(initial.colors[2])) },
      },
    })

    const geometry = new Triangle(gl)
    const mesh = new Mesh(gl, { geometry, program })

    const setSize = () => {
      const rect = container.getBoundingClientRect()
      const width = Math.max(1, Math.floor(rect.width))
      const height = Math.max(1, Math.floor(rect.height))
      renderer.setSize(width, height)
      const res = program.uniforms.iResolution!.value as Float32Array
      res[0] = gl.drawingBufferWidth
      res[1] = gl.drawingBufferHeight
    }
    const ro = new ResizeObserver(setSize)
    ro.observe(container)
    setSize()

    const writeUniforms = () => {
      const live = propsRef.current.uniforms
      const liveColors = propsRef.current.colors
      program.uniforms.uTimeSpeed!.value = live.timeSpeed
      program.uniforms.uColorBalance!.value = live.colorBalance
      program.uniforms.uWarpStrength!.value = live.warpStrength
      program.uniforms.uWarpFrequency!.value = live.warpFrequency
      program.uniforms.uWarpSpeed!.value = live.warpSpeed
      program.uniforms.uWarpAmplitude!.value = live.warpAmplitude
      program.uniforms.uBlendAngle!.value = live.blendAngle
      program.uniforms.uBlendSoftness!.value = live.blendSoftness
      program.uniforms.uRotationAmount!.value = live.rotationAmount
      program.uniforms.uNoiseScale!.value = live.noiseScale
      program.uniforms.uGrainAmount!.value = live.grainAmount
      program.uniforms.uGrainScale!.value = live.grainScale
      program.uniforms.uGrainAnimated!.value = live.grainAnimated ? 1 : 0
      program.uniforms.uContrast!.value = live.contrast
      program.uniforms.uGamma!.value = live.gamma
      program.uniforms.uSaturation!.value = live.saturation
      const center = program.uniforms.uCenterOffset!.value as Float32Array
      center[0] = live.centerX
      center[1] = live.centerY
      program.uniforms.uZoom!.value = live.zoom
      const c1 = hexToRgb(liveColors[0])
      const c2 = hexToRgb(liveColors[1])
      const c3 = hexToRgb(liveColors[2])
      const u1 = program.uniforms.uColor1!.value as Float32Array
      const u2 = program.uniforms.uColor2!.value as Float32Array
      const u3 = program.uniforms.uColor3!.value as Float32Array
      u1[0] = c1[0]
      u1[1] = c1[1]
      u1[2] = c1[2]
      u2[0] = c2[0]
      u2[1] = c2[1]
      u2[2] = c2[2]
      u3[0] = c3[0]
      u3[1] = c3[1]
      u3[2] = c3[2]
    }

    let raf = 0
    let running = false
    let visible = false
    let pageVisible = !document.hidden
    let firstFrameRendered = false
    const startTime = performance.now()

    const renderFrame = (now: number) => {
      writeUniforms()
      program.uniforms.iTime!.value = (now - startTime) * 0.001
      renderer.render({ scene: mesh })
      if (!firstFrameRendered) {
        firstFrameRendered = true
        canvas.classList.add('shader-gradient__canvas--ready')
      }
    }

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      renderFrame(now)
    }

    const start = () => {
      if (running) return
      running = true
      raf = requestAnimationFrame(loop)
    }
    const stop = () => {
      if (!running) return
      running = false
      cancelAnimationFrame(raf)
    }
    const evalRunning = () => {
      if (visible && pageVisible) start()
      else stop()
    }

    // Render one static frame immediately so the canvas has something while
    // the IntersectionObserver fires its first callback.
    renderFrame(performance.now())

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visible = entry.isIntersecting
        }
        evalRunning()
      },
      { rootMargin: '100px' }
    )
    io.observe(container)

    const onVisibilityChange = () => {
      pageVisible = !document.hidden
      evalRunning()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    const onContextLost = (e: Event) => {
      e.preventDefault()
      stop()
    }
    canvas.addEventListener('webglcontextlost', onContextLost)

    return () => {
      stop()
      io.disconnect()
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      if (canvas.parentNode === container) container.removeChild(canvas)
    }
  }, [shouldAnimate])

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={cn('shader-gradient', className)}
      style={{
        backgroundImage: placeholderBackground,
        ...style,
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!match) return [1, 1, 1]
  return [
    Number.parseInt(match[1]!, 16) / 255,
    Number.parseInt(match[2]!, 16) / 255,
    Number.parseInt(match[3]!, 16) / 255,
  ]
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return reduced
}

// Re-export the presets so consumers can read them without a separate import.
export { DEFAULT_UNIFORMS, SHADER_PRESETS, resolveUniforms }
