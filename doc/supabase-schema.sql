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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.shared_collections is
  'Collection-level share payloads inserted by the Zotero StaticSync plugin.';

comment on column public.shared_collections.slug is
  'Primary public share identifier returned to Zotero and recommended for share URLs.';

comment on column public.shared_collections.literature_data is
  'Array of exported Zotero items including bibliographic metadata, tags, notes, and frontmatter-ready fields.';

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

-- Optional public-read policy for a browser-facing share page frontend.
-- Run this only if you intentionally want public share pages to read rows with the anon key.
--
-- drop policy if exists "Enable read for anonymous users" on public.shared_collections;
-- create policy "Enable read for anonymous users"
-- on public.shared_collections
-- for select
-- to anon
-- using (true);

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
--     literature_data, created_at, updated_at
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
--   "created_at": "2026-07-19T12:00:00.000Z",
--   "updated_at": "2026-07-19T12:00:00.000Z"
-- }
