// apps/web/src/app/(protected)/app/settings/general/_components/change-password.tsx
'use client'

import { useState } from 'react'
import { RectangleEllipsis } from 'lucide-react'

import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { client } from '~/auth/auth-client'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'
import { PasswordStrengthIndicator } from '~/components/credentials/password-fields'
import { useUser } from '~/hooks/use-user'

/**
 * Component for changing or adding a password to user account
 * Includes automatic session refresh after password operations to update UI state
 */
export function ChangePassword() {
  const { refetch: refetchSession } = client.useSession()
  const { user } = useUser()
  const [currentPassword, setCurrentPassword] = useState<string>('')
  const [newPassword, setNewPassword] = useState<string>('')
  const [confirmPassword, setConfirmPassword] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [open, setOpen] = useState<boolean>(false)
  const [signOutDevices, setSignOutDevices] = useState<boolean>(false)

  const addPassword = api.auth.addPassword.useMutation()

  // Check if user has a password already set
  // This checks if the user signed up with OAuth or phone (no password)
  const hasPassword = user?.hasPassword === true

  /**
   * Handles password change or addition
   */
  const handlePasswordSubmit = async () => {
    if (newPassword !== confirmPassword) {
      toastError({ description: 'Passwords do not match' })
      return
    }
    if (newPassword.length < 8) {
      toastError({ description: 'Password must be at least 8 characters' })
      return
    }
    setLoading(true)

    let res
    if (hasPassword) {
      // Change existing password
      res = await client.changePassword({
        newPassword: newPassword,
        currentPassword: currentPassword,
        revokeOtherSessions: signOutDevices,
      })
    } else {
      // Add password for first time
      res = await addPassword.mutateAsync({ newPassword })
      console.log('addPassword', res)
    }

    setLoading(false)
    if (res.error) {
      toastError({
        description:
          res.error.message || hasPassword
            ? "Couldn't change your password! Make sure it's correct"
            : "Couldn't add your password! Please try again",
      })
    } else {
      setOpen(false)
      toastSuccess({
        description: hasPassword ? 'Password changed successfully' : 'Password added successfully',
      })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      // Refetch session to update hasPassword status and trigger UI updates
      refetchSession()
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <RectangleEllipsis />
          {hasPassword ? 'Change Password' : 'Add Password'}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] w-11/12">
        <ChangePasswordDialogContent
          hasPassword={hasPassword}
          currentPassword={currentPassword}
          setCurrentPassword={setCurrentPassword}
          newPassword={newPassword}
          setNewPassword={setNewPassword}
          confirmPassword={confirmPassword}
          setConfirmPassword={setConfirmPassword}
          signOutDevices={signOutDevices}
          setSignOutDevices={setSignOutDevices}
          loading={loading}
          handlePasswordSubmit={handlePasswordSubmit}
          onClose={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

/** Inner content props for ChangePasswordDialog */
interface ChangePasswordDialogContentProps {
  hasPassword: boolean
  currentPassword: string
  setCurrentPassword: (value: string) => void
  newPassword: string
  setNewPassword: (value: string) => void
  confirmPassword: string
  setConfirmPassword: (value: string) => void
  signOutDevices: boolean
  setSignOutDevices: (value: boolean) => void
  loading: boolean
  handlePasswordSubmit: () => Promise<void>
  onClose: () => void
}

/** Inner content component */
function ChangePasswordDialogContent({
  hasPassword,
  currentPassword,
  setCurrentPassword,
  newPassword,
  setNewPassword,
  confirmPassword,
  setConfirmPassword,
  signOutDevices,
  setSignOutDevices,
  loading,
  handlePasswordSubmit,
  onClose,
}: ChangePasswordDialogContentProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{hasPassword ? 'Change Password' : 'Add Password'}</DialogTitle>
        <DialogDescription>
          {hasPassword
            ? 'Change your password'
            : 'Add a password to your account for additional sign-in options'}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        {hasPassword && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="current-password">Current Password</Label>
            <Input
              type="password"
              id="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Password"
            />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Input
            type="password"
            id="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            placeholder="New Password"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Input
            type="password"
            id="confirm-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            placeholder="Confirm Password"
          />
        </div>
        <PasswordStrengthIndicator password={newPassword} confirmPassword={confirmPassword} />

        {hasPassword && (
          <div className="flex gap-2 items-center">
            <Checkbox
              onCheckedChange={(checked) =>
                checked ? setSignOutDevices(true) : setSignOutDevices(false)
              }
            />
            <p className="text-sm">Sign out from other devices</p>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel <Kbd shortcut="esc" variant="ghost" size="sm" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          loading={loading}
          loadingText="Saving..."
          onClick={handlePasswordSubmit}
          data-dialog-submit>
          {hasPassword ? 'Change Password' : 'Add Password'}
          <KbdSubmit variant="outline" size="sm" />
        </Button>
      </DialogFooter>
    </>
  )
}
