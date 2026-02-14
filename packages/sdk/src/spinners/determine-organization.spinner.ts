import { select } from '@inquirer/prompts'
import { api } from '../api/api.js'
import { complete, type DetermineOrganizationError, errored, isErrored } from '../errors.js'
// import type { ApiError } from '../api/api.js'
import { spinnerify } from '../util/spinner.js'

export type Organization = {
  id: string
  name: string
  slug: string
}

/**
 * Determine which organization to use for development
 * Either from the provided slug, prompt user, or use the only available org
 */
export async function determineOrganization(organizationSlug?: string) {
  const organizationsResult = await spinnerify(
    'Loading organizations...',
    'Organizations loaded',
    async () => await api.fetchOrganizations()
  )

  if (isErrored(organizationsResult)) {
    return organizationsResult
  }

  const organizations = organizationsResult.value // as Organization[]

  // If slug provided, try to find it
  if (organizationSlug) {
    const organization = organizations.find((org) => org.handle === organizationSlug)
    if (organization) {
      process.stdout.write(`Using organization: ${organization.name}\n`)
      return complete(organization)
    }
    return errored<DetermineOrganizationError>({
      code: 'NO_ORGANIZATION_FOUND',
      organization_slug: organizationSlug,
    })
  }

  // No organizations available
  if (organizations.length === 0) {
    return errored<DetermineOrganizationError>({
      code: 'NO_ORGANIZATIONS_FOUND',
    })
  }

  // Only one organization - use it
  if (organizations.length === 1) {
    const org = organizations[0]!
    process.stdout.write(`Using organization: ${org.name}\n`)
    return complete(org)
  }

  // Multiple organizations - prompt user
  const choice = await select({
    message: 'Choose an organization',
    choices: organizations.map((organization) => ({
      name: organization.name,
      value: organization,
    })),
  })
  process.stdout.write(`Using organization: ${choice.name}\n`)
  return complete(choice)
}
