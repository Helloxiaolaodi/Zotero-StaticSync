import { config } from "../../package.json";
import { getPref } from "../utils/prefs";

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
  note?: string;
}

export interface SyncSummary {
  successCount: number;
  failureCount: number;
  failures: string[];
  shareUrl?: string;
}

interface GitHubCommitBody {
  message: string;
  content: string;
  branch: string;
  sha?: string;
}

interface SupabaseInsertResult {
  id?: string | number;
  slug?: string;
  uuid?: string;
}

function getLibraryName(libraryID: number): string {
  if (libraryID === Zotero.Libraries.userLibraryID) {
    return "My Library";
  }
  const library = Zotero.Libraries.get(libraryID) as
    | { name?: string }
    | false;
  return library && library.name ? library.name : `Library-${libraryID}`;
}

function getCollectionPath(collection: Zotero.Collection): string[] {
  const names: string[] = [];
  let current: Zotero.Collection | false = collection;
  while (current) {
    names.unshift(current.name);
    current = current.parentID
      ? (Zotero.Collections.get(current.parentID) as Zotero.Collection)
      : false;
  }
  return names;
}

function sanitizeSegment(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5-_]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function yamlEscape(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function extractYear(dateValue: string): string {
  const match = dateValue.match(/(\d{4})/);
  return match ? match[1] : "";
}

function normalizeText(input: string): string {
  return input.replace(/\r\n/g, "\n").trim();
}

function toSingleLine(input: string): string {
  return normalizeText(input).replace(/\s+/g, " ").trim();
}

function summarizeText(input: string, maxLength = 240): string {
  const text = toSingleLine(input);
  if (!text) {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

function yamlList(values: string[]): string {
  return `[${values.map((value) => `"${yamlEscape(value)}"`).join(", ")}]`;
}

function base64EncodeUnicode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function readItemNote(item: Zotero.Item): Promise<string> {
  const noteIDs = item.getNotes();
  if (!noteIDs.length) {
    return "";
  }
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
  const titleSegment = sanitizeSegment(title) || "item";
  return `${titleSegment}-${key.toLowerCase()}`;
}

export class StaticSync {
  getSelectedCollection(): Zotero.Collection | undefined {
    const pane = Zotero.getActiveZoteroPane();
    return pane?.getSelectedCollection() || undefined;
  }

  async extractCollectionData(
    collection: Zotero.Collection,
  ): Promise<StaticSyncItem[]> {
    const items = await collection.getChildItems();
    const includeNotes = getPref("includeNotes");
    const statusField = getPref("statusField");
    const collectionPath = getCollectionPath(collection);
    const collectionName = collection.name;
    const libraryName = getLibraryName(collection.libraryID);
    const collectionPathText = collectionPath.join(" / ") || collectionName;
    const readingStatus = collectionPath[collectionPath.length - 1] || collectionName;
    const status =
      statusField === "library"
        ? libraryName
        : collectionPathText;

    const regularItems = items.filter((item) => item.isRegularItem());
    const output: StaticSyncItem[] = [];

    for (const item of regularItems) {
      const date = item.getField("date") || "";
      const creators = item
        .getCreators()
        .map((creator) => {
          const first = creator.firstName?.trim() || "";
          const last = creator.lastName?.trim() || "";
          return [first, last].filter(Boolean).join(" ").trim();
        })
        .filter(Boolean);
      const tags = item.getTags().map((tag) => tag.tag).filter(Boolean);
      const note = includeNotes ? await readItemNote(item) : "";
      const title = item.getField("title") || `Untitled-${item.key}`;
      const abstractNote = item.getField("abstractNote") || "";
      const descriptionSource = abstractNote || note || title;
      output.push({
        key: item.key,
        slug: buildItemSlug(title, item.key),
        title,
        creators,
        abstractNote,
        summary: summarizeText(descriptionSource, 220),
        description: summarizeText(descriptionSource, 320),
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
        note: note || undefined,
      });
    }

    return output;
  }

  convertToHugoMarkdown(item: StaticSyncItem): string {
    const frontmatter = [
      "---",
      `title: \"${yamlEscape(item.title)}\"`,
      `slug: \"${yamlEscape(item.slug)}\"`,
      `summary: \"${yamlEscape(item.summary)}\"`,
      `description: \"${yamlEscape(item.description)}\"`,
      `zotero_key: \"${item.key}\"`,
      `date: \"${yamlEscape(item.date)}\"`,
      `lastmod: \"${new Date().toISOString()}\"`,
      "draft: false",
      `year: \"${yamlEscape(item.year)}\"`,
      `status: \"${yamlEscape(item.status)}\"`,
      `reading_status: \"${yamlEscape(item.readingStatus)}\"`,
      `collection: \"${yamlEscape(item.collectionName)}\"`,
      `library: \"${yamlEscape(item.libraryName)}\"`,
      `categories: ${yamlList(item.collectionPath)}`,
      `zotero_collection_path: ${yamlList(item.collectionPath)}`,
      `zotero_collection_path_text: \"${yamlEscape(item.collectionPathText)}\"`,
      `zotero_collection: \"${yamlEscape(item.collectionName)}\"`,
      `zotero_library: \"${yamlEscape(item.libraryName)}\"`,
      `item_type: \"${yamlEscape(item.itemType)}\"`,
      `zotero_item_type: \"${yamlEscape(item.itemType)}\"`,
      `publication_title: \"${yamlEscape(item.publicationTitle)}\"`,
      `url: \"${yamlEscape(item.url)}\"`,
      `source_url: \"${yamlEscape(item.url)}\"`,
      `doi: \"${yamlEscape(item.doi)}\"`,
      `authors: ${yamlList(item.creators)}`,
      `tags: ${yamlList(item.tags)}`,
      "---",
      "",
    ];
    const body: string[] = [];
    if (item.abstractNote) {
      body.push(normalizeText(item.abstractNote));
      body.push("");
    }
    if (item.note) {
      body.push("## Notes");
      body.push("");
      body.push(normalizeText(item.note));
      body.push("");
    }
    return [...frontmatter, ...body].join("\n");
  }

  getGitHubFilePath(item: StaticSyncItem): string {
    const basePath = getPref("githubContentPath").replace(/^\/+|\/+$/g, "");
    const statusSegment = sanitizeSegment(item.status) || "collection";
    return `${basePath}/${statusSegment}-${item.slug}.md`;
  }

  async pushToGitHub(item: StaticSyncItem): Promise<void> {
    const repo = getPref("githubRepo").trim();
    const token = getPref("githubToken").trim();
    const branch = getPref("githubBranch").trim() || "main";
    if (!repo || !token) {
      throw new Error("GitHub repository and token are required.");
    }

    const path = this.getGitHubFilePath(item);
    const apiURL = `https://api.github.com/repos/${repo}/contents/${path}`;
    const markdown = this.convertToHugoMarkdown(item);
    const body: GitHubCommitBody = {
      message: `StaticSync: sync ${item.title}`,
      content: base64EncodeUnicode(markdown),
      branch,
    };

    const existingResponse = await fetch(apiURL, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
      },
    });

    if (existingResponse.ok) {
      const existing = (await existingResponse.json()) as { sha?: string };
      if (existing.sha) {
        body.sha = existing.sha;
      }
    } else if (existingResponse.status !== 404) {
      throw new Error(
        `GitHub lookup failed with status ${existingResponse.status}.`,
      );
    }

    const response = await fetch(apiURL, {
      method: "PUT",
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`GitHub sync failed (${response.status}): ${message}`);
    }
  }

  buildSupabaseShareURL(identifier: string): string {
    const shareBaseURL = getPref("shareBaseUrl").trim();
    if (!shareBaseURL) {
      return identifier;
    }
    const base = shareBaseURL.replace(/\/$/, "");
    if (base.includes("{id}")) {
      return base.replace("{id}", encodeURIComponent(identifier));
    }
    return `${base}?id=${encodeURIComponent(identifier)}`;
  }

  async pushToSupabase(
    collection: Zotero.Collection,
    items: StaticSyncItem[],
    password: string,
  ): Promise<string> {
    const supabaseUrl = getPref("supabaseUrl").trim().replace(/\/$/, "");
    const supabaseKey = getPref("supabaseKey").trim();
    const table = getPref("supabaseTable").trim() || "shared_collections";
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Supabase URL and key are required.");
    }

    const payload = {
      title: collection.name,
      collection_name: collection.name,
      collection_path: getCollectionPath(collection),
      collection_path_text: getCollectionPath(collection).join(" / "),
      library_name: getLibraryName(collection.libraryID),
      library_id: collection.libraryID,
      password: password.trim() || null,
      item_count: items.length,
      literature_data: items,
      status_source: getPref("statusField"),
      source: config.addonName,
      schema_version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const response = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Supabase sync failed (${response.status}): ${message}`);
    }

    const rows = (await response.json()) as unknown as SupabaseInsertResult[];
    const first = rows[0] || {};
    const identifier = String(first.slug || first.id || first.uuid || "").trim();
    if (!identifier) {
      throw new Error(
        "Supabase did not return a share identifier. The inserted row must return slug, id, or uuid.",
      );
    }
    return this.buildSupabaseShareURL(identifier);
  }

  async syncCollection(
    collection: Zotero.Collection,
    options?: { password?: string },
  ): Promise<SyncSummary> {
    const items = await this.extractCollectionData(collection);
    if (!items.length) {
      return {
        successCount: 0,
        failureCount: 0,
        failures: [],
      };
    }

    const mode = getPref("mode");
    if (mode === "supabase") {
      const shareUrl = await this.pushToSupabase(
        collection,
        items,
        options?.password || "",
      );
      return {
        successCount: items.length,
        failureCount: 0,
        failures: [],
        shareUrl,
      };
    }

    let successCount = 0;
    const failures: string[] = [];
    for (const item of items) {
      try {
        await this.pushToGitHub(item);
        successCount += 1;
      } catch (error) {
        failures.push(
          `${item.title}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return {
      successCount,
      failureCount: failures.length,
      failures,
    };
  }
}

export const staticSync = new StaticSync();
