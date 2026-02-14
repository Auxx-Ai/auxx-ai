import type React from 'react'
// import { Loading } from './Loading'
// import { ErrorDisplay } from './ErrorDisplay'

import { Loader2Icon } from 'lucide-react'

export function Loading() {
  return (
    <div className='p-8'>
      <Loader2Icon className='mx-auto size-8 animate-spin' />
    </div>
  )
}

interface LoadingContentProps {
  loading: boolean
  loadingComponent?: React.ReactNode
  error?: { info?: { error: string }; error?: string }
  errorComponent?: React.ReactNode
  children: React.ReactNode
}

export function LoadingContent(props: LoadingContentProps) {
  if (props.error) {
    return props.errorComponent ? (
      props.errorComponent
    ) : (
      <div className='mt-4'>
        {props.error?.info?.error || props.error?.error}
        {/* <ErrorDisplay error={props.error} /> */}
      </div>
    )
  }

  if (props.loading) return <>{props.loadingComponent || <Loading />}</>

  return <>{props.children}</>
}

export function LoadingSpinner() {
  return (
    <div className='absolute inset-0 grid place-items-center'>
      <div className='flex flex-col items-center gap-2'>
        <Loader2Icon className='mx-auto size-8 animate-spin' />
      </div>
    </div>
  )
}
