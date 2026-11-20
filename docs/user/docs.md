# Docs

Docs are collaborative documents. Several people can edit at once; changes sync live over the
collaboration connection at `/collab`.

## Roles

| Role      | Can                                    |
| --------- | -------------------------------------- |
| viewer    | Read                                   |
| commenter | Read and comment                       |
| editor    | Read and edit                          |
| manager   | Read, edit, change settings and access |

Viewers and commenters see a read-only editor.

## Creating a document

Start from a blank document, a template (**meeting-notes**, **rfc**, **decision-record**,
**runbook**, **project-brief**), or a Markdown file import. Use the slash menu inside the editor to
insert blocks.

## Organizing

The document tree shows nested documents. Reorder with move up and move down, nest or un-nest, or
drag and drop. The backlinks panel lists documents and tasks that link to the current document.

## Comments

Select text and add a comment. Comments stay attached to that text as it changes. Replies are
threaded. You can resolve, reopen, edit or delete comments.

## Versions

Versions are numbered per document, with three kinds:

- **auto**: written when the AI applies an edit, when an accepted upkeep suggestion is applied, and
  when stored updates are compacted.
- **named**: created explicitly with a label (1–120 characters).
- **restore**: written when you restore an older version.

Saving content alone does not create a version. Open the versions panel to compare a version with
the current text (line diff) and to restore it.

## Freshness review

A document can have a review interval of 1–3650 days in its settings. When the interval passes
since the last verification, the document is marked due and its owner receives a
"document review due" notification (at most once per interval). Select **Mark verified** to reset
the timer.

## Export

Export a document as Markdown or HTML from its menu.

## AI

With AI enabled for the workspace and the editor feature on, the document menu offers rewrite,
summarize, translate (English, Portuguese (Brazil), Spanish) and fix grammar. Results appear in a
dialog; nothing changes until you copy or apply them.

When the document upkeep feature is on, linked tasks, messages and events that change can produce
suggested text fixes as AI-tagged comments. Accepting one applies it as you and records an auto
version. Dismissing one removes the suggestion.
