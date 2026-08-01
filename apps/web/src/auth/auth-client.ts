// apps/web/src/auth/auth-client.ts

import { passkeyClient } from '@better-auth/passkey/client'
// import { WEBAPP_URL } from '@auxx/config/client'
import {
  inferAdditionalFields,
  oidcClient,
  phoneNumberClient,
  twoFactorClient,
} from 'better-auth/client/plugins'

import { createAuthClient } from 'better-auth/react'

export const client = createAuthClient({
  // baseURL: WEBAPP_URL,
  plugins: [
    // Mirrors the *client-settable* subset of `user.additionalFields` in
    // auth/server.ts. Everything else there is `input: false` and must stay out
    // of this list — declaring a field here is what makes the client send it.
    inferAdditionalFields({
      user: { signupSource: { type: 'string', required: false } },
    }),
    // Mirrors `oidcProvider()` on the server — without it `client.oauth2` is
    // undefined and the /consent page throws instead of completing the flow.
    oidcClient(),
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
