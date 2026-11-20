import { defineConfig } from "vitepress"

export default defineConfig({
  title: "audit",
  description:
    "Documentation for audit: projects, docs, chat, calendar and an AI assistant on one Postgres database.",
  cleanUrls: true,
  lastUpdated: false,
  themeConfig: {
    nav: [
      { text: "Install", link: "/install/docker" },
      { text: "Configuration", link: "/configuration" },
      { text: "Admin", link: "/admin/" },
      { text: "User guide", link: "/user/projects-and-board" },
      { text: "Security", link: "/security" },
      { text: "Operations", link: "/operations/backups-and-upgrades" },
      { text: "API", link: "/api/" },
    ],
    sidebar: [
      { text: "Introduction", link: "/" },
      {
        text: "Install",
        items: [
          { text: "Docker Compose", link: "/install/docker" },
          { text: "Coolify", link: "/install/coolify" },
        ],
      },
      { text: "Configuration reference", link: "/configuration" },
      {
        text: "Admin guide",
        items: [{ text: "Admin console", link: "/admin/" }],
      },
      {
        text: "User guide",
        items: [
          { text: "Projects and board", link: "/user/projects-and-board" },
          { text: "Docs", link: "/user/docs" },
          { text: "Chat", link: "/user/chat" },
          { text: "Calendar", link: "/user/calendar" },
          { text: "Inbox", link: "/user/inbox" },
          { text: "Search and palette", link: "/user/search" },
          { text: "AI assistant", link: "/user/assistant" },
        ],
      },
      { text: "Security model", link: "/security" },
      {
        text: "Operations",
        items: [{ text: "Backups and upgrades", link: "/operations/backups-and-upgrades" }],
      },
      {
        text: "API reference",
        items: [
          { text: "Overview", link: "/api/" },
          { text: "Endpoint table", link: "/api/endpoints" },
        ],
      },
      {
        text: "Decisions",
        items: [
          { text: "0001 Bun dependency check", link: "/decisions/0001-bun-dependency-check" },
        ],
      },
    ],
    search: { provider: "local" },
    footer: { message: "Apache-2.0", copyright: "audit" },
  },
})
