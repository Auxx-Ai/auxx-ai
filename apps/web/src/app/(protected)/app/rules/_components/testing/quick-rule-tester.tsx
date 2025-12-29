// apps/web/src/app/(protected)/app/rules/_components/testing/quick-rule-tester.tsx
'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Badge } from '@auxx/ui/components/badge'
import { Switch } from '@auxx/ui/components/switch'
import { Separator } from '@auxx/ui/components/separator'
import {
  PlayCircle,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Settings,
  Plus,
  X,
  TestTubeDiagonal,
} from 'lucide-react'
import { toastError } from '@auxx/ui/components/toast'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@auxx/ui/components/collapsible'
import { EmptyState } from '~/components/global/empty-state'
import { AutosizeTextarea } from '@auxx/ui/components/autosize-textarea'

interface TestResult {
  ruleId: string
  ruleName: string
  ruleType: string
  matched: boolean
  confidence?: number
  reasoning?: string
  actions: any[]
  error?: string
  executionTime?: number
}

export function QuickRuleTester() {
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>([])
  const [testEmail, setTestEmail] = useState({
    subject: '',
    body: '',
    fromEmail: 'test@example.com',
    toEmail: 'support@company.com',
    hasAttachments: false,
  })
  const [testOptions, setTestOptions] = useState({
    testMode: true,
    enableDetailedLogging: false,
    recordStatistics: false,
  })
  const [results, setResults] = useState<TestResult[]>([])
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)

  // Get available rules for selection
  const availableRules = 0

  const handleTestRules = async () => {
    if (selectedRuleIds.length === 0) {
      toastError({ title: 'Please select at least one rule to test' })
      return
    }

    if (!testEmail.subject && !testEmail.body) {
      toastError({ title: 'Please provide either a subject or body for the test email' })
      return
    }
    setResults([])
  }

  const handleRuleSelection = (ruleIds: string[]) => {
    setSelectedRuleIds(ruleIds)
  }

  const loadTestScenario = (scenario: string) => {
    switch (scenario) {
      case 'complaint':
        setTestEmail({
          ...testEmail,
          subject: 'Terrible service - want refund immediately',
          body: `Hi support,
          
I'm extremely disappointed with my recent order. The product arrived damaged and two weeks late. This is completely unacceptable.

I want a full refund immediately or I'll dispute this charge with my bank.

Very unsatisfied customer,
John Doe`,
        })
        break
      case 'question':
        setTestEmail({
          ...testEmail,
          subject: 'Question about product specifications',
          body: `Hello,

I'm interested in your XYZ product but need to know:
- What are the dimensions?
- Is it compatible with ABC standard?
- What's the warranty period?

Thank you for your help.

Best regards,
Jane Smith`,
        })
        break
      case 'urgent':
        setTestEmail({
          ...testEmail,
          subject: 'URGENT: System down - need immediate help',
          body: `URGENT: Our production system is down and we need immediate assistance. This is affecting our business operations.

Please call me ASAP at 555-0123.

Thanks,
Manager`,
        })
        break
    }
  }

  const isEvaluating = false

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 h-full flex-1 overflow-y-auto">
      <div className="border-r-0 md:border-r md:overflow-y-auto">
        <div className="h-full relative flex flex-col">
          <div className="flex flex-col px-5 pt-4 space-y-1">
            <CardTitle className="flex items-center gap-2">
              <PlayCircle className="size-5" />
              Quick Rule Tester
            </CardTitle>
            <CardDescription>
              Test specific rules with custom email content using dependency injection architecture
            </CardDescription>
          </div>
          <div className="space-y-4 pt-3 px-5 flex-1">
            {/* Rule Selection */}
            <div className="space-y-2">
              {/* Display selected rules */}
              {selectedRuleIds.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">
                    Selected {selectedRuleIds.length} rule(s):
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedRuleIds.map((ruleId) => {
                      const rule = availableRules.find((r) => r.id === ruleId)
                      return rule ? (
                        <Badge key={ruleId} variant="user" className="flex items-center gap-1">
                          {rule.name}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto p-0 ml-1 hover:bg-transparent"
                            onClick={() =>
                              handleRuleSelection(selectedRuleIds.filter((id) => id !== ruleId))
                            }>
                            <X className="h-3 w-3 text-primary-500" />
                          </Button>
                        </Badge>
                      ) : null
                    })}
                  </div>
                </div>
              )}
            </div>

            <Separator />

            {/* Test Email Input */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Test Email Content</Label>
                <Select onValueChange={loadTestScenario}>
                  <SelectTrigger className="w-48" size="sm">
                    <SelectValue placeholder="Load test scenario..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="complaint">Customer Complaint</SelectItem>
                    <SelectItem value="question">Product Question</SelectItem>
                    <SelectItem value="urgent">Urgent Request</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="subject">Subject</Label>
                  <Input
                    id="subject"
                    value={testEmail.subject}
                    onChange={(e) => setTestEmail((prev) => ({ ...prev, subject: e.target.value }))}
                    placeholder="Email subject..."
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fromEmail">From Email</Label>
                  <Input
                    id="fromEmail"
                    type="email"
                    value={testEmail.fromEmail}
                    onChange={(e) =>
                      setTestEmail((prev) => ({ ...prev, fromEmail: e.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="body">Email Body</Label>
                <AutosizeTextarea
                  id="body"
                  minHeight={52}
                  value={testEmail.body}
                  onChange={(e) => setTestEmail((prev) => ({ ...prev, body: e.target.value }))}
                  placeholder="Email body content..."
                  rows={4}
                />
              </div>
            </div>

            {/* Advanced Options */}
            <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="flex items-center gap-2">
                  <Settings className="size-4" />
                  Advanced Options
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="testMode"
                      checked={testOptions.testMode}
                      onCheckedChange={(checked) =>
                        setTestOptions((prev) => ({ ...prev, testMode: checked }))
                      }
                    />
                    <Label htmlFor="testMode" className="text-sm">
                      Test Mode (No DB updates)
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="detailedLogging"
                      checked={testOptions.enableDetailedLogging}
                      onCheckedChange={(checked) =>
                        setTestOptions((prev) => ({ ...prev, enableDetailedLogging: checked }))
                      }
                    />
                    <Label htmlFor="detailedLogging" className="text-sm">
                      Detailed Logging
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="recordStats"
                      checked={testOptions.recordStatistics}
                      onCheckedChange={(checked) =>
                        setTestOptions((prev) => ({ ...prev, recordStatistics: checked }))
                      }
                    />
                    <Label htmlFor="recordStats" className="text-sm">
                      Record Statistics
                    </Label>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
          {/* Test Button */}
          <div className="sticky bottom-0 p-3 backdrop-blur-sm">
            <Button
              onClick={handleTestRules}
              loading={false}
              className="w-full "
              loadingText="Testing Rules...">
              Test Selected Rules
            </Button>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="flex h-full flex-1 bg-primary-50 md:overflow-y-auto border-t md:border-t-0">
        {results.length > 0 ? (
          <div>
            <CardHeader>
              <CardTitle>Test Results</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {results.map((result, index) => (
                  <div key={index} className="border rounded-lg p-4 bg-background space-y-2">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {result.matched ? (
                          <CheckCircle2 className="size-5 text-green-500" />
                        ) : result.error ? (
                          <XCircle className="size-5 text-red-500" />
                        ) : (
                          <AlertCircle className="size-5 text-gray-500" />
                        )}
                        <span className="font-medium">{result.ruleName}</span>
                        <Badge variant="outline">{result.ruleType}</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {result.matched ? `` : 'No Match'}
                      </div>
                    </div>
                    {result.confidence !== undefined && (
                      <Badge variant="secondary">
                        {Math.round(result.confidence * 100)}% confidence
                      </Badge>
                    )}

                    {result.reasoning && (
                      <div className="text-sm text-muted-foreground mb-2">
                        <strong>Reasoning:</strong> {result.reasoning}
                      </div>
                    )}

                    {result.error && (
                      <div className="text-sm text-red-600 mb-2">
                        <strong>Error:</strong> {result.error}
                      </div>
                    )}

                    {result.actions.length > 0 && (
                      <div className="text-sm">
                        <strong>Actions:</strong>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {result.actions.map((action, actionIndex) => (
                            <Badge key={actionIndex} variant="outline" className="text-xs">
                              {action.type}: {action.value || JSON.stringify(action)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </div>
        ) : isEvaluating ? (
          <EmptyState
            icon={TestTubeDiagonal}
            iconClassName="animate-spin"
            title="Running test"
            description={<>Evaluating results...</>}
          />
        ) : (
          <EmptyState
            icon={TestTubeDiagonal}
            title="Run your test"
            description={<>To see results</>}
          />
        )}
      </div>
    </div>
  )
}
