// apps/homepage/src/app/free-tools/shader-gradient-preview/_components/shader-preview.tsx
'use client'

import { GRADIENT_PALETTES, type GradientPaletteName } from '@auxx/ui/components/gradient-palettes'
import {
  DEFAULT_UNIFORMS,
  SHADER_PRESETS,
  type ShaderGradientPreset,
  type ShaderUniforms,
} from '@auxx/ui/components/shader-gradient-presets'
import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'

const ShaderGradient = dynamic(
  () => import('@auxx/ui/components/shader-gradient').then((m) => m.ShaderGradient),
  { ssr: false }
)

const PRESETS: ShaderGradientPreset[] = ['hero', 'ambient', 'aurora', 'liquid', 'static']
const PALETTES = Object.keys(GRADIENT_PALETTES) as GradientPaletteName[]
const ASPECTS = [
  { label: '16:9', value: 'aspect-video' },
  { label: '21:9', value: 'aspect-[21/9]' },
  { label: '1:1', value: 'aspect-square' },
  { label: '9:16', value: 'aspect-[9/16]' },
] as const

export function ShaderPreview() {
  const [preset, setPreset] = useState<ShaderGradientPreset>('hero')
  const [palette, setPalette] = useState<GradientPaletteName>('dusk')
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number]['value']>('aspect-video')
  const [animated, setAnimated] = useState(true)
  const [grain, setGrain] = useState<number | null>(null)
  const [grainScale, setGrainScale] = useState<number | null>(null)
  const [grainAnimated, setGrainAnimated] = useState<boolean | null>(null)
  const [showAllPresets, setShowAllPresets] = useState(false)

  // Show what the resolved uniforms look like, so we can copy values back into
  // the presets file once they look right.
  const resolved = useMemo<ShaderUniforms>(() => {
    const overrides: Partial<ShaderUniforms> = {}
    if (grain !== null) overrides.grainAmount = grain
    if (grainScale !== null) overrides.grainScale = grainScale
    if (grainAnimated !== null) overrides.grainAnimated = grainAnimated
    return { ...DEFAULT_UNIFORMS, ...SHADER_PRESETS[preset], ...overrides }
  }, [preset, grain, grainScale, grainAnimated])

  return (
    <div className='space-y-4'>
      <div className='grid gap-4 lg:grid-cols-[320px_1fr]'>
        <div className='space-y-4 rounded-xl border border-border bg-card p-4'>
          <Field label='Preset'>
            <div className='grid grid-cols-3 gap-1 rounded-md border border-border bg-background p-1'>
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type='button'
                  onClick={() => setPreset(p)}
                  className={btn(preset === p)}>
                  {p}
                </button>
              ))}
            </div>
          </Field>

          <Field label='Palette'>
            <div className='grid grid-cols-2 gap-1.5'>
              {PALETTES.map((name) => (
                <button
                  key={name}
                  type='button'
                  onClick={() => setPalette(name)}
                  className={`group flex flex-col overflow-hidden rounded-md border text-left transition-all ${palette === name ? 'border-foreground ring-2 ring-foreground/20' : 'border-border hover:border-foreground/40'}`}>
                  <div className='flex h-6 w-full'>
                    {GRADIENT_PALETTES[name].map((c, i) => (
                      <div key={`${name}-${i}`} className='flex-1' style={{ backgroundColor: c }} />
                    ))}
                  </div>
                  <span className='px-1.5 py-0.5 text-[10px] font-medium capitalize'>{name}</span>
                </button>
              ))}
            </div>
          </Field>

          <Field label='Aspect'>
            <div className='grid grid-cols-4 gap-1 rounded-md border border-border bg-background p-1'>
              {ASPECTS.map((a) => (
                <button
                  key={a.value}
                  type='button'
                  onClick={() => setAspect(a.value)}
                  className={btn(aspect === a.value)}>
                  {a.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label='Animation'>
            <label className='flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2'>
              <span className='text-xs font-medium'>Animated</span>
              <input
                type='checkbox'
                checked={animated}
                onChange={(e) => setAnimated(e.target.checked)}
                className='size-4 cursor-pointer accent-foreground'
              />
            </label>
          </Field>

          <Slider
            label={`grain (preset: ${SHADER_PRESETS[preset].grainAmount?.toFixed(2) ?? DEFAULT_UNIFORMS.grainAmount})`}
            value={grain ?? SHADER_PRESETS[preset].grainAmount ?? DEFAULT_UNIFORMS.grainAmount}
            min={0}
            max={0.5}
            step={0.01}
            onChange={(v) => setGrain(v)}
            onReset={() => setGrain(null)}
          />
          <Slider
            label={`grainScale (preset: ${SHADER_PRESETS[preset].grainScale?.toFixed(2) ?? DEFAULT_UNIFORMS.grainScale})`}
            value={grainScale ?? SHADER_PRESETS[preset].grainScale ?? DEFAULT_UNIFORMS.grainScale}
            min={0.5}
            max={6}
            step={0.1}
            onChange={(v) => setGrainScale(v)}
            onReset={() => setGrainScale(null)}
          />
          <Field label='grainAnimated'>
            <div className='flex gap-2'>
              <button
                type='button'
                onClick={() => setGrainAnimated(true)}
                className={btn(
                  (grainAnimated ?? SHADER_PRESETS[preset].grainAnimated ?? false) === true
                )}>
                on
              </button>
              <button
                type='button'
                onClick={() => setGrainAnimated(false)}
                className={btn(
                  (grainAnimated ?? SHADER_PRESETS[preset].grainAnimated ?? false) === false
                )}>
                off
              </button>
              <button
                type='button'
                onClick={() => setGrainAnimated(null)}
                className='rounded-sm border border-dashed border-border px-2 py-1 text-xs text-muted-foreground'>
                reset
              </button>
            </div>
          </Field>

          <div>
            <button
              type='button'
              onClick={() => setShowAllPresets((s) => !s)}
              className='text-xs text-muted-foreground underline'>
              {showAllPresets ? 'Hide' : 'Show'} side-by-side preset comparison
            </button>
          </div>

          <details className='rounded-md border border-border bg-background p-2 text-xs'>
            <summary className='cursor-pointer font-medium'>Resolved uniforms</summary>
            <pre className='mt-2 overflow-auto text-[10px] leading-relaxed'>
              {JSON.stringify(resolved, null, 2)}
            </pre>
          </details>
        </div>

        <div
          className={`relative w-full overflow-hidden rounded-xl border border-border ${aspect}`}>
          <ShaderGradient
            preset={preset}
            palette={palette}
            animated={animated}
            grain={grain ?? undefined}
            grainScale={grainScale ?? undefined}
            grainAnimated={grainAnimated ?? undefined}
          />
        </div>
      </div>

      {showAllPresets ? (
        <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          {PRESETS.map((p) => (
            <div key={p} className='space-y-1'>
              <div className='text-xs font-medium text-muted-foreground'>{p}</div>
              <div className='relative aspect-video overflow-hidden rounded-lg border border-border'>
                <ShaderGradient preset={p} palette={palette} animated={animated} />
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='space-y-1.5'>
      <label className='block text-xs font-medium'>{label}</label>
      {children}
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  onReset,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  onReset: () => void
}) {
  return (
    <div className='space-y-1'>
      <div className='flex items-center justify-between gap-2'>
        <span className='text-xs font-medium truncate'>{label}</span>
        <span className='font-mono text-[10px] text-muted-foreground'>{value.toFixed(2)}</span>
        <button
          type='button'
          onClick={onReset}
          className='text-[10px] text-muted-foreground underline'>
          reset
        </button>
      </div>
      <input
        type='range'
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className='h-1.5 w-full cursor-pointer accent-foreground'
        aria-label={label}
      />
    </div>
  )
}

function btn(active: boolean): string {
  return `rounded-sm px-2 py-1.5 text-xs font-medium transition-colors ${active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted'}`
}
