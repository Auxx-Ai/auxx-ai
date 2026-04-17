// apps/homepage/src/app/free-tools/sla-calculator/_components/sla-calculator.tsx
'use client'

import { useMemo, useState } from 'react'

type SlaTier = {
  label: string
  minutes: number
}

const SLA_TIERS: SlaTier[] = [
  { label: '15 min', minutes: 15 },
  { label: '1 hour', minutes: 60 },
  { label: '4 hours', minutes: 240 },
  { label: '8 hours', minutes: 480 },
  { label: '24 hours', minutes: 1440 },
]

type NumericFieldProps = {
  label: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  unit?: string
  hint?: string
}

function NumericField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  hint,
}: NumericFieldProps) {
  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between'>
        <label className='text-sm font-medium'>{label}</label>
        <span className='text-sm tabular-nums text-muted-foreground'>
          {value}
          {unit ? ` ${unit}` : ''}
        </span>
      </div>
      <input
        type='range'
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className='h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary'
      />
      {hint ? <p className='text-xs text-muted-foreground'>{hint}</p> : null}
    </div>
  )
}

function computeStaffing(params: {
  ticketsPerDay: number
  coverageHours: number
  daysPerWeek: number
  slaMinutes: number
  handleMinutes: number
  utilization: number
}) {
  const { ticketsPerDay, coverageHours, slaMinutes, handleMinutes, utilization } = params

  const effectiveMinutesPerAgentPerDay = coverageHours * 60 * (utilization / 100)
  const minutesPerTicket = handleMinutes
  const ticketsPerAgentPerDay = effectiveMinutesPerAgentPerDay / minutesPerTicket
  const baseAgents = ticketsPerDay / ticketsPerAgentPerDay

  const slaTightnessFactor = Math.max(1, (handleMinutes * 3) / Math.max(slaMinutes, 1))
  const agentsRequired = Math.max(1, Math.ceil(baseAgents * slaTightnessFactor))

  const dailyCapacity = Math.round(agentsRequired * ticketsPerAgentPerDay)
  const capacityRatio = dailyCapacity / ticketsPerDay

  let risk: 'green' | 'amber' | 'red'
  if (capacityRatio >= 1.3) risk = 'green'
  else if (capacityRatio >= 1.0) risk = 'amber'
  else risk = 'red'

  return {
    agentsRequired,
    dailyCapacity,
    ticketsPerAgentPerDay: Math.round(ticketsPerAgentPerDay),
    effectiveAgentHours: Math.round(effectiveMinutesPerAgentPerDay / 6) / 10,
    risk,
  }
}

const riskStyles: Record<'green' | 'amber' | 'red', { bg: string; text: string; label: string }> = {
  green: {
    bg: 'bg-emerald-500/10 border-emerald-500/30',
    text: 'text-emerald-600 dark:text-emerald-400',
    label: 'Healthy headroom',
  },
  amber: {
    bg: 'bg-amber-500/10 border-amber-500/30',
    text: 'text-amber-600 dark:text-amber-400',
    label: 'Tight — no buffer for spikes',
  },
  red: {
    bg: 'bg-red-500/10 border-red-500/30',
    text: 'text-red-600 dark:text-red-400',
    label: 'Under-staffed — you will miss SLA',
  },
}

export function SlaCalculator() {
  const [ticketsPerDay, setTicketsPerDay] = useState(50)
  const [coverageHours, setCoverageHours] = useState(8)
  const [daysPerWeek, setDaysPerWeek] = useState<5 | 6 | 7>(5)
  const [slaMinutes, setSlaMinutes] = useState(240)
  const [handleMinutes, setHandleMinutes] = useState(8)
  const [utilization, setUtilization] = useState(70)

  const result = useMemo(
    () =>
      computeStaffing({
        ticketsPerDay,
        coverageHours,
        daysPerWeek,
        slaMinutes,
        handleMinutes,
        utilization,
      }),
    [ticketsPerDay, coverageHours, daysPerWeek, slaMinutes, handleMinutes, utilization]
  )

  const risk = riskStyles[result.risk]

  return (
    <div className='not-prose grid gap-8 rounded-xl border border-border bg-card p-6 shadow-sm md:grid-cols-[1fr_1fr] md:p-8'>
      <div className='space-y-5'>
        <div>
          <h2 className='text-base font-semibold'>Your inputs</h2>
          <p className='text-xs text-muted-foreground'>Adjust to match your team.</p>
        </div>

        <NumericField
          label='Tickets per day'
          value={ticketsPerDay}
          onChange={setTicketsPerDay}
          min={5}
          max={500}
          step={5}
        />
        <NumericField
          label='Coverage hours per day'
          value={coverageHours}
          onChange={setCoverageHours}
          min={4}
          max={24}
          unit='hr'
        />

        <div className='space-y-2'>
          <label className='text-sm font-medium'>Days of coverage per week</label>
          <div className='inline-flex rounded-md border border-border bg-background p-0.5 text-xs'>
            {[5, 6, 7].map((d) => (
              <button
                key={d}
                type='button'
                onClick={() => setDaysPerWeek(d as 5 | 6 | 7)}
                className={`rounded px-3 py-1.5 transition-colors ${
                  daysPerWeek === d ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                }`}>
                {d} days
              </button>
            ))}
          </div>
        </div>

        <div className='space-y-2'>
          <label className='text-sm font-medium'>Target response SLA</label>
          <div className='flex flex-wrap gap-1.5'>
            {SLA_TIERS.map((tier) => (
              <button
                key={tier.minutes}
                type='button'
                onClick={() => setSlaMinutes(tier.minutes)}
                className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                  slaMinutes === tier.minutes
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background hover:bg-muted'
                }`}>
                {tier.label}
              </button>
            ))}
          </div>
        </div>

        <NumericField
          label='Average handle time per ticket'
          value={handleMinutes}
          onChange={setHandleMinutes}
          min={2}
          max={30}
          unit='min'
        />
        <NumericField
          label='Agent utilization'
          value={utilization}
          onChange={setUtilization}
          min={50}
          max={90}
          unit='%'
          hint='Share of the shift actually on tickets, not breaks, training, or admin.'
        />
      </div>

      <div className='space-y-5'>
        <div>
          <h2 className='text-base font-semibold'>Your staffing</h2>
          <p className='text-xs text-muted-foreground'>Updates live as you change inputs.</p>
        </div>

        <div className='rounded-lg border border-border bg-background p-6 text-center'>
          <p className='text-xs uppercase tracking-wider text-muted-foreground'>Agents required</p>
          <p className='mt-2 text-5xl font-semibold tabular-nums'>{result.agentsRequired}</p>
          <p className='mt-1 text-xs text-muted-foreground'>
            to hit a {SLA_TIERS.find((t) => t.minutes === slaMinutes)?.label} response SLA
          </p>
        </div>

        <div className={`rounded-lg border p-4 text-sm ${risk.bg}`}>
          <p className={`font-medium ${risk.text}`}>{risk.label}</p>
          <p className='mt-1 text-xs text-muted-foreground'>
            Daily capacity at {result.agentsRequired} agent
            {result.agentsRequired === 1 ? '' : 's'}: ~{result.dailyCapacity} tickets vs.{' '}
            {ticketsPerDay} expected.
          </p>
        </div>

        <div className='space-y-2 text-sm'>
          <div className='flex items-baseline justify-between border-b border-border pb-2'>
            <span className='text-muted-foreground'>Per-agent daily capacity</span>
            <span className='tabular-nums'>{result.ticketsPerAgentPerDay} tickets</span>
          </div>
          <div className='flex items-baseline justify-between border-b border-border pb-2'>
            <span className='text-muted-foreground'>Effective agent-hours / day</span>
            <span className='tabular-nums'>{result.effectiveAgentHours} hr</span>
          </div>
          <div className='flex items-baseline justify-between'>
            <span className='text-muted-foreground'>Ticket-minutes needed / day</span>
            <span className='tabular-nums'>
              {(ticketsPerDay * handleMinutes).toLocaleString()} min
            </span>
          </div>
        </div>

        <p className='text-xs text-muted-foreground'>
          Back-of-envelope estimate. Real staffing needs adjust for volume spikes, schedules, and
          channel mix.
        </p>
      </div>
    </div>
  )
}
