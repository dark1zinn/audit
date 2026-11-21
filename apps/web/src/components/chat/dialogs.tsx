import { useState } from "react"
import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import type { Message } from "@audit/domain/chat/schema"
import type { BoardId, ChannelId, ProjectId, UserId } from "@audit/domain/ids"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@audit/ui/components/ui/dialog.tsx"
import { useChannelActions } from "../actions/channel-actions.ts"
import { ConfirmDialog } from "../actions/confirm-dialog.tsx"
import { callApi } from "../../lib/api.ts"
import { browseQuery, channelQuery, chatKeys, pinsQuery } from "../../lib/chat.ts"
import { membersQuery, projectsQuery, boardsQuery } from "../../lib/queries.ts"
import { ErrorMessage, LoadingRows } from "../feedback.tsx"
import { MessageBody } from "./message-body.tsx"

const MAX_GROUP_PEOPLE = 8

const invalidateChat = (queryClient: QueryClient, channelId?: ChannelId) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: chatKeys.channels }),
    queryClient.invalidateQueries({ queryKey: chatKeys.browse }),
    ...(channelId === undefined
      ? []
      : [queryClient.invalidateQueries({ queryKey: chatKeys.channel(channelId) })]),
  ])

interface ChannelSettingsDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly channelId: ChannelId
  readonly meId: string
}

/** Channel settings: name and topic, notifications, members, archive and leave. */
export function ChannelSettingsDialog({
  open,
  onOpenChange,
  channelId,
  meId,
}: ChannelSettingsDialogProps) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const header = useQuery({ ...channelQuery(channelId), enabled: open })
  const members = useQuery({ ...membersQuery, enabled: open })
  const [error, setError] = useState<unknown>(null)
  const [name, setName] = useState<string | null>(null)
  const [topic, setTopic] = useState<string | null>(null)
  const [addId, setAddId] = useState("")
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const channelActions = useChannelActions(
    header.data === undefined ? null : { kind: "channel", channel: header.data.channel },
  )
  const channelAction = (id: string) =>
    channelActions
      .flatMap((group) => group.flatMap((action) => [action, ...(action.children ?? [])]))
      .find((action) => action.id === id)

  const requestAction = (id: string) => {
    const action = channelAction(id)
    if (action?.confirm === undefined) action?.run?.()
    else setPendingAction(id)
  }
  const confirming = pendingAction === null ? undefined : channelAction(pendingAction)

  const act = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: () => {
      setError(null)
      return invalidateChat(queryClient, channelId)
    },
    onError: (caught) => setError(caught),
  })

  if (!open) return null
  const data = header.data
  const manager = data?.myRole === "manager"
  const channel = data?.channel
  const isDm = channel?.kind === "dm" || channel?.kind === "group_dm"
  const memberIds = new Set(data?.members.map((member) => member.userId) ?? [])
  const addable = (members.data ?? []).filter((member) => !memberIds.has(member.userId))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Trans>Channel settings</Trans>
          </DialogTitle>
          <DialogDescription>
            {isDm ? <Trans>Direct messages cannot be renamed.</Trans> : null}
          </DialogDescription>
        </DialogHeader>
        {header.isPending ? <LoadingRows /> : null}
        {header.isError ? <ErrorMessage error={header.error} /> : null}
        {channel === undefined ? null : (
          <div className="space-y-5">
            {isDm ? null : (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  act.mutate(() =>
                    callApi((api) =>
                      api.chat.updateChannel({
                        params: { channelId },
                        payload: {
                          name: name ?? channel.name,
                          topic: topic ?? channel.topic,
                          version: channel.version,
                        },
                      }),
                    ),
                  )
                }}
              >
                <div className="space-y-1">
                  <Label htmlFor="chat-channel-name">
                    <Trans>Name</Trans>
                  </Label>
                  <Input
                    id="chat-channel-name"
                    value={name ?? channel.name}
                    disabled={!manager}
                    maxLength={80}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="chat-channel-topic">
                    <Trans>Topic</Trans>
                  </Label>
                  <Input
                    id="chat-channel-topic"
                    value={topic ?? channel.topic ?? ""}
                    disabled={!manager}
                    maxLength={250}
                    onChange={(event) => setTopic(event.target.value)}
                  />
                </div>
                {manager ? (
                  <Button type="submit" size="sm" disabled={act.isPending}>
                    <Trans>Save</Trans>
                  </Button>
                ) : null}
              </form>
            )}

            <section className="space-y-2">
              <Label htmlFor="chat-notify">
                <Trans>Notifications</Trans>
              </Label>
              <select
                id="chat-notify"
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={channel.notifyLevel ?? "all"}
                onChange={(event) => requestAction(`notify-${event.target.value}`)}
              >
                <option value="all">{t`All messages`}</option>
                <option value="mentions">{t`Mentions only`}</option>
                <option value="none">{t`Nothing`}</option>
              </select>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">
                <Trans>Members</Trans>
              </h3>
              <ul className="space-y-1 text-sm">
                {data?.members.map((member) => (
                  <li key={member.userId} className="flex items-center justify-between gap-2">
                    <span>
                      {member.name}
                      {member.role === "manager" ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          <Trans>Manager</Trans>
                        </span>
                      ) : null}
                    </span>
                    {manager && member.userId !== meId && !isDm ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={act.isPending}
                        onClick={() =>
                          act.mutate(() =>
                            callApi((api) =>
                              api.chat.removeMember({
                                params: { channelId },
                                payload: { userIds: [member.userId] },
                              }),
                            ),
                          )
                        }
                      >
                        <Trans>Remove</Trans>
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {manager && !isDm ? (
                <div className="flex gap-2">
                  <select
                    aria-label={t`Add member`}
                    className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
                    value={addId}
                    onChange={(event) => setAddId(event.target.value)}
                  >
                    <option value="">{t`Choose a person`}</option>
                    {addable.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.displayName}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    disabled={addId === "" || act.isPending}
                    onClick={() => {
                      const userId = addId
                      setAddId("")
                      act.mutate(() =>
                        callApi((api) =>
                          api.chat.addMembers({
                            params: { channelId },
                            payload: { userIds: [userId as UserId] },
                          }),
                        ),
                      )
                    }}
                  >
                    <Trans>Add</Trans>
                  </Button>
                </div>
              ) : null}
            </section>

            <section className="flex flex-wrap gap-2">
              {manager && !isDm ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={act.isPending}
                  onClick={() => requestAction("archive")}
                >
                  {channel.archivedAt === null ? (
                    <Trans>Archive channel</Trans>
                  ) : (
                    <Trans>Unarchive channel</Trans>
                  )}
                </Button>
              ) : null}
              {isDm ? null : (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={act.isPending}
                  onClick={() => requestAction("leave")}
                >
                  <Trans>Leave channel</Trans>
                </Button>
              )}
            </section>
          </div>
        )}
        {error === null ? null : <ErrorMessage error={error} />}
        {confirming?.confirm === undefined ? null : (
          <ConfirmDialog
            open
            title={confirming.confirm.title}
            description={confirming.confirm.description}
            confirmLabel={confirming.confirm.confirmLabel}
            onOpenChange={(next) => {
              if (!next) setPendingAction(null)
            }}
            onConfirm={() => {
              confirming.run?.()
              setPendingAction(null)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

interface PinsDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly channelId: ChannelId
  readonly meId: string
}

/** Pinned messages in a channel, newest pin first. */
export function PinsDialog({ open, onOpenChange, channelId }: PinsDialogProps) {
  const queryClient = useQueryClient()
  const pins = useQuery({ ...pinsQuery(channelId), enabled: open })
  const [error, setError] = useState<unknown>(null)
  const unpin = useMutation({
    mutationFn: (messageId: Message["id"]) =>
      callApi((api) => api.chat.unpin({ params: { messageId } })),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: chatKeys.channel(channelId) }),
        queryClient.invalidateQueries({ queryKey: chatKeys.channels }),
      ]),
    onError: (caught) => setError(caught),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Trans>Pinned messages</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Pinned messages stay easy to find for everyone in this channel.</Trans>
          </DialogDescription>
        </DialogHeader>
        {pins.isPending ? <LoadingRows /> : null}
        {pins.isError ? <ErrorMessage error={pins.error} /> : null}
        {pins.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>Nothing is pinned yet.</Trans>
          </p>
        ) : null}
        <ul className="space-y-3">
          {pins.data?.map((message) => (
            <li key={message.id} className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">{message.author.name}</p>
              <MessageBody body={message.body} />
              <Button
                size="sm"
                variant="ghost"
                className="mt-2"
                disabled={unpin.isPending}
                onClick={() => unpin.mutate(message.id)}
              >
                <Trans>Unpin</Trans>
              </Button>
            </li>
          ))}
        </ul>
        {error === null ? null : <ErrorMessage error={error} />}
      </DialogContent>
    </Dialog>
  )
}

interface MessageToTaskDialogProps {
  readonly message: Message | null
  readonly onOpenChange: (open: boolean) => void
}

/** Creates a task on a board from a chat message. */
export function MessageToTaskDialog({ message, onOpenChange }: MessageToTaskDialogProps) {
  return (
    <Dialog open={message !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {message === null ? null : (
          <TaskFromMessageForm
            key={message.id}
            message={message}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function TaskFromMessageForm({
  message,
  onDone,
}: {
  readonly message: Message
  readonly onDone: () => void
}) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const projects = useQuery(projectsQuery)
  const [projectId, setProjectId] = useState<ProjectId | "">("")
  const boards = useQuery({
    ...boardsQuery(projectId as ProjectId),
    enabled: projectId !== "",
  })
  const [boardId, setBoardId] = useState("")
  const [title, setTitle] = useState(message.bodyText.slice(0, 120))
  const [error, setError] = useState<unknown>(null)
  const create = useMutation({
    mutationFn: () =>
      callApi((api) =>
        api.chat.messageToTask({
          params: { messageId: message.id },
          payload: { boardId: boardId as BoardId, title },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tasks"] })
      onDone()
      void navigate({ to: "/p/$key/board", params: { key: projectKey(projects.data, projectId) } })
    },
    onError: (caught) => setError(caught),
  })
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          <Trans>Create task from message</Trans>
        </DialogTitle>
        <DialogDescription>
          <Trans>The message stays in the channel and links to the new task.</Trans>
        </DialogDescription>
      </DialogHeader>
      {projects.isPending ? <LoadingRows /> : null}
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="task-project">
            <Trans>Project</Trans>
          </Label>
          <select
            id="task-project"
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value as ProjectId | "")
              setBoardId("")
            }}
          >
            <option value="">{t`Choose a project`}</option>
            {projects.data?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="task-board">
            <Trans>Board</Trans>
          </Label>
          <select
            id="task-board"
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={boardId}
            disabled={projectId === ""}
            onChange={(event) => setBoardId(event.target.value)}
          >
            <option value="">{t`Choose a board`}</option>
            {boards.data?.map((board) => (
              <option key={board.id} value={board.id}>
                {board.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="task-title">
            <Trans>Title</Trans>
          </Label>
          <Input
            id="task-title"
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <Button
          disabled={boardId === "" || title.trim() === "" || create.isPending}
          onClick={() => create.mutate()}
        >
          <Trans>Create task</Trans>
        </Button>
        {error === null ? null : <ErrorMessage error={error} />}
      </div>
    </>
  )
}

const projectKey = (projects: ReadonlyArray<{ id: string; key: string }> | undefined, id: string) =>
  projects?.find((project) => project.id === id)?.key ?? ""

interface CreateChannelDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

/** Creates a public or private channel and opens it. */
export function CreateChannelDialog({ open, onOpenChange }: CreateChannelDialogProps) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [topic, setTopic] = useState("")
  const [kind, setKind] = useState<"public" | "private">("public")
  const [error, setError] = useState<unknown>(null)
  const create = useMutation({
    mutationFn: () =>
      callApi((api) =>
        api.chat.createChannel({
          payload: {
            name: name.trim(),
            kind,
            ...(topic.trim() === "" ? {} : { topic: topic.trim() }),
          },
        }),
      ),
    onSuccess: async (channel) => {
      await invalidateChat(queryClient)
      onOpenChange(false)
      void navigate({ to: "/c/$channelId", params: { channelId: channel.id } })
    },
    onError: (caught) => setError(caught),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <Trans>New channel</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Public channels can be found and joined by anyone in the workspace.</Trans>
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate()
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="new-channel-name">
              <Trans>Name</Trans>
            </Label>
            <Input
              id="new-channel-name"
              required
              maxLength={80}
              value={name}
              placeholder={t`general`}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-channel-topic">
              <Trans>Topic</Trans>
            </Label>
            <Input
              id="new-channel-topic"
              maxLength={250}
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-channel-kind">
              <Trans>Visibility</Trans>
            </Label>
            <select
              id="new-channel-kind"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={kind}
              onChange={(event) => setKind(event.target.value as "public" | "private")}
            >
              <option value="public">{t`Public`}</option>
              <option value="private">{t`Private`}</option>
            </select>
          </div>
          <Button type="submit" disabled={name.trim() === "" || create.isPending}>
            <Trans>Create channel</Trans>
          </Button>
          {error === null ? null : <ErrorMessage error={error} />}
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface BrowseChannelsDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

/** Public channels in the workspace, with join. */
export function BrowseChannelsDialog({ open, onOpenChange }: BrowseChannelsDialogProps) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const browse = useQuery({ ...browseQuery, enabled: open })
  const [error, setError] = useState<unknown>(null)
  const join = useMutation({
    mutationFn: (channelId: ChannelId) =>
      callApi((api) => api.chat.joinChannel({ params: { channelId } })),
    onSuccess: async (_result, channelId) => {
      await invalidateChat(queryClient, channelId)
      onOpenChange(false)
      void navigate({ to: "/c/$channelId", params: { channelId } })
    },
    onError: (caught) => setError(caught),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <Trans>Browse channels</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Join a public channel to see its messages.</Trans>
          </DialogDescription>
        </DialogHeader>
        {browse.isPending ? <LoadingRows /> : null}
        {browse.isError ? <ErrorMessage error={browse.error} /> : null}
        <ul className="divide-y">
          {browse.data?.map((channel) => (
            <li key={channel.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">#{channel.name}</p>
                {channel.topic === null || channel.topic === "" ? null : (
                  <p className="truncate text-xs text-muted-foreground">{channel.topic}</p>
                )}
              </div>
              {channel.isMember ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    onOpenChange(false)
                    void navigate({ to: "/c/$channelId", params: { channelId: channel.id } })
                  }}
                >
                  <Trans>Open</Trans>
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={join.isPending}
                  aria-label={t`Join #${channel.name}`}
                  onClick={() => join.mutate(channel.id)}
                >
                  <Trans>Join</Trans>
                </Button>
              )}
            </li>
          ))}
        </ul>
        {error === null ? null : <ErrorMessage error={error} />}
      </DialogContent>
    </Dialog>
  )
}

interface NewDmDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly meId: string
}

/** Starts a direct message, or a group DM with up to eight people including you. */
export function NewDmDialog({ open, onOpenChange, meId }: NewDmDialogProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const people = useQuery({ ...membersQuery, enabled: open })
  const [picked, setPicked] = useState<string[]>([])
  const [error, setError] = useState<unknown>(null)
  const others = (people.data ?? []).filter((person) => person.userId !== meId)
  const open_ = useMutation({
    mutationFn: () =>
      callApi((api) => api.chat.openDm({ payload: { userIds: picked as UserId[] } })),
    onSuccess: async (channel) => {
      await queryClient.invalidateQueries({ queryKey: chatKeys.channels })
      setPicked([])
      onOpenChange(false)
      void navigate({ to: "/c/$channelId", params: { channelId: channel.id } })
    },
    onError: (caught) => setError(caught),
  })
  const toggle = (userId: string) =>
    setPicked((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : current.length >= MAX_GROUP_PEOPLE - 1
          ? current
          : [...current, userId],
    )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <Trans>New message</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              Pick one person for a direct message, or up to seven for a group (eight with you).
            </Trans>
          </DialogDescription>
        </DialogHeader>
        {people.isPending ? <LoadingRows /> : null}
        <ul className="space-y-1">
          {others.map((person) => (
            <li key={person.userId}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent">
                <input
                  type="checkbox"
                  checked={picked.includes(person.userId)}
                  onChange={() => toggle(person.userId)}
                />
                {person.displayName}
              </label>
            </li>
          ))}
        </ul>
        <Button disabled={picked.length === 0 || open_.isPending} onClick={() => open_.mutate()}>
          <Trans>Start conversation</Trans>
        </Button>
        {error === null ? null : <ErrorMessage error={error} />}
      </DialogContent>
    </Dialog>
  )
}
