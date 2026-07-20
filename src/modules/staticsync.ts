import { config } from "../../package.json";
import { getPref, setPref } from "../utils/prefs";

export interface StaticSyncItem {
  key: string;
  slug: string;
  title: string;
  creators: string[];
  abstractNote: string;
  summary: string;
  description: string;
  date: string;
  year: string;
  url: string;
  doi: string;
  itemType: string;
  publicationTitle: string;
  status: string;
  readingStatus: string;
  libraryName: string;
  collectionName: string;
  collectionPath: string[];
  collectionPathText: string;
  tags: string[];
  selfUploaded?: boolean;
  note?: string;
}

export interface SyncSummary {
  successCount: number;
  failureCount: number;
  failures: string[];
  shareUrl?: string;
  exportName?: string;
}

// -- Helpers --------------------------------------------------

function getLibraryName(libraryID: number): string {
  if (libraryID === Zotero.Libraries.userLibraryID) return "My Library";
  const lib = Zotero.Libraries.get(libraryID) as { name?: string } | false;
  return lib && lib.name ? lib.name : `Library-${libraryID}`;
}

function getCollectionPath(collection: Zotero.Collection): string[] {
  const names: string[] = [];
  let cur: Zotero.Collection | false = collection;
  while (cur) {
    names.unshift(cur.name);
    cur = cur.parentID ? (Zotero.Collections.get(cur.parentID) as Zotero.Collection) : false;
  }
  return names;
}

function sanitizeSegment(input: string): string {
  return input.trim().toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5-_]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function extractYear(dateValue: string): string {
  const m = dateValue.match(/(\d{4})/);
  return m ? m[1] : "";
}

function normalizeText(input: string): string {
  return input.replace(/\r\n/g, "\n").trim();
}

function toSingleLine(input: string): string {
  return normalizeText(input).replace(/\s+/g, " ").trim();
}

function summarizeText(input: string, maxLength = 240): string {
  const text = toSingleLine(input);
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

async function readItemNote(item: Zotero.Item): Promise<string> {
  const noteIDs = item.getNotes();
  if (!noteIDs.length) return "";
  const notes = await Zotero.Items.getAsync(noteIDs);
  return notes
    .map((note) => {
      const raw = (note as Zotero.Item).getNote();
      return Zotero.Utilities.htmlSpecialChars(raw);
    })
    .join("\n\n")
    .trim();
}

function buildItemSlug(title: string, key: string): string {
  const titleSeg = sanitizeSegment(title) || "item";
  return `${titleSeg}-${key.toLowerCase()}`;
}

function normalizeShareURLTemplate(input: string): string {
  const value = input.trim();
  if (!value) return "";
  const mdMatch = value.match(/^\[(.*?)\]\((https?:\/\/[^)]+)\)(.*)$/i);
  if (mdMatch) {
    const [, label, href, suffix] = mdMatch;
    const normalizedSuffix = suffix || (label.includes("{id}") ? label.replace(href, "") : "");
    return `${href}${normalizedSuffix}`.trim();
  }
  return value;
}

// -- Export scope helpers ------------------------------------

interface ItemWithPath {
  item: Zotero.Item;
  collectionPath: string[];
}

async function collectAllCollectionsRecursive(col: Zotero.Collection): Promise<ItemWithPath[]> {
  const seen = new Set<string>();
  const result: ItemWithPath[] = [];
  const stack: { collection: Zotero.Collection }[] = [{ collection: col }];
  while (stack.length) {
    const { collection } = stack.pop()!;
    const colPath = getCollectionPath(collection);
    const items = await collection.getChildItems();
    for (const it of items) {
      if (it.isRegularItem() && !seen.has(it.key)) {
        seen.add(it.key);
        result.push({ item: it, collectionPath: colPath });
      }
    }
    const children = collection.getChildCollections() as Zotero.Collection[];
    for (const child of children) stack.push({ collection: child });
  }
  return result;
}

async function collectWholeLibrary(libraryID: number): Promise<Zotero.Item[]> {
  const all = await Zotero.Items.getAll(libraryID);
  return all.filter((it: Zotero.Item) => it.isRegularItem());
}

// -- Main class ----------------------------------------------

export class StaticSync {
  // -- Collection resolution ---------------------------------
  getSelectedCollection(): Zotero.Collection | undefined {
    const pane = Zotero.getActiveZoteroPane();
    return pane?.getSelectedCollection() || undefined;
  }

  resolveLibraryID(): number {
    const groupID = getPref("groupID").trim();
    if (groupID) {
      const groupLibID = Zotero.Groups.getLibraryIDFromGroupID(Number(groupID));
      if (groupLibID) return groupLibID;
      Zotero.debug(`Group ID ${groupID} not found, falling back to user library.`);
    }
    return Zotero.Libraries.userLibraryID;
  }

  // -- Item extraction ---------------------------------------
  private async buildItemData(
    item: Zotero.Item,
    collectionName: string,
    libraryName: string,
    collectionPath: string[],
    collectionPathText: string,
    status: string,
    readingStatus: string,
  ): Promise<StaticSyncItem> {
    const includeNotes = getPref("includeNotes");
    const date = item.getField("date") || "";
    const creators = item.getCreators().map((c) => {
      const first = c.firstName?.trim() || "";
      const last = c.lastName?.trim() || "";
      return [first, last].filter(Boolean).join(" ").trim();
    }).filter(Boolean);
    const tags = item.getTags().map((t) => t.tag).filter(Boolean);
    const selfUploaded = tags.includes("external-claim");
    const note = includeNotes ? await readItemNote(item) : "";
    const title = item.getField("title") || `Untitled-${item.key}`;
    const abstractNote = item.getField("abstractNote") || "";
    const descSource = abstractNote || note || title;
    return {
      key: item.key,
      slug: buildItemSlug(title, item.key),
      title,
      creators,
      abstractNote,
      summary: summarizeText(descSource, 220),
      description: summarizeText(descSource, 320),
      date,
      year: extractYear(date),
      url: item.getField("url") || "",
      doi: item.getField("DOI") || "",
      itemType: Zotero.ItemTypes.getName(item.itemTypeID),
      publicationTitle: item.getField("publicationTitle") || "",
      status,
      readingStatus,
      libraryName,
      collectionName,
      collectionPath,
      collectionPathText,
      tags,
      selfUploaded,
      note: note || undefined,
    };
  }

  // -- Export scope resolution -------------------------------
  async extractCollectionData(collection?: Zotero.Collection): Promise<{
    items: StaticSyncItem[];
    exportName: string;
    libName: string;
    colPath: string[];
    colPathText: string;
  }> {
    const statusField = getPref("statusField");
    const libraryID = this.resolveLibraryID();
    const libName = getLibraryName(libraryID);

    // --- Whole-library sync (no collection selected) ---
    if (!collection) {
      const libItems = await collectWholeLibrary(libraryID);
      const items: StaticSyncItem[] = [];
      for (const item of libItems) {
        const itemStatus = statusField === "library" ? libName : "Unfiled";
        items.push(await this.buildItemData(item, "Unfiled", libName, [], "", itemStatus, "Unfiled"));
      }
      return { items, exportName: libName, libName, colPath: [], colPathText: libName };
    }

    const colPathText = getCollectionPath(collection).join(" / ");
    const colPath = getCollectionPath(collection);

    // Always use collectionRecursive scope
    const itemsWithPath = await collectAllCollectionsRecursive(collection);
    const parentName = collection.name;
    const items: StaticSyncItem[] = [];
    for (const { item, collectionPath } of itemsWithPath) {
      const itemColName = collectionPath[collectionPath.length - 1] || parentName;
      const itemPathText = collectionPath.join(" / ") || itemColName;
      const itemStatus = statusField === "library" ? libName : itemPathText;
      items.push(await this.buildItemData(item, itemColName, libName, collectionPath, itemPathText, itemStatus, itemColName));
    }
    return { items, exportName: collection.name, libName, colPath, colPathText: colPathText || collection.name };
  }

  // -- Supabase share URL ------------------------------------
  buildSupabaseShareURL(identifier: string): string {
    const template = normalizeShareURLTemplate(getPref("shareBaseUrl"));
    if (!template) return identifier;
    const base = template.replace(/\/$/, "");
    if (base.includes("{id}")) return base.replace("{id}", encodeURIComponent(identifier));
    return `${base}?id=${encodeURIComponent(identifier)}`;
  }

  // -- Supabase push (with upsert by fixed slug) -------------
  async pushToSupabase(
    items: StaticSyncItem[],
    exportName: string,
    colPath: string[],
    colPathText: string,
    libName: string,
    libraryID: number,
  ): Promise<string> {
    const supabaseUrl = getPref("supabaseUrl").trim().replace(/\/$/, "");
    const supabaseKey = getPref("supabaseKey").trim();
    const table = getPref("supabaseTable").trim() || "shared_collections";
    if (!supabaseUrl || !supabaseKey) throw new Error("Supabase URL and key are required.");

    const syncProfile = getPref("syncProfile");
    const isCollaborative = syncProfile === "collaborative";

    // Resolve the slug: fixed slug only (no longer falls back to lastSyncedShareSlug)
    let slug = getPref("fixedShareSlug").trim();
    // If still empty, let the DB auto-generate it

    const payload: Record<string, unknown> = {
      title: exportName,
      collection_name: exportName,
      collection_path: colPath,
      collection_path_text: colPathText,
      library_name: libName,
      library_id: libraryID,
      password: getPref("defaultSharePassword").trim() || null,
      item_count: items.length,
      literature_data: items,
      status_source: getPref("statusField"),
      source: config.addonName,
      schema_version: 1,
      is_collaborative: isCollaborative,
      updated_at: new Date().toISOString(),
    };

    // If we have a fixed slug, include it; the trigger will sanitize it
    if (slug) payload.slug = slug;

    let identifier = "";

    // Try upsert: PATCH by slug, fall back to POST
    if (slug) {
      // Check if record exists
      const checkUrl = `${supabaseUrl}/rest/v1/${table}?slug=eq.${encodeURIComponent(slug)}&select=slug`;
      const checkResp = await fetch(`${checkUrl}`, {
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
      });
      if (checkResp.ok) {
        const existing = await checkResp.json();
        if (existing && (existing as unknown as Array<{ slug?: string }>).length) {
          // PATCH existing
          const patchUrl = `${supabaseUrl}/rest/v1/${table}?slug=eq.${encodeURIComponent(slug)}`;
          const patchResp = await fetch(patchUrl, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              Prefer: "return=representation",
            },
            body: JSON.stringify(payload),
          });
          if (!patchResp.ok) throw new Error(`Supabase update failed (${patchResp.status}): ${await patchResp.text()}`);
          const rows = (await patchResp.json()) as unknown as { slug?: string; id?: string }[];
          identifier = String(rows[0]?.slug || rows[0]?.id || slug);
        }
      }
    }

    // POST if no upsert happened
    if (!identifier) {
      if (slug) payload.created_at = new Date().toISOString();
      const postResp = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Prefer: "return=representation",
        },
        body: JSON.stringify(payload),
      });
      if (!postResp.ok) throw new Error(`Supabase sync failed (${postResp.status}): ${await postResp.text()}`);
      const rows = (await postResp.json()) as unknown as { slug?: string; id?: string; uuid?: string }[];
      const first = rows[0] || {};
      identifier = String(first.slug || first.id || first.uuid || "").trim();
    }

    if (!identifier) throw new Error("Supabase did not return a share identifier.");

    // Persist last-synced info for collaboration polling
    setPref("lastSyncedShareSlug", identifier);
    setPref("lastSyncedLibraryID", String(libraryID));
    // Persist last-synced collection key for collaboration polling
    const col = this.getSelectedCollection();
    if (col) setPref("lastSyncedCollectionKey", col.key);

    return this.buildSupabaseShareURL(identifier);
  }

  // -- Main sync entry ---------------------------------------
  async syncCollection(
    collection?: Zotero.Collection,
  ): Promise<SyncSummary> {
    const { items, exportName, libName, colPath, colPathText } = await this.extractCollectionData(collection);
    const libraryID = this.resolveLibraryID();

    if (!items.length) {
      return { successCount: 0, failureCount: 0, failures: [], exportName };
    }

    const shareUrl = await this.pushToSupabase(items, exportName, colPath, colPathText, libName, libraryID);
    return { successCount: items.length, failureCount: 0, failures: [], shareUrl, exportName };
  }
}

export const staticSync = new StaticSync();
