// packages/lib/src/apps/client.ts
//
// Client-safe pieces of the apps module.
//
// **No `'use client'` directive.** Server code imports this file too, and the
// directive turns every export into a client-reference proxy there. Nothing
// here may import a server-only module — keep it to types, literals and pure
// functions.

export {
  type InstallationTypeCarrier,
  PREFERRED_INSTALLATION_TYPE,
  pickPreferredInstallation,
  pickPreferredInstallationPerApp,
} from './installations/preferred-installation'
