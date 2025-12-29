// apps/web/src/app/(auth)/consent/_components/consent-content.tsx
'use client'

import { useState } from 'react'
import { client } from '~/auth/auth-client'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent } from '@auxx/ui/components/card'
import { ShieldCheck, AlertCircle } from 'lucide-react'

/**
 * Props for the ConsentContent component
 */
interface ConsentContentProps {
  consentCode: string | null
  clientId: string | null
  scopes: string[]
}

/**
 * Internal state for consent processing
 */
interface ConsentState {
  loading: boolean
  error: string | null
}

/**
 * Format scope into human-readable description
 */
function formatScopeDescription(scope: string): string {
  const scopeDescriptions: Record<string, string> = {
    developer: 'Access your developer account',
    'apps:read': 'View your applications',
    'apps:write': 'Create and modify applications',
    'versions:publish': 'Publish application versions',
    openid: 'Verify your identity',
    profile: 'Access your profile information',
    email: 'Access your email address',
  }

  return scopeDescriptions[scope] || scope
}

/**
 * OAuth Consent Content
 * Displays authorization request and allows user to approve or deny access
 */
export function ConsentContent({ consentCode, clientId, scopes }: ConsentContentProps) {
  const [state, setState] = useState<ConsentState>({
    loading: false,
    error: null,
  })

  // Validate required params
  if (!consentCode || !clientId) {
    return (
      <Card className="shadow-md shadow-black/20 border-transparent w-full">
        <CardContent className="flex flex-col gap-4 overflow-hidden pt-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <div className="font-semibold">Authorization Error</div>
          </div>
          <p className="text-sm text-muted-foreground">
            Invalid consent request. Missing required parameters.
          </p>
        </CardContent>
      </Card>
    )
  }

  /**
   * Handle consent decision (approve or deny)
   */
  const handleConsent = async (accept: boolean) => {
    setState({ loading: true, error: null })

    try {
      const res = await client.oauth2.consent({
        accept,
        consent_code: consentCode,
      })

      console.log('Consent response:', res)

      if (res.error) {
        setState({
          loading: false,
          error: res.error.message || 'Failed to process consent',
        })
        return
      }

      // Better-auth should redirect automatically, but if not, check for redirect URL
      if (res.data) {
        console.log('Consent data:', res.data)

        if (typeof res.data === 'object' && 'url' in res.data) {
          window.location.href = res.data.url as string
        } else if (typeof res.data === 'string') {
          window.location.href = res.data
        }
      }

      // If we get here and there's no redirect, better-auth might handle it automatically
      setTimeout(() => {
        setState({
          loading: false,
          error: 'Authorization processed but redirect did not occur. Please close this window.',
        })
      }, 3000)
    } catch (error) {
      console.error('Consent error:', error)
      setState({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to process consent',
      })
    }
  }

  // Use clientId as client name (TODO: fetch actual name from DB)
  const clientName = clientId

  return (
    <Card className="shadow-md shadow-black/20 border-transparent w-full">
      <CardContent className="flex flex-col gap-4 overflow-hidden pt-6">
        {state.error ? (
          <>
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <div className="font-semibold">Authorization Error</div>
            </div>
            <p className="text-sm text-muted-foreground">{state.error}</p>
          </>
        ) : (
          <>
            <div className="font-semibold leading-none tracking-tight py-4 text-xl text-center">
              Authorize Application
            </div>

            <div className="text-center mb-2">
              <p className="text-sm text-muted-foreground">
                <strong className="text-foreground">{clientName}</strong> is requesting access to
                your account
              </p>
            </div>

            {scopes.length > 0 && (
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="h-4 w-4" />
                  <span>This application will be able to:</span>
                </div>
                <ul className="space-y-1.5 ml-6">
                  {scopes.map((scope) => (
                    <li key={scope} className="text-sm text-muted-foreground">
                      • {formatScopeDescription(scope)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex gap-3 mt-2">
              <Button
                variant="outline"
                onClick={() => handleConsent(false)}
                disabled={state.loading}
                className="flex-1">
                Deny
              </Button>
              <Button
                onClick={() => handleConsent(true)}
                disabled={state.loading}
                loading={state.loading}
                loadingText="Authorizing..."
                className="flex-1">
                Authorize
              </Button>
            </div>

            <p className="text-xs text-muted-foreground text-center mt-2">
              By authorizing, you allow this application to access your data according to their
              privacy policy.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
