// apps/web/src/app/(protected)/app/tickets/_components/domain-testing-tab.tsx
'use client'

import { api } from '~/trpc/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Button } from '@auxx/ui/components/button'
import { Separator } from '@auxx/ui/components/separator'
import { Alert, AlertTitle, AlertDescription } from '@auxx/ui/components/alert'
import { InfoIcon, AlertCircleIcon, ClipboardCopyIcon, RefreshCwIcon } from 'lucide-react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'

interface DomainTestingTabProps {
  domainId: string
  onBack: () => void
}

/** Domain details and testing instructions */
export default function DomainTestingTab({ domainId, onBack }: DomainTestingTabProps) {
  const { data: domainData, isLoading } = api.mailDomain.getDomain.useQuery(
    { id: domainId },
    { refetchOnWindowFocus: false }
  )

  const updateDomain = api.mailDomain.updateDomain.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Domain updated',
        description: 'Domain status has been updated',
      })
    },
    onError: (error) => {
      toastError({ title: 'Error updating domain', description: error.message })
    },
  })

  const handleToggleActive = async (isActive: boolean) => {
    if (!domainData?.domain) return
    await updateDomain.mutateAsync({ id: domainId, isActive })
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toastSuccess({ title: 'Copied', description: 'Email address copied to clipboard' })
  }

  if (isLoading || !domainData) {
    return (
      <Card>
        <CardContent className="flex justify-center py-8">
          <RefreshCwIcon className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  const { domain } = domainData

  if (!domain.isActive) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <AlertCircleIcon className="mx-auto h-12 w-12 text-amber-500" />
          <h3 className="mt-2 text-lg font-medium">Domain Inactive</h3>
          <p className="mt-1 text-muted-foreground">
            This domain is currently inactive. Activate it to use email functionality.
          </p>
          <Button className="mt-4" onClick={() => handleToggleActive(true)}>
            Activate Domain
          </Button>
          <Button variant="outline" className="mt-2" onClick={onBack}>
            Back to Domains
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Domain Details</CardTitle>
        <CardDescription>Your email domain: {domain.domain}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <Alert>
            <InfoIcon className="h-4 w-4" />
            <AlertTitle>How to Use</AlertTitle>
            <AlertDescription>
              <p className="mb-2">
                Send an email to{' '}
                <span className="font-mono font-bold">{`${domain.routingPrefix}new@${domain.domain}`}</span> to create a
                new ticket.
              </p>
              <p>Once a ticket is created, you can reply to the notification email to add more information.</p>
            </AlertDescription>
          </Alert>

          <div className="rounded-md border p-4">
            <h3 className="text-lg font-medium">Email Formats</h3>
            <div className="mt-4 space-y-4">
              <div>
                <p className="text-sm font-medium">New Ticket</p>
                <div className="flex items-center">
                  <p className="font-mono text-sm">{`${domain.routingPrefix}new@${domain.domain}`}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-2"
                    onClick={() => copyToClipboard(`${domain.routingPrefix}new@${domain.domain}`)}>
                    <ClipboardCopyIcon className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <Separator />
              <div>
                <p className="text-sm font-medium">Reply to Ticket</p>
                <p className="font-mono text-sm">
                  {`${domain.routingPrefix}123@${domain.domain}`} (where 123 is the ticket number)
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <h3 className="mb-4 text-lg font-medium">Troubleshooting</h3>
            <div className="space-y-4">
              <div className="rounded-md border p-4">
                <h4 className="font-medium">Emails not being received?</h4>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>Check that the domain is active</li>
                  <li>Try sending a test email from a different email account</li>
                  <li>Check your spam folder for the ticket confirmation</li>
                </ul>
              </div>

              <div className="rounded-md border p-4">
                <h4 className="font-medium">Emails not being delivered?</h4>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>Check if your email is being marked as spam</li>
                  <li>Verify your email client settings</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-between">
            <Button variant="outline" onClick={onBack}>
              Back to Domains
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleToggleActive(false)}
              loading={updateDomain.isPending}
              loadingText="Updating...">
              Disable Domain
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
