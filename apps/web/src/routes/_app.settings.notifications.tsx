import { t as tMacro } from "@lingui/core/macro"
import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { FormEvent } from "react"
import { useState } from "react"
import type { NotificationChannel, NotificationSettings } from "@audit/domain/notifications/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@audit/ui/components/ui/card.tsx"
import { Checkbox } from "@audit/ui/components/ui/checkbox.tsx"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@audit/ui/components/ui/table.tsx"
import { ErrorMessage, LoadingRows, PageHeader } from "../components/feedback.tsx"
import { formValue, TextField } from "../components/form.tsx"
import { NOTIFICATION_KINDS, useKindText } from "../components/inbox/kind.tsx"
import { callApi } from "../lib/api.ts"
import { keys, notificationSettingsQuery } from "../lib/queries.ts"
import { urlBase64ToBytes } from "../lib/push.ts"

export const Route = createFileRoute("/_app/settings/notifications")({
  staticData: { crumb: () => ({ label: tMacro`Notifications` }) },
  component: NotificationSettingsPage,
})

function NotificationSettingsPage() {
  const { t } = useLingui()
  const settings = useQuery(notificationSettingsQuery)

  return (
    <>
      <PageHeader
        title={t`Notifications`}
        description={t`Choose what you hear about and where it reaches you.`}
      />
      {settings.isError && <ErrorMessage error={settings.error} />}
      {settings.data === undefined && !settings.isError && <LoadingRows />}
      {settings.data !== undefined && (
        <div className="space-y-6">
          <DeliveryCard settings={settings.data} />
          <QuietHoursCard settings={settings.data} />
          <PushCard settings={settings.data} />
          <ModerationCard />
        </div>
      )}
    </>
  )
}

/** Explicit prefs win; pairs without a row are enabled (server default). */
function prefEnabled(settings: NotificationSettings, kind: string, channel: NotificationChannel) {
  return (
    settings.prefs.find((pref) => pref.kind === kind && pref.channel === channel)?.enabled ?? true
  )
}

function DeliveryCard({ settings }: { readonly settings: NotificationSettings }) {
  const { t } = useLingui()
  const kindText = useKindText()
  const queryClient = useQueryClient()
  const [error, setError] = useState<unknown>(null)

  const update = useMutation({
    mutationFn: (input: {
      readonly kind: string
      readonly channel: NotificationChannel
      readonly enabled: boolean
    }) => callApi((api) => api.notifications.updatePref({ payload: input })),
    onSuccess: () => {
      setError(null)
      return queryClient.invalidateQueries({ queryKey: keys.notificationSettings })
    },
    onError: setError,
  })

  const channels: ReadonlyArray<{ readonly id: NotificationChannel; readonly label: string }> = [
    { id: "in_app", label: t`In app` },
    { id: "push", label: t`Push` },
    { id: "email", label: t`Email` },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Delivery</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>In-app notifications are always on.</Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!settings.emailEnabled && (
          <p className="text-sm text-muted-foreground" id="email-disabled">
            <Trans>
              Email notifications are unavailable because this server has no mail delivery
              configured.
            </Trans>
          </p>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Trans>Notification</Trans>
              </TableHead>
              {channels.map((channel) => (
                <TableHead key={channel.id} className="text-center">
                  {channel.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {NOTIFICATION_KINDS.map((kind) => (
              <TableRow key={kind}>
                <TableCell>{kindText(kind)}</TableCell>
                {channels.map((channel) => {
                  const label = t`${kindText(kind)}: ${channel.label}`
                  const disabled =
                    channel.id === "in_app" ||
                    (channel.id === "email" && !settings.emailEnabled) ||
                    update.isPending
                  return (
                    <TableCell key={channel.id} className="text-center">
                      <Checkbox
                        className="mx-auto"
                        aria-label={label}
                        aria-describedby={channel.id === "email" ? "email-disabled" : undefined}
                        checked={channel.id === "in_app" || prefEnabled(settings, kind, channel.id)}
                        disabled={disabled}
                        onCheckedChange={(enabled) =>
                          update.mutate({ kind, channel: channel.id, enabled: enabled === true })
                        }
                      />
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {error !== null && <ErrorMessage error={error} />}
      </CardContent>
    </Card>
  )
}

function QuietHoursCard({ settings }: { readonly settings: NotificationSettings }) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const [problem, setProblem] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)

  const save = useMutation({
    mutationFn: (input: { readonly quietStart: string | null; readonly quietEnd: string | null }) =>
      callApi((api) => api.notifications.updateQuietHours({ payload: input })),
    onSuccess: () => {
      setError(null)
      return queryClient.invalidateQueries({ queryKey: keys.notificationSettings })
    },
    onError: setError,
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const start = formValue(event.currentTarget, "quietStart")
    const end = formValue(event.currentTarget, "quietEnd")
    if ((start === "") !== (end === "")) {
      setProblem(t`Set both a start and an end time, or clear both.`)
      return
    }
    setProblem(null)
    save.mutate({ quietStart: start === "" ? null : start, quietEnd: end === "" ? null : end })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Quiet hours</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Push and email are held during these hours. Times use your time zone:{" "}
            {settings.timezone}.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-3" onSubmit={onSubmit}>
          <TextField
            name="quietStart"
            width="xs"
            type="time"
            label={t`Start`}
            defaultValue={settings.quietStart ?? ""}
          />
          <TextField
            name="quietEnd"
            width="xs"
            type="time"
            label={t`End`}
            defaultValue={settings.quietEnd ?? ""}
          />
          <div className="flex items-end">
            <Button type="submit" disabled={save.isPending}>
              <Trans>Save quiet hours</Trans>
            </Button>
          </div>
        </form>
        {problem !== null && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {problem}
          </p>
        )}
        {error !== null && <ErrorMessage error={error} />}
      </CardContent>
    </Card>
  )
}

type PushState = "unsupported" | "denied" | "unconfigured" | "ready"

function pushStateOf(settings: NotificationSettings): PushState {
  const supported =
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
  if (!supported) return "unsupported"
  if (Notification.permission === "denied") return "denied"
  if (settings.pushPublicKey === null) return "unconfigured"
  return "ready"
}

function PushCard({ settings }: { readonly settings: NotificationSettings }) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const state = pushStateOf(settings)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.notificationSettings })

  const subscribe = useMutation({
    mutationFn: async (publicKey: string) => {
      const permission = await Notification.requestPermission()
      if (permission !== "granted") throw new Error("permission")
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(publicKey),
      })
      const { endpoint, keys: pushKeys } = subscription.toJSON()
      const p256dh = pushKeys?.p256dh
      const auth = pushKeys?.auth
      if (endpoint === undefined || p256dh === undefined || auth === undefined) {
        throw new Error("subscription")
      }
      await callApi((api) =>
        api.notifications.subscribePush({ payload: { endpoint, p256dh, auth } }),
      )
    },
    onSuccess: () => {
      setError(null)
      return refresh()
    },
    onError: (caught) => {
      setError(
        caught instanceof Error && caught.message === "permission"
          ? t`Notifications are blocked for this site. Allow them in your browser settings.`
          : t`Could not turn on push notifications. Try again.`,
      )
    },
  })

  const unsubscribe = useMutation({
    mutationFn: async () => {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription === null) return
      const endpoint = subscription.endpoint
      await callApi((api) => api.notifications.unsubscribePush({ payload: { endpoint } }))
      await subscription.unsubscribe()
    },
    onSuccess: () => {
      setError(null)
      return refresh()
    },
    onError: () => setError(t`Could not turn off push notifications. Try again.`),
  })

  const busy = subscribe.isPending || unsubscribe.isPending

  const message: Record<Exclude<PushState, "ready">, string> = {
    unsupported: t`This browser does not support push notifications.`,
    denied: t`Notifications are blocked for this site. Allow them in your browser settings.`,
    unconfigured: t`Push notifications are not configured on this server.`,
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Push on this device</Trans>
        </CardTitle>
        <CardDescription>
          {settings.pushSubscribed ? (
            <Trans>Push notifications are on for this device.</Trans>
          ) : (
            <Trans>Push notifications are off for this device.</Trans>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {state !== "ready" && <p className="text-sm text-muted-foreground">{message[state]}</p>}
        {state === "ready" && settings.pushSubscribed && (
          <Button variant="outline" disabled={busy} onClick={() => unsubscribe.mutate()}>
            <Trans>Turn off push on this device</Trans>
          </Button>
        )}
        {state === "ready" && !settings.pushSubscribed && (
          <Button
            disabled={busy}
            onClick={() => {
              if (settings.pushPublicKey !== null) subscribe.mutate(settings.pushPublicKey)
            }}
          >
            <Trans>Turn on push on this device</Trans>
          </Button>
        )}
        {error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function ModerationCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Who can read what</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Owners and admins can read private channels and direct messages for moderation. Other
            members see only what they are part of.
          </Trans>
        </CardDescription>
      </CardHeader>
    </Card>
  )
}
