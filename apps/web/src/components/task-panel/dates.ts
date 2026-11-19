/** Day-only values are stored at UTC midnight; the input shows the UTC calendar day. */
export const toDayString = (date: Date): string => date.toISOString().slice(0, 10)

export const fromDayString = (day: string): Date => new Date(`${day}T00:00:00.000Z`)
