import { Trans, useLingui } from "@lingui/react/macro"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import QRCode from "qrcode"
import { useEffect, useState, type FormEvent } from "react"
import { toast } from "sonner"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@audit/ui/components/ui/card.tsx"
import { ErrorMessage, PageHeader } from "../components/feedback.tsx"
import { formValue, TextField } from "../components/form.tsx"
import { useMe } from "../components/use-me.ts"
import { authClient } from "../lib/auth.ts"
import { keys } from "../lib/queries.ts"

export const Route = createFileRoute("/_app/settings/security")({
  component: SecurityPage,
})

function SecurityPage() {
  const { t } = useLingui()
  const me = useMe()
  return (
    <>
      <PageHeader title={t`Security`} description={t`Protect your account and manage sign-ins.`} />
      <div className="grid gap-6">
        <TwoFactorCard enabled={me.twoFactorEnabled} />
        <PasskeysCard />
        <SessionsCard />
      </div>
    </>
  )
}

function BackupCodes({ codes }: { readonly codes: ReadonlyArray<string> }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">
        <Trans>Backup codes (shown once; store them safely)</Trans>
      </p>
      <ul className="grid grid-cols-2 gap-1 font-mono text-sm">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
    </div>
  )
}

function TwoFactorCard({ enabled }: { readonly enabled: boolean }) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const [password, setPassword] = useState<string | null>(null)
  const [setup, setSetup] = useState<{ uri: string; backupCodes: ReadonlyArray<string> } | null>(
    null,
  )
  const [qr, setQr] = useState<string | null>(null)
  const [codes, setCodes] = useState<ReadonlyArray<string> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (setup === null) return
    let cancelled = false
    void QRCode.toDataURL(setup.uri, { margin: 1, width: 192 }).then((url) => {
      if (!cancelled) setQr(url)
    })
    return () => {
      cancelled = true
    }
  }, [setup])

  const run = async (
    action: () => Promise<{ error: { message?: string | undefined } | null; data?: unknown }>,
  ) => {
    setBusy(true)
    setError(null)
    try {
      const result = await action()
      if (result.error) {
        setError(t`That did not work. Check your password or code and try again.`)
        return null
      }
      return result
    } catch {
      setError(t`Cannot reach the server. Check your connection.`)
      return null
    } finally {
      setBusy(false)
    }
  }

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (password === null) return
    const result = await run(() => authClient.twoFactor.enable({ password }))
    const data = result?.data as { totpURI?: string; backupCodes?: string[] } | undefined
    if (data?.totpURI !== undefined) {
      setSetup({ uri: data.totpURI, backupCodes: data.backupCodes ?? [] })
    }
  }

  const confirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const code = formValue(event.currentTarget, "code")
    if ((await run(() => authClient.twoFactor.verifyTotp({ code }))) === null) return
    await queryClient.invalidateQueries({ queryKey: keys.session })
    setCodes(setup?.backupCodes ?? [])
    setSetup(null)
    setPassword(null)
    toast.success(t`Two-factor authentication is on`)
  }

  const disable = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (password === null) return
    if ((await run(() => authClient.twoFactor.disable({ password }))) === null) return
    await queryClient.invalidateQueries({ queryKey: keys.session })
    setPassword(null)
    toast.success(t`Two-factor authentication is off`)
  }

  const regenerate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (password === null) return
    const result = await run(() => authClient.twoFactor.generateBackupCodes({ password }))
    const data = result?.data as { backupCodes?: string[] } | undefined
    if (data?.backupCodes !== undefined) setCodes(data.backupCodes)
    setPassword(null)
  }

  const secret = setup === null ? null : new URL(setup.uri).searchParams.get("secret")

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Two-factor authentication</Trans>
        </CardTitle>
        <CardDescription>
          {enabled ? <Trans>Enabled</Trans> : <Trans>Not enabled</Trans>}{" "}
          <Badge variant={enabled ? "default" : "outline"} className="ml-2">
            {enabled ? t`On` : t`Off`}
          </Badge>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {!enabled && setup === null && (
          <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => void start(event)}>
            <div className="min-w-64 flex-1">
              <TextField
                name="password"
                type="password"
                label={t`Current password`}
                autoComplete="current-password"
                required
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
            </div>
            <Button type="submit" disabled={busy}>
              <Trans>Set up two-factor</Trans>
            </Button>
          </form>
        )}

        {setup !== null && (
          <div className="grid gap-6 sm:grid-cols-[auto_1fr]">
            {qr !== null && (
              <img
                src={qr}
                alt={t`QR code for your authenticator app`}
                width={192}
                height={192}
                className="rounded-md border bg-white p-2"
              />
            )}
            <div className="space-y-4">
              <p className="text-sm">
                <Trans>Scan the code with your authenticator app, or enter this key:</Trans>
              </p>
              {secret !== null && (
                <code className="block break-all font-mono text-sm">{secret}</code>
              )}
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(event) => void confirm(event)}
              >
                <div className="min-w-40">
                  <TextField
                    name="code"
                    label={t`6-digit code`}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                  />
                </div>
                <Button type="submit" disabled={busy}>
                  <Trans>Confirm</Trans>
                </Button>
              </form>
              <BackupCodes codes={setup.backupCodes} />
            </div>
          </div>
        )}

        {codes !== null && setup === null && <BackupCodes codes={codes} />}

        {enabled && (
          <div className="grid gap-4 sm:grid-cols-2">
            <form className="space-y-3" onSubmit={(event) => void disable(event)}>
              <TextField
                name="password"
                type="password"
                label={t`Current password`}
                autoComplete="current-password"
                required
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
              <Button type="submit" variant="destructive" disabled={busy}>
                <Trans>Turn off two-factor</Trans>
              </Button>
            </form>
            <form className="space-y-3" onSubmit={(event) => void regenerate(event)}>
              <TextField
                name="password"
                type="password"
                label={t`Current password`}
                autoComplete="current-password"
                required
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
              <Button type="submit" variant="outline" disabled={busy}>
                <Trans>Generate new backup codes</Trans>
              </Button>
            </form>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PasskeysCard() {
  const { t } = useLingui()
  const passkeys = authClient.useListPasskeys()
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)

  const add = async () => {
    setError(null)
    const trimmed = name.trim()
    const result = await authClient.passkey.addPasskey(trimmed === "" ? {} : { name: trimmed })
    if (result.error) {
      setError(t`The passkey could not be added.`)
      return
    }
    setName("")
    toast.success(t`Passkey added`)
  }

  const remove = async (id: string) => {
    const result = await authClient.passkey.deletePasskey({ id })
    if (result.error) setError(t`The passkey could not be removed.`)
  }

  const list = passkeys.data ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Passkeys</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>Sign in with your device, without a password.</Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>No passkeys yet.</Trans>
          </p>
        ) : (
          <ul className="divide-y">
            {list.map((passkey) => (
              <li key={passkey.id} className="flex items-center justify-between gap-4 py-2">
                <span className="text-sm">{passkey.name ?? t`Unnamed passkey`}</span>
                <Button variant="ghost" size="sm" onClick={() => void remove(passkey.id)}>
                  <Trans>Remove</Trans>
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void add()
          }}
        >
          <div className="min-w-48 flex-1">
            <TextField
              name="passkeyName"
              label={t`Name (optional)`}
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              maxLength={60}
            />
          </div>
          <Button type="submit" variant="outline">
            <Trans>Add passkey</Trans>
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function SessionsCard() {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const current = authClient.useSession().data?.session.token
  const sessions = useQuery({
    queryKey: ["auth", "sessions"],
    queryFn: async () => {
      const result = await authClient.listSessions()
      if (result.error) throw new Error(result.error.message ?? "sessions")
      return result.data
    },
  })

  const revoke = async (token: string) => {
    await authClient.revokeSession({ token })
    await queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] })
  }

  const revokeOthers = async () => {
    await authClient.revokeOtherSessions()
    await queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] })
    toast.success(t`Other sessions signed out`)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Active sessions</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>Devices currently signed in to your account.</Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sessions.isError && <ErrorMessage error={sessions.error} />}
        <ul className="divide-y">
          {(sessions.data ?? []).map((session) => (
            <li key={session.token} className="flex items-center justify-between gap-4 py-2">
              <div className="min-w-0 text-sm">
                <p className="truncate">{session.userAgent ?? t`Unknown device`}</p>
                <p className="text-xs text-muted-foreground">
                  {session.ipAddress ?? ""}
                  {session.token === current && (
                    <>
                      {" "}
                      · <Trans>This device</Trans>
                    </>
                  )}
                </p>
              </div>
              {session.token !== current && (
                <Button variant="ghost" size="sm" onClick={() => void revoke(session.token)}>
                  <Trans>Sign out</Trans>
                </Button>
              )}
            </li>
          ))}
        </ul>
        <Button variant="outline" onClick={() => void revokeOthers()}>
          <Trans>Sign out other sessions</Trans>
        </Button>
      </CardContent>
    </Card>
  )
}
