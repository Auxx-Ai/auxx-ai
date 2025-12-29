// apps/web/src/app/(protected)/app/settings/general/_components/two-factor-dialog.tsx
'use client'

import { useState } from 'react'
import { Loader2, QrCode, ShieldCheck, ShieldOff } from 'lucide-react'
import QRCode from 'react-qr-code'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { client } from '~/auth/auth-client'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { CopyButton } from '@auxx/ui/components/button-copy'

import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '@auxx/ui/components/input-otp'

/**
 * Component for managing two-factor authentication - enable/disable 2FA and QR code display
 */
export function TwoFactorDialog(): JSX.Element {
  const { data: session } = client.useSession()
  const [isPendingTwoFa, setIsPendingTwoFa] = useState<boolean>(false)
  const [twoFaPassword, setTwoFaPassword] = useState<string>('')
  const [twoFactorDialog, setTwoFactorDialog] = useState<boolean>(false)
  const [twoFactorVerifyURI, setTwoFactorVerifyURI] = useState<string>('')

  /**
   * Handle QR code generation for already enabled 2FA
   */
  const handleShowQRCode = async () => {
    if (twoFaPassword.length < 8) {
      toastError({
        description: 'Password must be at least 8 characters',
      })
      return
    }
    await client.twoFactor.getTotpUri(
      { password: twoFaPassword },
      {
        onSuccess(context) {
          setTwoFactorVerifyURI(context.data.totpURI)
        },
      }
    )
    setTwoFaPassword('')
  }

  /**
   * Handle main 2FA toggle (enable/disable)
   */
  const handleTwoFactorToggle = async () => {
    if (twoFaPassword.length < 8 && !twoFactorVerifyURI) {
      toastError({ description: 'Password must be at least 8 characters' })
      return
    }

    if (twoFactorVerifyURI && twoFaPassword.length !== 6) {
      toastError({ description: 'Please enter a valid 6-digit OTP code' })
      return
    }

    setIsPendingTwoFa(true)

    if (session?.user.twoFactorEnabled) {
      // Disable 2FA
      await client.twoFactor.disable({
        //@ts-ignore
        password: twoFaPassword,
        fetchOptions: {
          onError(context) {
            toastError({ description: context.error.message })
          },
          onSuccess() {
            toastSuccess({ description: '2FA disabled successfully' })
            setTwoFactorDialog(false)
          },
        },
      })
    } else {
      if (twoFactorVerifyURI) {
        // Verify OTP to complete 2FA setup
        await client.twoFactor.verifyTotp({
          code: twoFaPassword,
          fetchOptions: {
            onError(context) {
              setIsPendingTwoFa(false)
              setTwoFaPassword('')
              toastError({ description: context.error.message })
            },
            onSuccess() {
              toastSuccess({ description: '2FA enabled successfully' })
              setTwoFactorVerifyURI('')
              setIsPendingTwoFa(false)
              setTwoFaPassword('')
              setTwoFactorDialog(false)
            },
          },
        })
        return
      }
      // Enable 2FA - verify password first
      await client.twoFactor.enable({
        password: twoFaPassword,
        fetchOptions: {
          onError(context) {
            toastError({ description: context.error.message })
          },
          onSuccess(ctx) {
            setTwoFactorVerifyURI(ctx.data.totpURI)
            toastSuccess({
              description:
                'Password verified. Please scan the QR code and enter the OTP to complete setup.',
            })
          },
        },
      })
    }
    setIsPendingTwoFa(false)
    setTwoFaPassword('')
  }

  /**
   * Check if the button should be disabled
   */
  const isButtonDisabled = () => {
    if (isPendingTwoFa) return true
    if (twoFactorVerifyURI) {
      // For OTP verification, require exactly 6 digits
      return twoFaPassword.length !== 6
    }
    // For password verification, require at least 8 characters
    return twoFaPassword.length < 8
  }

  return (
    <div className="flex gap-2">
      {!!session?.user.twoFactorEnabled && (
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <QrCode />
              Scan QR Code
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px] w-11/12">
            <DialogHeader className="pb-4">
              <DialogTitle>Scan QR Code</DialogTitle>
              <DialogDescription>Scan the QR code with your TOTP app</DialogDescription>
            </DialogHeader>

            {twoFactorVerifyURI ? (
              <>
                <div className="flex items-center justify-center">
                  <QRCode value={twoFactorVerifyURI} />
                </div>
                <div className="flex gap-2 items-center justify-center">
                  <p className="text-sm text-muted-foreground">Copy URI to clipboard</p>
                  <CopyButton text={twoFactorVerifyURI} />
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-2">
                <Input
                  value={twoFaPassword}
                  type="password"
                  onChange={(e) => setTwoFaPassword(e.target.value)}
                  placeholder="Enter Password"
                />
                <Button variant="outline" type="button" onClick={handleShowQRCode}>
                  Show QR Code
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
      <Dialog open={twoFactorDialog} onOpenChange={setTwoFactorDialog}>
        <DialogTrigger asChild>
          <Button size="sm" variant={session?.user.twoFactorEnabled ? 'destructive' : 'outline'}>
            {session?.user.twoFactorEnabled ? <ShieldOff /> : <ShieldCheck />}
            {session?.user.twoFactorEnabled ? 'Disable 2FA' : 'Enable 2FA'}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[425px] w-11/12">
          <DialogHeader className="mb-4">
            <DialogTitle>
              {session?.user.twoFactorEnabled ? 'Disable 2FA' : 'Enable 2FA'}
            </DialogTitle>
            <DialogDescription>
              {session?.user.twoFactorEnabled
                ? 'Disable the second factor authentication from your account'
                : 'Enable 2FA to secure your account'}
            </DialogDescription>
          </DialogHeader>

          {twoFactorVerifyURI ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Scan the QR code with your TOTP app</Label>

              <div className="flex items-center justify-center">
                <QRCode value={twoFactorVerifyURI} />
              </div>
              <div className="flex gap-2 items-center justify-center">
                <p className="text-sm text-muted-foreground">Copy URI to clipboard</p>
                <CopyButton text={twoFactorVerifyURI} />
              </div>

              <div className="flex flex-col mx-auto">
                <InputOTP
                  maxLength={6}
                  value={twoFaPassword}
                  onChange={(value) => setTwoFaPassword(value)}>
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

              {/* <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="Enter 6-digit OTP"
                maxLength={6}
              /> */}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Password"
                value={twoFaPassword}
                onChange={(e) => setTwoFaPassword(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={isButtonDisabled()}
              onClick={handleTwoFactorToggle}
              loading={isPendingTwoFa}
              loadingText="Processing...">
              {session?.user.twoFactorEnabled
                ? 'Disable 2FA'
                : twoFactorVerifyURI
                  ? 'Verify OTP'
                  : 'Verify Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
