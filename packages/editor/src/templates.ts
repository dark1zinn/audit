/**
 * Starter documents for the templates picker. `titleKey` is the i18n message id; `title` is the
 * English fallback used by the server when it creates a doc from a template.
 */
import type { JsonNode } from "./json.ts"

export interface Template {
  readonly id: "meeting-notes" | "rfc" | "decision-record" | "runbook" | "project-brief"
  readonly titleKey: string
  readonly title: string
  readonly content: JsonNode
}

const heading = (level: number, text: string): JsonNode => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
})

const paragraph = (text = ""): JsonNode =>
  text.length === 0
    ? { type: "paragraph" }
    : { type: "paragraph", content: [{ type: "text", text }] }

const bullets = (items: string[]): JsonNode => ({
  type: "bulletList",
  content: items.map((item) => ({ type: "listItem", content: [paragraph(item)] })),
})

const doc = (...content: JsonNode[]): JsonNode => ({ type: "doc", content })

export const TEMPLATES: ReadonlyArray<Template> = [
  {
    id: "meeting-notes",
    titleKey: "template.meetingNotes",
    title: "Meeting notes",
    content: doc(
      heading(1, "Meeting notes"),
      paragraph("Date:"),
      paragraph("Attendees:"),
      heading(2, "Agenda"),
      bullets([""]),
      heading(2, "Discussion"),
      paragraph(),
      heading(2, "Action items"),
      {
        type: "taskList",
        content: [{ type: "taskItem", attrs: { checked: false }, content: [paragraph()] }],
      },
    ),
  },
  {
    id: "rfc",
    titleKey: "template.rfc",
    title: "RFC",
    content: doc(
      heading(1, "RFC: title"),
      paragraph("Status: draft"),
      heading(2, "Summary"),
      paragraph(),
      heading(2, "Motivation"),
      paragraph(),
      heading(2, "Design"),
      paragraph(),
      heading(2, "Alternatives"),
      paragraph(),
      heading(2, "Open questions"),
      bullets([""]),
    ),
  },
  {
    id: "decision-record",
    titleKey: "template.decisionRecord",
    title: "Decision record",
    content: doc(
      heading(1, "Decision: title"),
      paragraph("Status: proposed"),
      heading(2, "Context"),
      paragraph(),
      heading(2, "Decision"),
      paragraph(),
      heading(2, "Consequences"),
      paragraph(),
    ),
  },
  {
    id: "runbook",
    titleKey: "template.runbook",
    title: "Runbook",
    content: doc(
      heading(1, "Runbook: service"),
      heading(2, "Symptoms"),
      bullets([""]),
      heading(2, "Steps"),
      paragraph(),
      heading(2, "Rollback"),
      paragraph(),
      heading(2, "Owners"),
      paragraph(),
    ),
  },
  {
    id: "project-brief",
    titleKey: "template.projectBrief",
    title: "Project brief",
    content: doc(
      heading(1, "Project brief"),
      heading(2, "Goal"),
      paragraph(),
      heading(2, "Scope"),
      bullets([""]),
      heading(2, "Milestones"),
      paragraph(),
      heading(2, "Risks"),
      bullets([""]),
    ),
  },
]

/** The template with this id, or undefined. */
export const findTemplate = (id: string): Template | undefined =>
  TEMPLATES.find((template) => template.id === id)
