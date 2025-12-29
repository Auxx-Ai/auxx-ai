// apps/web/src/app/(protected)/app/rules/_components/testing/coverage-content.tsx
'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCircle, XCircle, TrendingUp, TrendingDown, Plus } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Progress } from '@auxx/ui/components/progress'
import { Badge } from '@auxx/ui/components/badge'
import { useTestingContext } from './testing-provider'
import { cn } from '@auxx/ui/lib/utils'

interface RuleCoverage {
  ruleId: string
  ruleName: string
  ruleType: string
  isActive: boolean
  testCaseCount: number
  lastTested?: Date
  testResults: {
    passed: number
    failed: number
    total: number
  }
}

export function CoverageContent() {
  const { testCases } = useTestingContext()
  const [selectedRuleType, setSelectedRuleType] = useState<string | null>(null)

  // Mock data for rule coverage
  const mockRuleCoverage: RuleCoverage[] = [
    {
      ruleId: 'rule-1',
      ruleName: 'Auto-assign to support team',
      ruleType: 'Assignment',
      isActive: true,
      testCaseCount: 3,
      lastTested: new Date(Date.now() - 1000 * 60 * 60 * 24),
      testResults: { passed: 3, failed: 0, total: 3 },
    },
    {
      ruleId: 'rule-2',
      ruleName: 'Tag urgent orders',
      ruleType: 'Tagging',
      isActive: true,
      testCaseCount: 2,
      lastTested: new Date(Date.now() - 1000 * 60 * 60 * 48),
      testResults: { passed: 1, failed: 1, total: 2 },
    },
    {
      ruleId: 'rule-3',
      ruleName: 'Forward to sales',
      ruleType: 'Forwarding',
      isActive: true,
      testCaseCount: 0,
      lastTested: undefined,
      testResults: { passed: 0, failed: 0, total: 0 },
    },
    {
      ruleId: 'rule-4',
      ruleName: 'Auto-reply to common questions',
      ruleType: 'Response',
      isActive: false,
      testCaseCount: 1,
      lastTested: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7),
      testResults: { passed: 1, failed: 0, total: 1 },
    },
  ]

  // Calculate coverage statistics
  const totalRules = mockRuleCoverage.length
  const testedRules = mockRuleCoverage.filter((r) => r.testCaseCount > 0).length
  const untestedRules = mockRuleCoverage.filter((r) => r.testCaseCount === 0).length
  const coveragePercentage = Math.round((testedRules / totalRules) * 100)

  // Group rules by type
  const ruleTypes = Array.from(new Set(mockRuleCoverage.map((r) => r.ruleType)))
  const filteredRules = selectedRuleType
    ? mockRuleCoverage.filter((r) => r.ruleType === selectedRuleType)
    : mockRuleCoverage

  return (
    <div className="space-y-6">
      {/* Coverage Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Overall Coverage</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-end gap-2">
                <span className="text-3xl font-bold">{coveragePercentage}%</span>
                <span className="text-sm text-muted-foreground mb-1">of rules tested</span>
              </div>
              <Progress value={coveragePercentage} className="h-2" />
              <p className="text-sm text-muted-foreground">
                {testedRules} of {totalRules} rules have test cases
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Coverage Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-green-600">+12%</p>
                <p className="text-sm text-muted-foreground">vs last month</p>
              </div>
              <TrendingUp className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Untested Rules</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-orange-600">{untestedRules}</p>
                <p className="text-sm text-muted-foreground">rules need tests</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Rule Type Filter */}
      <div className="flex gap-2">
        <Button
          variant={selectedRuleType === null ? 'default' : 'outline'}
          size="sm"
          onClick={() => setSelectedRuleType(null)}>
          All Types
        </Button>
        {ruleTypes.map((type) => (
          <Button
            key={type}
            variant={selectedRuleType === type ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedRuleType(type)}>
            {type}
          </Button>
        ))}
      </div>

      {/* Rules Coverage List */}
      <div className="space-y-3">
        {filteredRules.map((rule) => {
          const passRate =
            rule.testResults.total > 0
              ? Math.round((rule.testResults.passed / rule.testResults.total) * 100)
              : 0

          return (
            <Card
              key={rule.ruleId}
              className={cn('transition-colors', !rule.isActive && 'opacity-60')}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="font-medium">{rule.ruleName}</h3>
                      <Badge variant="secondary" className="text-xs">
                        {rule.ruleType}
                      </Badge>
                      {!rule.isActive && (
                        <Badge variant="outline" className="text-xs">
                          Inactive
                        </Badge>
                      )}
                    </div>

                    <div className="mt-2 flex items-center gap-6 text-sm">
                      {rule.testCaseCount > 0 ? (
                        <>
                          <span className="text-muted-foreground">
                            {rule.testCaseCount} test case{rule.testCaseCount !== 1 ? 's' : ''}
                          </span>
                          <div className="flex items-center gap-2">
                            {passRate === 100 ? (
                              <CheckCircle className="h-4 w-4 text-green-600" />
                            ) : passRate > 0 ? (
                              <AlertTriangle className="h-4 w-4 text-orange-600" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-600" />
                            )}
                            <span
                              className={cn(
                                passRate === 100 && 'text-green-600',
                                passRate > 0 && passRate < 100 && 'text-orange-600',
                                passRate === 0 && rule.testResults.total > 0 && 'text-red-600'
                              )}>
                              {passRate}% passing
                            </span>
                          </div>
                          {rule.lastTested && (
                            <span className="text-muted-foreground">
                              Last tested {new Date(rule.lastTested).toLocaleDateString()}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-orange-600">No test coverage</span>
                      )}
                    </div>
                  </div>

                  <Button size="sm" variant={rule.testCaseCount === 0 ? 'default' : 'outline'}>
                    <Plus className="mr-2 h-4 w-4" />
                    {rule.testCaseCount === 0 ? 'Add Test' : 'Add More'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle>Recommendations</CardTitle>
          <CardDescription>Improve your test coverage with these suggestions</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            <li className="flex items-start gap-2">
              <span className="text-orange-600">•</span>
              <span className="text-sm">
                Add test cases for the {untestedRules} untested rules to achieve 100% coverage
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-orange-600">•</span>
              <span className="text-sm">
                Review and update test cases for rules with failing tests
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-orange-600">•</span>
              <span className="text-sm">Consider adding edge case tests for critical rules</span>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
