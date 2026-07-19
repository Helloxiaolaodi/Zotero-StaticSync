# Zotero-StaticSync

[![zotero target version](https://img.shields.io/badge/Zotero-7%20to%209-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)

Zotero-StaticSync is a Zotero plugin for publishing collection data from Zotero to either:

- a GitHub repository that powers a static site such as Hugo
- a Supabase table that backs a sharing page or lightweight literature portal

The plugin works at the collection level. You right-click a Zotero collection, trigger a sync, and Zotero-StaticSync exports the regular items inside that collection.

## Features

- Sync the currently selected Zotero collection from the collection context menu
- Export collection items as Markdown files with YAML frontmatter for static sites
- Push Markdown files directly to GitHub through the GitHub Contents API
- Upload a full collection payload to Supabase through the REST API
- Use collection path or library name as the exported status field
- Optionally include child notes in exported content
- Copy the generated share URL automatically after Supabase upload
- Supports personal libraries and group libraries as long as a normal collection is selected

## Installation

### Build from source

```bash
npm install
npm run build
```

After build, install the generated `.xpi` file in Zotero:

1. Open Zotero
2. Go to `Tools -> Plugins`
3. Click the gear icon
4. Choose `Install Plugin From File...`
5. Select the generated `.xpi`

Plugin display naming:

- Zotero plugin manager / install UI: `Zotero StaticSync`
- Zotero preference pane title: `StaticSync`

## How to use

### 1. Open plugin settings

In Zotero preferences, open the `StaticSync` pane and configure one of the following modes.

### 2. GitHub mode

Required fields:

- `GitHub repository`: repository in `owner/repo` format
- `GitHub token`: token with permission to write repository contents
- `Branch`: target branch, usually `main`
- `Content path`: target directory inside the repository, for example `content/reading`

In GitHub mode, each regular Zotero item becomes one Markdown file. The filename is built from the collection-derived status, sanitized title, and Zotero item key.

The generated frontmatter includes:

- `title`
- `slug`
- `summary`
- `description`
- `zotero_key`
- `date`
- `lastmod`
- `draft`
- `year`
- `status`
- `reading_status`
- `collection`
- `library`
- `categories`
- `zotero_collection_path`
- `zotero_collection_path_text`
- `zotero_collection`
- `zotero_library`
- `item_type`
- `zotero_item_type`
- `publication_title`
- `url`
- `source_url`
- `doi`
- `authors`
- `tags`

Recommended Hugo usage:

- `content/reading` for reading notes and literature digests
- `content/publication` if your site renders bibliographic items as publication pages
- `reading_status` can map to values such as `to-read`, `reading`, `reported`, or `archived`
- `categories` mirrors the Zotero collection path so Hugo taxonomy pages can group items automatically

Suggested Hugo frontmatter interpretation:

- `title`: page title shown in lists and article templates
- `slug`: stable URL segment and filename-safe identifier
- `summary`: short list excerpt for cards, list pages, RSS, and search indexes
- `description`: longer SEO or social preview description
- `status`: high-level pipeline label derived from collection path or library name
- `reading_status`: leaf collection label, useful for reading-progress taxonomies
- `collection` and `library`: direct labels for single-page metadata blocks
- `categories`: full Zotero collection path, useful for Hugo taxonomies and breadcrumbs
- `zotero_collection_path_text`: human-readable collection breadcrumb string
- `publication_title`, `doi`, `authors`, `tags`: bibliographic metadata for article layouts
- `source_url`: original literature landing page, separate from the page permalink

### 3. Supabase mode

Required fields:

- `Supabase URL`: your project URL, for example `https://xxx.supabase.co`
- `Supabase anon/public key`: the browser-safe key used by the REST API
- `Table name`: default is `shared_collections`
- `Share URL template`: optional URL used to build a user-facing share link

Share URL template behavior:

- If it contains `{id}`, the returned row identifier replaces `{id}`
- Otherwise the plugin appends `?id=<identifier>` to the URL
- If empty, the plugin returns the raw identifier from Supabase

During sync, the plugin asks for an optional password. The inserted payload includes collection name, library name, item count, exported literature data, source plugin name, and timestamp.

Important security note:

- Do not use the Supabase `service_role` key inside Zotero.
- Zotero runs in a browser-like environment, and Supabase may reject secret keys used from client-side requests.
- Use the `anon` / `public` key together with an RLS insert policy, or send writes through your own backend.

Minimum RLS setup for the plugin:

```sql
create policy "Enable insert for anonymous users"
on public.shared_collections
for insert
to anon
with check (true);
```

If you also deploy the public share frontend, add this read policy too:

```sql
create policy "Enable read for anonymous users"
on public.shared_collections
for select
to anon
using (true);
```

The current payload written by the plugin includes:

- `title`
- `collection_name`
- `collection_path`
- `collection_path_text`
- `library_name`
- `library_id`
- `password`
- `item_count`
- `literature_data`
- `status_source`
- `source`
- `schema_version`
- `created_at`
- `updated_at`

## Collection sync workflow

1. Select a Zotero collection
2. Right-click the collection
3. Choose `Sync Collection with Zotero-StaticSync`
4. If Supabase mode is active, optionally enter a password
5. Wait for the progress notification

If a collection contains no regular Zotero items, the plugin will stop without uploading anything.

## Export behavior

- Only regular Zotero items are exported
- Child attachments are ignored
- Child notes are optional and controlled by the `Include child notes` setting
- `Status Source = Collection` uses the full collection path
- `Status Source = Library` uses the Zotero library name

## Example Supabase schema

The plugin expects a table that can accept a payload like this:

```json
{
  "title": "Weekly Reading",
  "collection_name": "Weekly Reading",
  "collection_path": ["Research", "Weekly Reading"],
  "collection_path_text": "Research / Weekly Reading",
  "library_name": "My Library",
  "library_id": 1,
  "password": null,
  "item_count": 10,
  "literature_data": [],
  "status_source": "collection",
  "source": "Zotero-StaticSync",
  "schema_version": 1,
  "created_at": "2026-07-19T12:00:00.000Z",
  "updated_at": "2026-07-19T12:00:00.000Z"
}
```

To build a usable share URL, your table should return at least one of these fields after insert:

- `slug` (recommended)
- `id`
- `uuid`

The plugin sends `Prefer: return=representation`, so your Supabase REST insert response must return the inserted row representation. A ready-to-run reference schema is provided in:

```text
doc/supabase-schema.sql
```

The default SQL contract creates the `shared_collections` table, generates a stable `slug`, and updates `updated_at` automatically.
It also enables an RLS policy that allows inserts for the `anon` role, which is the expected browser-safe setup for Zotero.

## What you must prepare before using the `.xpi`

For GitHub mode:

- a GitHub repository you can write to
- a personal access token with content write permission for that repository
- a target branch such as `main`
- a Hugo content directory such as `content/reading` or `content/publication`

For Supabase mode:

- a Supabase project URL such as `https://your-project.supabase.co`
- the `anon` / `public` API key
- the `shared_collections` table created from `doc/supabase-schema.sql`
- the RLS insert policy for `anon` enabled on that table
- a share page URL template if you want end users to open a web page instead of only copying the returned identifier

If you want the generated share link to open a real page, also deploy the companion frontend project in:

```text
..\zotero-staticsync-share
```

That frontend expects the public route format:

```text
https://your-project.vercel.app/share/{id}
```

General requirements:

- Zotero must be able to reach GitHub or Supabase over the network
- install the generated `.xpi` from `.scaffold/build/zotero-static-sync.xpi`
- open Zotero preferences and configure exactly one sync mode before right-click syncing a collection

## Notes for static sites

GitHub mode is designed for content repositories where Markdown files are part of the site source tree. If you use Hugo, a common target path is:

```text
content/reading
```

You can render `status`, `reading_status`, `authors`, `categories`, and other frontmatter fields inside your templates.

## Development

```bash
npm install
npm run start
```

or build directly:

```bash
npm run build
```

## Debugging

- Use `Help -> Debug Output Logging` in Zotero to inspect runtime logs
- If GitHub sync fails, verify token scope and repository path
- If Supabase sync fails, verify REST access, table name, and returned identifier fields

## Changing the plugin icon

The current icon files are:

```text
addon/content/icons/favicon.png
addon/content/icons/favicon@0.5x.png
```

How to replace them:

1. Prepare a square PNG icon.
2. Replace `favicon.png` with the main icon, typically 96x96 or larger.
3. Replace `favicon@0.5x.png` with a matching smaller version, typically 48x48.
4. Rebuild the plugin with `npm run build`.
5. Reinstall the generated `.xpi` in Zotero.

The icon paths are declared in `addon/manifest.json`. If you want to use different filenames, update the `icons` section there as well.

## License

AGPL-3.0-or-later
