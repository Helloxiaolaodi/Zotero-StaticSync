import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";

type SyncMode = "github" | "supabase";
type SyncProfile = "static" | "collaborative";

function query<T extends Element>(selector: string): T | null {
  return addon.data.prefs?.window.document.querySelector(selector) as T | null;
}

function normalizeMode(value: string | undefined | null): SyncMode {
  return value === "supabase" ? "supabase" : "github";
}

function normalizeProfile(value: string | undefined | null): SyncProfile {
  return value === "collaborative" ? "collaborative" : "static";
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

function syncProfileSections(profile: SyncProfile) {
  const collabBox = query<HTMLElement>(`#${config.addonRef}-collaboration-settings`);
  if (collabBox) {
    collabBox.hidden = profile !== "collaborative";
  }
}

function getSelectedMode(select: XUL.MenuList): SyncMode {
  const value =
    (select.value as string) ||
    select.getAttribute("value") ||
    (getPref("mode") as string);
  return normalizeMode(value);
}

function getSelectedProfile(select: XUL.MenuList): SyncProfile {
  const value =
    (select.value as string) ||
    select.getAttribute("value") ||
    (getPref("syncProfile") as string);
  return normalizeProfile(value);
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

function bindSyncProfileToggle() {
  const select = query<XUL.MenuList>(`#zotero-prefpane-${config.addonRef}-syncProfile`);
  if (!select || select.getAttribute("data-bound") === "true") {
    return;
  }
  select.setAttribute("data-bound", "true");

  const applyProfile = () => {
    syncProfileSections(getSelectedProfile(select));
  };

  applyProfile();
  addon.data.prefs?.window.setTimeout(applyProfile, 0);

  select.addEventListener("command", applyProfile);
  select.addEventListener("change", applyProfile);
  select.addEventListener("select", applyProfile);
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

  const exportScopeHint = query<HTMLElement>(`#${config.addonRef}-export-scope-hint`);
  if (exportScopeHint) {
    exportScopeHint.textContent = getString("pref-export-scope-help");
  }

  const groupHint = query<HTMLElement>(`#${config.addonRef}-group-id-hint`);
  if (groupHint) {
    groupHint.textContent = getString("pref-group-id-help");
  }

  const fixedSlugHint = query<HTMLElement>(`#${config.addonRef}-fixed-slug-hint`);
  if (fixedSlugHint) {
    fixedSlugHint.textContent = getString("pref-fixed-slug-help");
  }

  const syncProfileHint = query<HTMLElement>(`#${config.addonRef}-sync-profile-hint`);
  if (syncProfileHint) {
    syncProfileHint.textContent = getString("pref-sync-profile-help");
  }

  const pollIntervalHint = query<HTMLElement>(`#${config.addonRef}-poll-interval-hint`);
  if (pollIntervalHint) {
    pollIntervalHint.textContent = getString("pref-poll-interval-help");
  }

  const defaultPasswordHint = query<HTMLElement>(`#${config.addonRef}-default-password-hint`);
  if (defaultPasswordHint) {
    defaultPasswordHint.textContent = getString("pref-default-password-help");
  }
}

export async function registerPrefsScripts(_window: Window) {
  addon.data.prefs = {
    window: _window, columns: [], rows: [] };
  updateStaticText();
  bindModeToggle();
  bindSyncProfileToggle();
}
