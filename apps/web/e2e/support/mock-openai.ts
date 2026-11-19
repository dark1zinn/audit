/**
 * A tiny OpenAI-compatible server for the e2e suite. The assistant's first chat turn calls
 * `create_task` with arguments taken from the script; the turn after a tool result answers with
 * text. `POST /__script` sets the script (the spec calls it before chatting). Speaks just enough of
 * `POST /v1/chat/completions` (streamed and not), `POST /v1/embeddings` and `GET /v1/models`.
 */

interface Script {
  readonly columnId: string
  readonly title: string
  readonly description?: string
  readonly reply: string
}

interface ChatMessage {
  readonly role: string
  readonly content?: unknown
}

interface ToolDefinition {
  readonly function: { readonly name: string; readonly parameters?: JsonSchema }
}

interface JsonSchema {
  readonly type?: string
  readonly properties?: Record<string, JsonSchema>
  readonly required?: ReadonlyArray<string>
}

interface ChatRequest {
  readonly model: string
  readonly stream?: boolean
  readonly messages: ReadonlyArray<ChatMessage>
  readonly tools?: ReadonlyArray<ToolDefinition>
}

interface EmbeddingRequest {
  readonly model: string
  readonly input: string | ReadonlyArray<string>
  readonly dimensions?: number
}

const MODEL = "mock-chat"
const DEFAULT_DIMENSIONS = 8
const TOOL_NAME = "create_task"

const usage = { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }

const defaultScript: Script = { columnId: "", title: "Untitled", reply: "Done." }

/** Fills the create_task arguments from its tool schema: script values where names match. */
const toolArguments = (schema: JsonSchema | undefined, script: Script): Record<string, unknown> => {
  const args: Record<string, unknown> = {}
  for (const [name, property] of Object.entries(schema?.properties ?? {})) {
    if (name === "columnId") args[name] = script.columnId
    else if (name === "title") args[name] = script.title
    else if (name === "description") {
      if (script.description !== undefined) args[name] = script.description
    } else if (property.type === "string") args[name] = ""
    else if (property.type === "number" || property.type === "integer") args[name] = 0
    else if (property.type === "array") args[name] = []
    else args[name] = null
  }
  return args
}

const completionId = () => `chatcmpl-mock-${crypto.randomUUID()}`

/** Turns one request into the reply: a create_task call, or final text after a tool result. */
const planReply = (request: ChatRequest, script: Script) => {
  const last = request.messages.at(-1)
  if (last?.role === "tool") return { text: script.reply, toolCall: null }
  const tool = request.tools?.find((candidate) => candidate.function.name === TOOL_NAME)
  if (tool === undefined) return { text: script.reply, toolCall: null }
  return {
    text: null,
    toolCall: {
      id: `call_${crypto.randomUUID().slice(0, 8)}`,
      name: TOOL_NAME,
      arguments: JSON.stringify(toolArguments(tool.function.parameters, script)),
    },
  }
}

const sse = (chunks: ReadonlyArray<unknown>) => {
  const body =
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n"
  return new Response(body, { headers: { "content-type": "text/event-stream" } })
}

const streamChat = (request: ChatRequest, script: Script): Response => {
  const id = completionId()
  const created = Math.floor(Date.now() / 1000)
  const base = { id, object: "chat.completion.chunk", created, model: request.model }
  const chunks: Array<unknown> = []
  const plan = planReply(request, script)
  if (plan.toolCall !== null) {
    chunks.push({
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: plan.toolCall.id,
                type: "function",
                function: { name: plan.toolCall.name, arguments: "" },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    })
    chunks.push({
      ...base,
      choices: [
        {
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { arguments: plan.toolCall.arguments } }] },
          finish_reason: null,
        },
      ],
    })
    chunks.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })
  } else {
    chunks.push({
      ...base,
      choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
    })
    for (const piece of plan.text?.match(/\S+\s*/g) ?? []) {
      chunks.push({
        ...base,
        choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
      })
    }
    chunks.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })
  }
  chunks.push({ ...base, choices: [], usage })
  return sse(chunks)
}

const completeChat = (request: ChatRequest, script: Script): Response => {
  const plan = planReply(request, script)
  const message =
    plan.toolCall === null
      ? { role: "assistant", content: plan.text }
      : {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: plan.toolCall.id,
              type: "function",
              function: { name: plan.toolCall.name, arguments: plan.toolCall.arguments },
            },
          ],
        }
  return Response.json({
    id: completionId(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: request.model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: plan.toolCall === null ? "stop" : "tool_calls",
      },
    ],
    usage,
  })
}

/** A deterministic unit vector per input, so the same text always embeds the same way. */
const embed = (text: string, dimensions: number): Array<number> => {
  const vector = Array.from({ length: dimensions }, (_, index) => {
    let hash = index + 1
    for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) % 1_000_003
    return (hash % 1000) / 1000
  })
  const norm = Math.hypot(...vector) || 1
  return vector.map((value) => value / norm)
}

const embeddings = (request: EmbeddingRequest): Response => {
  const inputs = typeof request.input === "string" ? [request.input] : request.input
  const dimensions = request.dimensions ?? DEFAULT_DIMENSIONS
  return Response.json({
    object: "list",
    model: request.model,
    data: inputs.map((text, index) => ({
      object: "embedding",
      index,
      embedding: embed(text, dimensions),
    })),
    usage: { prompt_tokens: inputs.length, total_tokens: inputs.length },
  })
}

/** Starts the mock on a free loopback port. `stop()` shuts it down. */
export const startMockOpenAi = () => {
  let script: Script = defaultScript
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url)
      if (req.method === "POST" && pathname === "/__script") {
        script = { ...defaultScript, ...((await req.json()) as Partial<Script>) }
        return Response.json(script)
      }
      if (req.method === "POST" && pathname === "/v1/chat/completions") {
        const request = (await req.json()) as ChatRequest
        return request.stream === true ? streamChat(request, script) : completeChat(request, script)
      }
      if (req.method === "POST" && pathname === "/v1/embeddings") {
        return embeddings((await req.json()) as EmbeddingRequest)
      }
      if (req.method === "GET" && pathname === "/v1/models") {
        return Response.json({
          object: "list",
          data: [{ id: MODEL, object: "model", created: 0, owned_by: "mock" }],
        })
      }
      return Response.json(
        { error: { message: `no route ${req.method} ${pathname}` } },
        { status: 404 },
      )
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  }
}
