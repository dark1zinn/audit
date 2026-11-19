// Runs the API server and the Vite dev server together. Ctrl+C stops both.
const cwds = ["apps/server", "apps/web"] as const

const children = cwds.map((cwd) =>
  Bun.spawn(["bun", "--cwd", cwd, "run", "dev"], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }),
)

const stop = () => {
  for (const child of children) child.kill()
}

process.on("SIGINT", stop)
process.on("SIGTERM", stop)

await Promise.race(children.map((child) => child.exited))
stop()
process.exit(1)
