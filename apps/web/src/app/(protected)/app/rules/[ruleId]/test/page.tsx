// src/app/(protected)/app/rules/[ruleId]/test/page.tsx
'use client'

import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Textarea } from '@auxx/ui/components/textarea'
import { Badge } from '@auxx/ui/components/badge'
import { Separator } from '@auxx/ui/components/separator'
import { api } from '~/trpc/react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import {
  ArrowLeft,
  Play,
  Save,
  Trash2,
  CheckCircle,
  XCircle,
  AlertCircle,
  Info,
  FileText,
  Download,
  Upload,
} from 'lucide-react'
import Link from 'next/link'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Switch } from '@auxx/ui/components/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { useRuleTestAdapter } from '~/hooks/use-rule-test-adapter'

interface TestCase {
  id: string
  name: string
  email: {
    subject: string
    body: string
    from: string
    to: string
    metadata?: { hasAttachments?: boolean; isReply?: boolean; threadMessageCount?: number }
  }
  expectedResult: { shouldMatch: boolean; expectedActions?: string[] }
}

interface TestResult {
  testCaseId: string
  passed: boolean
  matched: boolean
  executedActions: string[]
  executionTime: number
  error?: string
  details?: any
}

export default function RuleTestPage() {
  const router = useRouter()
  const params = useParams()
  const ruleId = params.ruleId as string
  const utils = api.useUtils()

  const [activeTab, setActiveTab] = useState('manual')
  const [testCases, setTestCases] = useState<TestCase[]>([])
  const [testResults, setTestResults] = useState<TestResult[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [selectedTestCase, setSelectedTestCase] = useState<string>('')

  // Manual test form
  const [manualTest, setManualTest] = useState({
    subject: '',
    body: '',
    from: 'test@example.com',
    to: 'support@company.com',
    hasAttachments: false,
    isReply: false,
    forceEvaluation: false,
    dryRun: true,
  })

  // Validate ruleId before making API call
  const isValidRuleId =
    ruleId &&
    ruleId !== 'rules' &&
    ruleId !== 'groups' &&
    ruleId !== 'new' &&
    ruleId !== 'analytics'

  // Try to fetch as rule first, then as rule group
  const {
    data: rule,
    isLoading: ruleLoading,
    error: ruleError,
  } = api.rule.getRule.useQuery({ id: ruleId }, { enabled: isValidRuleId, retry: false })

  const {
    data: ruleGroup,
    isLoading: groupLoading,
    error: groupError,
  } = api.ruleGroup.get.useQuery(
    { id: ruleId },
    { enabled: isValidRuleId && !rule && !ruleLoading, retry: false }
  )

  // Determine what we're testing
  const isRule = !!rule
  const isRuleGroup = !!ruleGroup
  const isLoading = ruleLoading || groupLoading
  const item = rule || ruleGroup

  // Fetch saved test cases (TODO: implement API endpoint)
  // const { data: savedTestCases } = api.rule.getTestCases.useQuery({ ruleId })
  const savedTestCases = [
    {
      id: '1',
      name: 'VIP Customer Test',
      testEmail: {
        from: 'vip@example.com',
        subject: 'Urgent: Order Issue',
        body: 'I need immediate assistance with my order.',
        sender: { email: 'vip@example.com', isVip: true },
      },
      expectedResult: { matched: true, actions: ['escalate', 'auto-reply'] },
    },
    {
      id: '2',
      name: 'Regular Customer Test',
      testEmail: {
        from: 'customer@example.com',
        subject: 'General inquiry',
        body: 'Can you help me with shipping info?',
        sender: { email: 'customer@example.com', isVip: false },
      },
      expectedResult: { matched: false, actions: [] },
    },
  ]

  // Test mutations - using enhanced adapter
  const testRule = useRuleTestAdapter()

  // Add success/error handling to the adapter
  const handleTestSuccess = (result: any) => {
    toastSuccess({ title: 'Test completed' })
    setTestResults((prev) => [
      ...prev,
      {
        testCaseId: 'manual',
        passed: result.matched,
        matched: result.matched,
        executedActions: result.executedActions || [],
        executionTime: result.executionTime || 0,
        details: result,
      },
    ])
  }

  const handleTestError = (error: any) => {
    toastError({ title: 'Test failed', description: error.message })
  }

  const testRuleGroup = api.ruleGroup.test.useMutation({
    onSuccess: (result) => {
      toastSuccess({ title: 'Test completed' })
      setTestResults((prev) => [
        ...prev,
        {
          testCaseId: 'manual',
          passed: result.matched,
          matched: result.matched,
          executedActions: Object.keys(result.actions || {}),
          executionTime: result.executionTime || 0,
          details: result,
        },
      ])
    },
    onError: (error) => {
      toastError({ title: 'Test failed', description: error.message })
    },
  })

  const saveTestCase = {
    mutate: (data: any) => {
      toastSuccess({ title: 'Test case saved (mock)' })
    },
    isLoading: false,
  }

  // Load saved test cases
  // useEffect(() => {
  //   if (savedTestCases) {
  //     setTestCases(savedTestCases)
  //   }
  // }, [savedTestCases])

  // Pre-fill with common test scenarios
  const loadScenario = (scenario: string) => {
    const scenarios: Record<string, typeof manualTest> = {
      'order-inquiry': {
        subject: 'Order #12345 - Where is my package?',
        body: "Hi, I placed an order 5 days ago and haven't received it yet. Can you check the status?",
        from: 'customer@example.com',
        to: 'support@company.com',
        hasAttachments: false,
        isReply: false,
        forceEvaluation: false,
        dryRun: true,
      },
      complaint: {
        subject: 'TERRIBLE SERVICE - DEMAND REFUND',
        body: "This is unacceptable! I've been waiting for 2 weeks and no one has helped me. I want a full refund immediately!",
        from: 'angry.customer@example.com',
        to: 'support@company.com',
        hasAttachments: false,
        isReply: true,
        forceEvaluation: false,
        dryRun: true,
      },
      spam: {
        subject: "🎁 You've Won $1,000,000!!!",
        body: 'CONGRATULATIONS! Click here to claim your prize: http://scam.fake/claim',
        from: 'lottery@scammer.fake',
        to: 'support@company.com',
        hasAttachments: false,
        isReply: false,
        forceEvaluation: false,
        dryRun: true,
      },
      vip: {
        subject: 'Urgent: Need immediate assistance',
        body: "I'm a premium customer and need help ASAP with my account.",
        from: 'vip@premium-domain.com',
        to: 'support@company.com',
        hasAttachments: false,
        isReply: false,
        forceEvaluation: false,
        dryRun: true,
      },
    }

    if (scenarios[scenario]) {
      setManualTest(scenarios[scenario])
    }
  }

  const runManualTest = () => {
    if (!manualTest.subject && !manualTest.body) {
      toastError({ title: 'Please provide email content to test' })
      return
    }

    setIsRunning(true)

    const testEmail = {
      subject: manualTest.subject,
      body: manualTest.body,
      from: manualTest.from,
      to: manualTest.to,
      metadata: { hasAttachments: manualTest.hasAttachments, isReply: manualTest.isReply },
    }

    if (isRule) {
      testRule.mutate(
        {
          ruleId,
          email: testEmail,
          options: { forceEvaluation: manualTest.forceEvaluation, dryRun: manualTest.dryRun },
        },
        { onSettled: () => setIsRunning(false) }
      )
    } else if (isRuleGroup) {
      testRuleGroup.mutate(
        { groupId: ruleId, email: testEmail },
        { onSettled: () => setIsRunning(false) }
      )
    }
  }

  const runTestSuite = async () => {
    if (testCases.length === 0) {
      toastError({ title: 'No test cases to run' })
      return
    }

    setIsRunning(true)
    setTestResults([])

    // Run tests sequentially
    for (const testCase of testCases) {
      try {
        const result = await testRule.mutateAsync({
          ruleId,
          testEmail: testCase.email,
          options: { forceEvaluation: false, dryRun: true },
        })

        const passed =
          result.matched === testCase.expectedResult.shouldMatch &&
          (!testCase.expectedResult.expectedActions ||
            testCase.expectedResult.expectedActions.every((action) =>
              result.executedActions?.includes(action)
            ))

        setTestResults((prev) => [
          ...prev,
          {
            testCaseId: testCase.id,
            passed,
            matched: result.matched,
            executedActions: result.executedActions || [],
            executionTime: result.executionTime || 0,
            details: result,
          },
        ])
      } catch (error) {
        setTestResults((prev) => [
          ...prev,
          {
            testCaseId: testCase.id,
            passed: false,
            matched: false,
            executedActions: [],
            executionTime: 0,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        ])
      }
    }

    setIsRunning(false)
    toastSuccess({ title: 'Test suite completed' })
  }

  const saveCurrentAsTestCase = () => {
    const name = prompt('Enter a name for this test case:')
    if (!name) return

    const newTestCase: TestCase = {
      id: Date.now().toString(),
      name,
      email: {
        subject: manualTest.subject,
        body: manualTest.body,
        from: manualTest.from,
        to: manualTest.to,
        metadata: { hasAttachments: manualTest.hasAttachments, isReply: manualTest.isReply },
      },
      expectedResult: {
        shouldMatch: true, // User should update this
        expectedActions: [],
      },
    }

    setTestCases((prev) => [...prev, newTestCase])

    // Save to backend
    saveTestCase.mutate({ ruleId, testCase: newTestCase })
  }

  const deleteTestCase = (id: string) => {
    setTestCases((prev) => prev.filter((tc) => tc.id !== id))
    // TODO: Delete from backend
  }

  const exportTestCases = () => {
    const data = JSON.stringify(testCases, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `rule-${ruleId}-test-cases.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importTestCases = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target?.result as string)
        setTestCases(imported)
        toastSuccess({ title: 'Test cases imported successfully' })
      } catch (error) {
        toastError({ title: 'Failed to import test cases' })
      }
    }
    reader.readAsText(file)
  }

  if (isLoading) {
    return (
      <div className="flex-1 space-y-6 p-8">
        <Skeleton className="h-12 w-64" />
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!item) {
    return (
      <div className="flex-1 space-y-6 p-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Rule or rule group not found. It may have been deleted.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-6 p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/app/rules/${ruleId}`}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Test {isRuleGroup ? 'Rule Group' : 'Rule'}: {item.name}
            </h1>
            <p className="text-muted-foreground">
              Test how your {isRuleGroup ? 'rule group' : 'rule'} responds to different emails
            </p>
          </div>
        </div>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Tests run in dry-run mode by default. No actions will be executed, only simulated.
        </AlertDescription>
      </Alert>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="manual">Manual Test</TabsTrigger>
          <TabsTrigger value="suite">Test Suite</TabsTrigger>
          <TabsTrigger value="results">Results</TabsTrigger>
        </TabsList>

        <TabsContent value="manual" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Test Input */}
            <Card>
              <CardHeader>
                <CardTitle>Test Email</CardTitle>
                <CardDescription>
                  Create a test email to see if it matches your{' '}
                  {isRuleGroup ? 'rule group' : 'rule'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Quick Scenarios */}
                <div>
                  <Label>Quick Scenarios</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => loadScenario('order-inquiry')}>
                      Order Inquiry
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => loadScenario('complaint')}>
                      Complaint
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => loadScenario('spam')}>
                      Spam
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => loadScenario('vip')}>
                      VIP Customer
                    </Button>
                  </div>
                </div>

                <Separator />

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="from">From Email</Label>
                    <Input
                      id="from"
                      type="email"
                      value={manualTest.from}
                      onChange={(e) => setManualTest({ ...manualTest, from: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="to">To Email</Label>
                    <Input
                      id="to"
                      type="email"
                      value={manualTest.to}
                      onChange={(e) => setManualTest({ ...manualTest, to: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="subject">Subject</Label>
                  <Input
                    id="subject"
                    value={manualTest.subject}
                    onChange={(e) => setManualTest({ ...manualTest, subject: e.target.value })}
                    placeholder="Email subject line"
                  />
                </div>

                <div>
                  <Label htmlFor="body">Body</Label>
                  <Textarea
                    id="body"
                    value={manualTest.body}
                    onChange={(e) => setManualTest({ ...manualTest, body: e.target.value })}
                    placeholder="Email body content"
                    rows={6}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="hasAttachments">Has Attachments</Label>
                    <Switch
                      id="hasAttachments"
                      checked={manualTest.hasAttachments}
                      onCheckedChange={(checked) =>
                        setManualTest({ ...manualTest, hasAttachments: checked })
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="isReply">Is Reply</Label>
                    <Switch
                      id="isReply"
                      checked={manualTest.isReply}
                      onCheckedChange={(checked) =>
                        setManualTest({ ...manualTest, isReply: checked })
                      }
                    />
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="forceEvaluation">Force Evaluation</Label>
                      <p className="text-xs text-muted-foreground">
                        Test rule even if conditions don't match
                      </p>
                    </div>
                    <Switch
                      id="forceEvaluation"
                      checked={manualTest.forceEvaluation}
                      onCheckedChange={(checked) =>
                        setManualTest({ ...manualTest, forceEvaluation: checked })
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="dryRun">Dry Run</Label>
                      <p className="text-xs text-muted-foreground">
                        Simulate actions without executing them
                      </p>
                    </div>
                    <Switch
                      id="dryRun"
                      checked={manualTest.dryRun}
                      onCheckedChange={(checked) =>
                        setManualTest({ ...manualTest, dryRun: checked })
                      }
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button onClick={runManualTest} disabled={isRunning} className="flex-1">
                    <Play className="mr-2 h-4 w-4" />
                    {isRunning ? 'Testing...' : 'Run Test'}
                  </Button>
                  <Button variant="outline" onClick={saveCurrentAsTestCase}>
                    <Save className="mr-2 h-4 w-4" />
                    Save as Test Case
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Rule/Rule Group Summary */}
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>{isRuleGroup ? 'Rule Group' : 'Rule'} Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Type</Label>
                    <Badge className="mt-1">{isRuleGroup ? 'RULE_GROUP' : item.type}</Badge>
                  </div>

                  <div>
                    <Label className="text-xs text-muted-foreground">Priority</Label>
                    <p className="text-sm">{item.priority}</p>
                  </div>

                  {isRuleGroup && ruleGroup.operator && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Operator</Label>
                      <p className="text-sm">{ruleGroup.operator}</p>
                    </div>
                  )}

                  {isRuleGroup && ruleGroup.rules && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Rules Count</Label>
                      <p className="text-sm">{ruleGroup.rules.length}</p>
                    </div>
                  )}

                  {isRule && rule.type === 'AI' && rule.instructions && (
                    <div>
                      <Label className="text-xs text-muted-foreground">AI Instructions</Label>
                      <p className="text-sm mt-1 line-clamp-3">{rule.instructions}</p>
                    </div>
                  )}

                  {isRule && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Expected Actions</Label>
                      <div className="mt-1 space-y-1">
                        {Object.entries(rule.actions || {}).map(([action, value]) => (
                          <Badge key={action} variant="outline" className="text-xs">
                            {action}: {typeof value === 'string' ? value : 'configured'}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {isRuleGroup && ruleGroup.actions && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Expected Actions</Label>
                      <div className="mt-1 space-y-1">
                        {Object.entries(ruleGroup.actions).map(([action, value]) => (
                          <Badge key={action} variant="outline" className="text-xs">
                            {action}: {typeof value === 'string' ? value : 'configured'}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Latest Test Result */}
              {testResults.length > 0 &&
                testResults[testResults.length - 1].testCaseId === 'manual' && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Test Result</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          {testResults[testResults.length - 1].matched ? (
                            <>
                              <CheckCircle className="h-5 w-5 text-green-500" />
                              <span className="font-medium">Rule Matched</span>
                            </>
                          ) : (
                            <>
                              <XCircle className="h-5 w-5 text-red-500" />
                              <span className="font-medium">Rule Did Not Match</span>
                            </>
                          )}
                        </div>

                        {testResults[testResults.length - 1].executedActions.length > 0 && (
                          <div>
                            <Label className="text-xs text-muted-foreground">
                              Actions Triggered
                            </Label>
                            <div className="mt-1 space-y-1">
                              {testResults[testResults.length - 1].executedActions.map(
                                (action, idx) => (
                                  <Badge key={idx} variant="secondary" className="text-xs">
                                    {action}
                                  </Badge>
                                )
                              )}
                            </div>
                          </div>
                        )}

                        <div className="text-xs text-muted-foreground">
                          Execution time: {testResults[testResults.length - 1].executionTime}ms
                        </div>

                        {testResults[testResults.length - 1].details && (
                          <details className="text-xs">
                            <summary className="cursor-pointer">View Details</summary>
                            <pre className="mt-2 bg-muted p-2 rounded overflow-auto">
                              {JSON.stringify(testResults[testResults.length - 1].details, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="suite" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Test Cases</CardTitle>
                  <CardDescription>Saved test cases for automated testing</CardDescription>
                </div>
                <div className="flex gap-2">
                  <input
                    type="file"
                    accept=".json"
                    onChange={importTestCases}
                    className="hidden"
                    id="import-file"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => document.getElementById('import-file')?.click()}>
                    <Upload className="mr-2 h-4 w-4" />
                    Import
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportTestCases}
                    disabled={testCases.length === 0}>
                    <Download className="mr-2 h-4 w-4" />
                    Export
                  </Button>
                  <Button
                    size="sm"
                    onClick={runTestSuite}
                    disabled={isRunning || testCases.length === 0}>
                    <Play className="mr-2 h-4 w-4" />
                    Run All
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {testCases.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No test cases saved yet</p>
                  <p className="text-sm mt-1">Create test cases from the Manual Test tab</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {testCases.map((testCase) => {
                    const result = testResults.find((r) => r.testCaseId === testCase.id)

                    return (
                      <div key={testCase.id} className="border rounded-lg p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium">{testCase.name}</h4>
                              {result &&
                                (result.passed ? (
                                  <CheckCircle className="h-4 w-4 text-green-500" />
                                ) : (
                                  <XCircle className="h-4 w-4 text-red-500" />
                                ))}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              {testCase.email?.subject}
                            </p>
                            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                              <span>From: {testCase.email?.from}</span>
                              <span>
                                Expected:{' '}
                                {testCase.expectedResult.shouldMatch ? 'Match' : 'No Match'}
                              </span>
                              {result && <span>Time: {result.executionTime}ms</span>}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteTestCase(testCase.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="results" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Test Results</CardTitle>
              <CardDescription>Results from all test runs in this session</CardDescription>
            </CardHeader>
            <CardContent>
              {testResults.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No test results yet</p>
                  <p className="text-sm mt-1">Run tests to see results here</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Summary */}
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Total Tests</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">{testResults.length}</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Passed</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold text-green-600">
                          {testResults.filter((r) => r.passed).length}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Failed</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold text-red-600">
                          {testResults.filter((r) => !r.passed).length}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Detailed Results */}
                  <div className="space-y-2">
                    {testResults.map((result, idx) => {
                      const testCase = testCases.find((tc) => tc.id === result.testCaseId)

                      return (
                        <div key={idx} className="border rounded-lg p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {result.passed ? (
                                <CheckCircle className="h-5 w-5 text-green-500" />
                              ) : (
                                <XCircle className="h-5 w-5 text-red-500" />
                              )}
                              <div>
                                <p className="font-medium">{testCase?.name || 'Manual Test'}</p>
                                <p className="text-sm text-muted-foreground">
                                  {result.matched ? 'Matched' : 'Did not match'} •
                                  {result.executedActions.length} actions •{result.executionTime}ms
                                </p>
                              </div>
                            </div>
                            {result.error && <Badge variant="destructive">Error</Badge>}
                          </div>

                          {result.error && (
                            <Alert variant="destructive" className="mt-3">
                              <AlertCircle className="h-4 w-4" />
                              <AlertDescription>{result.error}</AlertDescription>
                            </Alert>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
