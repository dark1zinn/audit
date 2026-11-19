/**
 * Pure chunking and rank fusion. No I/O here: the sync job loads sources and passes them in.
 * Sizes are character budgets; ~4 characters per token, so 2000 characters is about 500 tokens.
 */

export interface Chunk {
  readonly chunk: number
  readonly text: string
}

export const CHUNK_CHARS = 2000

export const splitLong = (text: string, max = CHUNK_CHARS): ReadonlyArray<string> => {
  const lines: string[] = []
  for (const line of text.split("\n")) {
    for (let at = 0; at < line.length; at += max) lines.push(line.slice(at, at + max))
    if (line === "") lines.push("")
  }
  const out: string[] = []
  let current = ""
  for (const line of lines) {
    if (current !== "" && current.length + 1 + line.length > max) {
      out.push(current)
      current = line
    } else {
      current = current === "" ? line : `${current}\n${line}`
    }
  }
  if (current.trim() !== "") out.push(current)
  return out
}

/** Numbers pieces 0..n-1 and drops empties; the title is prefixed to every piece for recall. */
export const numberChunks = (title: string, pieces: ReadonlyArray<string>): Chunk[] =>
  pieces
    .map((piece) => piece.trim())
    .filter((piece) => piece !== "")
    .map((piece, index) => ({ chunk: index, text: title === "" ? piece : `${title}\n${piece}` }))

/** Groups already-rendered blocks into sections that begin at headings. */
export interface Section {
  readonly heading: string
  readonly body: string
}

/** Sections are cut at headings; a section longer than the budget is split on line boundaries. */
export const chunkSections = (title: string, sections: ReadonlyArray<Section>): Chunk[] => {
  const pieces: string[] = []
  for (const section of sections) {
    const text = [section.heading, section.body].filter((s) => s !== "").join("\n")
    pieces.push(...splitLong(text))
  }
  return numberChunks(title, pieces)
}

/** Chunks a task: title, description, then the most recent comments in one budgeted stream. */
export const chunkTask = (
  title: string,
  description: string,
  recentComments: ReadonlyArray<string>,
): Chunk[] => {
  const body = [description, ...recentComments.map((c) => `Comment: ${c}`)]
    .filter((s) => s.trim() !== "")
    .join("\n")
  const pieces = splitLong(body)
  // A task with no description or comments still has its title to index.
  return pieces.length === 0 ? numberChunks("", [title]) : numberChunks(title, pieces)
}

/** Chunks a thread: the root message followed by replies, in order. */
export const chunkThread = (title: string, root: string, replies: ReadonlyArray<string>): Chunk[] =>
  numberChunks(title, splitLong([root, ...replies].join("\n")))

/** Chunks an event: title, when/where and description. */
export const chunkEvent = (title: string, details: ReadonlyArray<string>): Chunk[] =>
  numberChunks(title, splitLong(details.filter((s) => s.trim() !== "").join("\n")))

/** Content hash used to skip unchanged chunks. Hex SHA-256 of the chunk text. */
export const contentHash = (text: string): string =>
  new Bun.CryptoHasher("sha256").update(text).digest("hex")

/**
 * Reciprocal rank fusion over ranked lists (rank starts at 1). Ties are broken by key so the
 * order is deterministic. `k` is the standard damping constant.
 */
export const rrf = (
  lists: ReadonlyArray<ReadonlyArray<string>>,
  k = 60,
): ReadonlyArray<{ readonly key: string; readonly score: number }> => {
  const scores = new Map<string, number>()
  for (const list of lists) {
    list.forEach((key, index) => {
      scores.set(key, (scores.get(key) ?? 0) + 1 / (k + index + 1))
    })
  }
  return [...scores.entries()]
    .map(([key, score]) => ({ key, score }))
    .sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}
