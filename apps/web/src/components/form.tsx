import { Input } from "@audit/ui/components/ui/input.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import type { ComponentProps, ReactNode } from "react"

/**
 * Width scale for inputs and select triggers. Inputs stay fluid by default
 * (`full`); pick the smallest key that fits the content:
 * - `2xs` short keys and codes
 * - `xs` numbers, days and dates
 * - `sm` short names and selects with short values
 * - `md` names, emails and passwords
 * - `lg` notes and longer single-line text
 * - `full` search, editors and compose, only where content is open-ended
 */
export const fieldWidth = {
  "2xs": "w-24",
  xs: "w-32",
  sm: "w-full sm:w-64",
  md: "w-full sm:max-w-sm",
  lg: "w-full sm:max-w-md",
  full: "w-full",
} as const

export type FieldWidth = keyof typeof fieldWidth

/** Label + input pair. The input's `name` doubles as its id. */
export function TextField({
  name,
  label,
  hint,
  width = "full",
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, "name"> & {
  readonly name: string
  readonly label: string
  readonly hint?: ReactNode
  readonly width?: FieldWidth
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} className={className === undefined ? fieldWidth[width] : `${fieldWidth[width]} ${className}`} {...props} />
      {hint !== undefined && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** Reads a named string field from a submitted form. */
export const formValue = (form: HTMLFormElement, name: string): string => {
  const value = new FormData(form).get(name)
  return typeof value === "string" ? value : ""
}
