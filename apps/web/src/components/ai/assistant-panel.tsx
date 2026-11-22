import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Send, Settings, Square, Trash2 } from "lucide-react"
import type { AiChatStreamMessage } from "@audit/domain/ai/schema"
import type { AiConversationId } from "@audit/domain/ids"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@audit/ui/components/ui/sheet.tsx"
import { Textarea } from "@audit/ui/components/ui/textarea.tsx"
import { callApi } from "../../lib/api.ts"
import {
  aiConversationQuery,
  aiConversationsQuery,
  aiKeys,
  aiStatusQuery,
  streamAiChat,
  type AiChatStream,
} from "../../lib/ai.ts"
import { ErrorMessage, LoadingRows } from "../feedback.tsx"
import { AutoApproveDialog, LiveTurnView, MessageView, type LiveTurn } from "./assistant-parts.tsx"
import { consumePrompt, setAssistantOpen, useAssistantState } from "./ai-store.ts"

/** Right-hand assistant panel, mounted once in the app shell. */
export function AssistantPanel() {
  const { open } = useAssistantState()
  return (
    <Sheet open={open} onOpenChange={setAssistantOpen}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <AssistantBody />
      </SheetContent>
    </Sheet>
  )
}

function ConversationMessages({
  conversationId,
  live,
}: {
  readonly conversationId: AiConversationId
  readonly live: LiveTurn | null
}) {
  const detail = useQuery(aiConversationQuery(conversationId))
  if (detail.isPending) return <LoadingRows />
  if (detail.isError) return <ErrorMessage error={detail.error} />
  const persisted = new Set(
    detail.data.messages.flatMap((message) =>
      message.parts.flatMap((part) => (part._tag === "proposal" ? [part.proposalId] : [])),
    ),
  )
  return (
    <div className="space-y-4">
      {detail.data.messages.map((message) => (
        <MessageView key={message.id} message={message} />
      ))}
      {live === null ? null : <LiveTurnView live={live} persisted={persisted} />}
    </div>
  )
}

function AssistantBody() {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const { pageContext, prompt } = useAssistantState()
  const status = useQuery(aiStatusQuery)
  const conversations = useQuery(aiConversationsQuery)
  const [selected, setSelected] = useState<AiConversationId | null>(null)
  const [live, setLive] = useState<LiveTurn | null>(null)
  const [draft, setDraft] = useState("")
  const [turnError, setTurnError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<unknown>(null)
  const [announcement, setAnnouncement] = useState("")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const stream = useRef<AiChatStream | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  // Closing the panel unmounts this body, which interrupts any turn still streaming.
  useEffect(() => () => stream.current?.stop(), [])

  const [seenPrompt, setSeenPrompt] = useState<typeof prompt>(null)
  if (prompt !== seenPrompt) {
    setSeenPrompt(prompt)
    if (prompt !== null) setDraft(prompt.text)
  }

  useEffect(() => {
    if (prompt !== null) consumePrompt()
  }, [prompt])

  useEffect(() => {
    const element = scroller.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [live, selected])

  const remove = useMutation({
    mutationFn: (conversationId: AiConversationId) =>
      callApi((api) => api.ai.deleteConversation({ params: { conversationId } })),
    onSuccess: (_result, conversationId) => {
      setSelected((current) => (current === conversationId ? null : current))
      queryClient.removeQueries({ queryKey: aiKeys.conversation(conversationId) })
      void queryClient.invalidateQueries({ queryKey: aiKeys.conversations })
    },
    onError: (error) => {
      setActionError(error)
    },
  })

  let notice: string | null = null
  const current = status.data
  if (current !== undefined) {
    if (!current.enabled) notice = t`AI is turned off for this workspace.`
    else if (!current.allowed) notice = t`Your role cannot use AI in this workspace.`
    else if (!current.features.assistant)
      notice = t`The assistant is turned off for this workspace.`
    else if (!current.hasProvider) notice = t`No AI provider is configured yet.`
    else if (
      current.monthlyTokenBudget !== null &&
      current.usedTokens >= current.monthlyTokenBudget
    )
      notice = t`This month's AI budget is used up.`
  }

  const stopTurn = () => {
    const running = stream.current
    stream.current = null
    running?.stop()
    setLive(null)
    if (selected !== null) {
      void queryClient.invalidateQueries({ queryKey: aiKeys.conversation(selected) })
    }
  }

  const choose = (conversationId: AiConversationId | null) => {
    stopTurn()
    setTurnError(null)
    setActionError(null)
    setSelected(conversationId)
  }

  const settleTurn = async (conversationId: AiConversationId, failed: boolean) => {
    if (failed) setTurnError(t`The assistant stopped before it finished.`)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: aiKeys.conversation(conversationId) }),
      queryClient.invalidateQueries({ queryKey: aiKeys.conversations }),
      queryClient.invalidateQueries({ queryKey: aiKeys.status }),
    ])
    setLive(null)
    setAnnouncement(failed ? t`The assistant stopped.` : t`The assistant replied.`)
  }

  const applyMessage = (message: AiChatStreamMessage) => {
    switch (message._tag) {
      case "ai.chat.delta":
        setLive((turn) => (turn === null ? null : { ...turn, text: turn.text + message.text }))
        return
      case "ai.chat.tool_call":
        setLive((turn) =>
          turn === null
            ? null
            : {
                ...turn,
                tools: [
                  ...turn.tools,
                  {
                    callId: message.callId,
                    name: message.name,
                    input: message.input,
                    hasOutput: false,
                    output: undefined,
                  },
                ],
              },
        )
        return
      case "ai.chat.tool_result":
        setLive((turn) =>
          turn === null
            ? null
            : {
                ...turn,
                tools: turn.tools.map((tool) =>
                  tool.callId === message.callId
                    ? { ...tool, hasOutput: true, output: message.output }
                    : tool,
                ),
              },
        )
        return
      case "ai.chat.proposal":
        setLive((turn) =>
          turn === null ? null : { ...turn, proposals: [...turn.proposals, message.proposalId] },
        )
        void queryClient.invalidateQueries({ queryKey: aiKeys.proposals })
        return
      case "ai.chat.error":
        setTurnError(message.message)
        return
      case "ai.chat.usage":
      case "ai.chat.done":
        return
    }
  }

  const startTurn = (conversationId: AiConversationId, text: string) => {
    setLive({ userText: text, text: "", tools: [], proposals: [] })
    stream.current = streamAiChat(
      { conversationId, text },
      {
        onMessage: applyMessage,
        onEnd: (failed) => {
          stream.current = null
          void settleTurn(conversationId, failed)
        },
      },
    )
  }

  const send = async () => {
    const text = draft.trim()
    if (text === "" || live !== null || notice !== null) return
    setDraft("")
    setTurnError(null)
    setActionError(null)
    try {
      let conversationId = selected
      if (conversationId === null) {
        const created = await callApi((api) =>
          api.ai.createConversation({
            payload: {
              title: text.slice(0, 80),
              ...(pageContext === null ? {} : { contextEntityId: pageContext }),
            },
          }),
        )
        conversationId = created.id
        setSelected(created.id)
        void queryClient.invalidateQueries({ queryKey: aiKeys.conversations })
      }
      startTurn(conversationId, text)
    } catch (error) {
      setDraft(text)
      setActionError(error)
    }
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void send()
  }

  return (
    <>
      <SheetHeader className="gap-2 border-b p-4 pe-12 sm:flex-row sm:items-center">
        <SheetTitle>
          <Trans>Assistant</Trans>
        </SheetTitle>
        <div className="flex w-full items-center gap-1 sm:w-auto">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t`Assistant settings`}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings aria-hidden="true" className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t`Delete conversation`}
            disabled={selected === null || live !== null || remove.isPending}
            onClick={() => {
              if (selected !== null) remove.mutate(selected)
            }}
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </Button>
          <Button variant="outline" size="sm" className="ms-auto" onClick={() => choose(null)}>
            <Plus aria-hidden="true" className="size-4" />
            <Trans>New</Trans>
          </Button>
        </div>
      </SheetHeader>

      <div className="space-y-2 border-b p-4">
        <label htmlFor="ai-conversation" className="text-sm font-medium">
          <Trans>Conversation</Trans>
        </label>
        <select
          id="ai-conversation"
          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          value={selected ?? ""}
          onChange={(event) => {
            const value = event.target.value
            choose(value === "" ? null : (value as AiConversationId))
          }}
        >
          <option value="">{t`Choose a conversation`}</option>
          {(conversations.data ?? []).map((conversation) => (
            <option key={conversation.id} value={conversation.id}>
              {conversation.title}
            </option>
          ))}
        </select>
        {conversations.isError ? <ErrorMessage error={conversations.error} /> : null}
        {pageContext === null ? null : (
          <p className="text-xs text-muted-foreground">
            <Trans>New conversations start with this page as context.</Trans>
          </p>
        )}
      </div>

      {status.isError ? <ErrorMessage error={status.error} /> : null}
      {notice === null ? null : <p className="border-b bg-muted/40 px-4 py-2 text-sm">{notice}</p>}

      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {selected === null && live === null ? (
          <p className="text-sm text-muted-foreground">
            <Trans>
              Ask about this page, search the workspace, or request drafts. Changes wait for your
              approval.
            </Trans>
          </p>
        ) : null}
        {selected === null ? null : <ConversationMessages conversationId={selected} live={live} />}
        {turnError === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {turnError}
          </p>
        )}
        {actionError === null ? null : <ErrorMessage error={actionError} />}
      </div>

      <output aria-live="polite" className="sr-only">
        {announcement}
      </output>

      {notice === null ? (
        <form
          className="flex items-end gap-2 border-t p-3"
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <Textarea
            aria-label={t`Message the assistant`}
            placeholder={t`Ask the assistant`}
            value={draft}
            rows={2}
            maxLength={8000}
            className="min-h-10 resize-none"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onComposerKeyDown}
          />
          {live === null ? (
            <Button type="submit" disabled={draft.trim() === ""}>
              <Send aria-hidden="true" className="size-4" />
              <Trans>Send</Trans>
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={stopTurn}>
              <Square aria-hidden="true" className="size-4" />
              <Trans>Stop</Trans>
            </Button>
          )}
        </form>
      ) : null}

      <AutoApproveDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  )
}
