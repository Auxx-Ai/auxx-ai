// apps/web/src/app/(auth)/demo/page.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Check, CircleDashed, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Logo } from '~/components/global/login/logo'

type StepStatus = 'pending' | 'active' | 'done'

interface ProgressStep {
  label: string
  status: StepStatus
}

const STEP_LABELS = [
  'Creating demo environment',
  'Loading test data',
  'Preparing AI responses',
  'Finalizing setup',
]

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'done') {
    return <Check className='size-4 text-emerald-500' />
  }
  if (status === 'active') {
    return <Loader2 className='size-4 text-white/80 animate-spin' />
  }
  return <CircleDashed className='size-4 text-white/20' />
}

export default function DemoPage() {
  const [status, setStatus] = useState<'loading' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [steps, setSteps] = useState<ProgressStep[]>(
    STEP_LABELS.map((label, i) => ({
      label,
      status: i === 0 ? 'active' : 'pending',
    }))
  )
  const hasStarted = useRef(false)

  const createDemo = useCallback(async () => {
    setStatus('loading')
    setError(null)
    setSteps(
      STEP_LABELS.map((label, i) => ({
        label,
        status: i === 0 ? 'active' : 'pending',
      }))
    )

    // Cosmetic step progression — each step activates then completes
    const timers: ReturnType<typeof setTimeout>[] = []
    for (let step = 1; step < STEP_LABELS.length; step++) {
      timers.push(
        setTimeout(() => {
          setSteps((prev) =>
            prev.map((s, i) => ({
              ...s,
              status: i < step ? 'done' : i === step ? 'active' : 'pending',
            }))
          )
        }, step * 800)
      )
    }

    // TODO: re-enable session creation
    try {
      const res = await fetch('/api/demo/create-session', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to create demo session')
      }
      // Mark all steps done before redirect
      setSteps((prev) => prev.map((s) => ({ ...s, status: 'done' as const })))
      // Small delay so user sees the final checkmarks
      await new Promise((resolve) => setTimeout(resolve, 300))
      window.location.href = '/app'
    } catch (err) {
      timers.forEach(clearTimeout)
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setStatus('error')
    }

    // Temporary: mark all steps done after animation completes
    timers.push(
      setTimeout(() => {
        setSteps((prev) => prev.map((s) => ({ ...s, status: 'done' as const })))
      }, STEP_LABELS.length * 800)
    )
  }, [])

  // Auto-launch on mount
  useEffect(() => {
    if (hasStarted.current) return
    hasStarted.current = true
    createDemo()
  }, [createDemo])

  return (
    <div className='flex min-h-screen w-screen items-center justify-center p-4 bg-white/10'>
      <div className='flex w-full max-w-sm flex-col items-center gap-4'>
        <Logo />
        <Card variant='translucent' className='border-transparent w-full px-4 py-3'>
          {status === 'loading' ? (
            <>
              <CardHeader className='text-center'>
                <CardTitle className='text-xl'>Setting up your demo</CardTitle>
                <p className='text-sm text-white/50'>No signup required</p>
              </CardHeader>
              <CardContent>
                <div className='space-y-3'>
                  {steps.map((step) => (
                    <div key={step.label} className='flex items-center gap-3'>
                      <StepIcon status={step.status} />
                      <span
                        className={
                          step.status === 'pending'
                            ? 'text-sm text-white/30'
                            : 'text-sm text-white/80'
                        }>
                        {step.label}
                        {step.status === 'active' && '...'}
                      </span>
                    </div>
                  ))}
                </div>
                <p className='text-xs text-white/50 text-center mt-6'>
                  This usually takes a few seconds.
                </p>
              </CardContent>
              <CardFooter className='flex flex-col items-center gap-2 text-center text-xs text-white/50'>
                <span>
                  Want the real thing?{' '}
                  <Link
                    href='/signup'
                    className='text-white underline-offset-3 underline hover:text-white'>
                    Sign up free
                  </Link>{' '}
                  — no credit card required.
                </span>
              </CardFooter>
            </>
          ) : (
            <>
              <CardHeader className='text-center'>
                <CardTitle className='text-xl'>Couldn&apos;t start demo</CardTitle>
                <p className='text-sm text-white/50'>{error}</p>
              </CardHeader>
              <CardContent className='flex flex-col gap-3'>
                <Button onClick={createDemo} className='w-full'>
                  Try Again
                </Button>
                <Button asChild variant='translucent' className='w-full'>
                  <Link href='/signup'>Sign Up Instead</Link>
                </Button>
              </CardContent>
              <CardFooter className='pt-3 flex flex-col items-center gap-2 text-center text-xs text-white/50'>
                <span>
                  Having trouble? Contact{' '}
                  <a
                    href='mailto:support@auxx.ai'
                    className='text-white/80 underline hover:text-white underline-offset-3'>
                    support@auxx.ai
                  </a>
                </span>
              </CardFooter>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}
