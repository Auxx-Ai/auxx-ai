// packages/credentials/src/crypto/client.ts
// Client-safe exports — pure constants only, no server dependencies

/**
 * Sentinel a form submits in place of an unchanged masked secret.
 * The server swaps it back for the stored ciphertext instead of persisting it.
 */
export const HIDDEN_VALUE = '__HIDDEN__'
