/** Formats a chat timestamp with the active UI locale: `short` is the clock time, `full` is the date and time. */
export function formatMessageTime(
  value: Date | string | number,
  locale: string,
  style: "short" | "full",
): string {
  const date = new Date(value)
  return style === "short"
    ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date)
    : new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short" }).format(date)
}
