import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { staticSync, type StaticSyncItem } from "./staticsync";

// -- Column definitions ----------------------------------------

interface CsvColumn {
  key: string;
  label: () => string;
}

const ALL_COLUMNS: CsvColumn[] = [
  { key: "key", label: () => getString("zotero-staticsync-csv-col-key") },
  { key: "itemType", label: () => getString("zotero-staticsync-csv-col-item-type") },
  { key: "title", label: () => getString("zotero-staticsync-csv-col-title") },
  { key: "authors", label: () => getString("zotero-staticsync-csv-col-authors") },
  { key: "publicationTitle", label: () => getString("zotero-staticsync-csv-col-publication-title") },
  { key: "year", label: () => getString("zotero-staticsync-csv-col-year") },
  { key: "date", label: () => getString("zotero-staticsync-csv-col-date") },
  { key: "doi", label: () => getString("zotero-staticsync-csv-col-doi") },
  { key: "url", label: () => getString("zotero-staticsync-csv-col-url") },
  { key: "abstractNote", label: () => getString("zotero-staticsync-csv-col-abstract-note") },
  { key: "tags", label: () => getString("zotero-staticsync-csv-col-tags") },
  { key: "collectionName", label: () => getString("zotero-staticsync-csv-col-collection-name") },
  { key: "libraryName", label: () => getString("zotero-staticsync-csv-col-library-name") },
];

const DEFAULT_COLUMNS = ["title"];

const VALID_KEYS = new Set(ALL_COLUMNS.map((c) => c.key));

// -- CSV helpers ------------------------------------------------

function escapeCsvCell(value: string): string {
  if (!value) return "";
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function formatAuthors(creators: string[]): string {
  return creators.join("; ");
}

function formatTags(tags: string[]): string {
  return tags.join("; ");
}

function resolveFieldValue(item: StaticSyncItem, field: string): string {
  switch (field) {
    case "authors":
      return formatAuthors(item.creators);
    case "tags":
      return formatTags(item.tags);
    default:
      return (item as unknown as Record<string, string>)[field] ?? "";
  }
}

function generateCsv(items: StaticSyncItem[], columnKeys: string[]): string {
  const lines: string[] = [];

  // Header row: sequence number + selected columns
  const headers = [
    getString("zotero-staticsync-csv-seq-number"),
    ...columnKeys.map((key) => {
      const col = ALL_COLUMNS.find((c) => c.key === key);
      return col ? col.label() : key;
    }),
  ];
  lines.push(headers.map(escapeCsvCell).join(","));

  // Data rows
  items.forEach((item, idx) => {
    const row = [
      String(idx + 1),
      ...columnKeys.map((key) => resolveFieldValue(item, key)),
    ];
    lines.push(row.map(escapeCsvCell).join(","));
  });

  return lines.join("\r\n");
}

// -- File picker ------------------------------------------------

async function pickSavePath(
  win: _ZoteroTypes.MainWindow,
  defaultName: string,
): Promise<string | false> {
  // Zotero 7+ uses BrowsingContext for nsIFilePicker.init
  // Try modern approach first (BrowsingContext), fall back to window
  const fp = Cc[
    "@mozilla.org/filepicker;1"
  ].createInstance(Ci.nsIFilePicker);

  try {
    // Zotero 7+ (Firefox 115 ESR+): first arg is BrowsingContext
    (fp as any).init(
      (win as any).browsingContext ?? (win as any).docShell,
      getString("zotero-staticsync-csv-export-progress"),
      Ci.nsIFilePicker.modeSave,
    );
  } catch {
    // Fallback for older Zotero: use Services.wm to get a proper parent window
    const parentWin = Services.wm.getMostRecentWindow("");
    (fp as any).init(
      parentWin,
      getString("zotero-staticsync-csv-export-progress"),
      Ci.nsIFilePicker.modeSave,
    );
  }
  fp.appendFilter("CSV Files (*.csv)", "*.csv");
  fp.appendFilter("All Files (*.*)", "*.*");
  fp.defaultString = defaultName;
  fp.defaultExtension = "csv";

  const result = await new Promise<number>((resolve) => {
    fp.open((status: number) => resolve(status));
  });

  if (result === Ci.nsIFilePicker.returnOK || result === Ci.nsIFilePicker.returnReplace) {
    return fp.file?.path || false;
  }
  return false;
}

// -- Main export handler -----------------------------------------

export async function handleExportCsv(win: _ZoteroTypes.MainWindow): Promise<void> {
  const collection = staticSync.getSelectedCollection();

  if (!collection) {
    Zotero.alert(
      win,
      "Zotero-StaticSync",
      getString("zotero-staticsync-error-no-collection"),
    );
    return;
  }

  // Parse column selection from preferences
  const csvColumnsPref = getPref("csvColumns") || "title";
  const columnKeys = csvColumnsPref
    .split(",")
    .map((k: string) => k.trim())
    .filter((k: string) => VALID_KEYS.has(k));

  if (columnKeys.length === 0) {
    columnKeys.push(...DEFAULT_COLUMNS);
  }

  const progress = new ztoolkit.ProgressWindow("Zotero-StaticSync", {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({
      text: getString("zotero-staticsync-csv-export-progress"),
      progress: 20,
    })
    .show();

  try {
    const { items, exportName } = await staticSync.extractCollectionData(
      collection,
    );

    if (!items.length) {
      progress.changeLine({
        progress: 100,
        text: getString("zotero-staticsync-error-empty-collection"),
        type: "warning",
      });
      progress.startCloseTimer(6000);
      return;
    }

    const csvContent = "﻿" + generateCsv(items, columnKeys);
    const defaultFileName = `${exportName || "export"}.csv`;

    const filePath = await pickSavePath(win, defaultFileName);
    if (!filePath) {
      progress.changeLine({
        progress: 100,
        text: getString("zotero-staticsync-csv-export-cancelled"),
        type: "fail",
      });
      progress.startCloseTimer(3000);
      return;
    }

    await IOUtils.writeUTF8(filePath, csvContent);

    progress.changeLine({
      progress: 100,
      text: getString("zotero-staticsync-csv-export-success", {
        args: { count: items.length },
      }),
      type: "success",
    });
    progress.startCloseTimer(5000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    progress.changeLine({
      progress: 100,
      text: getString("zotero-staticsync-csv-export-error", {
        args: { error: message },
      }),
      type: "error",
    });
    progress.startCloseTimer(10000);
  }
}