/**
 * What each role may do. Resource actions are named `<entity>.<verb>`; the verb decides the minimum
 * role on the resource. Workspace capabilities come from the workspace role alone.
 */
import type { ResourceRole, WorkspaceRole } from "./roles.ts"

const verbRoles = {
  read: "viewer",
  comment: "commenter",
  react: "commenter",
  reply: "commenter",
  post: "commenter",
  create: "editor",
  update: "editor",
  move: "editor",
  delete_own: "editor",
  delete: "manager",
  archive: "manager",
  settings: "manager",
  manage_access: "manager",
} as const satisfies Record<string, ResourceRole>

export type ResourceVerb = keyof typeof verbRoles
export type ResourceAction = `${string}.${ResourceVerb}`

/** `task.update` → `editor`. */
export const minimumRole = (action: ResourceAction): ResourceRole => {
  const verb = action.slice(action.indexOf(".") + 1) as ResourceVerb
  return verbRoles[verb]
}

export const WorkspaceCapabilities = {
  "workspace.settings": ["owner", "admin"],
  "members.manage": ["owner", "admin"],
  /** Members may invite only when the workspace setting allows it, and only as member or guest. */
  "invites.create": ["owner", "admin", "member"],
  "invites.manage": ["owner", "admin"],
  "teams.manage": ["owner", "admin"],
  "ai.configure": ["owner", "admin"],
  "trail.read": ["owner", "admin"],
  "projects.create": ["owner", "admin", "member"],
  "channels.create_public": ["owner", "admin", "member"],
  "private.read": ["owner", "admin"],
  "access.override": ["owner", "admin"],
  "workspace.transfer": ["owner"],
  "workspace.delete": ["owner"],
  "members.delete": ["owner"],
} as const satisfies Record<string, ReadonlyArray<WorkspaceRole>>

export type WorkspaceCapability = keyof typeof WorkspaceCapabilities

export const hasCapability = (role: WorkspaceRole, capability: WorkspaceCapability): boolean =>
  (WorkspaceCapabilities[capability] as ReadonlyArray<WorkspaceRole>).includes(role)

/** The only workspace capabilities the AI may use on a user's behalf; admin actions never. */
export const aiCapabilities: Partial<Record<WorkspaceCapability, true>> = {
  "projects.create": true,
  "channels.create_public": true,
}
