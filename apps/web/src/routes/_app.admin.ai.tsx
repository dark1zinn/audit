import { Trans, useLingui } from "@lingui/react/macro"
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import type {
  AiFeature,
  AiProvider,
  AiProviderInput,
  AiProviderKind,
  AiProviderPatch,
  AiSettings,
  AiSettingsInput,
} from "@audit/domain/ai/schema"
import type { AiProviderId } from "@audit/domain/ids"
import type { WorkspaceRole } from "@audit/domain/roles"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@audit/ui/components/ui/dialog.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@audit/ui/components/ui/select.tsx"
import { Switch } from "@audit/ui/components/ui/switch.tsx"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@audit/ui/components/ui/table.tsx"
import { ErrorMessage, LoadingRows, PageHeader } from "../components/feedback.tsx"
import { callApi } from "../lib/api.ts"

/** Query keys for this page. Kept local: nothing outside the AI admin page reads them. */
const aiKeys = {
  settings: ["admin", "ai", "settings"] as const,
  providers: ["admin", "ai", "providers"] as const,
  usage: (month: string) => ["admin", "ai", "usage", month] as const,
}

const settingsQuery = queryOptions({
  queryKey: aiKeys.settings,
  queryFn: () => callApi((api) => api.aiAdmin.settings()),
})

const providersQuery = queryOptions({
  queryKey: aiKeys.providers,
  queryFn: () => callApi((api) => api.aiAdmin.providers()),
})

const FEATURES: readonly AiFeature[] = [
  "assistant",
  "semantic_search",
  "summaries",
  "doc_upkeep",
  "editor",
  "chat",
  "board",
  "calendar",
]

const ROLES: readonly WorkspaceRole[] = ["owner", "admin", "member", "guest"]

const PROVIDER_KINDS: readonly AiProviderKind[] = [
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "openai_compatible",
]

/** Select value meaning "no provider". Radix selects cannot use an empty string as a value. */
const NO_PROVIDER = "none"

const MONTH_PATTERN = /^\d{4}-\d{2}$/

/** Translated labels for the enumerations this page shows. */
function useAiLabels() {
  const { t } = useLingui()
  return {
    feature: {
      assistant: t`Assistant`,
      semantic_search: t`Semantic search`,
      summaries: t`Summaries`,
      doc_upkeep: t`Document upkeep`,
      editor: t`Editor`,
      chat: t`Chat`,
      board: t`Board`,
      calendar: t`Calendar`,
    } satisfies Record<AiFeature, string>,
    role: {
      owner: t`Owner`,
      admin: t`Admin`,
      member: t`Member`,
      guest: t`Guest`,
    } satisfies Record<WorkspaceRole, string>,
    kind: {
      openai: "OpenAI",
      anthropic: "Anthropic",
      google: "Google",
      openrouter: "OpenRouter",
      openai_compatible: t`OpenAI-compatible`,
    } satisfies Record<AiProviderKind, string>,
    status: {
      untested: t`Untested`,
      ok: t`Connected`,
      failed: t`Failed`,
    } satisfies Record<AiProvider["status"], string>,
  }
}

/** Trimmed text, or `undefined` when blank. Used so optional fields are omitted, not sent empty. */
const trimmedOrUndefined = (value: string): string | undefined => {
  const trimmed = value.trim()
  return trimmed === "" ? undefined : trimmed
}

/** `{ key: value }` when present, `{}` otherwise (the API types forbid explicit `undefined`). */
const present = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
  value === undefined ? {} : ({ [key]: value } as Record<K, V>)

export const Route = createFileRoute("/_app/admin/ai")({
  component: AiAdminPage,
})

function AiAdminPage() {
  const { t } = useLingui()
  const settings = useQuery(settingsQuery)
  const providers = useQuery(providersQuery)

  return (
    <>
      <PageHeader
        title={t`AI`}
        description={t`Turn AI on for the workspace, choose the providers it uses and watch token use.`}
      />
      {(settings.isPending || providers.isPending) && <LoadingRows />}
      {settings.isError && <ErrorMessage error={settings.error} />}
      {providers.isError && <ErrorMessage error={providers.error} />}
      {settings.data !== undefined && providers.data !== undefined && (
        <div className="grid max-w-5xl gap-6">
          <SettingsForm settings={settings.data} providers={providers.data} />
          <ProvidersCard providers={providers.data} />
          <ProviderCreateCard />
          <UsageCard />
        </div>
      )}
    </>
  )
}

function SettingsForm({
  settings,
  providers,
}: {
  readonly settings: AiSettings
  readonly providers: readonly AiProvider[]
}) {
  const { t } = useLingui()
  const labels = useAiLabels()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<AiSettings>(settings)
  const [budget, setBudget] = useState(
    settings.monthlyTokenBudget === null ? "" : String(settings.monthlyTokenBudget),
  )

  const save = useMutation({
    mutationFn: (input: AiSettingsInput) =>
      callApi((api) => api.aiAdmin.updateSettings({ payload: input })),
    onSuccess: (saved) => {
      queryClient.setQueryData(aiKeys.settings, saved)
      toast.success(t`AI settings saved`)
    },
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedBudget = budget.trim()
    save.mutate({
      enabled: draft.enabled,
      defaultProviderId: draft.defaultProviderId,
      embeddingProviderId: draft.embeddingProviderId,
      allowedRoles: [...draft.allowedRoles],
      monthlyTokenBudget: trimmedBudget === "" ? null : Number(trimmedBudget),
      features: draft.features,
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Workspace AI</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            AI is off until it is turned on here. Nothing is sent to a provider before then.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-6" onSubmit={onSubmit}>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="aiEnabled">
              <Trans>AI enabled</Trans>
            </Label>
            <Switch
              id="aiEnabled"
              checked={draft.enabled}
              onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked })}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="defaultProvider">
                <Trans>Default provider</Trans>
              </Label>
              <ProviderSelect
                id="defaultProvider"
                value={draft.defaultProviderId}
                providers={providers}
                onChange={(next) => setDraft({ ...draft, defaultProviderId: next })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="embeddingProvider">
                <Trans>Embedding provider</Trans>
              </Label>
              <ProviderSelect
                id="embeddingProvider"
                value={draft.embeddingProviderId}
                providers={providers}
                onChange={(next) => setDraft({ ...draft, embeddingProviderId: next })}
              />
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              <Trans>Allowed roles</Trans>
            </legend>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {ROLES.map((role) => (
                <div key={role} className="flex items-center gap-2">
                  <Checkbox
                    id={`role-${role}`}
                    checked={draft.allowedRoles.includes(role)}
                    onCheckedChange={(checked) =>
                      setDraft((current) => ({
                        ...current,
                        allowedRoles: ROLES.filter((r) =>
                          r === role ? checked === true : current.allowedRoles.includes(r),
                        ),
                      }))
                    }
                  />
                  <Label htmlFor={`role-${role}`} className="font-normal">
                    {labels.role[role]}
                  </Label>
                </div>
              ))}
            </div>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="monthlyTokenBudget">
              <Trans>Monthly token budget</Trans>
            </Label>
            <Input
              id="monthlyTokenBudget"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              className="max-w-xs"
              placeholder={t`No limit`}
              value={budget}
              onChange={(event) => setBudget(event.currentTarget.value)}
            />
            <p className="text-xs text-muted-foreground">
              <Trans>
                Leave empty for no limit. Counts input and output tokens across the workspace.
              </Trans>
            </p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              <Trans>Features</Trans>
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {FEATURES.map((feature) => (
                <div key={feature} className="flex items-center justify-between gap-4">
                  <Label htmlFor={`feature-${feature}`} className="font-normal">
                    {labels.feature[feature]}
                  </Label>
                  <Switch
                    id={`feature-${feature}`}
                    checked={draft.features[feature]}
                    onCheckedChange={(checked) =>
                      setDraft((current) => ({
                        ...current,
                        features: { ...current.features, [feature]: checked },
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          </fieldset>

          {save.error !== null && <ErrorMessage error={save.error} />}
          <Button type="submit" disabled={save.isPending}>
            <Trans>Save</Trans>
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function ProviderSelect({
  id,
  value,
  providers,
  onChange,
}: {
  readonly id: string
  readonly value: AiProviderId | null
  readonly providers: readonly AiProvider[]
  readonly onChange: (next: AiProviderId | null) => void
}) {
  return (
    <Select
      value={value ?? NO_PROVIDER}
      onValueChange={(next) => onChange(next === NO_PROVIDER ? null : (next as AiProviderId))}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_PROVIDER}>
          <Trans>None</Trans>
        </SelectItem>
        {providers.map((provider) => (
          <SelectItem key={provider.id} value={provider.id}>
            {provider.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ProvidersCard({ providers }: { readonly providers: readonly AiProvider[] }) {
  const { t, i18n } = useLingui()
  const labels = useAiLabels()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<AiProvider | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AiProvider | null>(null)

  const test = useMutation({
    mutationFn: (providerId: AiProviderId) =>
      callApi((api) => api.aiAdmin.testProvider({ params: { providerId } })),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: aiKeys.providers })
      if (result.ok) toast.success(t`Connection works (${result.latencyMs} ms)`)
      else toast.error(result.message)
    },
  })

  const remove = useMutation({
    mutationFn: (providerId: AiProviderId) =>
      callApi((api) => api.aiAdmin.deleteProvider({ params: { providerId } })),
    onSuccess: (_result, providerId) => {
      setPendingDelete(null)
      setEditing((current) => (current?.id === providerId ? null : current))
      void queryClient.invalidateQueries({ queryKey: aiKeys.providers })
      void queryClient.invalidateQueries({ queryKey: aiKeys.settings })
      toast.success(t`Provider deleted`)
    },
  })

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Providers</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>API keys are write-only. Only the last four characters are shown.</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {providers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>No providers yet. Add one below.</Trans>
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Trans>Name</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans>Kind</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans>Chat model</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans>Embedding model</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans>Key</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans>Status</Trans>
                  </TableHead>
                  <TableHead>
                    <span className="sr-only">
                      <Trans>Actions</Trans>
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {providers.map((provider) => (
                  <TableRow key={provider.id}>
                    <TableCell className="text-sm font-medium">{provider.name}</TableCell>
                    <TableCell className="text-sm">{labels.kind[provider.kind]}</TableCell>
                    <TableCell className="text-sm">{provider.chatModel}</TableCell>
                    <TableCell className="text-sm">
                      {provider.embeddingModel === "" ? (
                        <span className="text-muted-foreground">
                          <Trans>None</Trans>
                        </span>
                      ) : (
                        <>
                          {provider.embeddingModel}
                          <span className="block text-xs text-muted-foreground">
                            {provider.embeddingDimensions}
                          </span>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {provider.hasKey ? (
                        <>••••{provider.keyLast4}</>
                      ) : (
                        <span className="text-muted-foreground">
                          <Trans>No key</Trans>
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      <Badge
                        variant={
                          provider.status === "ok"
                            ? "secondary"
                            : provider.status === "failed"
                              ? "destructive"
                              : "outline"
                        }
                      >
                        {labels.status[provider.status]}
                      </Badge>
                      {provider.lastTestedAt !== null && (
                        <span className="block text-xs text-muted-foreground">
                          {new Intl.DateTimeFormat(i18n.locale, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(provider.lastTestedAt)}
                        </span>
                      )}
                      {provider.lastTestError !== null && (
                        <span className="block text-xs text-destructive">
                          {provider.lastTestError}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={test.isPending && test.variables === provider.id}
                          onClick={() => test.mutate(provider.id)}
                        >
                          <Trans>Test</Trans>
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setEditing(provider)}>
                          <Trans>Edit</Trans>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPendingDelete(provider)}
                        >
                          <Trans>Delete</Trans>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {test.error !== null && <ErrorMessage error={test.error} />}
          {editing !== null && (
            <div className="space-y-4 rounded-md border p-4">
              <h2 className="text-sm font-medium">
                <Trans>Edit provider</Trans>
              </h2>
              <ProviderForm
                key={editing.id}
                provider={editing}
                onDone={() => setEditing(null)}
                onCancel={() => setEditing(null)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <Trans>Delete provider?</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>
                The provider and its stored key are removed. Features that use it stop working until
                another provider is chosen.
              </Trans>
            </DialogDescription>
          </DialogHeader>
          {remove.error !== null && <ErrorMessage error={remove.error} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (pendingDelete !== null) remove.mutate(pendingDelete.id)
              }}
            >
              <Trans>Delete</Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ProviderCreateCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Add provider</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>The key is stored sealed and is never shown again.</Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ProviderForm />
      </CardContent>
    </Card>
  )
}

/** Creates a provider when `provider` is absent, otherwise edits that provider. The kind is fixed. */
function ProviderForm({
  provider,
  onDone,
  onCancel,
}: {
  readonly provider?: AiProvider
  readonly onDone?: () => void
  readonly onCancel?: () => void
}) {
  const { t } = useLingui()
  const labels = useAiLabels()
  const queryClient = useQueryClient()
  const isEdit = provider !== undefined
  const [kind, setKind] = useState<AiProviderKind>(provider?.kind ?? "openai")
  const [name, setName] = useState(provider?.name ?? "")
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "")
  const [apiKey, setApiKey] = useState("")
  const [chatModel, setChatModel] = useState(provider?.chatModel ?? "")
  const [embeddingModel, setEmbeddingModel] = useState(provider?.embeddingModel ?? "")
  const [dimensions, setDimensions] = useState(
    provider === undefined ? "" : String(provider.embeddingDimensions),
  )

  const save = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: aiKeys.providers })
      toast.success(isEdit ? t`Provider saved` : t`Provider added`)
      if (!isEdit) reset()
      onDone?.()
    },
  })

  const reset = () => {
    setName("")
    setBaseUrl("")
    setApiKey("")
    setChatModel("")
    setEmbeddingModel("")
    setDimensions("")
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const dims = dimensions.trim()
    const key = trimmedOrUndefined(apiKey)

    if (provider === undefined) {
      const input: AiProviderInput = {
        kind,
        name: name.trim(),
        chatModel: chatModel.trim(),
        ...present("baseUrl", trimmedOrUndefined(baseUrl)),
        ...present("apiKey", key),
        ...present("embeddingModel", trimmedOrUndefined(embeddingModel)),
        ...present("embeddingDimensions", dims === "" ? undefined : Number(dims)),
      }
      save.mutate(() => callApi((api) => api.aiAdmin.createProvider({ payload: input })))
      return
    }

    const patch: AiProviderPatch = {
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      chatModel: chatModel.trim(),
      embeddingModel: embeddingModel.trim(),
      ...present("apiKey", key),
      ...present("embeddingDimensions", dims === "" ? undefined : Number(dims)),
    }
    save.mutate(() =>
      callApi((api) =>
        api.aiAdmin.updateProvider({ params: { providerId: provider.id }, payload: patch }),
      ),
    )
  }

  return (
    <form className="grid gap-4 md:grid-cols-2" onSubmit={onSubmit}>
      <div className="space-y-2">
        <Label htmlFor="aiProviderKind">
          <Trans>Kind</Trans>
        </Label>
        {isEdit ? (
          <p className="text-sm">{labels.kind[kind]}</p>
        ) : (
          <Select value={kind} onValueChange={(next) => setKind(next as AiProviderKind)}>
            <SelectTrigger id="aiProviderKind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_KINDS.map((option) => (
                <SelectItem key={option} value={option}>
                  {labels.kind[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="aiProviderName">
          <Trans>Name</Trans>
        </Label>
        <Input
          id="aiProviderName"
          required
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="aiProviderBaseUrl">
          <Trans>Base URL (optional)</Trans>
        </Label>
        <Input
          id="aiProviderBaseUrl"
          type="url"
          maxLength={500}
          placeholder={t`Provider default`}
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.currentTarget.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="aiProviderApiKey">
          <Trans>API key</Trans>
        </Label>
        <Input
          id="aiProviderApiKey"
          type="password"
          autoComplete="off"
          maxLength={500}
          required={!isEdit}
          placeholder={
            isEdit && provider.hasKey ? t`Leave empty to keep ••••${provider.keyLast4 ?? ""}` : ""
          }
          value={apiKey}
          onChange={(event) => setApiKey(event.currentTarget.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="aiProviderChatModel">
          <Trans>Chat model</Trans>
        </Label>
        <Input
          id="aiProviderChatModel"
          required
          maxLength={200}
          value={chatModel}
          onChange={(event) => setChatModel(event.currentTarget.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="aiProviderEmbeddingModel">
          <Trans>Embedding model (optional)</Trans>
        </Label>
        <Input
          id="aiProviderEmbeddingModel"
          maxLength={200}
          value={embeddingModel}
          onChange={(event) => setEmbeddingModel(event.currentTarget.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="aiProviderDimensions">
          <Trans>Embedding dimensions</Trans>
        </Label>
        <Input
          id="aiProviderDimensions"
          type="number"
          inputMode="numeric"
          min={0}
          max={4000}
          step={1}
          value={dimensions}
          onChange={(event) => setDimensions(event.currentTarget.value)}
        />
      </div>
      <div className="flex items-end gap-2 md:col-span-2">
        {save.error !== null && <ErrorMessage error={save.error} />}
        <div className="ml-auto flex gap-2">
          {onCancel !== undefined && (
            <Button type="button" variant="outline" onClick={onCancel}>
              <Trans>Cancel</Trans>
            </Button>
          )}
          <Button type="submit" disabled={save.isPending}>
            {isEdit ? <Trans>Save provider</Trans> : <Trans>Add provider</Trans>}
          </Button>
        </div>
      </div>
    </form>
  )
}

function UsageCard() {
  const { t, i18n } = useLingui()
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const usage = useQuery({
    queryKey: aiKeys.usage(month),
    queryFn: () => callApi((api) => api.aiAdmin.usage({ query: { month } })),
    enabled: MONTH_PATTERN.test(month),
  })
  const format = (value: number) => value.toLocaleString(i18n.locale)

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Usage</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>Tokens used in the chosen calendar month (UTC).</Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="usageMonth">
            <Trans>Month</Trans>
          </Label>
          <Input
            id="usageMonth"
            type="month"
            className="max-w-xs"
            value={month}
            onChange={(event) => setMonth(event.currentTarget.value)}
          />
        </div>

        {usage.isPending && MONTH_PATTERN.test(month) && <LoadingRows rows={2} />}
        {usage.isError && <ErrorMessage error={usage.error} />}
        {usage.data !== undefined && (
          <>
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">
                  <Trans>Calls</Trans>
                </dt>
                <dd className="text-lg font-semibold">{format(usage.data.totals.calls)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  <Trans>Input tokens</Trans>
                </dt>
                <dd className="text-lg font-semibold">{format(usage.data.totals.inputTokens)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  <Trans>Output tokens</Trans>
                </dt>
                <dd className="text-lg font-semibold">{format(usage.data.totals.outputTokens)}</dd>
              </div>
            </dl>
            <UsageTable title={t`By feature`} rows={usage.data.byFeature} format={format} />
            <UsageTable title={t`By person`} rows={usage.data.byPerson} format={format} />
            <UsageTable title={t`By provider`} rows={usage.data.byProvider} format={format} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

function UsageTable({
  title,
  rows,
  format,
}: {
  readonly title: string
  readonly rows: readonly {
    readonly key: string
    readonly label: string
    readonly calls: number
    readonly inputTokens: number
    readonly outputTokens: number
  }[]
  readonly format: (value: number) => string
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <Trans>No usage this month.</Trans>
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Trans>Name</Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans>Calls</Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans>Input tokens</Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans>Output tokens</Trans>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="text-sm">{row.label}</TableCell>
                <TableCell className="text-right text-sm">{format(row.calls)}</TableCell>
                <TableCell className="text-right text-sm">{format(row.inputTokens)}</TableCell>
                <TableCell className="text-right text-sm">{format(row.outputTokens)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}
