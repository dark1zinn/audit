import { useLingui } from "@lingui/react/macro"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@audit/ui/components/ui/select.tsx"
import { ToggleGroup, ToggleGroupItem } from "@audit/ui/components/ui/toggle-group.tsx"
import {
  WEEKDAYS,
  type RecurrenceEnd,
  type RecurrenceFreq,
  type RecurrenceState,
  type Weekday,
} from "../../lib/calendar.ts"

/** Weekday labels from a fixed UTC week (2024-01-01 is a Monday), in the UI locale. */
const weekdayName = (locale: string, index: number, style: "short" | "long") =>
  new Intl.DateTimeFormat(locale, { weekday: style, timeZone: "UTC" }).format(
    new Date(Date.UTC(2024, 0, 1 + index)),
  )

/** Repeat rule builder. Writes a `RecurrenceState`; the caller turns it into an RRULE on save. */
export function RecurrenceFields({
  id,
  value,
  locale,
  onChange,
}: {
  readonly id: string
  readonly value: RecurrenceState
  readonly locale: string
  readonly onChange: (next: RecurrenceState) => void
}) {
  const { t } = useLingui()

  const freqLabel = (freq: RecurrenceFreq) => {
    switch (freq) {
      case "none":
        return t`Does not repeat`
      case "daily":
        return t`Daily`
      case "weekly":
        return t`Weekly`
      case "monthly":
        return t`Monthly`
      case "yearly":
        return t`Yearly`
      case "custom":
        return t`Custom rule`
    }
  }

  const endLabel = (end: RecurrenceEnd) => {
    switch (end) {
      case "never":
        return t`Never ends`
      case "until":
        return t`Ends on date`
      case "count":
        return t`Ends after occurrences`
    }
  }

  const toggleDay = (values: ReadonlyArray<string>) => {
    const weekdays = WEEKDAYS.filter((day) => values.includes(day))
    onChange({ ...value, weekdays })
  }

  return (
    <div className="grid gap-3">
      <div className="space-y-2">
        <Label htmlFor={`${id}-freq`}>
          <span>{t`Repeat`}</span>
        </Label>
        <Select
          value={value.freq}
          onValueChange={(next) => onChange({ ...value, freq: next as RecurrenceFreq })}
        >
          <SelectTrigger id={`${id}-freq`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["none", "daily", "weekly", "monthly", "yearly", "custom"] as const).map((freq) => (
              <SelectItem key={freq} value={freq}>
                {freqLabel(freq)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {value.freq === "weekly" && (
        <div className="space-y-2">
          <Label>
            <span>{t`On`}</span>
          </Label>
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            value={[...value.weekdays]}
            onValueChange={toggleDay}
            aria-label={t`Days of the week`}
          >
            {WEEKDAYS.map((day: Weekday, index) => (
              <ToggleGroupItem
                key={day}
                value={day}
                aria-label={weekdayName(locale, index, "long")}
              >
                {weekdayName(locale, index, "short")}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}

      {value.freq !== "none" && value.freq !== "custom" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${id}-end`}>
              <span>{t`Ends`}</span>
            </Label>
            <Select
              value={value.end}
              onValueChange={(next) => onChange({ ...value, end: next as RecurrenceEnd })}
            >
              <SelectTrigger id={`${id}-end`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["never", "until", "count"] as const).map((end) => (
                  <SelectItem key={end} value={end}>
                    {endLabel(end)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {value.end === "until" && (
            <div className="space-y-2">
              <Label htmlFor={`${id}-until`}>
                <span>{t`End date`}</span>
              </Label>
              <Input
                id={`${id}-until`}
                type="date"
                required
                value={value.until}
                onChange={(event) => onChange({ ...value, until: event.currentTarget.value })}
              />
            </div>
          )}
          {value.end === "count" && (
            <div className="space-y-2">
              <Label htmlFor={`${id}-count`}>
                <span>{t`Number of occurrences`}</span>
              </Label>
              <Input
                id={`${id}-count`}
                type="number"
                min={1}
                max={1000}
                required
                value={value.count}
                onChange={(event) =>
                  onChange({ ...value, count: Number(event.currentTarget.value) })
                }
              />
            </div>
          )}
        </div>
      )}

      {value.freq === "custom" && (
        <div className="space-y-2">
          <Label htmlFor={`${id}-custom`}>
            <span>{t`Recurrence rule (RFC 5545)`}</span>
          </Label>
          <Input
            id={`${id}-custom`}
            required
            value={value.custom}
            placeholder="FREQ=WEEKLY;BYDAY=MO,WE"
            onChange={(event) => onChange({ ...value, custom: event.currentTarget.value })}
          />
        </div>
      )}
    </div>
  )
}
