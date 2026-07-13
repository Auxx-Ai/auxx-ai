// apps/web/src/components/channels/hooks/use-channel-reconnect.ts

'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useRef } from 'react'
import {
  type ConnectFlowDefinition,
  useConnectFlow,
} from '~/components/apps/hooks/use-connect-flow'
import { api } from '~/trpc/react'

const RETURN_TO = '/app/settings/channels'

/**
 * Shared channel reconnect: resolves the credential/definition for an integration
 * (`channelReauth.getAuthStatus`), then runs it through `useConnectFlow`'s reconnect path — silent
 * `connections.refreshTokens` first (`attemptRefreshThenOAuth`), popup only when the refresh grant
 * is actually dead. Replaces the four bespoke `channelReauth.initiateReauth` +
 * `window.location.href` call sites (plans/channels/v3/README.md Phase 2).
 */
export function useChannelReconnect() {
  const utils = api.useUtils()
  const resetSyncState = api.channel.resetSyncState.useMutation()
  // credentialId -> integrationId, set right before a reconnect attempt starts. `onConnected`
  // fires with the credId, which for a reconnect always equals the credentialId we passed in.
  const integrationByCredential = useRef(new Map<string, string>())

  const flow = useConnectFlow({
    onConnected: (credId) => {
      void utils.channel.list.invalidate()
      void utils.channelReauth.getAuthStatus.invalidate()
      void utils.channelReauth.getMultipleAuthStatus.invalidate()

      // Sync-breaker gap: the provisioning hook's relink branch resets `syncStatus`/`syncStage`
      // back to a healthy baseline, but that only runs on a full OAuth callback. A *silent*
      // refresh success (attemptRefreshThenOAuth) skips the callback entirely, so a channel
      // stuck at FAILED would refresh its token and still show "Sync Error" forever.
      // `useConnectFlow` doesn't expose which path settled `onConnected` (both the silent-refresh
      // branch and the popup's `onDone` call the same callback) — resetting on every success is
      // harmless: the provisioning hook already reset it on the popup path, so this is a no-op
      // re-write there, and the only path where it actually matters.
      const integrationId = integrationByCredential.current.get(credId)
      if (integrationId) {
        integrationByCredential.current.delete(credId)
        resetSyncState.mutate({ integrationId })
      }
    },
  })

  const reconnect = useCallback(
    async (integrationId: string) => {
      try {
        const status = await utils.channelReauth.getAuthStatus.fetch({ integrationId })
        if (!status.credentialId || !status.connectionDefinitionId || !status.providerKey) {
          toastError({
            title: 'Cannot reconnect',
            description: 'This channel has no linked connection to reconnect.',
          })
          return
        }

        integrationByCredential.current.set(status.credentialId, integrationId)

        const def: ConnectFlowDefinition = { connectionType: 'oauth2-code' }
        flow.start({
          target: {
            owner: {
              kind: 'platform',
              connectionDefinitionId: status.connectionDefinitionId,
              providerKey: status.providerKey,
            },
            title: status.name || status.email || 'Channel',
            // Reconnect never needs the def resolved by scope (it's not entering the variable
            // dialog), so both keys point at the same trivial def — `pickDef` just needs one to
            // find a match for whichever scope this credential turns out to be.
            connectionDefinitions: { user: def, organization: def },
          },
          scope: 'organization',
          connectionId: status.credentialId,
          returnTo: RETURN_TO,
        })
      } catch (error) {
        toastError({
          title: 'Failed to start reconnect',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    },
    [flow, utils]
  )

  return { reconnect, pending: flow.pending, Dialogs: flow.Dialogs }
}
