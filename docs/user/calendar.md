# Calendar

## Calendars

You have a personal calendar. Each project can also have its own calendar. Create, rename, update
and delete calendars from the calendar list.

## Views

Month grid, week (default), day, and month agenda.

Select an empty time slot to create an event; the default duration is one hour.

## Events

- Title: 1–300 characters. Description and location are optional.
- **Attendees** receive invitations and reply with RSVP. Invitees do not need access to the calendar.
- **Reminders**: any number of offsets from 0 to 10080 minutes before the start. The UI offers 0, 5,
  15, 30, 60, 1440 (1 day) and 10080 (1 week) minutes; the default is 15 minutes. A reminder is sent
  as an inbox notification.
- **Recurrence**: daily, weekly, monthly, yearly, or a custom rule, ending never, on a date, or after
  a count. Editing one occurrence creates an exception for that occurrence only.
- **Meeting prep**: the event view collects linked tasks and documents.

## Import and export

- **Import** an `.ics` file from the calendar list.
- **Export**: the calendar can be exported as an `.ics` file. Recurring events are exported as one
  series with exceptions.

## Subscribing from another app

Each user has a private subscription URL of the form `/ical/<token>.ics`. The token is a credential:
anyone with the URL can read your calendar. Use **Regenerate** to issue a new URL; the old URL stops
working immediately.

## Notes

- Reminders are scheduled per occurrence and re-check the event's current start time before they are
  sent.
- If a recurring series would skip more than 50 occurrences in a row, reminders for later
  occurrences stop until the series is edited.
