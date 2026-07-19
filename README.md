# Zotero-StaticSync

A Zotero plugin that exports Zotero collections to GitHub (Markdown + Hugo frontmatter) or Supabase (structured JSON for share links), with an optional collaborative web-to-Zotero bidirectional sync workflow.

## Features

### Phase 1 (stable)
- **GitHub mode** — push each Zotero item as a Markdown file with Hugo-compatible YAML frontmatter
- **Supabase mode** — upload a collection as structured JSON to a Supabase table, get a share URL back
- **Collection context menu** — right-click any Zotero collection to sync
- **Password-protected shares** — set a password prompt for Supabase shares
- **Auto-copy share URL** — clipboard integration on sync
- **Bilingual UI** — English and Chinese locale support

### Phase 2 (current)
- **Export scope control** — sync a single collection, a collection with all its subcollections, or the entire library
- **Zotero group library support** — target a specific Zotero group via its Group ID
- **Fixed share slug** — keep a stable, custom URL for repeated syncs instead of a random slug each time
- **Collaborative sync profile** — enable web-to-Zotero bidirectional sync with background polling
- **Collaboration workflow** — web-side actions (claim, report, add by DOI, undo) are applied to your Zotero library
- **Public share frontend** — Next.js + Supabase share page with author formatting, status tabs, DOI links, and password gate

## Installation

1. Download the latest `.xpi` from the Releases page.
2. Open Zotero → Tools → Plugins → Install Plugin From File...
3. Select the `.xpi` file.
4. Configure the plugin in Edit → Preferences → StaticSync.

## Configuration

### Mode: GitHub

| Setting | Description |
|---------|-------------|
| GitHub repository | `owner/repo` format |
| GitHub token | PAT with repo content write permission |
| Branch | Target branch, e.g. `main` |
| Content path | Directory path for generated files, e.g. `content/reading` |

### Mode: Supabase

| Setting | Description |
|---------|-------------|
| Supabase URL | Your Supabase project URL |
| Supabase anon/public key | **Use the anon/public key only** — do NOT use the service_role key (Zotero runs in a browser context) |
| Table name | Default: `shared_collections` |
| Share URL template | e.g. `https://yoursite.vercel.app/share/{id}` |

### Supabase schema

Run `doc/supabase-schema.sql` in your Supabase SQL Editor. It creates:
- `shared_collections` table with auto-generated `slug`, RLS policies for anon insert/select
- `shared_collection_actions` table for collaboration workflow (optional)

### Export Options

| Setting | Description |
|---------|-------------|
| Export scope | `Selected collection only` / `Collection and subcollections` / `Entire library` |
| Zotero group ID | Numeric ID from your Zotero group settings URL. Leave blank for personal library. |
| Fixed share slug | Stable URL identifier. Leave blank to auto-generate from collection name. |
| Include child notes | Whether to export Zotero child notes as part of each item |

### Sync Profile

| Setting | Description |
|---------|-------------|
| Static | One-way push only — data is uploaded and done. |
| Collaborative | Enables background polling for web-side actions (claim/report/add-by-DOI/undo). |

### Collaboration Settings (collaborative profile only)

| Setting | Default | Description |
|---------|---------|-------------|
| Poll interval | 60s | How often Zotero checks for pending actions from the web |
| Actions table | `shared_collection_actions` | Supabase table for collaboration actions |
| To Read collection | `To Read` | Zotero collection name for unclaimed items |
| Claimed collection | `Claimed` | Zotero collection name for claimed items |
| Reported collection | `Reported` | Zotero collection name for reported items |
| Default share password | (empty) | Pre-filled password for new shares |

## Usage

1. Select a Zotero collection (or set Export Scope to "Entire library" to skip this).
2. Right-click the collection → **Sync Collection with Zotero-StaticSync**.
3. If Supabase mode: enter a password or leave blank for public access.
4. Wait for the progress message. If successful, the share URL is copied to your clipboard.

## Public Share Frontend

A companion Next.js frontend renders collection data from Supabase as a public web page.

### Deploying the frontend

1. Push the frontend code to GitHub.
2. Import the repo into Vercel.
3. Set environment variables: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Deploy. Use the resulting URL (e.g. `https://yoursite.vercel.app/share/{id}`) as your Share URL template.

### Frontend features

- Author display: first 3 authors + "et al."
- Status tags with color coding (pending/claimed/reported)
- DOI linkification
- Journal name in italic
- Line-clamped titles
- Password gate for protected collections
- **Collaboration mode**: claim, report, add-by-DOI, and undo buttons with reporter name/date forms

## Build from source

```bash
git clone https://github.com/windingwind/zotero-plugin-template.git
cd zotero-plugin-template
npm install
npm run build
```

The built `.xpi` will be in `.scaffold/build/`.

## Requirements

- Zotero 7 or later
- For GitHub mode: a GitHub repository and personal access token
- For Supabase mode: a Supabase project with the schema from `doc/supabase-schema.sql`

## Credits

Built on the [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) by windingwind.
