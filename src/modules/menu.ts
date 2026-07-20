import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { staticSync } from "./staticsync";
import { handleExportCsv } from "./csvexport";

const MENU_ID = "zotero-collectionmenu-staticsync";
const EXPORT_CSV_MENU_ID = "zotero-collectionmenu-staticsync-exportcsv";

function getCollectionMenuPopup(win: _ZoteroTypes.MainWindow) {
  return (
    win.document.getElementById("zotero-collections-tree-context-menu") ||
    win.document.getElementById("zotero-collectionmenu")
  ) as XUL.MenuPopup | null;
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

    const successText = result.shareUrl
      ? getString("zotero-staticsync-sync-success-supabase", {
          args: {
            count: result.successCount,
            url: result.shareUrl,
          },
        })
      : getString("zotero-staticsync-sync-success-github", {
          args: {
            count: result.successCount,
            collection: result.exportName || "",
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
  const popup = getCollectionMenuPopup(win);
  if (!popup || win.document.getElementById(MENU_ID)) {
    return;
  }

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

  popup.addEventListener("popupshowing", () => {
    const collection = staticSync.getSelectedCollection();
    const hidden = collection ? "false" : "true";
    menuItem.setAttribute("hidden", hidden);
    csvMenuItem.setAttribute("hidden", hidden);
  });

  popup.appendChild(menuItem);
  popup.appendChild(csvMenuItem);

  // Also register in the Zotero 7+ collection menu panel (for groups/libraries)
  const menuPanel = win.document.getElementById("zotero-collectionmenu");
  if (menuPanel && menuPanel !== popup) {
    const syncItemGroup = win.document.createXULElement("menuitem");
    syncItemGroup.id = MENU_ID + "-group";
    syncItemGroup.setAttribute("label", getString("zotero-staticsync-collection-menu-label"));
    syncItemGroup.addEventListener("command", () => {
      void handleSyncCommand(win);
    });

    const csvItemGroup = win.document.createXULElement("menuitem");
    csvItemGroup.id = EXPORT_CSV_MENU_ID + "-group";
    csvItemGroup.setAttribute("label", getString("zotero-staticsync-csv-menu-label"));
    csvItemGroup.addEventListener("command", () => {
      void handleExportCsv(win);
    });

    menuPanel.appendChild(syncItemGroup);
    menuPanel.appendChild(csvItemGroup);
  }
}

export function unregisterCollectionMenu(win: Window) {
  win.document.getElementById(MENU_ID)?.remove();
  win.document.getElementById(EXPORT_CSV_MENU_ID)?.remove();
  win.document.getElementById(MENU_ID + "-group")?.remove();
  win.document.getElementById(EXPORT_CSV_MENU_ID + "-group")?.remove();
}