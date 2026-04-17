// apps/homepage/src/app/free-tools/first-response-time-calculator/_components/frt-calculator.tsx
'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'

type Mode = 'paste' | 'estimate'
type Channel = 'email' | 'chat' | 'social'

type ParsedResult = {
  validCount: number
  skipped: number
  deltaMinutes: number[]
}

function parseTimestamp(raw: string): Date | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const direct = new Date(trimmed)
  if (!Number.isNaN(direct.getTime())) return direct
  const withT = new Date(trimmed.replace(' ', 'T'))
  if (!Number.isNaN(withT.getTime())) return withT
  return null
}

function parsePaste(raw: string): ParsedResult {
  const lines = raw.split('\n').slice(0, 1000)
  const deltaMinutes: number[] = []
  let skipped = 0

  for (const line of lines) {
    if (!line.trim()) continue
    const parts = line.split(/,|\t|;/)
    if (parts.length < 2) {
      skipped++
      continue
    }
    const [rawA, rawB] = parts
    const a = parseTimestamp(rawA)
    const b = parseTimestamp(rawB)
    if (!a || !b) {
      skipped++
      continue
    }
    const deltaMs = Math.abs(b.getTime() - a.getTime())
    deltaMinutes.push(deltaMs / 60_000)
  }

  return { validCount: deltaMinutes.length, skipped, deltaMinutes }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${Math.round(mins)} min`
  if (mins < 1440) return `${(mins / 60).toFixed(1)} hr`
  return `${(mins / 1440).toFixed(1)} days`
}

type Stats = {
  mean: number
  median: number
  p90: number
  p95: number
  p99: number
  buckets: { label: string; count: number }[]
}

function computeStats(deltaMinutes: number[]): Stats {
  const sorted = [...deltaMinutes].sort((a, b) => a - b)
  const sum = sorted.reduce((s, v) => s + v, 0)
  const mean = sorted.length ? sum / sorted.length : 0

  const buckets = [
    { label: '< 15 min', count: 0 },
    { label: '15–60 min', count: 0 },
    { label: '1–4 hr', count: 0 },
    { label: '4–24 hr', count: 0 },
    { label: '> 24 hr', count: 0 },
  ]
  for (const m of sorted) {
    if (m < 15) buckets[0].count++
    else if (m < 60) buckets[1].count++
    else if (m < 240) buckets[2].count++
    else if (m < 1440) buckets[3].count++
    else buckets[4].count++
  }

  return {
    mean,
    median: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    buckets,
  }
}

type Tier = { name: string; maxMinutes: number; color: string }
const BENCHMARKS: Record<Channel, Tier[]> = {
  email: [
    { name: 'Excellent', maxMinutes: 60, color: 'text-emerald-600 dark:text-emerald-400' },
    { name: 'Good', maxMinutes: 240, color: 'text-emerald-600 dark:text-emerald-400' },
    { name: 'Average', maxMinutes: 720, color: 'text-amber-600 dark:text-amber-400' },
    { name: 'Slow', maxMinutes: Number.POSITIVE_INFINITY, color: 'text-red-600 dark:text-red-400' },
  ],
  chat: [
    { name: 'Excellent', maxMinutes: 1, color: 'text-emerald-600 dark:text-emerald-400' },
    { name: 'Good', maxMinutes: 5, color: 'text-emerald-600 dark:text-emerald-400' },
    { name: 'Average', maxMinutes: 15, color: 'text-amber-600 dark:text-amber-400' },
    { name: 'Slow', maxMinutes: Number.POSITIVE_INFINITY, color: 'text-red-600 dark:text-red-400' },
  ],
  social: [
    { name: 'Excellent', maxMinutes: 30, color: 'text-emerald-600 dark:text-emerald-400' },
    { name: 'Good', maxMinutes: 120, color: 'text-emerald-600 dark:text-emerald-400' },
    { name: 'Average', maxMinutes: 720, color: 'text-amber-600 dark:text-amber-400' },
    { name: 'Slow', maxMinutes: Number.POSITIVE_INFINITY, color: 'text-red-600 dark:text-red-400' },
  ],
}

function tierFor(channel: Channel, minutes: number): Tier {
  return BENCHMARKS[channel].find((t) => minutes <= t.maxMinutes) ?? BENCHMARKS[channel][3]
}

function PasteMode({ channel }: { channel: Channel }) {
  const [raw, setRaw] = useState('')
  const [submitted, setSubmitted] = useState('')

  const parsed = useMemo(() => (submitted ? parsePaste(submitted) : null), [submitted])
  const stats = useMemo(() => (parsed ? computeStats(parsed.deltaMinutes) : null), [parsed])

  const maxBucket = stats ? Math.max(1, ...stats.buckets.map((b) => b.count)) : 1
  const medianTier = stats ? tierFor(channel, stats.median) : null

  return (
    <div className='space-y-5'>
      <div className='space-y-2'>
        <label htmlFor='frt-paste' className='text-sm font-medium'>
          Paste ticket timestamps
        </label>
        <p className='text-xs text-muted-foreground'>
          One row per ticket. Two timestamps separated by a comma: customer message, first reply. Up
          to 1,000 rows.
        </p>
        <textarea
          id='frt-paste'
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={
            '2026-04-15 09:12, 2026-04-15 11:45\n2026-04-15 10:03, 2026-04-15 10:08\n...'
          }
          rows={8}
          className='w-full rounded-md border border-input bg-background p-3 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
        />
        <Button type='button' onClick={() => setSubmitted(raw)} disabled={!raw.trim()}>
          Calculate
        </Button>
      </div>

      {parsed && stats ? (
        <div className='space-y-5 rounded-lg border border-border bg-background p-5'>
          <div className='flex flex-wrap items-baseline justify-between gap-2'>
            <p className='text-sm font-medium'>Results</p>
            <p className='text-xs text-muted-foreground'>
              {parsed.validCount} tickets parsed
              {parsed.skipped > 0 ? ` (${parsed.skipped} rows skipped)` : ''}
            </p>
          </div>

          <div className='grid grid-cols-2 gap-3 sm:grid-cols-5'>
            {(
              [
                { label: 'Mean', value: stats.mean },
                { label: 'Median', value: stats.median },
                { label: 'P90', value: stats.p90 },
                { label: 'P95', value: stats.p95 },
                { label: 'P99', value: stats.p99 },
              ] as const
            ).map((s) => (
              <div
                key={s.label}
                className='rounded-md border border-border bg-card p-3 text-center'>
                <p className='text-[10px] uppercase tracking-wider text-muted-foreground'>
                  {s.label}
                </p>
                <p className='mt-1 text-sm font-semibold tabular-nums'>{formatMinutes(s.value)}</p>
              </div>
            ))}
          </div>

          <div className='space-y-2'>
            <p className='text-xs font-medium'>Distribution</p>
            {stats.buckets.map((bucket) => (
              <div key={bucket.label} className='flex items-center gap-3 text-xs'>
                <span className='w-20 shrink-0 text-muted-foreground'>{bucket.label}</span>
                <div className='h-4 flex-1 overflow-hidden rounded bg-muted'>
                  <div
                    className='h-full bg-primary'
                    style={{ width: `${(bucket.count / maxBucket) * 100}%` }}
                  />
                </div>
                <span className='w-10 shrink-0 text-right tabular-nums'>{bucket.count}</span>
              </div>
            ))}
          </div>

          {medianTier ? (
            <div className='rounded-md border border-border bg-muted/30 p-3 text-xs'>
              <p>
                Your median of <strong>{formatMinutes(stats.median)}</strong> is{' '}
                <strong className={medianTier.color}>{medianTier.name.toLowerCase()}</strong> for{' '}
                {channel}. See the benchmark table below for the full tier ranges.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function EstimateMode({ channel }: { channel: Channel }) {
  const [averageMinutes, setAverageMinutes] = useState(180)
  const [_ticketsPerDay, setTicketsPerDay] = useState(50)
  const [_coverageHours, setCoverageHours] = useState(8)

  const tier = tierFor(channel, averageMinutes)
  const slaTargets = [60, 240, 480, 1440]

  return (
    <div className='grid gap-6 md:grid-cols-2'>
      <div className='space-y-5'>
        <div className='space-y-2'>
          <label className='text-sm font-medium'>Average first response time</label>
          <div className='flex items-center gap-2'>
            <input
              type='number'
              min={1}
              value={averageMinutes}
              onChange={(e) => setAverageMinutes(Math.max(1, Number(e.target.value)))}
              className='h-9 w-24 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
            />
            <span className='text-sm text-muted-foreground'>minutes</span>
          </div>
          <p className='text-xs text-muted-foreground'>{formatMinutes(averageMinutes)}</p>
        </div>

        <div className='space-y-2'>
          <label className='text-sm font-medium'>Ticket volume per day</label>
          <input
            type='number'
            min={1}
            defaultValue={50}
            onChange={(e) => setTicketsPerDay(Math.max(1, Number(e.target.value)))}
            className='h-9 w-32 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
          />
        </div>

        <div className='space-y-2'>
          <label className='text-sm font-medium'>Hours of coverage per day</label>
          <input
            type='number'
            min={1}
            max={24}
            defaultValue={8}
            onChange={(e) => setCoverageHours(Math.max(1, Number(e.target.value)))}
            className='h-9 w-32 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
          />
        </div>
      </div>

      <div className='space-y-4 rounded-lg border border-border bg-background p-5'>
        <div>
          <p className='text-xs uppercase tracking-wider text-muted-foreground'>Benchmark tier</p>
          <p className={`mt-1 text-2xl font-semibold ${tier.color}`}>{tier.name}</p>
          <p className='mt-1 text-xs text-muted-foreground'>
            For {channel} at {formatMinutes(averageMinutes)} average.
          </p>
        </div>

        <div className='space-y-2'>
          <p className='text-xs font-medium'>SLA miss estimate</p>
          {slaTargets.map((target) => {
            const missRate =
              averageMinutes <= target
                ? 0
                : Math.min(100, Math.round(((averageMinutes - target) / averageMinutes) * 100))
            return (
              <div key={target} className='flex items-baseline justify-between text-xs'>
                <span className='text-muted-foreground'>{formatMinutes(target)} SLA</span>
                <span className='tabular-nums'>
                  ~{missRate}% miss{missRate === 0 ? ' (compliant)' : ''}
                </span>
              </div>
            )
          })}
        </div>

        <p className='text-xs text-muted-foreground'>
          Rough estimate based on the average — real miss rates depend on the distribution, not the
          mean. Use paste mode for accuracy.
        </p>
      </div>
    </div>
  )
}

export function FrtCalculator() {
  const [mode, setMode] = useState<Mode>('paste')
  const [channel, setChannel] = useState<Channel>('email')

  return (
    <div className='not-prose space-y-6 rounded-xl border border-border bg-card p-6 shadow-sm md:p-8'>
      <div className='flex flex-wrap items-center gap-4'>
        <div className='inline-flex rounded-md border border-border bg-background p-0.5 text-xs'>
          {(['paste', 'estimate'] as const).map((m) => (
            <button
              key={m}
              type='button'
              onClick={() => setMode(m)}
              className={`rounded px-3 py-1.5 transition-colors ${
                mode === m ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}>
              {m === 'paste' ? 'Paste tickets' : 'Estimate from averages'}
            </button>
          ))}
        </div>
        <div className='flex items-center gap-2 text-xs'>
          <span className='text-muted-foreground'>Channel:</span>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as Channel)}
            className='h-7 rounded-md border border-input bg-background px-2 text-xs'>
            <option value='email'>Email</option>
            <option value='chat'>Live chat</option>
            <option value='social'>Social</option>
          </select>
        </div>
      </div>

      {mode === 'paste' ? <PasteMode channel={channel} /> : <EstimateMode channel={channel} />}
    </div>
  )
}
