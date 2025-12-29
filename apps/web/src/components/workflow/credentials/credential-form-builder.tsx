// apps/web/src/app/(protected)/app/workflows/_components/credentials/credential-form-builder.tsx
'use client'

import React from 'react'
import { UseFormReturn } from 'react-hook-form'
import { INodeProperty, NodeValue, hasOAuth2Config } from '@auxx/workflow-nodes/types'
import { generateFormValidationRules } from './validation-utils'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { Textarea } from '@auxx/ui/components/textarea'
import { Switch } from '@auxx/ui/components/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Info } from 'lucide-react'
import { OAuth2Button } from './oauth2-button'
import type { ICredentialType } from '@auxx/workflow-nodes/types'

interface CredentialFormBuilderProps {
  properties: INodeProperty[]
  form: UseFormReturn<Record<string, any>>
  values?: Record<string, NodeValue>
  editMode?: boolean
  nonSensitiveValues?: Record<string, NodeValue>
  credentialType?: ICredentialType
  onOAuth2Success?: (credentialId: string) => void
}

/**
 * Determine if a field contains sensitive data that should not be pre-populated
 */
function isSensitiveField(property: INodeProperty): boolean {
  // Check field type
  if (property.type === 'password' || property.typeOptions?.password) {
    return true
  }

  // Check field name patterns
  const fieldName = property.name.toLowerCase()
  const sensitivePatterns = [
    'password',
    'passwd',
    'pwd',
    'key',
    'secret',
    'token',
    'auth',
    'credential',
    'privatekey',
    'passphrase',
  ]

  return sensitivePatterns.some((pattern) => fieldName.includes(pattern))
}

/**
 * Check if a field should be displayed based on display options
 */
function shouldDisplayField(property: INodeProperty, formValues: Record<string, any>): boolean {
  const { displayOptions } = property

  if (!displayOptions) return true

  // Check show conditions
  if (displayOptions.show) {
    for (const [fieldName, allowedValues] of Object.entries(displayOptions.show)) {
      const currentValue = formValues[fieldName]
      if (!allowedValues.includes(currentValue)) {
        return false
      }
    }
  }

  // Check hide conditions
  if (displayOptions.hide) {
    for (const [fieldName, hiddenValues] of Object.entries(displayOptions.hide)) {
      const currentValue = formValues[fieldName]
      if (hiddenValues.includes(currentValue)) {
        return false
      }
    }
  }

  return true
}

/**
 * Render individual form field based on property type
 */
function renderFormField(
  property: INodeProperty,
  form: UseFormReturn<Record<string, any>>,
  editMode: boolean = false,
  nonSensitiveValues: Record<string, NodeValue> = {}
) {
  const { name, type, displayName, description, placeholder, required, typeOptions, options } =
    property

  const isSensitive = isSensitiveField(property)

  // Generate comprehensive validation rules
  const validationRules = generateFormValidationRules(property, editMode)

  return (
    <FormField
      key={name}
      control={form.control}
      name={name}
      rules={validationRules}
      render={({ field }) => (
        <FormItem>
          <FormLabel
            className={required ? "after:content-['*'] after:ml-0.5 after:text-red-500" : ''}>
            {displayName}
          </FormLabel>
          <FormControl>
            {(() => {
              switch (type) {
                case 'string':
                  const isStringPassword = typeOptions?.password || isSensitive
                  const effectivePlaceholder =
                    editMode && isStringPassword
                      ? 'Enter new value (required)'
                      : placeholder || `Enter ${displayName.toLowerCase()}`

                  return (
                    <div>
                      <Input
                        {...field}
                        type={isStringPassword ? 'password' : 'text'}
                        placeholder={effectivePlaceholder}
                        value={field.value || ''}
                      />
                      {editMode && isStringPassword && (
                        <FormDescription className="text-blue-600 text-sm mt-1">
                          💡 Leave empty to keep existing value, or enter new value to update
                        </FormDescription>
                      )}
                    </div>
                  )

                case 'password':
                  const passwordPlaceholder = editMode
                    ? 'Enter new value (required)'
                    : placeholder || `Enter ${displayName.toLowerCase()}`

                  return (
                    <div>
                      <Input
                        {...field}
                        type="password"
                        placeholder={passwordPlaceholder}
                        value={field.value || ''}
                      />
                      {editMode && (
                        <FormDescription className="text-blue-600 text-sm mt-1">
                          💡 Leave empty to keep existing value, or enter new value to update
                        </FormDescription>
                      )}
                    </div>
                  )

                case 'number':
                  const numberPlaceholder = placeholder || `Enter ${displayName.toLowerCase()}`

                  return (
                    <Input
                      {...field}
                      type="number"
                      placeholder={numberPlaceholder}
                      value={field.value || ''}
                      onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : '')}
                    />
                  )

                case 'boolean':
                  return (
                    <div className="flex items-center space-x-2">
                      <Switch checked={field.value || false} onCheckedChange={field.onChange} />
                      <span className="text-sm text-muted-foreground">
                        {field.value ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                  )

                case 'options':
                  const selectPlaceholder = placeholder || `Select ${displayName.toLowerCase()}`

                  return (
                    <Select value={field.value || ''} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder={selectPlaceholder} />
                      </SelectTrigger>
                      <SelectContent>
                        {options?.map((option) => (
                          <SelectItem key={option.value} value={String(option.value)}>
                            {option.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )

                case 'json':
                  const jsonPlaceholder = placeholder || 'Enter JSON data'

                  return (
                    <Textarea
                      {...field}
                      placeholder={jsonPlaceholder}
                      rows={typeOptions?.rows || 4}
                      value={field.value || ''}
                    />
                  )

                case 'notice':
                  return (
                    <Alert variant="warning" className="mt-2">
                      <Info className="size-4" />
                      <AlertDescription>{displayName}</AlertDescription>
                    </Alert>
                  )

                case 'hidden':
                  return <Input {...field} type="hidden" value={field.value || ''} />

                default:
                  const defaultPlaceholder = placeholder || `Enter ${displayName.toLowerCase()}`
                  return (
                    <Input {...field} placeholder={defaultPlaceholder} value={field.value || ''} />
                  )
              }
            })()}
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

/**
 * Dynamic form builder for credential properties
 */
export function CredentialFormBuilder({
  properties,
  form,
  values = {},
  editMode = false,
  nonSensitiveValues = {},
  credentialType,
  onOAuth2Success,
}: CredentialFormBuilderProps) {
  const formValues = form.watch()

  // Check if this is an OAuth2 credential type
  const isOAuth2Credential = credentialType && hasOAuth2Config(credentialType)

  // If it's an OAuth2 credential, show the OAuth2 button instead of form fields
  if (isOAuth2Credential && !editMode) {
    const credentialName = form.getValues('name') || ''

    const handleOAuth2Success = (credentialId: string, userInfo?: any) => {
      // Set form values to indicate OAuth2 completion
      form.setValue('oauthComplete', true)
      form.setValue('oauthCredentialId', credentialId)
      if (userInfo?.email) {
        form.setValue('userEmail', userInfo.email)
      }

      // Call the success callback
      onOAuth2Success?.(credentialId)
    }

    const handleOAuth2Error = (error: string) => {
      // Reset OAuth2 state on error
      form.setValue('oauthComplete', false)
      form.setValue('oauthCredentialId', '')
      form.setValue('userEmail', '')
    }

    return (
      <div className="space-y-6">
        <OAuth2Button
          credentialType={credentialType}
          credentialName={credentialName}
          onSuccess={handleOAuth2Success}
          onError={handleOAuth2Error}
          disabled={!credentialName.trim()}
        />

        {!credentialName.trim() && (
          <Alert>
            <Info className="size-4" />
            <AlertDescription>
              Please enter a credential name above to enable authentication.
            </AlertDescription>
          </Alert>
        )}
      </div>
    )
  }

  // Regular form field rendering for non-OAuth2 credentials
  const visibleProperties = properties.filter((property) =>
    shouldDisplayField(property, { ...values, ...formValues })
  )

  // Separate notice fields from regular fields
  const noticeFields = visibleProperties.filter((p) => p.type === 'notice')
  const regularFields = visibleProperties.filter((p) => p.type !== 'notice' && p.type !== 'hidden')
  const hiddenFields = visibleProperties.filter((p) => p.type === 'hidden')

  return (
    <div className="space-y-6">
      {/* Notice fields at the top */}
      {noticeFields.length > 0 && (
        <div className="space-y-2">
          {noticeFields.map((property) =>
            renderFormField(property, form, editMode, nonSensitiveValues)
          )}
        </div>
      )}

      {/* Regular form fields */}
      {regularFields.length > 0 && (
        <div className="space-y-4">
          {regularFields.map((property) =>
            renderFormField(property, form, editMode, nonSensitiveValues)
          )}
        </div>
      )}

      {/* Hidden fields */}
      {hiddenFields.map((property) =>
        renderFormField(property, form, editMode, nonSensitiveValues)
      )}
    </div>
  )
}
