/**
 * One-shot AI actions from the editor, chat, board and calendar surfaces. Each runs a single model
 * turn over context read through the same queries the UI uses, as the AI actor acting for the
 * signed-in person. Editor, chat, calendar and column summaries are text only. Board triage and
 * task breakdown store their suggestions as pending proposals; nothing is applied without approval.
 */
import type { ProviderConfig } from "@audit/ai/provider"
import type { Actor, AiActor } from "@audit/domain/actor"
import { CurrentActor } from "@audit/domain/actor"
import type { AiActionInput, AiActionResult } from "@audit/domain/ai/schema"
import { AiUnavailable } from "@audit/domain/ai/errors"
import { Forbidden, NotFound, ValidationError } from "@audit/domain/errors"
import { AiProposalId, type AiProviderId, type UserId } from "@audit/domain/ids"
import { BoardView } from "@audit/domain/tasks/schema"
import { Effect, Schema } from "effect"
import * as LanguageModel from "effect/ai/LanguageModel"
import { Authz } from "../authz.ts"
import { calendarsVisibleTo, occurrencesIn } from "../calendar/queries.ts"
import { messagePage } from "../chat/queries.ts"
import { recipientLocale } from "../notifications/locale.ts"
import { plainText } from "../notifications/notify.ts"
import { boardView } from "../tasks/queries.ts"
import { loadAiContext } from "./guard.ts"
import { AiModels } from "./models.ts"
import { type ProposalDraft, proposeChange } from "./proposals.ts"
import { createConversation } from "./conversations.ts"
import { createTaskRequest, moveTaskRequest } from "./tool-commands.ts"
import type { AiSettings } from "@audit/domain/ai/schema"
import { checkBudget, recordUsage } from "./usage.ts"

type ActionFeature = "editor" | "chat" | "board" | "calendar"

type EditorInput = Extract<AiActionInput, { surface: "editor" }>
type ChatInput = Extract<AiActionInput, { surface: "chat" }>
type BoardInput = Extract<AiActionInput, { surface: "board" }>
type BreakDownInput = Extract<BoardInput, { action: "break_down" }>
type CalendarInput = Extract<AiActionInput, { surface: "calendar" }>

type BoardViewValue = typeof BoardView.Type

type UserActor = Extract<Actor, { _tag: "user" }>
/** Everything a model call needs, resolved once by `runAiAction`. */
interface ModelCall {
  readonly userId: UserId
  readonly actor: UserActor
  readonly providerId: AiProviderId
  readonly config: ProviderConfig
  readonly settings: AiSettings
  readonly feature: ActionFeature
  readonly locale: string
}

const LOCALE_NAMES: Record<"en" | "pt-BR" | "es", string> = {
  en: "English",
  "pt-BR": "Brazilian Portuguese",
  es: "Spanish",
}

const DAY_MS = 86_400_000
const CHAT_LIMIT = 40
const BOARD_CARD_LIMIT = 200

const system = (locale: string, task: string) =>
  `You are a workspace assistant. ${task} Answer in the user's interface language (${locale}) unless the task says otherwise. Return only the result, with no preface.`

/** One model call. Returns null when the model produced no text. */
const complete = (call: ModelCall, systemPrompt: string, user: string) =>
  Effect.gen(function* () {
    yield* checkBudget(call.userId, call.settings)
    const models = yield* AiModels
    const response = yield* LanguageModel.generateText({
      prompt: [
        { role: "system", content: systemPrompt },
        { role: "user", content: user },
      ],
    }).pipe(
      Effect.mapError((error) => new AiUnavailable({ message: error.message })),
      Effect.provide(models.language(call.config)),
    )
    yield* recordUsage({
      userId: call.userId,
      providerId: call.providerId,
      feature: call.feature,
      model: call.config.chatModel,
      inputTokens: response.usage.inputTokens.total ?? 0,
      outputTokens: response.usage.outputTokens.total ?? 0,
    })
    const text = response.text.trim()
    return text.length > 0 ? text : null
  })

const editorAction = (input: EditorInput, call: ModelCall) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireOn("doc.read", input.docId)
    const selection = input.selection?.trim() ?? ""
    if (selection.length === 0) {
      return yield* new ValidationError({ message: "Select some text first", field: "selection" })
    }
    const target = input.targetLocale ?? "en"
    const task = (() => {
      switch (input.action) {
        case "rewrite":
          return "Rewrite the text to be clearer and tighter. Keep its meaning and its own language."
        case "summarize":
          return "Summarize the text in a few sentences."
        case "translate":
          return `Translate the text into ${LOCALE_NAMES[target]}. Ignore the interface language rule.`
        case "fix_grammar":
          return "Fix grammar, spelling and punctuation. Keep the wording and language otherwise unchanged."
      }
    })()
    const text = yield* complete(call, system(call.locale, task), selection)
    const result: AiActionResult = { text, proposals: [] }
    return result
  })

const chatAction = (input: ChatInput, call: ModelCall) =>
  Effect.gen(function* () {
    const page = yield* messagePage(input.channelId, { limit: CHAT_LIMIT }, call.userId)
    const lines = page.messages
      .filter((message) => message.bodyText.trim().length > 0)
      .map(
        (message) =>
          `${message.createdAt.toISOString()} ${message.author.name}: ${message.bodyText}`,
      )
    if (lines.length === 0) {
      const empty: AiActionResult = { text: null, proposals: [] }
      return empty
    }
    const task =
      input.action === "summarize_channel"
        ? "Summarize this channel conversation: main points, decisions, open questions and action items."
        : "Draft a short reply to the latest messages, for the signed-in user to post. Match the channel's tone. Return only the draft."
    const text = yield* complete(call, system(call.locale, task), lines.join("\n"))
    const result: AiActionResult = { text, proposals: [] }
    return result
  })

/** Columns and task cards as plain lines, capped so the prompt stays bounded. */
const boardTranscript = (view: BoardViewValue) => {
  let remaining = BOARD_CARD_LIMIT
  const lines: Array<string> = []
  for (const column of view.columns) {
    const wip = column.overWipLimit ? " (over WIP limit)" : ""
    lines.push(`## ${column.name} [column id ${column.id}]${wip}`)
    for (const card of column.tasks) {
      if (remaining === 0) break
      remaining -= 1
      const due = card.dueAt === null ? "none" : card.dueAt.toISOString()
      lines.push(
        `- ${card.key} [id ${card.id}] ${card.title} | priority ${card.priority} | assignees ${card.assignees.length} | due ${due}`,
      )
    }
  }
  return lines.join("\n")
}

const TRIAGE_TASK = `Triage this board: point out blocked, overdue, unassigned or misplaced work. Suggest a move only where a task clearly belongs in another column. Respond with JSON only: {"summary": string, "suggestions": [{"type": "move", "taskId": string, "columnId": string}]}. Use only the ids in brackets.`
const BREAK_DOWN_TASK = `Break this task into two to eight concrete subtasks. Respond with JSON only: {"summary": string, "suggestions": [{"type": "subtask", "title": string, "description": string}]}. The summary is one sentence about the plan.`

const Suggestion = Schema.Union([
  Schema.Struct({ type: Schema.Literal("move"), taskId: Schema.String, columnId: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("subtask"),
    title: Schema.String,
    description: Schema.optionalKey(Schema.String),
  }),
])
const BoardSuggestions = Schema.Struct({
  summary: Schema.String,
  suggestions: Schema.Array(Suggestion),
})

/** Model output as JSON, tolerating a code fence. Unparseable output keeps its text, with no suggestions. */
const parseSuggestions = (text: string) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(BoardSuggestions))(
    text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, ""),
  ).pipe(Effect.orElseSucceed(() => ({ summary: text, suggestions: [] })))

const cardsOf = (view: BoardViewValue) => view.columns.flatMap((column) => column.tasks)

interface Suggested {
  readonly tool: string
  readonly draft: ProposalDraft
}

/** Stores each suggestion as a pending proposal in one new conversation. Nothing is applied. */
const proposeAll = (actor: UserActor, title: string, items: ReadonlyArray<Suggested>) =>
  Effect.gen(function* () {
    const ids: Array<AiProposalId> = []
    if (items.length === 0) return ids
    const conversation = yield* createConversation.execute({ title })
    for (const item of items) {
      const outcome = yield* proposeChange.execute({
        ...item.draft,
        preview: { ...item.draft.preview, fields: [...item.draft.preview.fields] },
        tool: item.tool,
        autoApprovable: false,
        conversationId: conversation.id,
      })
      const id = yield* Schema.decodeUnknownEffect(AiProposalId)(outcome.proposalId).pipe(
        Effect.orDie,
      )
      ids.push(id)
    }
    return ids
  }).pipe(Effect.provideService(CurrentActor, actor))

const triageAction = (view: BoardViewValue, call: ModelCall) =>
  Effect.gen(function* () {
    const raw =
      (yield* complete(call, system(call.locale, TRIAGE_TASK), boardTranscript(view))) ?? ""
    const reply = yield* parseSuggestions(raw)
    const items: Array<Suggested> = []
    for (const suggestion of reply.suggestions) {
      if (suggestion.type !== "move") continue
      const card = cardsOf(view).find((candidate) => candidate.id === suggestion.taskId)
      const column = view.columns.find((candidate) => candidate.id === suggestion.columnId)
      if (card === undefined || column === undefined) continue
      const draft = yield* moveTaskRequest({ taskId: card.id, columnId: column.id })
      items.push({ tool: "move_task", draft })
    }
    const proposals = yield* proposeAll(call.actor, "Board triage", items)
    const result: AiActionResult = { text: reply.summary, proposals }
    return result
  })

const breakDownAction = (input: BreakDownInput, view: BoardViewValue, call: ModelCall) =>
  Effect.gen(function* () {
    const parent = cardsOf(view).find((card) => card.id === input.taskId)
    if (parent === undefined) {
      return yield* new NotFound({ entity: "task", id: input.taskId })
    }
    const task = `${parent.key} ${parent.title} (priority ${parent.priority})`
    const raw = (yield* complete(call, system(call.locale, BREAK_DOWN_TASK), task)) ?? ""
    const reply = yield* parseSuggestions(raw)
    const items: Array<Suggested> = []
    for (const suggestion of reply.suggestions) {
      if (suggestion.type !== "subtask" || suggestion.title.trim().length === 0) continue
      const draft = yield* createTaskRequest({
        columnId: parent.columnId,
        title: suggestion.title.trim(),
        ...(suggestion.description === undefined ? {} : { description: suggestion.description }),
      })
      items.push({ tool: "create_task", draft })
    }
    const proposals = yield* proposeAll(call.actor, "Break down task", items)
    const result: AiActionResult = { text: reply.summary, proposals }
    return result
  })

const boardAction = (input: BoardInput, call: ModelCall) =>
  Effect.gen(function* () {
    const view = yield* boardView(input.boardId, {})
    if (input.action === "break_down") return yield* breakDownAction(input, view, call)
    if (input.action === "triage") return yield* triageAction(view, call)
    const text = yield* complete(
      call,
      system(
        call.locale,
        "Summarize each column: what it holds, what is blocked or overdue, and any WIP-limit problem.",
      ),
      boardTranscript(view),
    )
    const result: AiActionResult = { text, proposals: [] }
    return result
  })

const calendarAction = (input: CalendarInput, call: ModelCall) =>
  Effect.gen(function* () {
    const calendars = yield* calendarsVisibleTo(call.userId).pipe(Effect.orDie)
    if (!calendars.some((calendar) => calendar.id === input.calendarId)) {
      return yield* new NotFound({ entity: "calendar", id: input.calendarId })
    }
    const now = new Date()
    let from: Date
    let to: Date
    if (input.action === "summarize_week") {
      // Monday 00:00 UTC of the current week, seven days forward.
      const mondayOffset = (now.getUTCDay() + 6) % 7
      from = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - mondayOffset),
      )
      to = new Date(from.getTime() + 7 * DAY_MS)
    } else {
      from = now
      to = new Date(now.getTime() + 7 * DAY_MS)
    }
    const occurrences = yield* occurrencesIn(call.userId, from, to).pipe(Effect.orDie)
    const lines = occurrences
      .filter((occurrence) => occurrence.calendarId === input.calendarId)
      .map((occurrence) => {
        const where = occurrence.location.length > 0 ? ` @ ${occurrence.location}` : ""
        const notes =
          occurrence.description === null ? "" : ` — ${plainText(occurrence.description)}`
        return `${occurrence.startsAt.toISOString()} – ${occurrence.endsAt.toISOString()} ${occurrence.title}${where}${notes}`
      })
    const task =
      input.action === "suggest_agenda"
        ? "Suggest an agenda for the upcoming events in this calendar: items, time for each, and what to prepare. Flag overlaps."
        : "Summarize this week's calendar: key events, busy days, conflicts and what to prepare."
    const body = lines.length === 0 ? "No events in this range." : lines.join("\n")
    const text = yield* complete(call, system(call.locale, task), body)
    const result: AiActionResult = { text, proposals: [] }
    return result
  })

type ActionArms = [
  ReturnType<typeof editorAction>,
  ReturnType<typeof chatAction>,
  ReturnType<typeof boardAction>,
  ReturnType<typeof calendarAction>,
]
type ActionError = Effect.Error<ActionArms[number]>
type ActionServices = Effect.Services<ActionArms[number]>

const dispatch = (
  input: AiActionInput,
  call: ModelCall,
): Effect.Effect<AiActionResult, ActionError, ActionServices> => {
  switch (input.surface) {
    case "editor":
      return editorAction(input, call)
    case "chat":
      return chatAction(input, call)
    case "board":
      return boardAction(input, call)
    case "calendar":
      return calendarAction(input, call)
  }
}

/**
 * Runs one AI action for the signed-in person. Refusals (AI off, role, feature switch, budget,
 * missing provider) and permission checks happen before any model call.
 */
export const runAiAction = (input: AiActionInput) =>
  Effect.gen(function* () {
    const actor = yield* CurrentActor
    if (actor._tag !== "user") {
      return yield* new Forbidden({ action: "ai.use", message: "Only people can run AI actions" })
    }
    const userId = actor.userId
    const feature: ActionFeature = input.surface
    const loaded = yield* loadAiContext(userId, feature)
    const locale = yield* recipientLocale(userId)
    const call: ModelCall = {
      userId,
      actor,
      providerId: loaded.providerId,
      config: loaded.config,
      settings: loaded.settings,
      feature,
      locale,
    }
    const aiActor: AiActor = { _tag: "ai", onBehalfOf: userId, role: actor.role }
    return yield* Effect.provideService(dispatch(input, call), CurrentActor, aiActor)
  })
