import type { JobDefinition } from "@audit/platform/jobs"

/** Every background job; queues are created at start. Features add their definitions here. */
export const jobDefinitions: ReadonlyArray<JobDefinition> = []
