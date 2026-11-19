/**
 * The `entities.search_text` each entity type indexes next to its title. Commands and the reindex
 * command both build it here so the two never disagree.
 */
import type { JsonNode } from "@audit/editor/json"
import { jsonToText } from "@audit/editor/text"

const joinWords = (...parts: ReadonlyArray<string | null | undefined>) =>
  parts
    .filter((part): part is string => part !== null && part !== undefined && part.length > 0)
    .join(" ")

/** A task is found by its key (`ENG-14`) and by its description. */
export const taskSearchText = (key: string, description: unknown) =>
  joinWords(key, jsonToText(description as JsonNode | null))

export const projectSearchText = (key: string, name: string) => joinWords(key, name)

export const eventSearchText = (description: unknown, location: string) =>
  joinWords(jsonToText(description as JsonNode | null), location)

export const channelSearchText = (name: string, topic: string) => joinWords(name, topic)
