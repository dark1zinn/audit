/**
 * Write proposals. The assistant never writes directly: a write tool stores the command and its
 * input as a proposal, and it runs only when the user approves it. Approval runs the command as the
 * user, so permissions are checked again at approval time. Auto-approved low-risk tools run at once
 * as the AI actor on behalf of the user.
 */
import { aiProposals, aiUserPreferences } from "@audit/db/schema"
import { actorUserId, CurrentActor } from "@audit/domain/actor"
import { AiProposal } from "@audit/domain/ai/schema"
import { Conflict, Forbidden, NotFound } from "@audit/domain/errors"
import { type AiConversationId, EntityId, type UserId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import { defineJob } from "@audit/platform/jobs"
import { and, desc, eq, lt } from "drizzle-orm"
import { Effect, Schema } from "effect"
import * as Command from "../command.ts"
import { notify } from "../notifications/notify.ts"
import { record } from "../trail.ts"
import { proposalCommands } from "./proposal-commands.ts"

export const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000

export interface ProposalPreview {
  readonly summary: string
  readonly fields: ReadonlyArray<{ readonly label: string; readonly value: string }>
  readonly diff?: { readonly before: string; readonly after: string }
}

/** Built by a write tool; `input` is already encoded as JSON for storage. */
export interface ProposalRequest {
  readonly tool: string
  readonly command: string
  readonly input: unknown
  readonly preview: ProposalPreview
  /** The entity the change is about (a task, column, channel, ...). */
  readonly target: string
  readonly autoApprovable: boolean
  readonly conversationId: AiConversationId
}

/** What a write tool builds; `submitProposal` adds the tool name, risk level and conversation. */
export type ProposalDraft = Omit<ProposalRequest, "tool" | "autoApprovable" | "conversationId">

const ProposalId = Schema.String

/** The person the current actor acts for, with their role; forbidden for the system. */
const actingPerson = (action: string) =>
  Effect.gen(function* () {
    const actor = yield* CurrentActor
    const userId = actorUserId(actor)
    if (userId === null || actor._tag === "system") {
      return yield* new Forbidden({ action, message: "Only people can do this" })
    }
    return { _tag: "user", userId, role: actor.role } as const
  })

const actingUser = (action: string) => Effect.map(actingPerson(action), (actor) => actor.userId)

/** Runs a stored proposal's command in the current actor's context. */
export const runStored = (row: { readonly command: string; readonly input: unknown }) => {
  const entry = proposalCommands.find((item) => item.name === row.command)
  return entry === undefined
    ? Effect.die(`unknown proposal command ${row.command}`)
    : entry.run(row.input)
}

const setStatus = (
  proposalId: string,
  status: "approved" | "failed" | "rejected",
  result: unknown,
) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* db
      .update(aiProposals)
      .set({ status, result, decidedAt: new Date() })
      .where(eq(aiProposals.id, proposalId))
  })

const autoApprovedFor = (userId: UserId, tool: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [prefs] = yield* db
      .select({ tools: aiUserPreferences.autoApproveTools })
      .from(aiUserPreferences)
      .where(eq(aiUserPreferences.userId, userId))
      .limit(1)
    return prefs !== undefined && prefs.tools.includes(tool)
  })

/** The outcome of running a command: approved with its result, or failed with the reason. */
const execute = (row: { readonly command: string; readonly input: unknown }) =>
  runStored(row).pipe(
    Effect.match({
      onSuccess: (value) => ({ status: "approved" as const, result: value }),
      onFailure: (error) => ({
        status: "failed" as const,
        result: { error: error instanceof Error ? error.message : String(error) },
      }),
    }),
  )

const ProposalPreviewSchema = Schema.Struct({
  summary: Schema.String,
  fields: Schema.Array(Schema.Struct({ label: Schema.String, value: Schema.String })),
  diff: Schema.optionalKey(Schema.Struct({ before: Schema.String, after: Schema.String })),
})

const ProposalRequestSchema = Schema.Struct({
  tool: Schema.String,
  command: Schema.String,
  input: Schema.Unknown,
  preview: ProposalPreviewSchema,
  target: Schema.String,
  autoApprovable: Schema.Boolean,
  conversationId: Schema.String,
})

const ProposalOutcome = Schema.Struct({
  proposalId: Schema.String,
  status: Schema.Literals(["pending", "approved", "failed"]),
  result: Schema.Unknown,
})

/**
 * Stores a proposal in its own audited transaction. Auto-approved low-risk tools run the target
 * command at once (as the AI on behalf of the user, in a nested transaction); otherwise the user is
 * notified and the command runs only on approval.
 */
export const proposeChange = Command.make("ai.propose", {
  input: ProposalRequestSchema,
  output: ProposalOutcome,
  // Proposing changes nothing; the target command authorizes when it runs.
  authorize: () => Effect.void,
  run: (request) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* actingUser("ai.propose")
      const id = crypto.randomUUID()
      const target = Schema.decodeUnknownSync(EntityId)(request.target)
      yield* db
        .insert(aiProposals)
        .values({
          id,
          userId,
          conversationId: request.conversationId as AiConversationId,
          command: request.command,
          input: request.input,
          preview: request.preview,
          status: "pending",
          expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS),
        })
        .pipe(Effect.orDie)
      yield* record({
        action: "ai.proposal_created",
        entityId: target,
        details: { aiProposalId: id, command: request.command },
      })
      if (request.autoApprovable && (yield* autoApprovedFor(userId, request.tool))) {
        const outcome = yield* execute(request)
        yield* setStatus(id, outcome.status, outcome.result)
        yield* record({
          action: "ai.proposal_auto_approved",
          entityId: target,
          details: { aiProposalId: id, command: request.command, outcome: outcome.status },
        })
        return { proposalId: id, status: outcome.status, result: outcome.result }
      }
      yield* notify({
        userId,
        kind: "ai_proposal",
        entityId: target,
        projectId: null,
        actorId: null,
        payload: { proposalId: id, summary: request.preview.summary },
        groupKey: `ai_proposal:${id}`,
      })
      return { proposalId: id, status: "pending" as const, result: null }
    }),
})

const ownProposal = (proposalId: string, action: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    const userId = yield* actingUser(action)
    const [row] = yield* db
      .select()
      .from(aiProposals)
      .where(and(eq(aiProposals.id, proposalId), eq(aiProposals.userId, userId)))
      .limit(1)
    if (row === undefined) return yield* new NotFound({ entity: "ai_proposal", id: proposalId })
    return row
  })

const requirePending = (row: { readonly status: string; readonly expiresAt: Date }) =>
  Effect.gen(function* () {
    if (row.status !== "pending") {
      return yield* new Conflict({ message: `Proposal is ${row.status}` })
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      return yield* new Conflict({ message: "Proposal expired" })
    }
  })

const reload = (proposalId: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select()
      .from(aiProposals)
      .where(eq(aiProposals.id, proposalId))
      .limit(1)
    if (row === undefined) return yield* new NotFound({ entity: "ai_proposal", id: proposalId })
    return Schema.decodeUnknownSync(AiProposal)(row)
  })

/**
 * Approves a pending proposal. The stored command runs as the approving user, so its own
 * permission checks decide. If they fail, the error reaches the caller and the transaction rolls
 * back: nothing is written and the proposal stays pending.
 */
export const approveProposal = Command.make("ai.proposal.approve", {
  input: Schema.Struct({ proposalId: ProposalId }),
  output: AiProposal,
  authorize: ({ proposalId }) => ownProposal(proposalId, "ai.proposal.approve").pipe(Effect.asVoid),
  run: ({ proposalId }) =>
    Effect.gen(function* () {
      const actor = yield* actingPerson("ai.proposal.approve")
      const row = yield* ownProposal(proposalId, "ai.proposal.approve")
      yield* requirePending(row)
      const result = yield* runStored(row).pipe(Effect.provideService(CurrentActor, actor))
      yield* setStatus(proposalId, "approved", result)
      yield* record({
        action: "ai.proposal_approved",
        details: { aiProposalId: proposalId, command: row.command, outcome: "approved" },
      })
      return yield* reload(proposalId)
    }),
})

/** Rejects a pending proposal; nothing runs. */
export const rejectProposal = Command.make("ai.proposal.reject", {
  input: Schema.Struct({ proposalId: ProposalId }),
  output: AiProposal,
  authorize: ({ proposalId }) => ownProposal(proposalId, "ai.proposal.reject").pipe(Effect.asVoid),
  run: ({ proposalId }) =>
    Effect.gen(function* () {
      const row = yield* ownProposal(proposalId, "ai.proposal.reject")
      yield* requirePending(row)
      yield* setStatus(proposalId, "rejected", null)
      yield* record({ action: "ai.proposal_rejected", details: { aiProposalId: proposalId } })
      return yield* reload(proposalId)
    }),
})

export const aiProposalExpireJob = defineJob("ai.proposal_expire", Schema.Struct({}))

/** Marks pending proposals past their 24 h window as expired. Runs hourly from the job queue. */
export const expireProposals = () =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* db
      .update(aiProposals)
      .set({ status: "expired", decidedAt: new Date() })
      .where(and(eq(aiProposals.status, "pending"), lt(aiProposals.expiresAt, new Date())))
  })

/** The current user's proposals, newest first, optionally for one conversation. */
export const listProposals = (conversationId: AiConversationId | null) =>
  Effect.gen(function* () {
    const db = yield* Db
    const userId = yield* actingUser("ai.proposal.list")
    const rows = yield* db
      .select()
      .from(aiProposals)
      .where(
        conversationId === null
          ? eq(aiProposals.userId, userId)
          : and(eq(aiProposals.userId, userId), eq(aiProposals.conversationId, conversationId)),
      )
      .orderBy(desc(aiProposals.createdAt))
      .limit(100)
      .pipe(Effect.orDie)
    return rows.map((row) => Schema.decodeUnknownSync(AiProposal)(row))
  })
