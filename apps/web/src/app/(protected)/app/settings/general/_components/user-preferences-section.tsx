// apps/web/src/app/(protected)/app/settings/general/_components/user-preferences-section.tsx
'use client'

import { TimezoneSettings } from '~/components/settings/timezone-settings'
import { LastLoginDisplay } from '~/components/settings/last-login-display'
import { useDehydratedUser } from '~/providers/dehydrated-state-provider'

/**
 * Client component for user preferences section
 * Uses dehydrated user data for timezone and last login
 */
export function UserPreferencesSection() {
  const user = useDehydratedUser()

  return (
    <section>
      {/* Timezone Selection */}
      <div className="mb-8">
        <TimezoneSettings currentTimezone={user.preferredTimezone} />
      </div>

      {/* Last Login Display */}
      <div>
        <LastLoginDisplay
          lastLoginAt={user.lastLoginAt}
          timezone={user.preferredTimezone || 'UTC'}
        />
      </div>
    </section>
  )
}
