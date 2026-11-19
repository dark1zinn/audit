/** Completion state follows the column category: entering `done` stamps the time, leaving clears it. */
export const completedAtFor = (category: string, existing: Date | null, now: Date): Date | null =>
  category === "done" ? (existing ?? now) : null
