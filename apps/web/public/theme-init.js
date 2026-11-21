// Applies the stored theme before the first paint so dark mode never flashes.
// Loaded as a classic script from index.html (the CSP forbids inline scripts).
;(function () {
  try {
    var stored = window.localStorage.getItem("audit.theme")
    var dark =
      stored === "dark" ||
      ((stored === "system" || stored === null) &&
        window.matchMedia("(prefers-color-scheme: dark)").matches)
    if (dark) document.documentElement.classList.add("dark")
  } catch {
    // Storage or matchMedia unavailable: keep the light default.
  }
})()
