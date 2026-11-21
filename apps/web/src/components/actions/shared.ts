import { useLingui } from "@lingui/react/macro"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { errorKind } from "../../lib/errors.ts"
import { toast } from "sonner"

/** Runs one action's request and refreshes caches on success. */
export const useRunAction = (invalidate: () => Promise<unknown>) => {
  const { t } = useLingui()
  return useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: async () => {
      await invalidate()
    },
    onError: (error: unknown) => {
      toast.error(
        errorKind(error) === "forbidden"
          ? t`You don't have permission to do that.`
          : errorKind(error) === "conflict"
            ? t`This changed elsewhere. Reload and try again.`
            : t`Something went wrong`,
      )
    },
  })
}

/** Cache keys shared by every task surface (board, list, my tasks, panel). */
export const useInvalidateTasks = () => {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["board"] }),
      queryClient.invalidateQueries({ queryKey: ["task"] }),
    ])
}

/** Writes text to the clipboard and confirms with a toast. */
export const useCopyText = () => {
  const { t } = useLingui()
  return (text: string, done: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success(done),
      () => toast.error(t`Could not copy`),
    )
  }
}

/** Absolute URL for a relative app href, used by "Copy link". */
export const absoluteHref = (href: string) => new URL(href, window.location.origin).toString()

/** Client-side navigation to an app href. */
export const useGo = () => {
  const router = useRouter()
  return (href: string) => {
    void router.navigate({ href })
  }
}

/** Task number from a human key such as `OPS-42`. */
export const taskNumberFromKey = (key: string) => Number(key.slice(key.lastIndexOf("-") + 1))
