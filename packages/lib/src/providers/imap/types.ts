// packages/lib/src/providers/imap/types.ts

/** Encrypted credential data stored in WorkflowCredentials.encryptedData */
export interface ImapCredentialData {
  /** Auth mode: 'direct' = IMAP login, 'ldap' = LDAP bind then IMAP */
  authMode: 'direct' | 'ldap'

  /** IMAP connection */
  imap: {
    host: string
    port: number
    secure: boolean
    username: string
    password: string
    allowUnauthorizedCerts: boolean
  }

  /** SMTP connection (for sending replies) */
  smtp: {
    host: string
    port: number
    secure: boolean
    username: string
    password: string
    allowUnauthorizedCerts: boolean
  }

  /** LDAP connection (optional, only when authMode = 'ldap') */
  ldap?: {
    url: string
    bindDN: string
    bindPassword: string
    searchBase: string
    searchFilter: string
    usernameAttribute: string
    emailAttribute: string
    allowUnauthorizedCerts: boolean
  }
}

/** Per-folder sync cursor stored in Label.providerCursor */
export interface ImapSyncCursor {
  uidValidity: number
  highestUid: number
  modSeq?: bigint
}

/** Parsed email from postal-mime */
export interface ParsedEmail {
  messageId: string | undefined
  inReplyTo: string | undefined
  references: string | undefined
  date: string | undefined
  subject: string | undefined
  from: { address: string; name: string }[]
  to: { address: string; name: string }[]
  cc: { address: string; name: string }[]
  bcc: { address: string; name: string }[]
  text: string | undefined
  html: string | undefined
  attachments: {
    filename: string
    mimeType: string
    size: number
  }[]
}

/** Result from syncing a single IMAP folder */
export interface ImapSyncResult {
  newUids: number[]
  deletedUids: number[]
  mailboxState: {
    uidValidity: number
    highestUid: number
    modSeq?: bigint
  }
}

// --- Full-sync checkpoint types ---

/** UID scan window size for bounded folder discovery */
export const UID_SCAN_WINDOW = 1000

/** Import batch size for IMAP full sync */
export const IMAP_IMPORT_BATCH_SIZE = 50

/** Max consecutive empty UID windows to scan per job before yielding */
export const MAX_CONSECUTIVE_EMPTY_WINDOWS = 100

/**
 * Max total empty windows to scan across the entire full-sync lifecycle per folder.
 * At 1K UIDs per window, 5000 windows = 5M UIDs — well beyond any realistic mailbox.
 */
export const MAX_TOTAL_EMPTY_WINDOWS = 5000

/** Per-folder checkpoint for resumable IMAP full sync, stored in Label.syncCheckpoint */
export interface ImapFolderCheckpoint {
  runId: string
  phase: 'listing' | 'importing' | 'done'
  uidValidity: number
  snapshotHighestUid: number
  nextUidStart: number
  activeWindowStart?: number
  activeWindowEnd?: number
  activeWindowBatchCount?: number
  activeWindowCompletedBatches?: number
  activeWindowFailedBatches?: number
  discoveredMessageCount: number
  importedMessageCount: number
  failedMessageCount: number
  /** Format: `${uidValidity}:${highestUid}` — encodes both validity and position */
  candidateCursor: string
  lastError?: string
  /** Cumulative empty windows scanned across all jobs in this run */
  totalEmptyWindowsScanned?: number
}

/** Job payload for a single IMAP import batch (self-contained, retryable) */
export interface ImapImportBatchJobData {
  runId: string
  integrationId: string
  organizationId: string
  provider: 'imap'
  labelId: string
  folderPath: string
  externalIds: string[]
}

/** Result from scanning a single UID window */
export interface UidWindowScanResult {
  uids: number[]
  windowStart: number
  windowEnd: number
  mailboxState: {
    uidValidity: number
    highestUid: number
    modSeq?: bigint
  }
}
