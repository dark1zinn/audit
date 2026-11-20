# Projects and board

## Projects

A project has a **key** (2–6 uppercase letters, for example `OPS`), a name (up to 120 characters),
and a visibility: `workspace` (everyone in the workspace can see it) or `restricted` (only people
with a role on it). Projects are `active`, `archived`, or `deleted`.

Each new project starts with one board named **Board** with the columns Backlog, To do, In
progress and Done.

## Columns

Each column has a category: `backlog`, `todo`, `in_progress`, `done`, or `canceled`. Moving a task
into a `done` column sets its completion time; moving it out clears it.

A column may have a **WIP limit** (1–999). Going over it shows a warning. It never blocks a move.

## Tasks

- Key: `<PROJECT KEY>-<number>`, for example `OPS-42`. Numbers are per project.
- Title: 1–300 characters.
- Description, start and due dates, estimate (whole number 0–1000), priority (`none`, `low`,
  `medium`, `high`, `urgent`), labels, assignees.
- **Subtasks**: a parent must be on the same board. Cycles are rejected.
- **Relations**: `blocks`, `relates`, or `duplicates`. The panel shows direction, for example
  "Blocked by".
- **Comments**: threaded, can be resolved, reopened, edited and deleted.
- **Activity**: the change history of the task.
- **Watching**: you watch the tasks you create. Assignees are notified when assigned.

If someone else changed the task while you were editing, saving shows a conflict dialog that lets
you choose field by field which version to keep.

## Moving tasks

Drag a card to another column or position, or use the keyboard: focus a card, press the drag key,
then use the arrow keys. Screen readers announce each step.

## Filters, views and bulk actions

- Filter by text, assignee, label, priority, column type, due date range, or "mentions me".
- Save a filter as a **saved view** (name up to 80 characters) and delete it later.
- Group a list by none, column, assignee, priority or label. Sort by position, priority, due date,
  last update, or number.
- Select several tasks to move them, assign them, add a label, or delete them (after confirmation).

## URLs

| Page     | URL                   |
| -------- | --------------------- |
| Board    | `/p/<KEY>/board`      |
| List     | `/p/<key>/list`       |
| Task     | `/p/<KEY>/t/<number>` |
| My tasks | `/my-tasks`           |

## AI on the board

When the AI assistant is enabled and the board feature is on, the board offers **Backlog triage**
(suggests moves as proposals you approve), **Summarize column**, and the task panel offers **Break
down** (suggests subtasks). See [AI assistant](/user/assistant).
