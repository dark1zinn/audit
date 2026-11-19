import { Schema } from "effect"

/** Everything that has a row in `entities` and can be referenced, searched and audited. */
export const EntityType = Schema.Literals([
  "user",
  "team",
  "project",
  "board",
  "task",
  "doc",
  "comment",
  "channel",
  "message",
  "calendar",
  "event",
  "file",
])
export type EntityType = typeof EntityType.Type

/** Containers sit between a project and its items; grants on them flow down to the items. */
export const ContainerType = Schema.Literals(["project", "board", "doc", "channel", "calendar"])
export type ContainerType = typeof ContainerType.Type

export const ReferenceKind = Schema.Literals([
  "mention",
  "link",
  "embed",
  "blocks",
  "relates",
  "duplicates",
  "scheduled_for",
])
export type ReferenceKind = typeof ReferenceKind.Type
