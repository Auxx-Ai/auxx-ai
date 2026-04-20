// apps/homepage/src/app/free-tools/mesh-gradient-generator/_components/gradient-studio.tsx
'use client'

import { type GradientMode, MODES } from '@auxx/ui/components/gradient-layers'
import { GRADIENT_PALETTES, type GradientPaletteName } from '@auxx/ui/components/gradient-palettes'
import { RandomGradient } from '@auxx/ui/components/random-gradient'
import { Check, Copy, Dice5, Download, Film, Plus, X } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  downloadBlob,
  downloadText,
  PNG_SIZE_PRESETS,
  type PngSize,
  pickVideoMime,
  toCss,
  toPng,
  toSvg,
  toVideo,
  VIDEO_DURATION_PRESETS,
  VIDEO_SIZE_PRESETS,
  type VideoSize,
} from './export'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const MODE_LIST: GradientMode[] = ['hero', 'ambient', 'mesh', 'openai']
const MODE_LABEL: Record<GradientMode, string> = {
  hero: 'Hero',
  ambient: 'Ambient',
  mesh: 'Mesh',
  openai: 'OpenAI',
}
const MODE_HINT: Record<GradientMode, string> = {
  hero: 'Bold peaks — good for landing heroes',
  ambient: 'Soft washes — good for dashboard backgrounds',
  mesh: 'Many small peaks — most painterly',
  openai: 'Skewed radial scatter — the OpenAI 2020 look',
}

const ASPECT_OPTIONS = [
  { label: '16:9', value: '16/9' as const },
  { label: '1:1', value: '1/1' as const },
  { label: '9:16', value: '9/16' as const },
  { label: '21:9', value: '21/9' as const },
]
type AspectValue = (typeof ASPECT_OPTIONS)[number]['value']

type State = {
  mode: GradientMode
  colors: string[]
  palette: GradientPaletteName | 'custom'
  animated: boolean
  animationDuration: number
  driftAmplitude: number
  blur: number
  layers: number
  seed: number
  aspect: AspectValue
}

type Action =
  | { type: 'SET_MODE'; mode: GradientMode }
  | { type: 'SET_COLOR'; index: number; color: string }
  | { type: 'ADD_COLOR' }
  | { type: 'REMOVE_COLOR'; index: number }
  | { type: 'PICK_PALETTE'; name: GradientPaletteName }
  | { type: 'SET_ANIMATED'; value: boolean }
  | { type: 'SET_ANIMATION_DURATION'; value: number }
  | { type: 'SET_DRIFT'; value: number }
  | { type: 'SET_BLUR'; value: number }
  | { type: 'SET_LAYERS'; value: number }
  | { type: 'SET_SEED'; value: number }
  | { type: 'RANDOMIZE' }
  | { type: 'SET_ASPECT'; value: AspectValue }
  | { type: 'HYDRATE'; state: State }

const DEFAULT_PALETTE: GradientPaletteName = 'openai'

function initialState(): State {
  const mode: GradientMode = 'openai'
  return {
    mode,
    colors: [...GRADIENT_PALETTES[DEFAULT_PALETTE]],
    palette: DEFAULT_PALETTE,
    animated: true,
    animationDuration: MODES[mode].animationDuration,
    driftAmplitude: MODES[mode].driftAmplitude,
    blur: MODES[mode].blur,
    layers: MODES[mode].layers,
    seed: 42,
    aspect: '16/9',
  }
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_MODE': {
      // When switching modes, reset blur / layers / duration / drift to the
      // new mode's defaults so the preset is recognizable. Keeps the palette.
      const modeConfig = MODES[action.mode]
      return {
        ...state,
        mode: action.mode,
        animationDuration: modeConfig.animationDuration,
        driftAmplitude: modeConfig.driftAmplitude,
        blur: modeConfig.blur,
        layers: modeConfig.layers,
      }
    }
    case 'SET_COLOR': {
      const colors = state.colors.slice()
      colors[action.index] = action.color
      return { ...state, colors, palette: 'custom' }
    }
    case 'ADD_COLOR': {
      if (state.colors.length >= 8) return state
      const last = state.colors[state.colors.length - 1] ?? '#ffffff'
      return { ...state, colors: [...state.colors, last], palette: 'custom' }
    }
    case 'REMOVE_COLOR': {
      if (state.colors.length <= 2) return state
      const colors = state.colors.filter((_, i) => i !== action.index)
      return { ...state, colors, palette: 'custom' }
    }
    case 'PICK_PALETTE': {
      return {
        ...state,
        palette: action.name,
        colors: [...GRADIENT_PALETTES[action.name]],
      }
    }
    case 'SET_ANIMATED':
      return { ...state, animated: action.value }
    case 'SET_ANIMATION_DURATION':
      return { ...state, animationDuration: action.value }
    case 'SET_DRIFT':
      return { ...state, driftAmplitude: action.value }
    case 'SET_BLUR':
      return { ...state, blur: action.value }
    case 'SET_LAYERS':
      return { ...state, layers: action.value }
    case 'SET_SEED':
      return { ...state, seed: action.value }
    case 'RANDOMIZE': {
      const newSeed = Math.floor(Math.random() * 2_147_483_647)
      // Roll a random palette only if the user hasn't customized colors.
      if (state.palette !== 'custom') {
        const names = Object.keys(GRADIENT_PALETTES) as GradientPaletteName[]
        const next = names[Math.floor(Math.random() * names.length)] ?? DEFAULT_PALETTE
        return { ...state, seed: newSeed, palette: next, colors: [...GRADIENT_PALETTES[next]] }
      }
      return { ...state, seed: newSeed }
    }
    case 'SET_ASPECT':
      return { ...state, aspect: action.value }
    case 'HYDRATE':
      return action.state
  }
}

// ---------------------------------------------------------------------------
// URL state sync
// ---------------------------------------------------------------------------

function encodeState(state: State): string {
  const params = new URLSearchParams()
  params.set('m', state.mode)
  params.set('c', state.colors.join(','))
  params.set('a', state.animated ? '1' : '0')
  params.set('ad', state.animationDuration.toString())
  params.set('dr', state.driftAmplitude.toString())
  params.set('b', state.blur.toString())
  params.set('l', state.layers.toString())
  params.set('s', state.seed.toString())
  params.set('r', state.aspect)
  if (state.palette !== 'custom') params.set('p', state.palette)
  return params.toString()
}

function decodeState(params: URLSearchParams, base: State): State | null {
  const mode = params.get('m') as GradientMode | null
  if (!mode || !MODE_LIST.includes(mode)) return null
  const colorsRaw = params.get('c')
  const colors = colorsRaw
    ? colorsRaw.split(',').filter((c) => /^#[0-9a-fA-F]{3,8}$/.test(c))
    : null
  if (!colors || colors.length < 2 || colors.length > 8) return null
  const palette = params.get('p') as GradientPaletteName | null
  const aspect = params.get('r') as AspectValue | null
  const validAspect =
    aspect && ASPECT_OPTIONS.some((o) => o.value === aspect) ? aspect : base.aspect
  return {
    mode,
    colors,
    palette: palette && palette in GRADIENT_PALETTES ? palette : 'custom',
    animated: params.get('a') === '1',
    animationDuration: Number(params.get('ad')) || base.animationDuration,
    driftAmplitude: Number(params.get('dr')) || base.driftAmplitude,
    blur: Number(params.get('b')) || base.blur,
    layers: Number(params.get('l')) || base.layers,
    seed: Number(params.get('s')) || base.seed,
    aspect: validAspect,
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GradientStudio() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const hydratedRef = useRef(false)

  // Hydrate from URL once on mount.
  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    const decoded = decodeState(searchParams, initialState())
    if (decoded) dispatch({ type: 'HYDRATE', state: decoded })
  }, [searchParams])

  // Debounced URL replace on state change.
  useEffect(() => {
    if (!hydratedRef.current) return
    const t = setTimeout(() => {
      const qs = encodeState(state)
      router.replace(`${pathname}?${qs}`, { scroll: false })
    }, 200)
    return () => clearTimeout(t)
  }, [state, pathname, router])

  // Spacebar = randomize (when focus is not in an input).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      e.preventDefault()
      dispatch({ type: 'RANDOMIZE' })
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const aspectClass = useMemo(() => {
    if (state.aspect === '16/9') return 'aspect-video'
    if (state.aspect === '1/1') return 'aspect-square'
    if (state.aspect === '9/16') return 'aspect-[9/16]'
    return 'aspect-[21/9]'
  }, [state.aspect])

  const isOpenAI = state.mode === 'openai'

  return (
    <div className='grid gap-6 lg:grid-cols-[380px_1fr]'>
      <ControlsPanel state={state} dispatch={dispatch} />
      <div className='space-y-4'>
        <PreviewPanel state={state} aspectClass={aspectClass} />
        <ExportBar state={state} isOpenAI={isOpenAI} />
        <ShareBar state={state} pathname={pathname} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Controls panel
// ---------------------------------------------------------------------------

function ControlsPanel({ state, dispatch }: { state: State; dispatch: React.Dispatch<Action> }) {
  return (
    <div className='space-y-5 rounded-xl border border-border bg-card p-5 shadow-sm lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto'>
      <div className='flex items-center justify-between'>
        <h2 className='text-sm font-semibold'>Controls</h2>
        <button
          type='button'
          onClick={() => dispatch({ type: 'RANDOMIZE' })}
          className='inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted'
          aria-label='Randomize (space)'
          title='Randomize (space)'>
          <Dice5 className='size-3.5' />
          Randomize
        </button>
      </div>

      <Field label='Mode'>
        <div className='grid grid-cols-4 gap-1 rounded-md border border-border bg-background p-1'>
          {MODE_LIST.map((m) => (
            <button
              key={m}
              type='button'
              onClick={() => dispatch({ type: 'SET_MODE', mode: m })}
              className={cn(
                'rounded-sm px-2 py-1.5 text-xs font-medium transition-colors',
                state.mode === m
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted'
              )}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <p className='mt-1.5 text-xs text-muted-foreground'>{MODE_HINT[state.mode]}</p>
      </Field>

      <Field label='Palette'>
        <div className='grid grid-cols-3 gap-1.5'>
          {(Object.keys(GRADIENT_PALETTES) as GradientPaletteName[]).map((name) => (
            <button
              key={name}
              type='button'
              onClick={() => dispatch({ type: 'PICK_PALETTE', name })}
              className={cn(
                'group flex flex-col overflow-hidden rounded-md border text-left transition-all',
                state.palette === name
                  ? 'border-foreground ring-2 ring-foreground/20'
                  : 'border-border hover:border-foreground/40'
              )}>
              <div className='flex h-8 w-full'>
                {GRADIENT_PALETTES[name].map((c, i) => (
                  <div key={`${name}-${i}`} className='flex-1' style={{ backgroundColor: c }} />
                ))}
              </div>
              <span className='px-1.5 py-1 text-[10px] font-medium capitalize'>{name}</span>
            </button>
          ))}
        </div>
        {state.palette === 'custom' ? (
          <p className='mt-1.5 text-xs text-muted-foreground'>Custom palette</p>
        ) : null}
      </Field>

      <Field
        label={`Colors (${state.colors.length})`}
        hint='First color is the background. Remaining colors form the peak palette.'>
        <div className='space-y-1.5'>
          {state.colors.map((c, i) => (
            <div key={i} className='flex items-center gap-2'>
              <label className='relative block size-8 shrink-0 overflow-hidden rounded-md border border-border'>
                <input
                  type='color'
                  value={c}
                  onChange={(e) => dispatch({ type: 'SET_COLOR', index: i, color: e.target.value })}
                  className='absolute inset-0 size-full cursor-pointer opacity-0'
                  aria-label={i === 0 ? 'Background color' : `Peak color ${i}`}
                />
                <span className='block size-full' style={{ backgroundColor: c }} />
              </label>
              <input
                type='text'
                value={c}
                onChange={(e) => {
                  const v = e.target.value
                  if (/^#[0-9a-fA-F]{0,8}$/.test(v)) {
                    dispatch({ type: 'SET_COLOR', index: i, color: v })
                  }
                }}
                className='h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs font-mono uppercase'
                aria-label={`Hex for color ${i + 1}`}
                maxLength={9}
              />
              <span className='text-[10px] text-muted-foreground w-12'>
                {i === 0 ? 'BG' : `Peak ${i}`}
              </span>
              <button
                type='button'
                onClick={() => dispatch({ type: 'REMOVE_COLOR', index: i })}
                disabled={state.colors.length <= 2}
                className='inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent'
                aria-label={`Remove color ${i + 1}`}>
                <X className='size-3.5' />
              </button>
            </div>
          ))}
          {state.colors.length < 8 ? (
            <button
              type='button'
              onClick={() => dispatch({ type: 'ADD_COLOR' })}
              className='inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground'>
              <Plus className='size-3.5' />
              Add color
            </button>
          ) : null}
        </div>
      </Field>

      <Field label='Animation'>
        <label className='flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2'>
          <span className='text-xs font-medium'>Animated</span>
          <input
            type='checkbox'
            checked={state.animated}
            onChange={(e) => dispatch({ type: 'SET_ANIMATED', value: e.target.checked })}
            className='size-4 cursor-pointer accent-foreground'
          />
        </label>
      </Field>

      <SliderField
        label='Animation duration'
        value={state.animationDuration}
        min={2}
        max={60}
        step={0.5}
        unit='s'
        onChange={(v) => dispatch({ type: 'SET_ANIMATION_DURATION', value: v })}
      />
      <SliderField
        label='Drift amplitude'
        value={state.driftAmplitude}
        min={0}
        max={40}
        step={0.5}
        unit='%'
        onChange={(v) => dispatch({ type: 'SET_DRIFT', value: v })}
      />
      <SliderField
        label='Blur'
        value={state.blur}
        min={0}
        max={120}
        step={1}
        unit='px'
        onChange={(v) => dispatch({ type: 'SET_BLUR', value: v })}
      />
      <SliderField
        label='Layers'
        value={state.layers}
        min={3}
        max={30}
        step={1}
        onChange={(v) => dispatch({ type: 'SET_LAYERS', value: v })}
      />

      <Field label='Seed'>
        <div className='flex items-center gap-2'>
          <input
            type='number'
            value={state.seed}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (!Number.isNaN(v)) dispatch({ type: 'SET_SEED', value: v })
            }}
            className='h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs font-mono'
            aria-label='Random seed'
          />
          <button
            type='button'
            onClick={() =>
              dispatch({ type: 'SET_SEED', value: Math.floor(Math.random() * 2_147_483_647) })
            }
            className='inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs transition-colors hover:bg-muted'
            aria-label='New seed'>
            <Dice5 className='size-3.5' />
          </button>
        </div>
      </Field>

      <Field label='Preview aspect'>
        <div className='grid grid-cols-4 gap-1 rounded-md border border-border bg-background p-1'>
          {ASPECT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type='button'
              onClick={() => dispatch({ type: 'SET_ASPECT', value: opt.value })}
              className={cn(
                'rounded-sm px-2 py-1 text-xs font-medium transition-colors',
                state.aspect === opt.value
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted'
              )}>
              {opt.label}
            </button>
          ))}
        </div>
      </Field>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Preview panel
// ---------------------------------------------------------------------------

function PreviewPanel({ state, aspectClass }: { state: State; aspectClass: string }) {
  return (
    <div
      className={cn(
        'relative w-full overflow-hidden rounded-xl border border-border bg-black shadow-lg',
        aspectClass
      )}>
      <RandomGradient
        colors={state.colors}
        mode={state.mode}
        seed={state.seed}
        layers={state.layers}
        animated={state.animated}
        blur={state.blur}
        animationDuration={state.animationDuration}
        driftAmplitude={state.driftAmplitude}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Export bar
// ---------------------------------------------------------------------------

function ExportBar({ state, isOpenAI }: { state: State; isOpenAI: boolean }) {
  const [copiedFormat, setCopiedFormat] = useState<'css' | 'svg' | null>(null)
  const [pngSizeIdx, setPngSizeIdx] = useState(0)
  const [busy, setBusy] = useState(false)
  const [videoSizeIdx, setVideoSizeIdx] = useState(0)
  const [videoDuration, setVideoDuration] = useState(10)
  const [videoProgress, setVideoProgress] = useState<number | null>(null)
  const videoAbortRef = useRef<AbortController | null>(null)
  const videoMime = useMemo(() => (typeof window !== 'undefined' ? pickVideoMime() : null), [])

  const copy = useCallback(async (format: 'css' | 'svg', text: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedFormat(format)
    setTimeout(() => setCopiedFormat(null), 1500)
  }, [])

  const onCopyCss = () => {
    try {
      copy('css', toCss(state))
    } catch (e) {
      console.error(e)
    }
  }
  const onCopySvg = () => copy('svg', toSvg(state))
  const onDownloadCss = () => {
    try {
      downloadText(toCss(state), `mesh-gradient-${state.seed}.css`, 'text/css')
    } catch (e) {
      console.error(e)
    }
  }
  const onDownloadSvg = () => {
    downloadText(toSvg(state), `mesh-gradient-${state.seed}.svg`, 'image/svg+xml')
  }
  const onDownloadPng = async () => {
    setBusy(true)
    try {
      const size = PNG_SIZE_PRESETS[pngSizeIdx]?.size as PngSize
      const blob = await toPng(state, size)
      downloadBlob(blob, `mesh-gradient-${state.seed}.png`)
    } catch (e) {
      console.error(e)
    } finally {
      setBusy(false)
    }
  }

  const onDownloadVideo = async () => {
    if (videoProgress !== null) return
    const size = VIDEO_SIZE_PRESETS[videoSizeIdx]?.size as VideoSize
    const abort = new AbortController()
    videoAbortRef.current = abort
    setVideoProgress(0)
    try {
      const { blob, mime } = await toVideo(state, {
        size,
        durationSeconds: videoDuration,
        signal: abort.signal,
        onProgress: (p) => setVideoProgress(p.progress),
      })
      downloadBlob(blob, `mesh-gradient-${state.seed}.${mime.ext}`)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') console.error(e)
    } finally {
      setVideoProgress(null)
      videoAbortRef.current = null
    }
  }

  const onCancelVideo = () => {
    videoAbortRef.current?.abort()
  }

  const videoBusy = videoProgress !== null

  return (
    <div className='space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm'>
      <div className='flex items-center justify-between'>
        <h2 className='text-sm font-semibold'>Export</h2>
        <span className='text-xs text-muted-foreground'>
          {state.animated ? 'PNG exports as a still frame' : 'Static export'}
        </span>
      </div>

      <div className='grid gap-3 sm:grid-cols-3'>
        <div className='space-y-1.5'>
          <div className='flex items-center justify-between'>
            <span className='text-xs font-medium'>CSS</span>
            {isOpenAI ? (
              <span
                className='text-[10px] text-muted-foreground'
                title='CSS cannot express skewX on a radial-gradient focal point. Switch to hero / ambient / mesh for CSS export.'>
                N/A for OpenAI
              </span>
            ) : null}
          </div>
          <div className='flex gap-1.5'>
            <Button
              variant='outline'
              size='sm'
              onClick={onCopyCss}
              disabled={isOpenAI}
              className='flex-1'>
              {copiedFormat === 'css' ? (
                <>
                  <Check className='size-3.5' /> Copied
                </>
              ) : (
                <>
                  <Copy className='size-3.5' /> Copy
                </>
              )}
            </Button>
            <Button
              variant='outline'
              size='sm'
              onClick={onDownloadCss}
              disabled={isOpenAI}
              aria-label='Download CSS'>
              <Download className='size-3.5' />
            </Button>
          </div>
        </div>

        <div className='space-y-1.5'>
          <span className='text-xs font-medium'>SVG</span>
          <div className='flex gap-1.5'>
            <Button variant='outline' size='sm' onClick={onCopySvg} className='flex-1'>
              {copiedFormat === 'svg' ? (
                <>
                  <Check className='size-3.5' /> Copied
                </>
              ) : (
                <>
                  <Copy className='size-3.5' /> Copy
                </>
              )}
            </Button>
            <Button variant='outline' size='sm' onClick={onDownloadSvg} aria-label='Download SVG'>
              <Download className='size-3.5' />
            </Button>
          </div>
        </div>

        <div className='space-y-1.5'>
          <span className='text-xs font-medium'>PNG</span>
          <div className='flex gap-1.5'>
            <select
              value={pngSizeIdx}
              onChange={(e) => setPngSizeIdx(Number(e.target.value))}
              className='h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs'
              aria-label='PNG size preset'>
              {PNG_SIZE_PRESETS.map((p, i) => (
                <option key={p.label} value={i}>
                  {p.label}
                </option>
              ))}
            </select>
            <Button
              variant='outline'
              size='sm'
              onClick={onDownloadPng}
              disabled={busy}
              aria-label='Download PNG'>
              <Download className='size-3.5' />
            </Button>
          </div>
        </div>
      </div>

      <div className='space-y-2 border-t border-border pt-3'>
        <div className='flex items-center justify-between'>
          <span className='text-xs font-medium inline-flex items-center gap-1.5'>
            <Film className='size-3.5' /> Video
            {videoMime ? (
              <span className='text-[10px] font-normal text-muted-foreground'>
                ({videoMime.label})
              </span>
            ) : null}
          </span>
          {!state.animated ? (
            <span className='text-[10px] text-muted-foreground'>Enable animation for video</span>
          ) : null}
        </div>
        <div className='grid gap-2 sm:grid-cols-[1fr_120px_auto]'>
          <select
            value={videoSizeIdx}
            onChange={(e) => setVideoSizeIdx(Number(e.target.value))}
            disabled={videoBusy}
            className='h-8 rounded-md border border-border bg-background px-2 text-xs'
            aria-label='Video size preset'>
            {VIDEO_SIZE_PRESETS.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            value={videoDuration}
            onChange={(e) => setVideoDuration(Number(e.target.value))}
            disabled={videoBusy}
            className='h-8 rounded-md border border-border bg-background px-2 text-xs'
            aria-label='Video duration'>
            {VIDEO_DURATION_PRESETS.map((d) => (
              <option key={d} value={d}>
                {d}s
              </option>
            ))}
          </select>
          {videoBusy ? (
            <Button variant='outline' size='sm' onClick={onCancelVideo}>
              <X className='size-3.5' /> Cancel
            </Button>
          ) : (
            <Button
              variant='outline'
              size='sm'
              onClick={onDownloadVideo}
              disabled={!state.animated}
              aria-label='Download video'>
              <Download className='size-3.5' /> Record
            </Button>
          )}
        </div>
        {videoBusy ? (
          <div className='space-y-1'>
            <div className='h-1 w-full overflow-hidden rounded-full bg-muted'>
              <div
                className='h-full bg-foreground transition-[width] duration-200'
                style={{ width: `${Math.round((videoProgress ?? 0) * 100)}%` }}
              />
            </div>
            <p className='text-[10px] text-muted-foreground'>
              Recording at {Math.round((videoProgress ?? 0) * 100)}% — this runs in real time, so a{' '}
              {videoDuration}s video takes ~{videoDuration}s to capture.
            </p>
          </div>
        ) : (
          <p className='text-[10px] text-muted-foreground'>
            Records in real time — a {videoDuration}s clip takes ~{videoDuration}s to produce. No
            upload, renders locally.
          </p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Share bar
// ---------------------------------------------------------------------------

function ShareBar({ state, pathname }: { state: State; pathname: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = useCallback(async () => {
    const url = `${window.location.origin}${pathname}?${encodeState(state)}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [state, pathname])
  return (
    <div className='flex items-center justify-between rounded-xl border border-border bg-card p-4 text-sm shadow-sm'>
      <div>
        <div className='font-medium'>Share this gradient</div>
        <p className='text-xs text-muted-foreground'>
          The URL contains your full config. Anyone who opens it sees the same gradient.
        </p>
      </div>
      <Button variant='outline' size='sm' onClick={onCopy}>
        {copied ? (
          <>
            <Check className='size-3.5' /> Copied
          </>
        ) : (
          <>
            <Copy className='size-3.5' /> Copy link
          </>
        )}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className='space-y-1.5'>
      <label className='block text-xs font-medium'>{label}</label>
      {children}
      {hint ? <p className='text-[10px] text-muted-foreground'>{hint}</p> : null}
    </div>
  )
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
}) {
  return (
    <div className='space-y-1'>
      <div className='flex items-center justify-between'>
        <span className='text-xs font-medium'>{label}</span>
        <span className='text-xs font-mono text-muted-foreground'>
          {value.toFixed(step < 1 ? 1 : 0)}
          {unit}
        </span>
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
