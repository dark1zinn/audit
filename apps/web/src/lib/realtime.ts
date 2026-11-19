import type { DomainEvent, PresenceViewer, RealtimeMessage } from "@audit/domain/events"
import { RealtimeRpcs } from "@audit/domain/events"
import type { BoardView, TaskCard } from "@audit/domain/tasks/schema"
import type { EntityId } from "@audit/domain/ids"
import type { QueryClient, QueryKey } from "@tanstack/react-query"
import { useEffect, useSyncExternalStore } from "react"
import { Effect, Layer, Stream } from "effect"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { Socket } from "effect/socket"
import { chatKeys, messageChangeKeys } from "./chat.ts"
import { keys } from "./queries.ts"

const MAX_BACKOFF_MS = 30_000
const ALWAYS_SCOPES = ["workspace", "inbox"]

const socketUrl = () => {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws"
  return `${scheme}://${window.location.host}/rpc`
}

const SocketLive = Layer.effect(Socket.Socket, Socket.makeWebSocket(socketUrl())).pipe(
  Layer.provide(Socket.layerWebSocketConstructorGlobal),
)

const ProtocolLive = RpcClient.layerProtocolSocket().pipe(
  Layer.provide([RpcSerialization.layerJson, SocketLive]),
)

// --- Scope registry ---------------------------------------------------------

/**
 * Ref-counted set of scopes. Components register the scopes they display; any change restarts the
 * realtime connection with the new set (resuming from the last sequence).
 */
class ScopeRegistry {
  private readonly counts = new Map<string, number>()
  private readonly listeners = new Set<() => void>()

  add(scope: string): () => void {
    this.counts.set(scope, (this.counts.get(scope) ?? 0) + 1)
    this.emit()
    return () => {
      const next = (this.counts.get(scope) ?? 1) - 1
      if (next <= 0) this.counts.delete(scope)
      else this.counts.set(scope, next)
      this.emit()
    }
  }

  list(): string[] {
    return [...this.counts.keys()]
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }
}

const subscriptions = new ScopeRegistry()
const presenceScopes = new ScopeRegistry()

/** Subscribes the realtime connection to `scopes` while the calling component is mounted. */
export const useRealtimeScopes = (scopes: ReadonlyArray<string | null>) => {
  const key = scopes.filter((scope): scope is string => scope !== null).join("|")
  useEffect(() => {
    const release = key === "" ? [] : key.split("|").map((scope) => subscriptions.add(scope))
    return () => {
      for (const done of release) done()
    }
  }, [key])
}

// --- Presence ---------------------------------------------------------------

interface PresenceSlot {
  viewers: ReadonlyArray<PresenceViewer>
  focusEntityId: EntityId | null
}

const EMPTY_VIEWERS: ReadonlyArray<PresenceViewer> = []
const presenceSlots = new Map<string, PresenceSlot>()
const presenceListeners = new Map<string, Set<() => void>>()

const setViewers = (scope: string, viewers: ReadonlyArray<PresenceViewer>) => {
  const slot = presenceSlots.get(scope)
  if (slot === undefined) return
  slot.viewers = viewers
  for (const listener of presenceListeners.get(scope) ?? []) listener()
}

const subscribePresence = (scope: string | null, listener: () => void) => {
  if (scope === null) return () => {}
  const set = presenceListeners.get(scope) ?? new Set<() => void>()
  set.add(listener)
  presenceListeners.set(scope, set)
  return () => {
    set.delete(listener)
  }
}

/**
 * Live viewers of `scope` (including the current user; callers filter). `focusEntityId` is what the
 * caller has open inside that scope; changes are sent to the server throttled by the server itself.
 */
export const usePresence = (
  scope: string | null,
  focusEntityId: EntityId | null = null,
): ReadonlyArray<PresenceViewer> => {
  useEffect(() => {
    if (scope === null) return
    presenceSlots.set(
      scope,
      presenceSlots.get(scope) ?? { viewers: EMPTY_VIEWERS, focusEntityId: null },
    )
    const release = presenceScopes.add(scope)
    return () => {
      release()
      presenceSlots.delete(scope)
    }
  }, [scope])

  useEffect(() => {
    if (scope === null) return
    const slot = presenceSlots.get(scope)
    if (slot === undefined || slot.focusEntityId === focusEntityId) return
    slot.focusEntityId = focusEntityId
    live?.updatePresence(scope, focusEntityId)
  }, [scope, focusEntityId])

  return useSyncExternalStore(
    (listener) => subscribePresence(scope, listener),
    () => (scope === null ? EMPTY_VIEWERS : (presenceSlots.get(scope)?.viewers ?? EMPTY_VIEWERS)),
    () => EMPTY_VIEWERS,
  )
}

/** Tells the server this viewer is (or stopped) typing in `scope`; the server expires it on its own. */
export const sendTyping = (scope: string, typing: boolean) => {
  const focusEntityId = presenceSlots.get(scope)?.focusEntityId ?? null
  live?.updatePresence(scope, focusEntityId, typing)
}
// --- Live connection --------------------------------------------------------

interface LiveHandle {
  updatePresence: (scope: string, focusEntityId: EntityId | null, typing?: boolean) => void
}

let live: LiveHandle | null = null

// --- Cache updates ----------------------------------------------------------

/** Query keys made stale by a domain event; prefixes cover every related query. */
export const invalidationsFor = (event: DomainEvent): ReadonlyArray<QueryKey> => {
  switch (event._tag) {
    case "MembersChanged":
      return [keys.members, keys.session]
    case "InvitesChanged":
      return [keys.invites]
    case "TeamsChanged":
      return [keys.teams]
    case "WorkspaceUpdated":
      return [keys.workspace, keys.session]
    case "ProfileUpdated":
      return [keys.session, keys.members]
    case "ProjectChanged":
      return [["projects"], ["admin", "projects"], ["project"], ["access"]]
    case "BoardChanged":
      return [
        ["boards"],
        ["board"],
        ["tasks"],
        ["calendar"],
        ["mine"],
        ...(event.kind === "label_changed" ? [["labels"]] : []),
      ]
    case "TaskChanged":
      return [["tasks"], ["calendar"], ["mine"], ["task", event.entityId]]
    case "CommentChanged":
      return [["task", event.taskId]]
    case "NotificationChanged":
      return [["notifications"]]
    case "DocChanged":
      return [
        ["docs"],
        ["doc", event.docId],
        ["doc-versions", event.docId],
        ["doc-comments", event.docId],
        ["backlinks"],
        ["entity-refs"],
      ]
    case "ChannelChanged":
      return [
        chatKeys.channels,
        chatKeys.browse,
        chatKeys.channel(event.channelId),
        ["chat", "admin"],
      ]
    case "MessageChanged":
      return messageChangeKeys(event.channelId)
    case "ReadStateChanged":
      return [chatKeys.channels, chatKeys.threads, ["chat", "thread"]]
    case "EventChanged":
      return [["calendar-events"]]
    case "CalendarChanged":
      return [["calendars"], ["calendar-events"]]
  }
}

type TaskChangedEvent = Extract<DomainEvent, { _tag: "TaskChanged" }>

const isOverWip = (wipLimit: number | null, count: number) => wipLimit !== null && count > wipLimit

const byPosition = (a: TaskCard, b: TaskCard) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0

/**
 * Applies a `moved` or `deleted` task event to one cached board view without refetching. Returns
 * `undefined` when the view cannot be patched exactly (the card is missing, or the target column is
 * not in the view), so the caller refetches instead.
 */
export const patchBoardView = (view: BoardView, event: TaskChangedEvent): BoardView | undefined => {
  if (event.entityId === null) return undefined
  const taskId = event.entityId
  const source = view.columns.find((column) => column.tasks.some((task) => task.id === taskId))
  const card = source?.tasks.find((task) => task.id === taskId)
  if (source === undefined || card === undefined) return undefined

  if (event.kind === "deleted") {
    return {
      ...view,
      columns: view.columns.map((column) => {
        if (column.id !== source.id) return column
        const tasks = column.tasks.filter((task) => task.id !== taskId)
        return { ...column, tasks, overWipLimit: isOverWip(column.wipLimit, tasks.length) }
      }),
    }
  }
  if (event.kind !== "moved") return undefined

  const targetId = event.columnId ?? source.id
  const target = view.columns.find((column) => column.id === targetId)
  if (target === undefined || event.position === undefined) return undefined

  const moved: TaskCard = {
    ...card,
    columnId: target.id,
    columnCategory: event.columnCategory ?? target.category,
    position: event.position,
    version: event.version ?? card.version,
  }

  return {
    ...view,
    columns: view.columns.map((column) => {
      const isSource = column.id === source.id
      const isTarget = column.id === target.id
      if (!isSource && !isTarget) return column
      const without = column.tasks.filter((task) => task.id !== taskId)
      const tasks = isTarget ? [...without, moved].toSorted(byPosition) : without
      return { ...column, tasks, overWipLimit: isOverWip(column.wipLimit, tasks.length) }
    }),
  }
}

const applyTaskEvent = (queryClient: QueryClient, event: TaskChangedEvent) => {
  const patchable = event.kind === "moved" || event.kind === "deleted"
  if (event.boardId !== null) {
    const cached = queryClient.getQueriesData<BoardView>({
      queryKey: ["board", event.boardId, "view"],
    })
    for (const [key, view] of cached) {
      if (view === undefined) continue
      const patched = patchable ? patchBoardView(view, event) : undefined
      if (patched === undefined) void queryClient.invalidateQueries({ queryKey: key })
      else queryClient.setQueryData(key, patched)
    }
  }
  for (const key of invalidationsFor(event)) {
    // Board views are patched above when possible; everything else refetches.
    if (key[0] === "board") continue
    void queryClient.invalidateQueries({ queryKey: key })
  }
}

const applyMessage = (queryClient: QueryClient, message: RealtimeMessage) => {
  if (message._tag === "Resync") {
    void queryClient.invalidateQueries()
    return
  }
  const event = message.event
  if (event._tag === "TaskChanged") {
    applyTaskEvent(queryClient, event)
    return
  }
  for (const key of invalidationsFor(event)) {
    void queryClient.invalidateQueries({ queryKey: key })
  }
}

/**
 * Query families the per-event handlers above patch. A fresh subscription (no resume) does not
 * replay events committed before it, so the cache is refetched across all of them.
 */
const LIVE_KEY_FAMILIES: ReadonlyArray<QueryKey> = [
  keys.session,
  keys.members,
  keys.invites,
  keys.teams,
  keys.workspace,
  keys.projects,
  keys.adminProjects,
  ["project"],
  ["access"],
  ["boards"],
  ["board"],
  ["tasks"],
  ["task"],
  ["calendar"],
  ["calendars"],
  ["calendar-events"],
  ["mine"],
  ["labels"],
  ["notifications"],
  ["docs"],
  ["doc"],
  ["doc-versions"],
  ["doc-comments"],
  ["backlinks"],
  ["entity-refs"],
  chatKeys.channels,
  chatKeys.browse,
  ["chat", "channel"],
  ["chat", "admin"],
  chatKeys.threads,
  ["chat", "thread"],
]

const invalidateLiveKeys = (queryClient: QueryClient) => {
  for (const key of LIVE_KEY_FAMILIES) void queryClient.invalidateQueries({ queryKey: key })
}

// --- Connection loop --------------------------------------------------------

interface Resume {
  connectionId: string
  lastSeq: number
}

/**
 * Opens one connection with the current scopes. Resolves when it ends; the caller decides whether
 * to reconnect.
 */
const connectOnce = (
  queryClient: QueryClient,
  scopes: ReadonlyArray<string>,
  presence: ReadonlyArray<string>,
  resume: Resume | undefined,
  onConnected: (connectionId: string) => void,
  onSeq: (seq: number) => void,
) =>
  Effect.gen(function* () {
    const client = yield* RpcClient.make(RealtimeRpcs)
    const handle: LiveHandle = {
      updatePresence: (scope, focusEntityId, typing) => {
        void Effect.runPromise(
          client["presence.update"]({
            scope,
            focusEntityId,
            ...(typing === undefined ? {} : { typing }),
          }).pipe(Effect.ignore),
        )
      },
    }
    live = handle
    for (const scope of presence) {
      const focusEntityId = presenceSlots.get(scope)?.focusEntityId ?? null
      if (focusEntityId !== null) handle.updatePresence(scope, focusEntityId)
    }

    const subscribed = client["realtime.subscribe"]({
      scopes: [...scopes],
      ...(resume === undefined ? {} : { resume }),
    }).pipe(
      Stream.runForEach((message) =>
        Effect.sync(() => {
          if (message._tag === "Hello") {
            onConnected(message.connectionId)
            // A resumed connection replays what it missed, or the server sends a `Resync`.
            if (resume === undefined) invalidateLiveKeys(queryClient)
          }
          if (message._tag === "Event") onSeq(message.seq)
          if (message._tag !== "Hello") applyMessage(queryClient, message)
        }),
      ),
    )
    const joins = presence.map((scope) =>
      client["presence.join"]({ scope }).pipe(
        Stream.runForEach((state) => Effect.sync(() => setViewers(state.scope, state.viewers))),
      ),
    )
    yield* Effect.all([subscribed, ...joins], { concurrency: "unbounded" }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (live === handle) live = null
        }),
      ),
    )
  }).pipe(Effect.scoped, Effect.provide(ProtocolLive))

/**
 * Keeps the realtime connection open while the app is mounted. Reconnects with capped exponential
 * backoff after failures, resumes from the last sequence, and restarts immediately when the scope
 * set changes. Returns a stop function.
 */
export const startRealtime = (queryClient: QueryClient): (() => void) => {
  const controller = new AbortController()
  let resume: Resume | undefined
  let connectionId: string | undefined
  let restart: AbortController | undefined
  let restartRequested = false

  const requestRestart = () => {
    restartRequested = true
    restart?.abort()
  }
  const unsubscribeScopes = subscriptions.onChange(requestRestart)
  const unsubscribePresence = presenceScopes.onChange(requestRestart)

  const sleep = (ms: number) => {
    const { promise, resolve } = Promise.withResolvers<void>()
    const timer = setTimeout(resolve, ms)
    controller.signal.addEventListener("abort", () => {
      clearTimeout(timer)
      resolve()
    })
    return promise
  }

  const run = async () => {
    let attempt = 0
    while (!controller.signal.aborted) {
      restart = new AbortController()
      restartRequested = false
      const scopes = [...ALWAYS_SCOPES, ...subscriptions.list()]
      try {
        await Effect.runPromise(
          connectOnce(
            queryClient,
            scopes,
            presenceScopes.list(),
            resume,
            (id) => {
              connectionId = id
              attempt = 0
            },
            (seq) => {
              if (connectionId !== undefined) resume = { connectionId, lastSeq: seq }
            },
          ),
          { signal: restart.signal },
        )
      } catch {
        // Fall through to the backoff below; the next attempt resumes or resyncs.
      }
      if (controller.signal.aborted) break
      if (restartRequested) continue
      attempt += 1
      await sleep(Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempt, 5)))
    }
  }

  void run()
  return () => {
    controller.abort()
    restart?.abort()
    unsubscribeScopes()
    unsubscribePresence()
  }
}
