import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { CommandError } from "../errors.ts"
import { Authentication } from "../http.ts"
import { CalendarId, EventId } from "../ids.ts"
import {
  CalendarSummary,
  CreateCalendarInput,
  DeleteEventInput,
  EventInput,
  EventOccurrence,
  EventsQuery,
  IcalFeed,
  ImportInput,
  ImportResult,
  LinkEventInput,
  RsvpInput,
  UnlinkEventInput,
  UpdateCalendarInput,
  UpdateEventInput,
} from "./schema.ts"

const calendarParams = { params: { calendarId: CalendarId } }
const eventParams = { params: { eventId: EventId } }

/** Calendars, events, RSVP, ICS import and the personal ICS feed. */
export const CalendarApi = HttpApiGroup.make("calendar")
  .add(
    HttpApiEndpoint.get("calendars", "/api/calendars", {
      success: Schema.Array(CalendarSummary),
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("createCalendar", "/api/calendars", {
      payload: CreateCalendarInput,
      success: CalendarSummary,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateCalendar", "/api/calendars/:calendarId", {
      ...calendarParams,
      payload: UpdateCalendarInput,
      success: CalendarSummary,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("deleteCalendar", "/api/calendars/:calendarId/delete", {
      ...calendarParams,
      success: Schema.Void,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("events", "/api/events", {
      query: EventsQuery,
      success: Schema.Array(EventOccurrence),
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("createEvent", "/api/calendars/:calendarId/events", {
      ...calendarParams,
      payload: EventInput,
      success: EventOccurrence,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateEvent", "/api/events/:eventId", {
      ...eventParams,
      payload: UpdateEventInput,
      success: Schema.Void,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("deleteEvent", "/api/events/:eventId/delete", {
      ...eventParams,
      payload: DeleteEventInput,
      success: Schema.Void,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("rsvp", "/api/events/:eventId/rsvp", {
      ...eventParams,
      payload: RsvpInput,
      success: Schema.Void,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("linkEvent", "/api/events/:eventId/links", {
      ...eventParams,
      payload: LinkEventInput,
      success: Schema.Void,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("unlinkEvent", "/api/events/:eventId/links/unlink", {
      ...eventParams,
      payload: UnlinkEventInput,
      success: Schema.Void,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("importIcs", "/api/calendars/:calendarId/import", {
      ...calendarParams,
      payload: ImportInput,
      success: ImportResult,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("regenerateIcalFeed", "/api/me/ical-feed", {
      success: IcalFeed,
      error: CommandError,
    }),
  )
  .middleware(Authentication)
