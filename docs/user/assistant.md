# AI assistant

AI is **off** until an admin enables it, then turns on features one by one. A user can use AI only
if their workspace role is in the allowed roles (default: owner, admin, member; guests are excluded)
and a default provider is configured.

When AI is enabled, text needed for each request is sent to the provider the admin configured. See
[security model](/security#ai-data-handling).

## Assistant panel

The panel holds conversations (50 per page). The assistant answers in your language and can look up
information through read tools:

- search the workspace
- list your tasks, get a task, get a document
- list calendar events
- say who you are

Read tools return only what you could see yourself.

Each reply can use up to six model steps.

## Changes need your approval

Write tools never change data directly. They create a **proposal**:

- create or update a task, move a task, assign a task
- create a document, propose a document edit
- create a calendar event
- link entities, draft a message

Proposals appear as pending. Approve to run the change with your permissions, or reject it.
Proposals expire after 24 hours. You receive an inbox notification when a proposal is created.

Two tools can be approved automatically if you add them to **Auto-approve tools** in your
preferences: `link_entities` and `draft_message`. All other tools always need your approval.

## One-shot actions

- **Docs**: rewrite, summarize, translate, fix grammar. Output is text you can copy.
- **Chat**: summarize a channel (last 40 messages); draft a reply, which is placed in the composer
  without sending.
- **Board**: backlog triage (suggested moves as proposals), summarize a column, break down a task
  into subtasks.
- **Calendar**: suggest an agenda, summarize the week.

## Digest

Each project may opt in to a weekly digest. It is posted to the project's public channel on Monday
at 09:00 UTC, covering the last seven days, and is marked as generated.

## Usage budget

Admins can set a monthly token budget. When it is used up, AI calls are refused until the next
month.
