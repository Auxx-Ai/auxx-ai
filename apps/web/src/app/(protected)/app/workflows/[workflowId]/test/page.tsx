// apps/web/src/app/(protected)/app/workflows/[workflowId]/test/page.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Switch } from '@auxx/ui/components/switch'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { ArrowLeft, TestTube2 } from 'lucide-react'
import Link from 'next/link'
import { use, useState } from 'react'
import { useAnalytics } from '~/hooks/use-analytics'
import { api } from '~/trpc/react'

interface TestWorkflowPageProps {
  params: Promise<{ workflowId: string }>
}

export default function TestWorkflowPage({ params }: TestWorkflowPageProps) {
  const { workflowId } = use(params)
  const posthog = useAnalytics()
  const [isTestRunning, setIsTestRunning] = useState(false)
  const [testResult, setTestResult] = useState<any>(null)

  // Test data state
  const [testSubject, setTestSubject] = useState('Test Email Subject')
  const [testBody, setTestBody] = useState(
    'This is a test email body to verify workflow execution.'
  )
  const [testFrom, setTestFrom] = useState('test@example.com')
  const [testFromName, setTestFromName] = useState('Test User')
  const [dryRun, setDryRun] = useState(true)
  const [debug, setDebug] = useState(true)

  const {
    data: workflow,
    isLoading,
    error,
  } = api.workflow.getById.useQuery({ id: workflowId }, { enabled: !!workflowId })

  const testWorkflow = api.workflow.test.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toastSuccess({
          title: 'Test completed successfully',
          description: 'Workflow executed without errors',
        })
      } else {
        toastError({
          title: 'Test completed with errors',
          description: 'Check the execution log for details',
        })
      }
      setTestResult(result)
      setIsTestRunning(false)
    },
    onError: (error) => {
      toastError({
        title: 'Test failed',
        description: error.message,
      })
      setIsTestRunning(false)
    },
  })

  const handleRunTest = async () => {
    if (isTestRunning || !workflow) return

    posthog?.capture('workflow_tested', { workflow_id: workflowId })
    setIsTestRunning(true)
    setTestResult(null)

    try {
      await testWorkflow.mutateAsync({
        workflowId,
        testData: {
          message: {
            subject: testSubject,
            textPlain: testBody,
            from: {
              identifier: testFrom,
              name: testFromName,
            },
            isInbound: true,
          },
          variables: {},
        },
        options: {
          dryRun,
          debug,
        },
      })
    } catch (error) {
      console.error('Error testing workflow:', error)
      setIsTestRunning(false)
    }
  }

  if (isLoading) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Workflows' href='/app/workflows' />
            <MainPageBreadcrumbItem title={<Skeleton className='h-4 w-32' />} />
            <MainPageBreadcrumbItem title='Test' last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <div className='p-6 space-y-4'>
            <Skeleton className='h-8 w-64' />
            <Skeleton className='h-64 w-full' />
          </div>
        </MainPageContent>
      </MainPage>
    )
  }

  if (error || !workflow) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Workflows' href='/app/workflows' />
            <MainPageBreadcrumbItem title='Not Found' />
            <MainPageBreadcrumbItem title='Test' last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <div className='p-6 text-center'>
            <h1 className='text-2xl font-bold text-destructive mb-2'>Workflow Not Found</h1>
            <p className='text-muted-foreground mb-4'>
              The workflow you're trying to test doesn't exist or you don't have permission to test
              it.
            </p>
            <Button asChild>
              <Link href='/app/workflows'>
                <ArrowLeft className='h-4 w-4 mr-2' />
                Back to Workflows
              </Link>
            </Button>
          </div>
        </MainPageContent>
      </MainPage>
    )
  }

  return (
    <MainPage>
      <MainPageHeader
        action={
          <div className='flex items-center gap-2'>
            <Button variant='outline' size='sm' asChild>
              <Link href={`/app/workflows/${workflowId}`}>
                <ArrowLeft className='h-4 w-4 mr-2' />
                Back to Workflow
              </Link>
            </Button>
          </div>
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Workflows' href='/app/workflows' />
          <MainPageBreadcrumbItem title={workflow.name} href={`/app/workflows/${workflowId}`} />
          <MainPageBreadcrumbItem title='Test' last />
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent>
        <div className='p-6 max-w-6xl mx-auto grid gap-6 md:grid-cols-2'>
          {/* Test Configuration */}
          <div className='space-y-6'>
            <Card>
              <CardHeader>
                <CardTitle>Test Configuration</CardTitle>
                <CardDescription>
                  Configure the test message data to simulate workflow execution
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div className='space-y-2'>
                  <Label htmlFor='subject'>Email Subject</Label>
                  <Input
                    id='subject'
                    value={testSubject}
                    onChange={(e) => setTestSubject(e.target.value)}
                    placeholder='Enter test email subject'
                  />
                </div>

                <div className='space-y-2'>
                  <Label htmlFor='body'>Email Body</Label>
                  <Textarea
                    id='body'
                    value={testBody}
                    onChange={(e) => setTestBody(e.target.value)}
                    placeholder='Enter test email body'
                    rows={4}
                  />
                </div>

                <div className='grid grid-cols-2 gap-4'>
                  <div className='space-y-2'>
                    <Label htmlFor='from'>From Email</Label>
                    <Input
                      id='from'
                      type='email'
                      value={testFrom}
                      onChange={(e) => setTestFrom(e.target.value)}
                      placeholder='test@example.com'
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label htmlFor='fromName'>From Name</Label>
                    <Input
                      id='fromName'
                      value={testFromName}
                      onChange={(e) => setTestFromName(e.target.value)}
                      placeholder='Test User'
                    />
                  </div>
                </div>

                <div className='space-y-4 pt-4 border-t'>
                  <div className='flex items-center justify-between'>
                    <div className='space-y-0.5'>
                      <Label htmlFor='dryRun'>Dry Run</Label>
                      <p className='text-sm text-muted-foreground'>
                        Simulate execution without making actual changes
                      </p>
                    </div>
                    <Switch id='dryRun' checked={dryRun} onCheckedChange={setDryRun} />
                  </div>

                  <div className='flex items-center justify-between'>
                    <div className='space-y-0.5'>
                      <Label htmlFor='debug'>Debug Mode</Label>
                      <p className='text-sm text-muted-foreground'>Show detailed execution logs</p>
                    </div>
                    <Switch id='debug' checked={debug} onCheckedChange={setDebug} />
                  </div>
                </div>

                <Button
                  className='w-full'
                  onClick={handleRunTest}
                  loading={isTestRunning}
                  loadingText='Running test...'>
                  <TestTube2 className='h-4 w-4 mr-2' />
                  Run Test
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Test Results */}
          <div className='space-y-6'>
            <Card className='h-[600px] flex flex-col'>
              <CardHeader>
                <CardTitle>Test Results</CardTitle>
                <CardDescription>View the execution results and debug information</CardDescription>
              </CardHeader>
              <CardContent className='flex-1 overflow-hidden'>
                {!testResult ? (
                  <div className='h-full flex items-center justify-center text-muted-foreground'>
                    <div className='text-center'>
                      <TestTube2 className='h-12 w-12 mx-auto mb-4 opacity-20' />
                      <p>Run a test to see results here</p>
                    </div>
                  </div>
                ) : (
                  <ScrollArea className='h-full'>
                    <div className='space-y-4'>
                      {/* Status Badge */}
                      <div className='flex items-center gap-2'>
                        <span className='text-sm font-medium'>Status:</span>
                        <Badge variant={testResult.success ? 'default' : 'destructive'}>
                          {testResult.success ? 'Success' : 'Failed'}
                        </Badge>
                      </div>

                      {/* Execution Summary */}
                      {testResult.result && (
                        <div className='space-y-2 text-sm'>
                          <div>
                            <span className='font-medium'>Execution ID:</span>{' '}
                            <code className='text-xs bg-muted px-1 py-0.5 rounded'>
                              {testResult.result.executionId}
                            </code>
                          </div>
                          <div>
                            <span className='font-medium'>Total Time:</span>{' '}
                            {testResult.result.totalExecutionTime}ms
                          </div>
                          <div>
                            <span className='font-medium'>Nodes Executed:</span>{' '}
                            {Object.keys(testResult.result.nodeResults || {}).length}
                          </div>
                        </div>
                      )}

                      {/* Debug Output */}
                      {debug && testResult.result?.debugLogs && (
                        <div className='space-y-2'>
                          <h4 className='font-medium text-sm'>Debug Logs</h4>
                          <pre className='text-xs bg-muted p-3 rounded overflow-x-auto'>
                            {JSON.stringify(testResult.result.debugLogs, null, 2)}
                          </pre>
                        </div>
                      )}

                      {/* Error Information */}
                      {testResult.result?.error && (
                        <div className='space-y-2'>
                          <h4 className='font-medium text-sm text-destructive'>Error Details</h4>
                          <div className='text-sm bg-destructive/10 text-destructive p-3 rounded'>
                            {testResult.result.error}
                          </div>
                        </div>
                      )}

                      {/* Full Result JSON */}
                      <details className='space-y-2'>
                        <summary className='cursor-pointer font-medium text-sm'>
                          Full Execution Result
                        </summary>
                        <pre className='text-xs bg-muted p-3 rounded overflow-x-auto'>
                          {JSON.stringify(testResult, null, 2)}
                        </pre>
                      </details>
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </MainPageContent>
    </MainPage>
  )
}
