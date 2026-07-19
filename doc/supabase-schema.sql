create extension if not exists pgcrypto;

create table if not exists public.shared_collections (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  collection_name text not null,
  collection_path jsonb not null default '[]'::jsonb,
  collection_path_text text not null default '',
  library_name text,
  library_id bigint,
  password text,
  item_count integer not null default 0,
  literature_data jsonb not null default '[]'::jsonb,
  status_source text not null default 'collection',
  source text,
  schema_version integer not null default 1,
  is_collaborative boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shared_collections add column if not exists title text;
alter table public.shared_collections add column if not exists collection_name text;
alter table public.shared_collections add column if not exists collection_path jsonb;
alter table public.shared_collections add column if not exists collection_path_text text;
alter table public.shared_collections add column if not exists library_name text;
alter table public.shared_collections add column if not exists library_id bigint;
alter table public.shared_collections add column if not exists password text;
alter table public.shared_collections add column if not exists item_count integer;
alter table public.shared_collections add column if not exists literature_data jsonb;
alter table public.shared_collections add column if not exists status_source text;
alter table public.shared_collections add column if not exists source text;
alter table public.shared_collections add column if not exists schema_version integer;
alter table public.shared_collections add column if not exists is_collaborative boolean;
alter table public.shared_collections add column if not exists created_at timestamptz;
alter table public.shared_collections add column if not exists updated_at timestamptz;

alter table public.shared_collections alter column title set default '';
alter table public.shared_collections alter column collection_name set default '';
alter table public.shared_collections alter column collection_path set default '[]'::jsonb;
alter table public.shared_collections alter column collection_path_text set default '';
alter table public.shared_collections alter column item_count set default 0;
alter table public.shared_collections alter column literature_data set default '[]'::jsonb;
alter table public.shared_collections alter column status_source set default 'collection';
alter table public.shared_collections alter column schema_version set default 1;
alter table public.shared_collections alter column is_collaborative set default false;
alter table public.shared_collections alter column created_at set default now();
alter table public.shared_collections alter column updated_at set default now();

update public.shared_collections
set
  title = coalesce(nullif(title, ''), coalesce(collection_name, 'Untitled Collection')),
  collection_name = coalesce(nullif(collection_name, ''), coalesce(title, 'Untitled Collection')),
  collection_path = coalesce(collection_path, '[]'::jsonb),
  collection_path_text = coalesce(collection_path_text, ''),
  item_count = coalesce(item_count, 0),
  literature_data = coalesce(literature_data, '[]'::jsonb),
  status_source = coalesce(status_source, 'collection'),
  schema_version = coalesce(schema_version, 1),
  is_collaborative = coalesce(is_collaborative, false),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

comment on table public.shared_collections is
  'Collection-level share payloads inserted by the Zotero StaticSync plugin.';

comment on column public.shared_collections.slug is
  'Primary public share identifier returned to Zotero and recommended for share URLs.';

comment on column public.shared_collections.literature_data is
  'Array of exported Zotero items including bibliographic metadata, tags, notes, and frontmatter-ready fields.';

comment on column public.shared_collections.is_collaborative is
  'When true, the share page should render collaboration controls (claim/report/add-by-DOI).';

create index if not exists idx_shared_collections_slug
  on public.shared_collections (slug);

create index if not exists idx_shared_collections_created_at
  on public.shared_collections (created_at desc);

create or replace function public.zotero_staticsync_slugify(input text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(input, 'shared-collection')), '[^a-z0-9]+', '-', 'g'))
$$;

create or replace function public.zotero_staticsync_fill_shared_collection_fields()
returns trigger
language plpgsql
as $$
declare
  slug_base text;
begin
  if new.slug is null or btrim(new.slug) = '' then
    slug_base := public.zotero_staticsync_slugify(coalesce(new.collection_name, new.title));
    if slug_base = '' then
      slug_base := 'shared-collection';
    end if;
    new.slug := slug_base || '-' || substr(replace(new.id::text, '-', ''), 1, 8);
  else
    new.slug := public.zotero_staticsync_slugify(new.slug);
  end if;

  if new.collection_path is null then
    new.collection_path := '[]'::jsonb;
  end if;

  if new.collection_path_text is null then
    new.collection_path_text := '';
  end if;

  if new.updated_at is null then
    new.updated_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_shared_collections_fill_fields on public.shared_collections;

create trigger trg_shared_collections_fill_fields
before insert or update on public.shared_collections
for each row
execute function public.zotero_staticsync_fill_shared_collection_fields();

create or replace function public.zotero_staticsync_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_shared_collections_touch_updated_at on public.shared_collections;

create trigger trg_shared_collections_touch_updated_at
before update on public.shared_collections
for each row
execute function public.zotero_staticsync_touch_updated_at();

alter table public.shared_collections enable row level security;

drop policy if exists "Allow insert for service role" on public.shared_collections;
drop policy if exists "Enable insert for anonymous users" on public.shared_collections;
create policy "Enable insert for anonymous users"
on public.shared_collections
for insert
to anon
with check (true);

drop policy if exists "Allow read for authenticated users" on public.shared_collections;
create policy "Allow read for authenticated users"
on public.shared_collections
for select
to authenticated
using (true);

drop policy if exists "Enable read for anonymous users" on public.shared_collections;
create policy "Enable read for anonymous users"
on public.shared_collections
for select
to anon
using (true);

create table if not exists public.shared_collection_actions (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  action_type text not null,
  source_slug text not null references public.shared_collections(slug) on delete cascade,
  item_key text,
  item_title text,
  doi text,
  reporter_name text,
  report_date text,
  processed boolean not null default false
);

alter table public.shared_collection_actions add column if not exists created_at timestamptz;
alter table public.shared_collection_actions add column if not exists action_type text;
alter table public.shared_collection_actions add column if not exists source_slug text;
alter table public.shared_collection_actions add column if not exists item_key text;
alter table public.shared_collection_actions add column if not exists item_title text;
alter table public.shared_collection_actions add column if not exists doi text;
alter table public.shared_collection_actions add column if not exists reporter_name text;
alter table public.shared_collection_actions add column if not exists report_date text;
alter table public.shared_collection_actions add column if not exists processed boolean;

alter table public.shared_collection_actions alter column created_at set default now();
alter table public.shared_collection_actions alter column processed set default false;

update public.shared_collection_actions
set
  created_at = coalesce(created_at, now()),
  processed = coalesce(processed, false);

comment on table public.shared_collection_actions is
  'Pending actions from collaboration share pages processed by the Zotero StaticSync plugin.';

comment on column public.shared_collection_actions.action_type is
  'One of: claim, undo_claim, report, add_by_doi, undo_add.';

comment on column public.shared_collection_actions.processed is
  'Set to true after the Zotero plugin has applied the action locally.';

create index if not exists idx_shared_collection_actions_processed
  on public.shared_collection_actions (processed, source_slug, created_at);

alter table public.shared_collection_actions enable row level security;

drop policy if exists "Enable insert for anon on actions" on public.shared_collection_actions;
create policy "Enable insert for anon on actions"
on public.shared_collection_actions
for insert
to anon
with check (true);

drop policy if exists "Enable select for anon on actions" on public.shared_collection_actions;
create policy "Enable select for anon on actions"
on public.shared_collection_actions
for select
to anon
using (true);

drop policy if exists "Enable update for anon on actions" on public.shared_collection_actions;
create policy "Enable update for anon on actions"
on public.shared_collection_actions
for update
to anon
using (true)
with check (true);

-- Returned field contract for Zotero-StaticSync
--
-- Zotero runs in a browser-like runtime. Do not use the Supabase service_role key
-- in the plugin settings. Use the anon/public key together with the INSERT policy
-- above, or route writes through your own trusted backend.
--
-- The plugin inserts rows through:
--   POST /rest/v1/shared_collections
--   Prefer: return=representation
--
-- Recommended returned fields:
--   slug text      -- preferred share identifier
--   id uuid        -- accepted fallback
--   uuid text      -- accepted fallback if your table/view exposes it
--
-- Frontend expectations for public share pages:
--   route: /share/[slug]
--   lookup field: slug
--   visible metadata commonly rendered:
--     collection_name, collection_path_text, library_name, item_count,
--     literature_data, created_at, updated_at, is_collaborative
--
-- Recommended literature_data item shape written by the plugin:
-- {
--   "key": "ABCD1234",
--   "slug": "paper-title-abcd1234",
--   "title": "Paper Title",
--   "creators": ["First Author", "Second Author"],
--   "abstractNote": "Long abstract...",
--   "summary": "Short summary for cards and previews.",
--   "description": "Longer summary for metadata and page descriptions.",
--   "date": "2025-03-01",
--   "year": "2025",
--   "url": "https://example.org/paper",
--   "doi": "10.1000/example",
--   "itemType": "journalArticle",
--   "publicationTitle": "Journal of Examples",
--   "status": "Research / Weekly Reading",
--   "readingStatus": "Weekly Reading",
--   "libraryName": "My Library",
--   "collectionName": "Weekly Reading",
--   "collectionPath": ["Research", "Weekly Reading"],
--   "collectionPathText": "Research / Weekly Reading",
--   "tags": ["microbiome", "review"],
--   "note": "Optional exported child note content"
-- }
--
-- Minimum payload written by the plugin:
-- {
--   "title": "Weekly Reading",
--   "collection_name": "Weekly Reading",
--   "collection_path": ["Research", "Weekly Reading"],
--   "collection_path_text": "Research / Weekly Reading",
--   "library_name": "My Library",
--   "library_id": 1,
--   "password": null,
--   "item_count": 10,
--   "literature_data": [ ... item records ... ],
--   "status_source": "collection",
--   "source": "Zotero-StaticSync",
--   "schema_version": 1,
--   "is_collaborative": false,
--   "created_at": "2026-07-19T12:00:00.000Z",
--   "updated_at": "2026-07-19T12:00:00.000Z"
-- }
