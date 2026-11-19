import { Schema } from "effect"
import { CalendarId, EventId, ProjectId, TeamId, UserId } from "../ids.ts"
import { RichDoc } from "../tasks/schema.ts"

export const ResponseStatus = Schema.Literals(["needs_action", "accepted", "declined", "tentative"])
export type ResponseStatus = typeof ResponseStatus.Type

export const PrincipalType = Schema.Literals(["user", "team"])

export const AttendeeInput = Schema.Struct({
  principalType: PrincipalType,
  principalId: Schema.String,
})
export type AttendeeInput = typeof AttendeeInput.Type

export const Attendee = Schema.Struct({
  principalType: PrincipalType,
  principalId: Schema.String,
  response: ResponseStatus,
})
export type Attendee = typeof Attendee.Type

export const CalendarSummary = Schema.Struct({
  id: CalendarId,
  projectId: Schema.NullOr(ProjectId),
  ownerUserId: Schema.NullOr(UserId),
  teamId: Schema.NullOr(TeamId),
  name: Schema.String,
  color: Schema.String,
  version: Schema.Number,
})
export type CalendarSummary = typeof CalendarSummary.Type

export const CreateCalendarInput = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  color: Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/)),
  /** A team calendar; mutually exclusive with `projectId`. */
  teamId: Schema.optionalKey(Schema.NullOr(TeamId)),
  /** A project calendar, a child of the project; mutually exclusive with `teamId`. */
  projectId: Schema.optionalKey(ProjectId),
})
export type CreateCalendarInput = typeof CreateCalendarInput.Type

export const UpdateCalendarInput = Schema.Struct({
  name: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120))),
  color: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/))),
  version: Schema.Number,
})
export type UpdateCalendarInput = typeof UpdateCalendarInput.Type

export const EventScope = Schema.Literals(["this", "following", "all"])
export type EventScope = typeof EventScope.Type

export const Reminder = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10080 }))

export const EventInput = Schema.Struct({
  calendarId: CalendarId,
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(300)),
  startsAt: Schema.Date,
  endsAt: Schema.Date,
  allDay: Schema.Boolean,
  timezone: Schema.String,
  rrule: Schema.NullOr(Schema.String),
  location: Schema.String,
  description: Schema.NullOr(RichDoc),
  attendees: Schema.Array(AttendeeInput),
  reminders: Schema.Array(Reminder),
})
export type EventInput = typeof EventInput.Type

export const UpdateEventInput = Schema.Struct({
  scope: EventScope,
  /** The occurrence being edited, required for recurring events unless `scope` is `all`. */
  occurrenceStart: Schema.optionalKey(Schema.Date),
  calendarId: Schema.optionalKey(CalendarId),
  title: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(300))),
  startsAt: Schema.optionalKey(Schema.Date),
  endsAt: Schema.optionalKey(Schema.Date),
  allDay: Schema.optionalKey(Schema.Boolean),
  timezone: Schema.optionalKey(Schema.String),
  rrule: Schema.optionalKey(Schema.NullOr(Schema.String)),
  location: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.NullOr(RichDoc)),
  attendees: Schema.optionalKey(Schema.Array(AttendeeInput)),
  reminders: Schema.optionalKey(Schema.Array(Reminder)),
  version: Schema.Number,
})
export type UpdateEventInput = typeof UpdateEventInput.Type

export const DeleteEventInput = Schema.Struct({
  scope: EventScope,
  occurrenceStart: Schema.optionalKey(Schema.Date),
  version: Schema.Number,
})
export type DeleteEventInput = typeof DeleteEventInput.Type

export const RsvpInput = Schema.Struct({
  response: ResponseStatus,
})
export type RsvpInput = typeof RsvpInput.Type

export const EventLinkKind = Schema.Literals(["task", "doc", "thread"])
export type EventLinkKind = typeof EventLinkKind.Type

export const EventLink = Schema.Struct({
  kind: EventLinkKind,
  id: Schema.String,
  title: Schema.NullOr(Schema.String),
  restricted: Schema.Boolean,
})
export type EventLink = typeof EventLink.Type

export const LinkEventInput = Schema.Struct({
  kind: EventLinkKind,
  targetId: Schema.String,
})
export type LinkEventInput = typeof LinkEventInput.Type

export const UnlinkEventInput = LinkEventInput
export type UnlinkEventInput = typeof UnlinkEventInput.Type

/** One expanded occurrence (or the single event) in a requested range. */
export const EventOccurrence = Schema.Struct({
  eventId: EventId,
  calendarId: CalendarId,
  title: Schema.String,
  /** Start of this occurrence; the original (series) start for recurring occurrences. */
  occurrenceStart: Schema.Date,
  startsAt: Schema.Date,
  endsAt: Schema.Date,
  allDay: Schema.Boolean,
  timezone: Schema.String,
  rrule: Schema.NullOr(Schema.String),
  isOverride: Schema.Boolean,
  location: Schema.String,
  description: Schema.NullOr(RichDoc),
  attendees: Schema.Array(Attendee),
  reminders: Schema.Array(Schema.Number),
  version: Schema.Number,
  createdBy: Schema.NullOr(UserId),
  /** Items this event is scheduled for; titles are null when the viewer may not read them. */
  links: Schema.Array(EventLink),
})
export type EventOccurrence = typeof EventOccurrence.Type

export const EventsQuery = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
})
export type EventsQuery = typeof EventsQuery.Type

export const ImportInput = Schema.Struct({
  calendarId: CalendarId,
  ics: Schema.String.check(Schema.isMaxLength(2_000_000)),
})
export type ImportInput = typeof ImportInput.Type

export const ImportResult = Schema.Struct({ imported: Schema.Number })
export type ImportResult = typeof ImportResult.Type

export const IcalFeed = Schema.Struct({ url: Schema.String })
export type IcalFeed = typeof IcalFeed.Type
