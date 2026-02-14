import chalk from 'chalk'
import { API as APP } from './env.js'
import type {
  AppSlugError,
  CliVersionError,
  CreateProjectError,
  // FetcherError,
  DetermineOrganizationError,
  Errored,
  UploadError,
} from './errors.js'

// import type { ApiError } from './api/api.js'

type AuxxError = {
  message: string
  code: string
  uploadUrl?: string
  status?: string
  path?: string
  dest?: string
  src?: string
  error?: AuxxError
  workspace_slug?: string
  organization_slug?: string
  issues?: AuxxError[]
}

export function printFetcherError(message: string, { error }: any) {
  process.stderr.write(`${chalk.red('✖ ')}${message}\n`)

  // Handle ApiError (has .error property containing FetcherError)
  // const fetcherError =
  //   'error' in error && typeof error.error === 'object' && 'code' in error.error
  //     ? error.error
  //     : (error as Errored<FetcherError>).error
  const fetcherError = error
  switch (fetcherError.code) {
    case 'HTTP_ERROR':
      process.stderr.write(`HTTP Error (${fetcherError.status}): ${fetcherError}\n`)
      break
    case 'INVALID_RESPONSE':
      process.stderr.write(`Invalid response: ${fetcherError}\n`)
      break
    case 'NETWORK_ERROR':
      process.stderr.write(`Network error: ${fetcherError}\n`)
      break
    case 'UNAUTHORIZED':
      process.stderr.write(`Unauthorized. You must log in with "auxx login"\n`)
      break
  }
}
export function printUploadError(error: Errored<UploadError>) {
  const e = error.error
  switch (e.code) {
    case 'BUNDLE_UPLOAD_ERROR':
      process.stderr.write(chalk.red(`Error uploading bundle: ${e.uploadUrl}\n`))
      break
    case 'START_UPLOAD_ERROR':
      process.stderr.write(chalk.red(`Error starting upload: ${e}\n`))

      // printFetcherError('Error starting upload', e)
      break
    case 'COMPLETE_BUNDLE_UPLOAD_ERROR':
      process.stderr.write(chalk.red(`Error completing bundle upload: ${e}\n`))
      // printFetcherError('Error completing bundle upload', error)
      break
  }
}
export function printCreateProjectError(e: Errored<CreateProjectError>) {
  const error = e.error
  switch (error.code) {
    case 'DIRECTORY_ALREADY_EXISTS':
      process.stderr.write(chalk.red(`Directory ${error.path} already exists`))
      break
    case 'WRITE_ACCESS_DENIED':
      process.stderr.write(chalk.red(`Write access denied to ${error.path}`))
      break
    case 'FAILED_TO_CREATE_DIRECTORY':
      process.stderr.write(chalk.red(`Failed to create directory ${error.path}`))
      break
    case 'FAILED_TO_COPY_FILE':
      process.stderr.write(chalk.red(`Failed to copy file ${error.src} to ${error.dest}`))
      break
    case 'FAILED_TO_LIST_FILES':
      process.stderr.write(chalk.red(`Failed to list files in ${error.path}`))
      break
    case 'FAILED_TO_READ_FILE':
      process.stderr.write(chalk.red(`Failed to read file ${error.path}`))
      break
    case 'FAILED_TO_WRITE_FILE':
      process.stderr.write(chalk.red(`Failed to write file ${error.path}`))
      break
    default:
      return error
  }
}
export function printPackageJsonError(result: Errored<AppSlugError>) {
  const { error: appSlugError } = result
  switch (appSlugError.code) {
    case 'MALFORMED_PACKAGE_JSON': {
      const { error } = appSlugError
      if (error.issues.length > 0) {
        process.stderr.write(
          `${chalk.red('✖ ')}Malformed package.json: ${error.issues[0]?.message ?? error.message}\n`
        )
      } else {
        process.stderr.write(`${chalk.red('✖ ')}Malformed package.json: ${error.message}\n`)
      }
      break
    }
    case 'FILE_SYSTEM_ERROR':
      process.stderr.write(`${chalk.red('✖ ')}Failed to read package.json\n`)
      break
    case 'INVALID_JSON': {
      const { error } = appSlugError
      process.stderr.write(`${chalk.red('✖ ')}Invalid JSON in package.json: ${error.message}\n`)
      break
    }
  }
}
export function printCliVersionError({ error }: Errored<CliVersionError>) {
  switch (error.code) {
    case 'UNABLE_TO_FIND_PACKAGE_JSON':
      process.stderr.write(`${chalk.red('✖ ')}Failed to find package.json in ${error.path}\n`)
      break
    case 'UNABLE_TO_READ_PACKAGE_JSON':
      process.stderr.write(`${chalk.red('✖ ')}Failed to read package.json: ${error.error}\n`)
      break
    case 'UNABLE_TO_PARSE_PACKAGE_JSON':
      process.stderr.write(`${chalk.red('✖ ')}Failed to parse package.json: ${error.error}\n`)
      break
    case 'INVALID_PACKAGE_JSON':
      process.stderr.write(`${chalk.red('✖ ')}Invalid package.json: ${error.error}\n`)
      break
    case 'ERROR_LOADING_PACKAGE_JSON':
      process.stderr.write(`${chalk.red('✖ ')}Error loading package.json: ${error.error}\n`)
      break
    case 'NO_CLI_VERSION_FOUND':
      process.stderr.write(`${chalk.red('✖ ')}No CLI version found in auxx's package.json\n`)
      break
    default:
      return error
  }
}

export function printDetermineOrganizationError(e: Errored<DetermineOrganizationError>) {
  const error = e.error
  switch (error.code) {
    case 'NO_ORGANIZATION_FOUND':
      process.stderr.write(`You are not the admin any workspace with the slug "${error.organization_slug}". Either request permission from "${error.organization_slug}" or create your own.

${APP}/welcome/workspace-details
                    `)
      break
    case 'NO_ORGANIZATIONS_FOUND':
      process.stderr.write(`You are not the admin of any workspaces. Either request permission from an existing workspace or create your own.

${APP}/welcome/workspace-details
                    `)
      break
  }
}

export function printKeychainError(error: { code: string; error: string }) {
  switch (error.code) {
    case 'SAVE_KEYCHAIN_ERROR':
      process.stderr.write(chalk.red(`Error saving token to keychain: ${error.error}`))
      break
    case 'LOAD_KEYCHAIN_ERROR':
      process.stderr.write(chalk.red(`Error loading token from keychain: ${error.error}`))
      break
    case 'DELETE_KEYCHAIN_ERROR':
      process.stderr.write(chalk.red(`Error deleting token from keychain: ${error.error}`))
      break
  }
}
// export function printAuthenticationError(error: AuxxError): AuxxError | void {
//   switch (error.code) {
//     case 'GET_TOKEN_ERROR':
//       printFetcherError('Error getting token', error)
//       break
//     case 'REFRESH_TOKEN_ERROR':
//       printFetcherError('Error refreshing token', error)
//       break
//     case 'NO_AUTHORIZATION_CODE':
//       process.stderr.write(chalk.red(`No authorization code received`))
//       break
//     case 'OAUTH_STATE_MISMATCH':
//       process.stderr.write(chalk.red(`OAuth state mismatch, possible CSRF attack`))
//       break
//     case 'SAVE_KEYCHAIN_ERROR':
//     case 'LOAD_KEYCHAIN_ERROR':
//     case 'DELETE_KEYCHAIN_ERROR':
//       printKeychainError(error)
//       break
//     default:
//       return error
//   }
// }

export function printLogSubscriptionError(error: AuxxError): string | void {
  switch (error.code) {
    case 'FAILED_TO_CONNECT_TO_LOGS_SERVER':
      process.stderr.write(chalk.red('Failed to connect to logs server\n'))
      if (error.error instanceof Error) {
        process.stderr.write(chalk.red(error.error.message))
      }
      break
    default:
      return error.code
  }
}
