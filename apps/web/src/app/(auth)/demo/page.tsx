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
  'Loading Shopify store data',
  'Preparing AI responses',
]

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'done') {
    return <Check className='size-4 text-emerald-500' />
  }
  if (status === 'active') {
    return <Loader2 className='size-4 text-primary animate-spin' />
  }
  return <CircleDashed className='size-4 text-muted-foreground/50' />
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

    // Cosmetic step progression
    const timer1 = setTimeout(() => {
      setSteps((prev) =>
        prev.map((s, i) => ({
          ...s,
          status: i === 0 ? 'done' : i === 1 ? 'active' : 'pending',
        }))
      )
    }, 800)

    const timer2 = setTimeout(() => {
      setSteps((prev) =>
        prev.map((s, i) => ({
          ...s,
          status: i <= 1 ? 'done' : 'active',
        }))
      )
    }, 2000)

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
      clearTimeout(timer1)
      clearTimeout(timer2)
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setStatus('error')
    }
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
        <Card className='shadow-md shadow-black/20 border-transparent w-full'>
          {status === 'loading' ? (
            <>
              <CardHeader className='text-center'>
                <CardTitle className='text-xl'>Setting up your demo</CardTitle>
                <p className='text-sm text-muted-foreground'>No signup required</p>
              </CardHeader>
              <CardContent>
                <div className='space-y-3'>
                  {steps.map((step) => (
                    <div key={step.label} className='flex items-center gap-3'>
                      <StepIcon status={step.status} />
                      <span
                        className={
                          step.status === 'pending'
                            ? 'text-sm text-muted-foreground/50'
                            : 'text-sm text-foreground'
                        }>
                        {step.label}
                        {step.status === 'active' && '...'}
                      </span>
                    </div>
                  ))}
                </div>
                <p className='text-xs text-muted-foreground text-center mt-6'>
                  This usually takes a few seconds.
                </p>
              </CardContent>
              <CardFooter className='flex flex-col items-center gap-2 text-center text-xs text-muted-foreground'>
                <span>
                  Want the real thing?{' '}
                  <Link href='/signup' className='underline hover:text-foreground'>
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
                <p className='text-sm text-muted-foreground'>{error}</p>
              </CardHeader>
              <CardContent className='flex flex-col gap-3'>
                <Button onClick={createDemo} className='w-full'>
                  Try Again
                </Button>
                <Button asChild variant='outline' className='w-full'>
                  <Link href='/signup'>Sign Up Instead</Link>
                </Button>
              </CardContent>
              <CardFooter className='flex flex-col items-center gap-2 text-center text-xs text-muted-foreground'>
                <span>
                  Having trouble? Contact{' '}
                  <a href='mailto:support@auxx.ai' className='underline hover:text-foreground'>
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
