import { TextBlock, Button, Separator } from '@auxx/sdk/client'
import React from 'react'

import { TestUser } from './test-user'

const Loading = () => <TextBlock>Loading stoic quote...</TextBlock>

/**
 * Example dialog component.
 *
 * IMPORTANT: Dialog components can ONLY use approved SDK components.
 * Using raw HTML elements (div, p, button, etc.) will cause TypeScript errors.
 */
export function HelloWorldDialog({
  recordId,
  hideDialog,
}: {
  recordId: string
  hideDialog: () => void
}) {
  // A simple counter to demonstrate that this is just regular React code.
  const [seconds, setSeconds] = React.useState(0)
  React.useEffect(() => {
    const timeout = setTimeout(() => setSeconds(seconds + 1), 1000)
    return () => clearTimeout(timeout)
  }, [seconds])

  return (
    <>
      <TextBlock align="left">
        I am a dialog. I have been open for: {seconds} second{seconds === 1 ? '' : 's'}
      </TextBlock>

      {/* The hook in TestUser will suspend until the stoic quote is loaded. */}
      <React.Suspense fallback={<Loading />}>
        <TestUser recordId={recordId} />
      </React.Suspense>

      <Separator />

      {/* Close button - demonstrates using hideDialog */}
      <Button label="Close" onClick={hideDialog} />
    </>
  )
}
