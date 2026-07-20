import { getPref, setPref } from "../utils/prefs";
import { staticSync } from "./staticsync";

interface PendingAction {
  id: number;
  created_at: string;
  action_type: string;
  item_key?: string;
  item_title?: string;
  doi?: string;
  reporter_name?: string;
  report_date?: string;
  source_slug: string;
  processed: boolean;
}

export class CollaborationManager {
  private polling = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private immediatePollScheduled = false;

  private buildRestURL(): string {
    const url = getPref("supabaseUrl").trim().replace(/\/$/, "");
    const key = getPref("supabaseKey").trim();
    const table = getPref("supabaseActionsTable").trim() || "shared_collection_actions";
    if (!url || !key) throw new Error("Supabase URL and key required for collaboration polling.");
    return `${url}/rest/v1/${table}`;
  }

  /** Fetch unprocessed actions from Supabase. */
  private async fetchPendingActions(): Promise<PendingAction[]> {
    const key = getPref("supabaseKey").trim();
    const base = this.buildRestURL();
    const latestSlug = getPref("lastSyncedShareSlug").trim();
    const filterAppend = latestSlug ? ('&source_slug=eq.' + encodeURIComponent(latestSlug)) : '';
    const url = `${base}?processed=eq.false${filterAppend}&order=created_at.asc&limit=20`;
    const resp = await fetch(url, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
    if (!resp.ok) throw new Error(`Fetch actions failed (${resp.status}): ${await resp.text()}`);
    return (await resp.json()) as unknown as PendingAction[];
  }

  /** Mark an action as processed. */
  private async markProcessed(action: PendingAction): Promise<void> {
    const key = getPref("supabaseKey").trim();
    const base = this.buildRestURL();
    const url = `${base}?id=eq.${action.id}`;
    const resp = await fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ processed: true }),
    });
    if (!resp.ok) {
      Zotero.debug(`Collaboration: failed to mark action ${action.id} processed: ${resp.status}`);
    }
  }

  /** Process one action against the local Zotero database. */
  private async processAction(action: PendingAction): Promise<void> {
    const claimedName = getPref("claimedCollectionName") || "Claimed";
    const reportedName = getPref("reportedCollectionName") || "Reported";
    const pendingName = getPref("pendingCollectionName") || "To Read";

    Zotero.debug(`Collaboration: processing action ${action.action_type} for ${action.item_title || action.item_key}`);

    switch (action.action_type) {
      case "claim": {
        if (!action.item_key) break;
        const item = await this.findItemByKey(action.item_key);
        if (!item) break;
        // Tag the item
        item.addTag("auto_claimed");
        if (action.reporter_name) item.addTag(`claimed_by:${action.reporter_name}`);
        if (action.report_date) item.addTag(`claim_date:${action.report_date}`);
        await item.saveTx();
       // Move to Claimed collection
        const claimedCol = await this.findCollection(claimedName);
       if (claimedCol) claimedCol.addItem(item.id);
        break;
      }
      case "undo_claim": {
        if (!action.item_key) break;
        const item = await this.findItemByKey(action.item_key);
        if (!item) break;
        item.removeTag("auto_claimed");
        item.removeTag("auto_reported");
        // Remove claim/report tags
        const tags = item.getTags();
        for (const t of tags) {
          if (t.tag.startsWith("claimed_by:") || t.tag.startsWith("claim_date:") ||
              t.tag.startsWith("reported_by:") || t.tag.startsWith("report_date:")) {
            item.removeTag(t.tag);
          }
        }
        await item.saveTx();
       // Move back to pending
        const pendingCol = await this.findCollection(pendingName);
       if (pendingCol) pendingCol.addItem(item.id);
        break;
      }
      case "undo_report": {
        if (!action.item_key) break;
        const item = await this.findItemByKey(action.item_key);
        if (!item) break;
        // Remove report-specific tags only, keep claim tags
        item.removeTag("auto_reported");
        const tags = item.getTags();
        for (const t of tags) {
          if (t.tag.startsWith("reported_by:") || t.tag.startsWith("report_date:")) {
            item.removeTag(t.tag);
          }
        }
        await item.saveTx();
       // Move back to claimed collection
        const claimedCol = await this.findCollection(claimedName);
       if (claimedCol) claimedCol.addItem(item.id);
        break;
      }
      case "report": {
        if (!action.item_key) break;
        const item = await this.findItemByKey(action.item_key);
        if (!item) break;
        item.addTag("auto_reported");
        if (action.reporter_name) item.addTag(`reported_by:${action.reporter_name}`);
        if (action.report_date) item.addTag(`report_date:${action.report_date}`);
       await item.saveTx();
       const reportedCol = await this.findCollection(reportedName);
       if (reportedCol) reportedCol.addItem(item.id);
        break;
      }
     case "add_by_doi": {
       if (!action.doi) break;
        const libID = Number(getPref("lastSyncedLibraryID")) || Zotero.Libraries.userLibraryID;

        // Pre-check: if a DOI-matching item already exists, claim it instead of adding duplicate
       const s = new Zotero.Search();
       s.addCondition("libraryID", "is", libID);
       s.addCondition("DOI", "is", action.doi);
       const existingIDs = await s.search();
       if (existingIDs.length > 0) {
          Zotero.debug(`Collaboration: DOI ${action.doi} already exists - claiming existing item instead of adding duplicate`);
          for (const id of existingIDs) {
            const existingItem = await Zotero.Items.getAsync(id);
            if (!existingItem || !existingItem.isRegularItem()) continue;
            if (action.reporter_name) {
              existingItem.addTag("auto_claimed");
              existingItem.addTag(`claimed_by:${action.reporter_name}`);
              if (action.report_date) existingItem.addTag(`claim_date:${action.report_date}`);
              await existingItem.saveTx();
              const claimedCol = await this.findCollection(claimedName);
              if (claimedCol) claimedCol.addItem(existingItem.id);
            } else {
              existingItem.addTag(`added_by:web`);
              await existingItem.saveTx();
              const pendingCol = await this.findCollection(pendingName);
              if (pendingCol) pendingCol.addItem(existingItem.id);
            }
          }
         break;
       }

       const translator = Zotero.Translate;
       const translate = new translator("search");
       translate.setTranslator("11645bd4-0420-45e1-95d8-b6e2951bcd33"); // DOI
       translate.setSearch({ itemType: "journalArticle", DOI: action.doi });
       const translators = await translate.getTranslators();
       if (translators.length) translate.setTranslator(translators[0].translatorID);
        const newItems = await translate.translate({ libraryID: libID, saveAttachments: false });
       if (newItems.length) {
         const newItem = newItems[0];
         if (action.reporter_name) newItem.addTag(`added_by:${action.reporter_name}`);
         if (action.report_date) newItem.addTag(`added_date:${action.report_date}`);
          // If reporter_name is present, also claim the newly added item
          if (action.reporter_name) {
            newItem.addTag("auto_claimed");
            newItem.addTag(`claimed_by:${action.reporter_name}`);
            if (action.report_date) newItem.addTag(`claim_date:${action.report_date}`);
            const claimedCol = await this.findCollection(claimedName);
            if (claimedCol) claimedCol.addItem(newItem.id);
          } else {
            // No reporter_name: submitted from To Read section
            newItem.addTag(`added_by:web`);
            const pendingCol = await this.findCollection(pendingName);
            if (pendingCol) pendingCol.addItem(newItem.id);
          }
         await newItem.saveTx();
       }
       break;
     }
      case "undo_add": {
        if (!action.item_key) break;
        try {
          const item = await this.findItemByKey(action.item_key);
          if (!item) break;
          // Move to trash
          item.deleted = true;
          await item.saveTx();
        } catch (e) {
          Zotero.debug(`Collaboration: undo_add failed for ${action.item_key}, item may already be deleted: ${e}`);
        }
        break;
      }
      default:
        Zotero.debug(`Collaboration: unknown action_type ${action.action_type}`);
    }
  }

  private async findItemByKey(key: string): Promise<Zotero.Item | null> {
    const libID = getPref("lastSyncedLibraryID") || String(Zotero.Libraries.userLibraryID);
    return Zotero.Items.getByLibraryAndKeyAsync(Number(libID), key) as Promise<Zotero.Item | null>;
  }

  private async findOrCreateCollection(name: string): Promise<Zotero.Collection | null> {
    const libID = Number(getPref("lastSyncedLibraryID")) || Zotero.Libraries.userLibraryID;
    const cols = Zotero.Collections.getByLibrary(libID) as Zotero.Collection[];
    const existing = cols.filter((c) => !c.deleted).find((c) => c.name === name);
    if (existing) return existing;
    const newCol = new Zotero.Collection({ name, libraryID: libID });
    await newCol.saveTx();
    return newCol;
  }
  /**
   * Look up an existing collection by name without creating one.
   * Collaboration buckets (To Read / Claimed / Reported) must be created by
   * the user in Zotero; the plugin never auto-creates empty folders.
   */
  private async findCollection(name: string): Promise<Zotero.Collection | null> {
    const libID = Number(getPref("lastSyncedLibraryID")) || Zotero.Libraries.userLibraryID;
    const cols = Zotero.Collections.getByLibrary(libID) as Zotero.Collection[];
    const existing = cols.filter((c) => !c.deleted).find((c) => c.name === name);
    if (!existing) {
      Zotero.debug(`Collaboration: collection "${name}" not found in library ${libID}; skipping (will not auto-create an empty folder)`);
    }
    return existing ?? null;
  }

 /** Main poll loop. */
 async pollAndProcess(): Promise<void> {
    let processedCount = 0;
   try {
     const actions = await this.fetchPendingActions();
     if (!actions.length) return;
     Zotero.debug(`Collaboration: found ${actions.length} pending action(s)`);
     for (const action of actions) {
       try {
         await this.processAction(action);
         await this.markProcessed(action);
          processedCount++;
       } catch (e) {
         Zotero.debug(`Collaboration: error processing action ${action.id}: ${e}`);
       }
     }
   } catch (e) {
     Zotero.debug(`Collaboration: poll error: ${e}`);
   }

    // Push updated state back to Supabase after processing web actions
    if (processedCount > 0) {
      try {
        await staticSync.silentSyncBack();
      } catch (e) {
        Zotero.debug(`Collaboration: silent sync-back failed: ${e}`);
      }
    }
 }

  /** Schedule an immediate poll after a brief delay, debouncing repeat calls. */
  scheduleImmediatePoll(): void {
    if (this.immediatePollScheduled) return;
    this.immediatePollScheduled = true;
    setTimeout(() => {
      this.immediatePollScheduled = false;
      void this.pollAndProcess();
    }, 2000);
  }

  start(): void {
    if (this.polling) return;
    const intervalSec = getPref("collaborationPollInterval") || 60;
    this.polling = true;
    Zotero.debug(`Collaboration: starting poll every ${intervalSec}s`);
    this.pollAndProcess(); // Immediate first poll
    this.timer = setInterval(() => {
      void this.pollAndProcess();
    }, intervalSec * 1000);
  }

  stop(): void {
    this.polling = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    Zotero.debug("Collaboration: stopped");
  }
}
