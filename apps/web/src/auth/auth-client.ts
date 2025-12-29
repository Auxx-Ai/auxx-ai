import { createAuthClient } from 'better-auth/react'
import { WEBAPP_URL } from '@auxx/config/client'
// import { passkeyClient } from 'better-auth/client/plugins'
import {
  // organizationClient,
  passkeyClient,
  phoneNumberClient,
  twoFactorClient,
  // adminClient,
  // multiSessionClient,
  // oneTapClient,
  // oidcClient,
  // genericOAuthClient,
} from 'better-auth/client/plugins'

export const client = createAuthClient({
  baseURL: WEBAPP_URL,
  plugins: [
    passkeyClient(),
    phoneNumberClient(),
    twoFactorClient({
      onTwoFactorRedirect() {
        window.location.href = '/two-factor'
      },
    }),
  ],
})

export const { signIn, signOut, useSession, updateUser, signUp, verifyEmail, changeEmail } = client
