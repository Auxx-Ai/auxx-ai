// apps/web/src/components/agents/ui/detail/setup/setup-progress-bar.tsx
'use client'

interface SetupProgressBarProps {
  /** Completeness 0..1. */
  value: number
}

/**
 * Horizontal progress rail with a grid texture, a hue-rotating gradient that
 * fills with progress, and a bright scan glow at the leading edge.
 */
export function SetupProgressBar({ value }: SetupProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, value))
  const pct = clamped * 100

  return (
    <div className='relative h-20 w-80 overflow-hidden'>
      {/* Grid overlay — light */}
      <div
        className='absolute inset-0 z-10 opacity-30 mask-x-from-60% mask-x-to-100% mask-y-from-60% mask-y-to-100% dark:hidden'
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(0,0,0,0.4) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.4) 1px, transparent 1px)',
          backgroundSize: '5px 5px',
        }}
      />
      {/* Grid overlay — dark */}
      <div
        className='absolute inset-0 z-10 hidden opacity-20 mask-x-from-60% mask-x-to-100% mask-y-from-60% mask-y-to-100% dark:block'
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.2) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.2) 1px, transparent 1px)',
          backgroundSize: '5px 5px',
        }}
      />

      {/* Filled portion — psychedelic gradient revealed up to pct */}
      <div
        className='absolute inset-y-2 left-0 overflow-hidden mask-r-from-85% mask-r-to-100% mask-l-from-90% mask-l-to-100% mask-t-from-40% mask-t-to-100% mask-b-from-40% mask-b-to-100% transition-[width] duration-700 ease-out'
        style={{ width: `${pct}%` }}>
        <div className='animate-scan-x absolute -inset-x-6 inset-y-0 opacity-80 blur-lg dark:opacity-50'>
          <div className='bg-linear-to-r/increasing animate-hue-rotate absolute inset-0 rounded-full from-pink-300 to-indigo-300' />
        </div>
      </div>

      {/* Leading-edge scan glow */}
      <div
        className='pointer-events-none absolute inset-y-2 z-20 w-6 -translate-x-1/2 transition-[left] duration-700 ease-out'
        style={{ left: `${pct}%` }}>
        <div className='absolute inset-y-0 m-auto h-full w-1.5 rounded-full bg-white/70 blur-md' />
      </div>
    </div>
  )
}
