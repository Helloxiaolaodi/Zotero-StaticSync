import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { staticSync } from "./staticsync";
import { handleExportCsv } from "./csvexport";

const MENU_ID = "zotero-collectionmenu-staticsync";
const EXPORT_CSV_MENU_ID = "zotero-collectionmenu-staticsync-exportcsv";

function getCollectionMenuPopups(win: _ZoteroTypes.MainWindow): XUL.MenuPopup[] {
  const popups: XUL.MenuPopup[] = [];
  // Zotero 7+ uses zotero-collectionmenu for the collection tree context menu
  const ids = [
    "zotero-collectionmenu",
    "zotero-collections-tree-context-menu",
  ];
  for (const id of ids) {
    const el = win.document.getElementById(id) as XUL.MenuPopup | null;
    if (el && !popups.includes(el)) {
      popups.push(el);
    }
  }
  return popups;
}

function copyToClipboard(text: string) {
  const helperClass = (Components.classes as any)[
    "@mozilla.org/widget/clipboardhelper;1"
  ];
  const helper = helperClass.getService(
    Components.interfaces.nsIClipboardHelper,
  ) as nsIClipboardHelper;
  helper.copyString(text);
}

function formatFailureMessage(failures: string[]): string {
  return failures.slice(0, 5).join("\n");
}

async function handleSyncCommand(win: _ZoteroTypes.MainWindow) {
  const groupID = getPref("groupID").trim();

  // Validate groupID early if provided
  if (groupID) {
    const resolvedLibID = Zotero.Groups.getLibraryIDFromGroupID(Number(groupID));
    if (!resolvedLibID) {
      Zotero.alert(win, "Zotero-StaticSync", getString("zotero-staticsync-error-invalid-group-id"));
      return;
    }
  }

  const collection = staticSync.getSelectedCollection();
  if (!collection) {
    Zotero.alert(win, "Zotero-StaticSync", getString("zotero-staticsync-error-no-collection"));
    return;
  }

  const progressLabel = getString("zotero-staticsync-sync-progress-start", {
    args: { collection: collection.name },
  });

  const progress = new ztoolkit.ProgressWindow("Zotero-StaticSync", {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({
      text: progressLabel,
      progress: 20,
    })
    .show();

  try {
    const result = await staticSync.syncCollection(collection || undefined);
    if (!result.successCount && !result.failureCount) {
      progress.changeLine({
        progress: 100,
        text: getString("zotero-staticsync-error-empty-collection"),
        type: "warning",
      });
      progress.startCloseTimer(6000);
      return;
    }

    if (result.shareUrl && getPref("copyShareUrl")) {
      copyToClipboard(result.shareUrl);
    }

    const successText = getString("zotero-staticsync-sync-success-supabase", {
        args: {
          count: result.successCount,
          url: result.shareUrl || "",
        },
      });

    progress.changeLine({
      progress: 100,
      text: successText,
      type: result.failureCount ? "warning" : "success",
    });
    progress.startCloseTimer(8000);

    if (result.failureCount) {
      Zotero.alert(
        win,
        "Zotero-StaticSync",
        `${getString("zotero-staticsync-sync-partial-failure", {
          args: { count: result.failureCount },
        })}\n\n${formatFailureMessage(result.failures)}`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    progress.changeLine({
      progress: 100,
      text: message,
      type: "error",
    });
    progress.startCloseTimer(10000);
    Zotero.alert(win, "Zotero-StaticSync", message);
  }
}

export function registerCollectionMenu(win: _ZoteroTypes.MainWindow) {
  // Prevent duplicate registration across multiple windows/reloads
  if (win.document.getElementById(MENU_ID)) {
    return;
  }

  const popups = getCollectionMenuPopups(win);
  if (!popups.length) return;

  // Sync Collection menu item
  const menuItem = win.document.createXULElement("menuitem");
  menuItem.id = MENU_ID;
  menuItem.setAttribute("label", getString("zotero-staticsync-collection-menu-label"));
  menuItem.addEventListener("command", () => {
    void handleSyncCommand(win);
  });

  // Export CSV menu item
  const csvMenuItem = win.document.createXULElement("menuitem");
  csvMenuItem.id = EXPORT_CSV_MENU_ID;
  csvMenuItem.setAttribute("label", getString("zotero-staticsync-csv-menu-label"));
  csvMenuItem.addEventListener("command", () => {
    void handleExportCsv(win);
  });

  const updateVisibility = () => {
    const collection = staticSync.getSelectedCollection();
    const hidden = collection ? "false" : "true";
    menuItem.setAttribute("hidden", hidden);
    csvMenuItem.setAttribute("hidden", hidden);
  };

  // Add menu items to ALL found popup menus (personal + group collections)
  for (const popup of popups) {
    popup.appendChild(menuItem);
    popup.appendChild(csvMenuItem);
    popup.addEventListener("popupshowing", updateVisibility);
    break; // only append the actual elements to the first popup; clone for others
  }

  // Clone items for additional popups (if both context menu and panel exist)
  for (let i = 1; i < popups.length; i++) {
    const syncClone = win.document.createXULElement("menuitem");
    syncClone.id = MENU_ID + "-" + i;
    syncClone.setAttribute("label", getString("zotero-staticsync-collection-menu-label"));
    syncClone.addEventListener("command", () => {
      void handleSyncCommand(win);
    });

    const csvClone = win.document.createXULElement("menuitem");
    csvClone.id = EXPORT_CSV_MENU_ID + "-" + i;
    csvClone.setAttribute("label", getString("zotero-staticsync-csv-menu-label"));
    csvClone.addEventListener("command", () => {
      void handleExportCsv(win);
    });

    popups[i].appendChild(syncClone);
    popups[i].appendChild(csvClone);
    popups[i].addEventListener("popupshowing", updateVisibility);
  }
}

export function unregisterCollectionMenu(win: Window) {
  // Remove the main menu items and any clones
  win.document.getElementById(MENU_ID)?.remove();
  win.document.getElementById(EXPORT_CSV_MENU_ID)?.remove();
  // Remove clones (id pattern: MENU_ID-0, MENU_ID-1, etc.)
  for (let i = 0; i < 10; i++) {
    win.document.getElementById(`${MENU_ID}-${i}`)?.remove();
    win.document.getElementById(`${EXPORT_CSV_MENU_ID}-${i}`)?.remove();
  }
}