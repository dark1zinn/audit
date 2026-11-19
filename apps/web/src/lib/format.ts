const units = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const

/** Localised byte count, e.g. `12.5 MB` in English, using the browser's unit formatting. */
export const formatBytes = (locale: string, bytes: number): string => {
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: units[index],
    maximumFractionDigits: 1,
  }).format(value)
}
