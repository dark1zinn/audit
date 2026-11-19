# Changesets

Every user-visible change adds a changeset: run `bun changeset`, pick the bump and describe the change.
All `@audit/*` packages are versioned together; the release workflow turns pending changesets into
`CHANGELOG.md` entries and a tag.
