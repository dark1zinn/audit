import { Input } from "@audit/ui/components/ui/input.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import type { ComponentProps, ReactNode } from "react"

/** Label + input pair. The input's `name` doubles as its id. */
export function TextField({
  name,
  label,
  hint,
  ...props
}: Omit<ComponentProps<typeof Input>, "name"> & {
  readonly name: string
  readonly label: string
  readonly hint?: ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} {...props} />
      {hint !== undefined && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** Reads a named string field from a submitted form. */
export const formValue = (form: HTMLFormElement, name: string): string => {
  const value = new FormData(form).get(name)
  return typeof value === "string" ? value : ""
}
