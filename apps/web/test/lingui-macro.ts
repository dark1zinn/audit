/**
 * Runtime stand-in for `@lingui/react/macro` under `bun test`, where the compile-time macro does
 * not run. Messages render as their source text, which is the English catalog.
 */
type Values = ReadonlyArray<unknown>

export const t = (strings: TemplateStringsArray, ...values: Values): string =>
  strings.reduce((text, part, index) => text + part + String(values[index] ?? ""), "")

export const useLingui = () => ({ t, i18n: { locale: "en" } })

export const Trans = ({ children }: { readonly children?: unknown }) => children

export const Plural = ({
  value,
  one,
  other,
}: {
  readonly value: number
  readonly one: unknown
  readonly other: unknown
}) => (value === 1 ? one : other)
