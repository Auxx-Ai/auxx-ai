'use client'
import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import React, { useState, useEffect, useRef } from 'react'
import { client } from '~/auth/auth-client'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@auxx/ui/components/input-otp'

type Props = Record<string, unknown>

function TwoFactorForm(_props: Props) {
  const router = useRouter()
  const [otp, setOtp] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const prevLengthRef = useRef(0)
  const manualSubmitRef = useRef(false)

  // Auto-submit when OTP is completed (6 digits)
  useEffect(() => {
    // Only auto-submit when length changes from 5 to 6 (completion)
    // This prevents re-submission when validation fails
    if (
      otp.length === 6 &&
      prevLengthRef.current !== 6 &&
      /^\d{6}$/.test(otp) &&
      !manualSubmitRef.current
    ) {
      const form = document.querySelector('form')
      if (form && !isLoading) {
        form.requestSubmit()
      }
    }

    prevLengthRef.current = otp.length

    // Reset manual submit flag when OTP changes
    if (manualSubmitRef.current && otp.length < 6) {
      manualSubmitRef.current = false
    }
  }, [otp, isLoading])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validate that we have 6 digits
    if (!/^\d{6}$/.test(otp)) {
      setError('Please enter a valid 6-digit code')
      return
    }

    // Set flag to prevent auto-resubmission
    manualSubmitRef.current = true
    setIsLoading(true)
    setError('')

    try {
      const { data, error } = await client.twoFactor.verifyTotp({ code: otp })
      if (error) {
        setError(error.message)
        // Clear the OTP on error to prevent loops
        setOtp('')
      }
      if (data) {
        router.push('/app/mail/inbox/open')
        console.log('Success: and redirect', data)
      }
    } catch (_err) {
      setError('Invalid OTP. Please try again.')
      // Clear the OTP on error to prevent loops
      setOtp('')
    } finally {
      setIsLoading(false)
    }
  }

  // Handle key press events
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && otp.length === 6) {
      e.preventDefault()
      manualSubmitRef.current = true
      const form = document.querySelector('form')
      if (form && !isLoading) {
        form.requestSubmit()
      }
    }
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <Card className="shadow-md shadow-black/20 border-transparent">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Two Factor Authentication</CardTitle>
          <div className="text-sm text-muted-foreground">
            {error ? <p className="text-destructive text-sm">{error}</p> : 'Enter your code below'}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center justify-center">
              <InputOTP
                maxLength={6}
                value={otp}
                onChange={(value) => setOtp(value)}
                onKeyDown={handleKeyDown}>
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>

            <Button
              type="submit"
              className="w-full mt-4"
              disabled={isLoading || otp.length < 6}
              loading={isLoading}
              loadingText="Verifying...">
              Verify Code
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default TwoFactorForm
