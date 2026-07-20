# Zotero-StaticSync

A Zotero plugin that exports Zotero collections to Supabase (structured JSON for share links), with an optional collaborative web-to-Zotero bidirectional sync workflow.

## Features

### Phase 1 (stable)
- **Supabase mode** — upload a collection as structured JSON to a Supabase table, get a share URL back
- **Collection context menu** — right-click any Zotero collection to sync (personal or group library)
- **Password-protected shares** — set a default password in preferences for Supabase shares
- **Auto-copy share URL** — clipboard integration on sync
- **Bilingual UI** — English and Chinese locale support

### Phase 2 (current)
- **Export scope control** — sync a collection with all its subcollections
- **Zotero group library support** — target a specific Zotero group via its Group ID
- **Fixed share slug** — keep a stable, custom URL for repeated syncs instead of a random slug each time
- **Collaborative sync profile** — enable web-to-Zotero bidirectional sync with background polling
- **Collaboration workflow** — web-side actions (claim, report, add by DOI, undo claim, undo report, undo add) are applied to your Zotero library
- **Export CSV** — export collection items to a local CSV file with customizable columns (default: sequence number + title)
- **Public share frontend** — Next.js + Supabase share page with author formatting, status tabs, DOI links, and password gate

## Installation

1. Download the latest `.xpi` from the Releases page.
2. Open Zotero → Tools → Plugins → Install Plugin From File...
3. Select the `.xpi` file.
4. Configure the plugin in Edit → Preferences → StaticSync.

## Configuration

### Supabase

| Setting | Description |
|---------|-------------|
| Supabase URL | Your Supabase project URL |
| Supabase anon/public key | **Use the anon/public key only** — do NOT use the service_role key (Zotero runs in a browser context) |
| Table name | Default: `shared_collections` |
| Share URL template | e.g. `https://yoursite.vercel.app/share/{id}` |
| Copy the generated share URL to clipboard | Auto-copy share URL after sync |
| Default share password | Pre-filled password for new shares. Leave blank for public access. |
| Zotero group ID | Numeric ID from your Zotero group settings URL. Leave blank for personal library. |
| Fixed share slug | Stable URL identifier. Leave blank to auto-generate from collection name. |

### Supabase schema

Run `doc/supabase-schema.sql` in your Supabase SQL Editor. It creates:
- `shared_collections` table with auto-generated `slug`, RLS policies for anon insert/select
- `shared_collection_actions` table for collaboration workflow (optional)

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

### CSV Export

Available column keys: `key`, `itemType`, `title`, `authors`, `publicationTitle`, `year`, `date`, `doi`, `url`, `abstractNote`, `tags`, `collectionName`, `libraryName`. The sequence number column is always included as the first column.

## Usage

1. Select a Zotero collection.
2. Right-click the collection → **Sync Collection with Zotero-StaticSync**.
3. Wait for the progress message. If successful, the share URL is copied to your clipboard.

To export items as CSV:

1. Select a Zotero collection.
2. Right-click the collection → **Export CSV with Zotero-StaticSync**.
3. Choose a save location in the file dialog.
4. The CSV file is saved with UTF-8 BOM encoding for Excel compatibility.

## Public Share Frontend

A companion Next.js frontend renders collection data from Supabase as a public web page.

### Deploying the frontend

1. Push the frontend code to GitHub.
2. Import the repo into Vercel.
3. Set environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` (required for instant web updates on claim/report actions).
4. Deploy. Use the resulting URL (e.g. `https://yoursite.vercel.app/share/{id}`) as your Share URL template.

### Frontend features

- **Bilingual UI** — full Chinese/English toggle with language switch button
- Workflow tabs: 待阅读/已认领/已汇报 (Chinese) ↔ Unread/Assigned/Reported (English)
- User Guide panel with detailed bilingual instructions
- Subtitle line under header describing page purpose (bilingual)
- Author display: first 3 authors + "et al."
- Status badges with color coding (gray=Unread, blue=Assigned, green=Reported)
- Reporter/presenter chips showing name and date for claimed/reported items
- No Zotero tags displayed in Unread section; only presenter chips in Assigned/Reported
- DOI linkification with "查看原文"/"View source" links aligned inline
- Journal name in italic
- Line-clamped titles
- Password gate for protected collections (bilingual)
- **Collaboration mode**: claim, report, add-by-DOI, undo claim, undo report, and undo add buttons with presenter name/date forms
- **Instant web updates**: claim/report actions are immediately written to `literature_data` in Supabase (requires `SUPABASE_SERVICE_ROLE_KEY` environment variable)
- Improved categorization: checks readingStatus, collectionPath, collectionName, and tags in priority order; supports both Chinese and English collection names
- **Tag-based auto-transition**: items with `claim_date:` or `report-date:` tags whose date has passed are automatically promoted from "claimed" to "reported"
- **Supabase Realtime**: web frontend subscribes to `shared_collections` changes via WebSocket for instant data refresh
- **Undo report**: reported items can be moved back to "claimed" via an undo report button

## Build from source

```bash
git clone https://github.com/Helloxiaolaodi/Zotero-StaticSync.git
cd Zotero-StaticSync
npm install
npm run build
```

The built `.xpi` will be in `.scaffold/build/`.

## Requirements

- Zotero 7 or later (compatible through Zotero 10-beta)
- A Supabase project with the schema from `doc/supabase-schema.sql`

## Credits

Built on the [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) by windingwind.