// apps/web/src/app/(protected)/app/rules/_components/testing/testing-import-manual.tsx
'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { TestCaseForm } from './test-case-form'

interface TestingImportManualProps {
  onSubmit: (data: any) => Promise<void>
  isLoading?: boolean
  isEditMode?: boolean
  testCaseId?: string
  initialData?: any
}

export function TestingImportManual({
  onSubmit,
  isLoading,
  isEditMode = false,
  testCaseId,
  initialData,
}: TestingImportManualProps) {
  return (
    <div>
      <CardHeader>
        <CardTitle>{isEditMode ? 'Edit Test Case' : 'Create Test Case Manually'}</CardTitle>
        <CardDescription>
          {isEditMode
            ? 'Update the email content and expected behavior'
            : 'Define the email content and expected behavior'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TestCaseForm
          onSubmit={onSubmit}
          isLoading={isLoading}
          initialData={initialData}
          isEditMode={isEditMode}
          testCaseId={testCaseId}
        />
      </CardContent>
    </div>
  )
}
