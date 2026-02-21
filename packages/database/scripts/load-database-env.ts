// packages/database/scripts/load-database-env.ts
import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'

/** Workspace marker used to locate the monorepo root from any subdirectory. */
const WORKSPACE_MARKER = 'pnpm-workspace.yaml'

/** Root-level env filename that holds local development defaults. */
const ROOT_ENV_FILENAME = '.env'

/** Default local database username for Docker Compose development. */
const LOCAL_DATABASE_USER = 'postgres'

/** Default local database host for Docker Compose development. */
const LOCAL_DATABASE_HOST = 'localhost'

/** Default local database port for Docker Compose development. */
const LOCAL_DATABASE_PORT = '5432'

/** Default local database name for Docker Compose development. */
const LOCAL_DATABASE_NAME = 'auxx-ai'

/** Default local database host aliases used for Docker Compose development. */
const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', 'postgres'])

/** Lists the source that provided DATABASE_URL for the current process. */
export type DatabaseEnvSource = 'process.env' | 'root-dotenv' | 'derived-from-password'

/** Describes how DATABASE_URL was resolved so callers can log/debug consistently. */
export interface DatabaseEnvLoadResult {
  workspaceRoot: string | null
  envFilePath: string | null
  source: DatabaseEnvSource
}

/** Removes matching single or double quotes from a shell-style env value. */
const stripWrappingQuotes = (value: string): string => {
  if (value.length < 2) return value
  const startsWithSingleQuote = value.startsWith("'") && value.endsWith("'")
  const startsWithDoubleQuote = value.startsWith('"') && value.endsWith('"')
  return startsWithSingleQuote || startsWithDoubleQuote ? value.slice(1, -1) : value
}

/** Finds the monorepo root by walking up until pnpm-workspace.yaml is found. */
export const findWorkspaceRoot = (startDirectory = process.cwd()): string | null => {
  let currentDirectory = path.resolve(startDirectory)

  while (true) {
    const markerPath = path.join(currentDirectory, WORKSPACE_MARKER)
    if (fs.existsSync(markerPath)) return currentDirectory

    const parentDirectory = path.dirname(currentDirectory)
    if (parentDirectory === currentDirectory) return null
    currentDirectory = parentDirectory
  }
}

/** Reads an env string value when present and non-empty, otherwise returns null. */
const readOptionalEnv = (key: string): string | null => {
  const value = process.env[key]
  if (!value) return null
  const trimmedValue = stripWrappingQuotes(value.trim())
  return trimmedValue.length > 0 ? trimmedValue : null
}

/** Returns the configured local database username with defaults for Docker Compose. */
const getLocalDatabaseUser = (): string => readOptionalEnv('DATABASE_USER') ?? LOCAL_DATABASE_USER

/** Returns the configured local database host with defaults for Docker Compose. */
const getLocalDatabaseHost = (): string => readOptionalEnv('DATABASE_HOST') ?? LOCAL_DATABASE_HOST

/** Returns the configured local database port with defaults for Docker Compose. */
const getLocalDatabasePort = (): string => readOptionalEnv('DATABASE_PORT') ?? LOCAL_DATABASE_PORT

/** Returns the configured local database name with defaults for Docker Compose. */
const getLocalDatabaseName = (): string => readOptionalEnv('DATABASE_NAME') ?? LOCAL_DATABASE_NAME

/** Returns local database hosts that should be treated as Docker Compose style endpoints. */
const getLocalDatabaseHosts = (): Set<string> => {
  const hosts = new Set(LOCAL_DATABASE_HOSTS)
  hosts.add(getLocalDatabaseHost().toLowerCase())
  return hosts
}

/** Builds a local Docker Compose DATABASE_URL from DATABASE_PASSWORD and optional local db settings. */
const buildDatabaseUrlFromPassword = (databasePassword: string): string => {
  const normalizedPassword = stripWrappingQuotes(databasePassword.trim())
  const encodedPassword = encodeURIComponent(normalizedPassword)
  const databaseUser = getLocalDatabaseUser()
  const databaseHost = getLocalDatabaseHost()
  const databasePort = getLocalDatabasePort()
  const databaseName = getLocalDatabaseName()
  return `postgresql://${databaseUser}:${encodedPassword}@${databaseHost}:${databasePort}/${databaseName}`
}

/** Returns true when a parsed DATABASE_URL looks like local Docker Compose Postgres. */
const isLocalComposeLikeDatabaseUrl = (databaseUrl: URL): boolean => {
  const localHosts = getLocalDatabaseHosts()
  const expectedUser = getLocalDatabaseUser()
  const expectedPort = getLocalDatabasePort()
  const normalizedHost = databaseUrl.hostname.toLowerCase()
  const normalizedUser = databaseUrl.username
  const normalizedPort = databaseUrl.port || expectedPort
  return (
    localHosts.has(normalizedHost) &&
    normalizedUser === expectedUser &&
    normalizedPort === expectedPort
  )
}

/** Returns true when DATABASE_URL should be normalized from DATABASE_PASSWORD for local compose usage. */
const shouldNormalizeLocalDatabaseUrl = (
  databaseUrlRaw: string,
  databasePasswordRaw: string
): boolean => {
  try {
    const databaseUrl = new URL(databaseUrlRaw)
    if (!isLocalComposeLikeDatabaseUrl(databaseUrl)) return false

    const databaseName = databaseUrl.pathname.replace(/^\//, '')
    const databasePassword = decodeURIComponent(databaseUrl.password)
    const expectedDatabaseName = getLocalDatabaseName()
    const expectedPassword = stripWrappingQuotes(databasePasswordRaw.trim())

    return databaseName !== expectedDatabaseName || databasePassword !== expectedPassword
  } catch {
    return false
  }
}

/** Ensures DATABASE_URL is set with stable precedence across local, CI, and SST paths. */
export const ensureDatabaseEnv = (): DatabaseEnvLoadResult => {
  if (process.env.DATABASE_URL?.trim()) {
    return { workspaceRoot: findWorkspaceRoot(), envFilePath: null, source: 'process.env' }
  }

  /** Monorepo root used to find root .env regardless of caller working directory. */
  const workspaceRoot = findWorkspaceRoot()
  /** Root .env path resolved from workspace root if available. */
  const envFilePath = workspaceRoot ? path.join(workspaceRoot, ROOT_ENV_FILENAME) : null

  if (envFilePath && fs.existsSync(envFilePath)) {
    dotenv.config({ path: envFilePath })
    if (
      process.env.DATABASE_URL?.trim() &&
      process.env.DATABASE_PASSWORD?.trim() &&
      shouldNormalizeLocalDatabaseUrl(process.env.DATABASE_URL, process.env.DATABASE_PASSWORD)
    ) {
      process.env.DATABASE_URL = buildDatabaseUrlFromPassword(process.env.DATABASE_PASSWORD)
      return { workspaceRoot, envFilePath, source: 'derived-from-password' }
    }

    if (process.env.DATABASE_URL?.trim()) {
      return { workspaceRoot, envFilePath, source: 'root-dotenv' }
    }
  }

  if (process.env.DATABASE_PASSWORD?.trim()) {
    process.env.DATABASE_URL = buildDatabaseUrlFromPassword(process.env.DATABASE_PASSWORD)
    return { workspaceRoot, envFilePath, source: 'derived-from-password' }
  }

  const rootEnvMessage = envFilePath
    ? `Create ${envFilePath} with DATABASE_URL (or DATABASE_PASSWORD) for local Docker migrations.`
    : 'Run from inside the monorepo so the root .env can be discovered.'

  throw new Error(
    `DATABASE_URL is required for database operations. ${rootEnvMessage} In CI/SST, inject DATABASE_URL via environment.`
  )
}
