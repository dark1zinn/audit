import { getSchema } from "@tiptap/core"
import { extensions } from "./extensions.ts"

/** The headless ProseMirror schema of the editor. Built without a DOM. */
export const schema = getSchema(extensions)
