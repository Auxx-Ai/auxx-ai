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
