import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { staticSync } from "./staticsync";

const MENU_ID = "zotero-collectionmenu-staticsync";

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

async function requestPassword(
  win: _ZoteroTypes.MainWindow,
): Promise<string | undefined> {
  const prompts = Services.prompt;
  const input = { value: "" };
  const checkState = { value: false };
  const accepted = prompts.prompt(
    win as unknown as mozIDOMWindowProxy,
    "Zotero-StaticSync",
    getString("zotero-staticsync-supabase-password-prompt"),
    input,
    "",
    checkState,
  );
  if (!accepted) {
    return undefined;
  }
  return input.value || "";
}

function formatFailureMessage(failures: string[]): string {
  return failures.slice(0, 5).join("\n");
}

async function handleSyncCommand(win: _ZoteroTypes.MainWindow) {
  const exportScope = getPref("exportScope") || "collection";
  const groupID = getPref("groupID").trim();

  // Validate groupID early if provided
  if (groupID) {
    const resolvedLibID = Zotero.Groups.getLibraryIDFromGroupID(Number(groupID));
    if (!resolvedLibID) {
      Zotero.alert(win, "Zotero-StaticSync", getString("zotero-staticsync-error-invalid-group-id"));
      return;
    }
  }

  // collection is optional for "library" export scope
  const collection = staticSync.getSelectedCollection();
  if (!collection && exportScope !== "library") {
    Zotero.alert(win, "Zotero-StaticSync", getString("zotero-staticsync-error-no-collection"));
    return;
  }

  const mode = getPref("mode");
  let password = "";
  if (mode === "supabase") {
    const value = await requestPassword(win);
    if (value === undefined) {
      return;
    }
    password = value;
  }

  const progressLabel = exportScope === "library"
    ? getString("zotero-staticsync-sync-progress-start-library")
    : getString("zotero-staticsync-sync-progress-start", {
        args: { collection: collection?.name || "" },
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
    const result = await staticSync.syncCollection(collection || undefined, { password });
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
      : (exportScope === "library"
        ? getString("zotero-staticsync-sync-success-github-library", {
            args: { count: result.successCount, library: result.exportName || "" },
          })
        : getString("zotero-staticsync-sync-success-github", {
            args: {
              count: result.successCount,
              collection: result.exportName || "",
            },
          }));

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

  const menuItem = win.document.createXULElement("menuitem");
  menuItem.id = MENU_ID;
  menuItem.setAttribute("label", getString("zotero-staticsync-collection-menu-label"));
  menuItem.addEventListener("command", () => {
    void handleSyncCommand(win);
  });

  popup.addEventListener("popupshowing", () => {
    const exportScope = getPref("exportScope") || "collection";
    // For library scope, always show the menu item
    // For collection scope, only show when a collection is selected
    const collection = exportScope === "library"
      ? { name: "" } // placeholder - always visible
      : staticSync.getSelectedCollection();
    menuItem.setAttribute("hidden", collection ? "false" : "true");
  });

  popup.appendChild(menuItem);
}

export function unregisterCollectionMenu(win: Window) {
  win.document.getElementById(MENU_ID)?.remove();
}
