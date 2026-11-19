import { useLingui } from "@lingui/react/macro"
import type { ColumnCategory, ProjectVisibility } from "@audit/domain/projects/schema"
import type { PrincipalType, ResourceRole, WorkspaceRole } from "@audit/domain/roles"

export const workspaceRoles: ReadonlyArray<WorkspaceRole> = ["owner", "admin", "member", "guest"]

export const columnCategories: ReadonlyArray<ColumnCategory> = [
  "backlog",
  "todo",
  "in_progress",
  "done",
  "canceled",
]

export const principalTypes: ReadonlyArray<PrincipalType> = ["user", "team", "role"]

/** Translated names for the enumerated values shown in project settings. */
export const useSettingsLabels = () => {
  const { t } = useLingui()
  return {
    visibility: {
      workspace: t`Workspace`,
      restricted: t`Restricted`,
    } satisfies Record<ProjectVisibility, string>,
    resourceRole: {
      viewer: t`Viewer`,
      commenter: t`Commenter`,
      editor: t`Editor`,
      manager: t`Manager`,
    } satisfies Record<ResourceRole, string>,
    workspaceRole: {
      owner: t`Owner`,
      admin: t`Admin`,
      member: t`Member`,
      guest: t`Guest`,
    } satisfies Record<WorkspaceRole, string>,
    category: {
      backlog: t`Backlog`,
      todo: t`To do`,
      in_progress: t`In progress`,
      done: t`Done`,
      canceled: t`Canceled`,
    } satisfies Record<ColumnCategory, string>,
    principalType: {
      user: t`Person`,
      team: t`Team`,
      role: t`Workspace role`,
    } satisfies Record<PrincipalType, string>,
  }
}
