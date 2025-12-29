// apps/web/src/components/credentials/credential-form.tsx

'use client'

import { useState } from 'react'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Switch } from '@auxx/ui/components/switch'
import { Badge } from '@auxx/ui/components/badge'
import { CheckCircle, XCircle, Loader2, AlertTriangle } from 'lucide-react'
import { useCredentialTest } from '~/hooks/use-credential-test'
import type { CredentialTestResult } from '@auxx/workflow-nodes/types'

interface CredentialFormField {
  name: string
  displayName: string
  type: 'string' | 'number' | 'password' | 'boolean'
  required?: boolean
  placeholder?: string
  default?: any
}

interface CredentialFormProps {
  credentialType: string
  credentialDisplayName: string
  fields: CredentialFormField[]
  initialData?: Record<string, any>
  onSave: (data: Record<string, any>) => void
  onCancel: () => void
  isLoading?: boolean
}

/**
 * Dynamic credential form with testing capabilities
 */
export function CredentialForm({
  credentialType,
  credentialDisplayName,
  fields,
  initialData,
  onSave,
  onCancel,
  isLoading,
}: CredentialFormProps) {
  const [formData, setFormData] = useState<Record<string, any>>(initialData || {})
  const [testResult, setTestResult] = useState<CredentialTestResult | null>(null)
  const [showTestResult, setShowTestResult] = useState(false)

  const { testCredentialData, isTestingCredentialData } = useCredentialTest()

  /**
   * Update form field value
   */
  const updateField = (fieldName: string, value: any) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }))
    // Clear test result when form data changes
    if (showTestResult) {
      setShowTestResult(false)
      setTestResult(null)
    }
  }

  /**
   * Test the current credential data
   */
  const handleTest = async () => {
    try {
      const result = await testCredentialData({
        type: credentialType,
        data: formData,
      })

      setTestResult(result)
      setShowTestResult(true)
      return result.success
    } catch (error) {
      setTestResult({
        success: false,
        message: 'Test failed',
        error: {
          type: 'UNKNOWN_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      })
      setShowTestResult(true)
      return false
    }
  }

  /**
   * Save the credential (optionally test first)
   */
  const handleSave = async () => {
    onSave(formData)
  }

  /**
   * Test and save if test passes
   */
  const handleTestAndSave = async () => {
    const testPassed = await handleTest()
    if (testPassed) {
      await handleSave()
    }
  }

  /**
   * Render form field based on type
   */
  const renderField = (field: CredentialFormField) => {
    const value = formData[field.name] ?? field.default ?? ''

    switch (field.type) {
      case 'string':
      case 'number':
        return (
          <Input
            type={field.type}
            value={value}
            onChange={(e) =>
              updateField(
                field.name,
                field.type === 'number' ? Number(e.target.value) : e.target.value
              )
            }
            placeholder={field.placeholder}
            required={field.required}
          />
        )

      case 'password':
        return (
          <Input
            type="password"
            value={value}
            onChange={(e) => updateField(field.name, e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
          />
        )

      case 'boolean':
        return (
          <Switch
            checked={!!value}
            onCheckedChange={(checked) => updateField(field.name, checked)}
          />
        )

      default:
        return (
          <Input
            value={value}
            onChange={(e) => updateField(field.name, e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
          />
        )
    }
  }

  /**
   * Render test result display
   */
  const renderTestResult = () => {
    if (!showTestResult || !testResult) return null

    return (
      <Card
        className={`mt-4 ${testResult.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            {testResult.success ? (
              <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
            ) : (
              <XCircle className="h-5 w-5 text-red-600 mt-0.5" />
            )}

            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="font-medium">
                  {testResult.success ? 'Connection Successful' : 'Connection Failed'}
                </h4>
                {testResult.details?.connectionTime && (
                  <Badge variant="outline" className="text-xs">
                    {testResult.details.connectionTime}ms
                  </Badge>
                )}
              </div>

              <p className="text-sm text-muted-foreground mt-1">{testResult.message}</p>

              {testResult.details?.serverInfo && (
                <p className="text-xs text-muted-foreground mt-2">
                  Server: {testResult.details.serverInfo}
                </p>
              )}

              {testResult.details?.permissions && testResult.details.permissions.length > 0 && (
                <div className="flex gap-1 mt-2">
                  {testResult.details.permissions.map((permission) => (
                    <Badge key={permission} variant="secondary" className="text-xs">
                      {permission}
                    </Badge>
                  ))}
                </div>
              )}

              {testResult.error && (
                <div className="mt-2 p-2 bg-red-100 border border-red-200 rounded text-sm">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    <span className="font-medium">Error: {testResult.error.type}</span>
                  </div>
                  <p className="text-red-700 mt-1">{testResult.error.message}</p>
                  {testResult.error.code && (
                    <p className="text-red-600 text-xs mt-1">Code: {testResult.error.code}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{credentialDisplayName}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {fields.map((field) => (
            <div key={field.name} className="space-y-2">
              <Label htmlFor={field.name}>
                {field.displayName}
                {field.required && <span className="text-red-500 ml-1">*</span>}
              </Label>
              {renderField(field)}
            </div>
          ))}
        </CardContent>
      </Card>

      {renderTestResult()}

      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={handleTest}
          loading={isTestingCredentialData}
          loadingText="Testing...">
          Test Connection
        </Button>

        <Button
          onClick={handleTestAndSave}
          disabled={isLoading || isTestingCredentialData}
          loading={isLoading}
          loadingText="Saving...">
          Test & Save
        </Button>

        <Button
          variant="outline"
          onClick={handleSave}
          disabled={isLoading || isTestingCredentialData}
          loading={isLoading}
          loadingText="Saving...">
          Save Without Testing
        </Button>

        <Button
          variant="outline"
          onClick={handleSave}
          disabled={isLoading || isTestingCredentialData}>
          Save Without Testing
        </Button>

        <Button variant="ghost" onClick={onCancel} disabled={isLoading || isTestingCredentialData}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
