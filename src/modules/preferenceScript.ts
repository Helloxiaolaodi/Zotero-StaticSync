import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";

type SyncMode = "github" | "supabase";

function query<T extends Element>(selector: string): T | null {
  return addon.data.prefs?.window.document.querySelector(selector) as T | null;
}

function normalizeMode(value: string | undefined | null): SyncMode {
  return value === "supabase" ? "supabase" : "github";
}

function syncModeSections(mode: SyncMode) {
  const githubBox = query<HTMLElement>(`#${config.addonRef}-github-settings`);
  const supabaseBox = query<HTMLElement>(`#${config.addonRef}-supabase-settings`);
  if (!githubBox || !supabaseBox) {
    return;
  }
  githubBox.hidden = mode !== "github";
  supabaseBox.hidden = mode !== "supabase";
}

function getSelectedMode(select: XUL.MenuList): SyncMode {
  const value =
    (select.value as string) ||
    select.getAttribute("value") ||
    (getPref("mode") as string);
  return normalizeMode(value);
}

function bindModeToggle() {
  const select = query<XUL.MenuList>(`#zotero-prefpane-${config.addonRef}-mode`);
  if (!select || select.getAttribute("data-bound") === "true") {
    return;
  }
  select.setAttribute("data-bound", "true");

  const applyMode = () => {
    syncModeSections(getSelectedMode(select));
  };

  applyMode();
  addon.data.prefs?.window.setTimeout(applyMode, 0);

  select.addEventListener("command", applyMode);
  select.addEventListener("change", applyMode);
  select.addEventListener("select", applyMode);
}

function updateStaticText() {
  const statusHint = query<HTMLElement>(`#${config.addonRef}-status-hint`);
  if (statusHint) {
    statusHint.textContent = getString("pref-status-field-help");
  }

  const shareHint = query<HTMLElement>(`#${config.addonRef}-share-url-hint`);
  if (shareHint) {
    shareHint.textContent = getString("pref-share-base-url-help");
  }
}

export async function registerPrefsScripts(_window: Window) {
  addon.data.prefs = {
    window: _window,
  };
  updateStaticText();
  bindModeToggle();
}
