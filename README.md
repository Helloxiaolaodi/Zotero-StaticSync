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
### Phase 2.1 (subfolder grouping + bidirectional sync + UX fixes)
- **Subfolder-aware web display** — when an exported folder contains subfolders (and nested sub-subfolders), the web page now distinguishes which folder each paper came from, grouped under a "Parent / Child" header. Papers are no longer dumped into the to-read bucket when they actually belong to a deeper folder. This is shown for both collaborative and non-collaborative collections.
- **Three workflow tabs only in group/collaborative mode** — the 待阅读/已认领/已汇报 (to-read/claimed/reported) tabs appear only when the share is a collaborative group collection. For non-collaborative collections the page shows a single flat view grouped by subfolder path, with no tabs.
- **Optimistic undo buttons** — claim and undo-claim now update the web UI immediately, so the button responds instantly instead of requiring a manual refresh or multiple clicks. On failure the change rolls back; a periodic refresh reconciles with the server.
- **Bidirectional sync (web ↔ Zotero)** — web actions write straight to Supabase (`?direct=1` direct mode) and also enqueue an action row in `shared_collection_actions`. The Zotero plugin polls every 15s and applies pending actions locally, so changes flow both ways.
- **DOI-added items get an undo button** — items added through the web (by DOI, batch, or from the claimed section) are flagged as `selfUploaded` and show an undo-add button, matching the to-read section's DOI submit.
- **No more Z Linter duplicate popups** — before adding a DOI-sourced item, the plugin checks Zotero for an existing item with the same DOI via `Zotero.Search` and skips the Translator import when a match already exists, avoiding the "no-item-duplication" popup from the Z Linter add-on.
- **Batch and claimed-section DOI submit resolve metadata** — batch import and the claimed-section submit now resolve DOI → title/authors/publication/year via Crossref and display the full article card on the web immediately, with an undo button, identical to the to-read section's DOI submit.
- **Faster collaboration polling** — default poll interval lowered from 60s to 15s so web actions reach Zotero sooner.

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
| Poll interval | 15s | How often Zotero checks for pending actions from the web |
| Actions table | `shared_collection_actions` | Supabase table for collaboration actions |
| To Read collection | `To Read` | Zotero collection name for unclaimed items |
| Claimed collection | `Claimed` | Zotero collection name for claimed items |
| Reported collection | `Reported` | Zotero collection name for reported items |
| Default share password | (empty) | Pre-filled password for new shares |

### CSV Export

Column selection uses checkboxes in the preferences panel. Available columns: Key, Item Type, Title, Authors, Publication Title, Year, Date, DOI, URL, Abstract Note, Tags, Collection Name, Collection Path (full folder hierarchy, e.g. "Parent / Child / Leaf"), Library Name. The sequence number column is always included as the first column. Checkboxes are saved automatically when toggled.

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
- **Instant web updates**: claim/report/add-by-DOI actions are immediately written to `literature_data` in Supabase (requires `SUPABASE_SERVICE_ROLE_KEY` environment variable). Add-by-DOI resolves article metadata via Crossref API so new items show title/authors immediately on the web.
- **Subfolder grouping**: papers from nested subfolders are grouped under their full folder path header ("Parent / Child / Leaf") instead of being flattened into the to-read bucket
- **Tab visibility by mode**: workflow tabs (to-read/claimed/reported) are shown only for collaborative group collections; non-collaborative collections show a single grouped view
- **Optimistic claim/undo**: claim and undo-claim update the UI instantly with rollback on failure
- **Undo on all web-added items**: DOI-added, batch-imported, and claimed-section items all show an undo-add button
- **DOI deduplication**: web and plugin both skip DOI duplicates (Crossref fetch / Zotero import) to avoid duplicate-item popups
- Improved categorization: checks readingStatus, collectionPath, collectionName, and tags in priority order; supports both Chinese and English collection names
- **Tag-based auto-transition**: items with `claim_date:` or `report-date:` tags whose date has passed are automatically promoted from "claimed" to "reported"
- **Supabase Realtime**: web frontend subscribes to `shared_collections` changes via WebSocket for instant data refresh
- **Undo report**: reported items can be moved back to "claimed" via an undo report button
## Cloudflare Pages API (direct mode)

For web pages served through Cloudflare Pages, the `functions/api/zotero-hugo/[[path]].js` worker provides a direct mode. The web UI appends `?direct=1` to its calls; the worker then reads and writes the Supabase `literature_data` JSON directly for instant feedback, and also inserts a row into `shared_collection_actions` so the Zotero plugin picks the action up on its next poll.

Required Cloudflare environment variables:

| Variable | Description |
|---------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (or `SUPABASE_KEY`) for direct read/write access |
| `SUPABASE_SHARE_SLUG` | The share `slug` identifying which `shared_collections` row to operate on |

In direct mode the worker returns `is_collaborative` and `collection_path_text` alongside the items, which the web UI uses to decide whether to render tabs and how to group papers by subfolder.

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
