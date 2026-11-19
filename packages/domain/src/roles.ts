import { Schema } from "effect"

export const WorkspaceRole = Schema.Literals(["owner", "admin", "member", "guest"])
export type WorkspaceRole = typeof WorkspaceRole.Type

/** Roles on a resource, lowest first. */
export const ResourceRoles = ["viewer", "commenter", "editor", "manager"] as const
export const ResourceRole = Schema.Literals(ResourceRoles)
export type ResourceRole = typeof ResourceRole.Type

const resourceRank: Record<ResourceRole, number> = {
  viewer: 1,
  commenter: 2,
  editor: 3,
  manager: 4,
}

/** True when `held` grants at least `required`. */
export const roleAtLeast = (held: ResourceRole, required: ResourceRole): boolean =>
  resourceRank[held] >= resourceRank[required]

/** The higher of two roles; `null` means no access. */
export const maxRole = (a: ResourceRole | null, b: ResourceRole | null): ResourceRole | null => {
  if (a === null) return b
  if (b === null) return a
  return resourceRank[a] >= resourceRank[b] ? a : b
}

export const isWorkspaceAdmin = (role: WorkspaceRole): boolean =>
  role === "owner" || role === "admin"

export const TeamRole = Schema.Literals(["member", "lead"])
export type TeamRole = typeof TeamRole.Type

export const PrincipalType = Schema.Literals(["user", "team", "role"])
export type PrincipalType = typeof PrincipalType.Type
