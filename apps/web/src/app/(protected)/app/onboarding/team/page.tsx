// apps/web/src/app/(protected)/app/onboarding/team/page.tsx
'use client'
import { OrganizationRole as OrganizationRoleEnum } from '@auxx/database/enums'
import type { OrganizationRole } from '@auxx/database/types'
import { Button } from '@auxx/ui/components/button'
import { CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@auxx/ui/components/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { Copy, Plus, Trash2, Users } from 'lucide-react'
import { motion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { updateUser } from '~/auth/auth-client'
import {
  useDehydratedOrganization,
  useDehydratedOrganizationId,
} from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'
import { OnboardingNavigation } from '../_components/onboarding-navigation'
import { useOnboarding } from '../_components/onboarding-provider'

interface TeamInvite {
  email: string
  role: OrganizationRole
}
export default function TeamOnboardingPage() {
  const router = useRouter()
  const { state, updateTeam, markStepCompleted, resetState } = useOnboarding()
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Get current org data from dehydrated state as fallback
  const organizationId = useDehydratedOrganizationId()
  const currentOrg = useDehydratedOrganization(organizationId)

  const [invites, setInvites] = useState<TeamInvite[]>(
    state.team.invites.length > 0
      ? state.team.invites
      : [{ email: '', role: OrganizationRoleEnum.USER }]
  )
  // API mutations
  const updateOrganization = api.organization.update.useMutation()
  const updateUserProfile = api.user.updateProfile.useMutation()
  const inviteBatch = api.member.inviteBatch.useMutation()
  // Add new invite row
  const addInvite = () => {
    setInvites([...invites, { email: '', role: OrganizationRoleEnum.USER }])
  }
  // Remove invite row
  const removeInvite = (index: number) => {
    if (invites.length > 1) {
      setInvites(invites.filter((_, i) => i !== index))
    }
  }
  // Update invite email
  const updateInviteEmail = (index: number, email: string) => {
    const updated = [...invites]
    updated[index].email = email
    setInvites(updated)
  }
  // Update invite role
  const updateInviteRole = (index: number, role: OrganizationRole) => {
    const updated = [...invites]
    updated[index].role = role
    setInvites(updated)
  }
  // Copy invite link
  const copyInviteLink = async () => {
    const inviteLink = `${window.location.origin}/invite/${state.organization.handle || 'org'}`
    await navigator.clipboard.writeText(inviteLink)
    toastSuccess({
      title: 'Link copied!',
      description: 'Invite link has been copied to clipboard',
    })
  }
  // Complete onboarding
  const completeOnboarding = async (skipInvites: boolean = false) => {
    setIsSubmitting(true)
    try {
      // 1. Update user profile with firstName/lastName
      if (state.personal.firstName || state.personal.lastName) {
        await updateUserProfile.mutateAsync({
          firstName: state.personal.firstName,
          lastName: state.personal.lastName,
        })
      }
      // 2. Update organization with handle and mark onboarding complete
      // Use dehydrated state as fallback for values not in sessionStorage
      await updateOrganization.mutateAsync({
        name: state.organization.name || currentOrg?.name || undefined,
        handle: state.organization.handle || currentOrg?.handle || undefined,
        website: state.organization.website || currentOrg?.website || undefined,
        completedOnboarding: true,
      })
      // 3. Send team invites if any (skip if no valid emails or skipped)
      if (!skipInvites && invites.length > 0) {
        const validInvites = invites.filter((i) => i.email)
        if (validInvites.length > 0) {
          const results = await inviteBatch.mutateAsync({ invites: validInvites })
          // Check for any failed invites
          const failedInvites = results.filter((r) => !r.success)
          if (failedInvites.length > 0) {
            toastError({
              title: 'Some invites failed',
              description: `Failed to send ${failedInvites.length} invite(s). You can resend them later.`,
            })
          } else if (results.length > 0) {
            toastSuccess({
              title: 'Invitations sent',
              description: `Successfully sent ${results.length} invitation(s)`,
            })
          }
        }
      }
      // 4. Clear sessionStorage
      resetState()
      // 5. Update auth session to reflect completedOnboarding
      await updateUser({ completedOnboarding: true })
      // 6. Redirect to main app (full reload to get fresh dehydrated state)
      window.location.href = '/app'
    } catch (error) {
      console.error('Failed to complete onboarding:', error)
      toastError({
        title: 'Error completing onboarding',
        description: 'Please try again or contact support if the issue persists.',
      })
      setIsSubmitting(false)
    }
  }
  const handleSendInvites = () => {
    // Save invites to state
    updateTeam({ invites, skipped: false })
    markStepCompleted(4)
    // Complete onboarding
    completeOnboarding(false)
  }
  const handleSkip = () => {
    updateTeam({ invites: [], skipped: true })
    markStepCompleted(4)
    // Complete onboarding without invites
    completeOnboarding(true)
  }
  const handleBack = () => {
    // Save current invites to state
    updateTeam({ invites })
    router.push('/app/onboarding/connections')
  }
  const hasValidInvites = invites.some((i) => i.email)
  // Animation variants
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.2,
      },
    },
  }
  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.5,
        ease: 'easeOut' as const,
      },
    },
  }
  return (
    <div className='grid grid-cols-1 md:grid-cols-2 w-full'>
      {/* Left column: Team invitations */}
      <div className='relative md:border-r bg-transparent shadow-none p-4'>
        <motion.div variants={containerVariants} initial='hidden' animate='visible'>
          <motion.div variants={itemVariants}>
            <CardHeader>
              <CardTitle className='font-normal'>Collaborate with your team</CardTitle>
              <CardDescription>
                The more your teammates use Auxx.ai, the more powerful it becomes.
              </CardDescription>
            </CardHeader>
          </motion.div>

          <CardContent className='space-y-4'>
            <motion.div variants={itemVariants} className='space-y-4'>
              <h3 className='text-sm font-medium'>Invite your team to collaborate</h3>

              {/* Invite list */}
              <div className='space-y-3'>
                {invites.map((invite, index) => (
                  <div key={index} className='flex gap-2'>
                    <InputGroup className='flex-1'>
                      <InputGroupInput
                        type='email'
                        placeholder='colleague@example.com'
                        value={invite.email}
                        onChange={(e) => updateInviteEmail(index, e.target.value)}
                      />
                      <InputGroupAddon align='inline-end'>
                        <Select
                          value={invite.role}
                          onValueChange={(value) =>
                            updateInviteRole(index, value as OrganizationRole)
                          }>
                          <SelectTrigger
                            variant='transparent'
                            className='w-28 h-auto border-0 shadow-none'>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={OrganizationRoleEnum.USER}>Member</SelectItem>
                            <SelectItem value={OrganizationRoleEnum.ADMIN}>Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </InputGroupAddon>
                    </InputGroup>
                    {invites.length > 1 && (
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        onClick={() => removeInvite(index)}>
                        <Trash2 className='size-4' />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <div className='flex flex-row items-center justify-between pt-3'>
                {/* Add more button */}
                <Button type='button' variant='outline' size='sm' onClick={addInvite}>
                  <Plus />
                  Add another
                </Button>

                {/* Copy invite link */}
                <Button type='button' variant='outline' size='sm' onClick={copyInviteLink}>
                  <Copy />
                  Copy invite link
                </Button>
              </div>
            </motion.div>

            {/* Info message */}
            <motion.div variants={itemVariants} className='rounded-lg bg-muted p-4'>
              <p className='text-sm text-muted-foreground'>
                <Users className='inline size-4 mr-2' />
                Team members will receive an email invitation to join your organization.
              </p>
            </motion.div>

            {/* Navigation */}
            <motion.div variants={itemVariants} className='space-y-3'>
              <Button
                onClick={handleSendInvites}
                disabled={isSubmitting}
                loading={isSubmitting}
                loadingText='Completing setup...'
                className='w-full'>
                Send invites & finish
              </Button>
              <Button
                onClick={handleSkip}
                variant='ghost'
                disabled={isSubmitting}
                loading={isSubmitting}
                loadingText='Completing setup...'
                className='w-full'>
                Skip for now
              </Button>

              <OnboardingNavigation
                onBack={handleBack}
                showContinue={false}
                showSkip={false}
                onSkip={handleSkip}
                skipText={hasValidInvites ? 'Skip and finish' : 'Complete setup'}
              />
            </motion.div>
          </CardContent>
        </motion.div>
      </div>

      {/* Right column: Illustration - hidden on mobile */}
      <div className='hidden md:flex items-center justify-center p-14'>
        <motion.div
          className='text-center'
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.3, ease: 'easeOut' }}>
          <motion.h2
            className='text-2xl font-semibold mb-4'
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}>
            Stronger Together
          </motion.h2>
          <motion.p
            className='text-muted-foreground'
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.6 }}>
            Invite your team to collaborate on customer support. Share knowledge, templates, and
            provide consistent responses across your organization.
          </motion.p>
        </motion.div>
      </div>
    </div>
  )
}
