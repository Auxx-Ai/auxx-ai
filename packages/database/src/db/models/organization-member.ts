// packages/database/src/db/models/organization-member.ts
// OrganizationMember model built on BaseModel (org-scoped)

import { and, eq, type SQL } from 'drizzle-orm'
import { OrganizationMember } from '../schema/organization-member'
import { User } from '../schema/user'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'

/** Selected OrganizationMember entity type */
export type OrganizationMemberEntity = typeof OrganizationMember.$inferSelect
/** Insertable OrganizationMember input type */
export type CreateOrganizationMemberInput = typeof OrganizationMember.$inferInsert
/** Updatable OrganizationMember input type */
export type UpdateOrganizationMemberInput = Partial<CreateOrganizationMemberInput>

/** Minimal membership info used in auth checks */
export type OrganizationMemberInfo = Pick<
  OrganizationMemberEntity,
  'id' | 'userId' | 'organizationId' | 'role' | 'status'
>

/**
 * OrganizationMemberModel encapsulates CRUD for the OrganizationMember table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class OrganizationMemberModel extends BaseModel<
  typeof OrganizationMember,
  CreateOrganizationMemberInput,
  OrganizationMemberEntity,
  UpdateOrganizationMemberInput
> {
  get table() {
    return OrganizationMember
  }

  /** Find membership for current org by user id with safe select */
  async findMemberByUser(
    userId: string
  ): Promise<TypedResult<OrganizationMemberInfo | null, Error>> {
    try {
      this.requireOrgIfScoped()
      const whereParts: SQL<unknown>[] = []
      if (this.scopeFilter) whereParts.push(this.scopeFilter)
      whereParts.push(eq(OrganizationMember.userId, userId))

      let q = this.db
        .select({
          id: OrganizationMember.id,
          userId: OrganizationMember.userId,
          organizationId: OrganizationMember.organizationId,
          role: OrganizationMember.role,
          status: OrganizationMember.status,
        })
        .from(OrganizationMember)
        .$dynamic()

      if (whereParts.length) q = q.where(and(...whereParts))
      q = q.limit(1)
      const rows = await q
      return Result.ok((rows?.[0] as OrganizationMemberInfo) ?? null)
    } catch (error: any) {
      return Result.error(error)
    }
  }

  /** Determine if user is OWNER or ADMIN within current org */
  async isAdminOrOwner(userId: string): Promise<TypedResult<boolean, Error>> {
    const res = await this.findMemberByUser(userId)
    if (!res.ok) return res
    const role = res.value?.role
    return Result.ok(role === 'OWNER' || role === 'ADMIN')
  }

  /**
   * List members with basic user info for the current org, optionally filter by name/email contains
   */
  async listWithUser(opts: { nameOrEmailContains?: string; limit?: number } = {}): Promise<
    TypedResult<
      Array<
        OrganizationMemberInfo & {
          user: Pick<typeof User.$inferSelect, 'id' | 'name' | 'email' | 'image'>
        }
      >,
      Error
    >
  > {
    try {
      this.requireOrgIfScoped()
      const whereParts: SQL<unknown>[] = []
      if (this.scopeFilter) whereParts.push(this.scopeFilter)

      let q = this.db
        .select({
          id: OrganizationMember.id,
          userId: OrganizationMember.userId,
          organizationId: OrganizationMember.organizationId,
          role: OrganizationMember.role,
          status: OrganizationMember.status,
          user: {
            id: User.id,
            name: User.name,
            email: User.email,
            image: User.image,
          },
        })
        .from(OrganizationMember)
        .leftJoin(User, eq(User.id, OrganizationMember.userId))
        .$dynamic()

      if (whereParts.length) q = q.where(and(...whereParts))
      if (opts.limit) q = q.limit(opts.limit)
      const rows = await q

      const filtered = opts.nameOrEmailContains
        ? rows.filter((r: any) => {
            const needle = opts.nameOrEmailContains!.toLowerCase()
            return (
              (r.user?.name || '').toLowerCase().includes(needle) ||
              (r.user?.email || '').toLowerCase().includes(needle)
            )
          })
        : rows
      return Result.ok(filtered as any)
    } catch (error: any) {
      return Result.error(error)
    }
  }
}
