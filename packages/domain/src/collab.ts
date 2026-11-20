/**
 * WebSocket close code the collab server sends when a doc's latest edits were refused and are not
 * saved. The client must show that instead of quietly reconnecting.
 */
export const CHANGES_NOT_SAVED = 4422
