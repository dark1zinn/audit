import { FileRef } from "@audit/domain/files/schema"
import type { EntityId } from "@audit/domain/ids"
import { Schema } from "effect"
import { ApiError } from "./api.ts"

const tagByStatus: Record<number, string> = {
  401: "Unauthorized",
  403: "Forbidden",
  404: "NotFound",
  409: "Conflict",
  422: "ValidationError",
  429: "RateLimited",
}

/** Uploads a file attached to `parentId` (a doc). Multipart, so it sits outside the typed client. */
export const uploadFile = async (file: File, parentId: EntityId): Promise<FileRef> => {
  const form = new FormData()
  form.append("file", file)
  form.append("parentId", parentId)
  const response = await fetch("/api/files", {
    method: "POST",
    body: form,
    credentials: "same-origin",
  })
  if (!response.ok) {
    const detail: unknown = await response.json().catch(() => null)
    throw new ApiError(tagByStatus[response.status] ?? "UnknownError", detail)
  }
  return Schema.decodeUnknownPromise(FileRef)(await response.json())
}
