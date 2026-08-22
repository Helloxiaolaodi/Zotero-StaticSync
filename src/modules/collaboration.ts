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
    const table =
      getPref("supabaseActionsTable").trim() || "shared_collection_actions";
    if (!url || !key)
      throw new Error(
        "Supabase URL and key required for collaboration polling.",
      );
    return `${url}/rest/v1/${table}`;
  }

  /** Fetch unprocessed actions from Supabase. */
  private async fetchPendingActions(): Promise<PendingAction[]> {
    const key = getPref("supabaseKey").trim();
    const base = this.buildRestURL();
    const latestSlug = getPref("lastSyncedShareSlug").trim();
    const filterAppend = latestSlug
      ? "&source_slug=eq." + encodeURIComponent(latestSlug)
      : "";
    const url = `${base}?processed=eq.false${filterAppend}&order=created_at.asc&limit=20`;
    const resp = await fetch(url, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
    if (!resp.ok)
      throw new Error(
        `Fetch actions failed (${resp.status}): ${await resp.text()}`,
      );
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
      Zotero.debug(
        `Collaboration: failed to mark action ${action.id} processed: ${resp.status}`,
      );
    }
  }

  /** Process one action against the local Zotero database. */
  private async processAction(action: PendingAction): Promise<void> {
    const claimedName = getPref("claimedCollectionName") || "Claimed";
    const reportedName = getPref("reportedCollectionName") || "Reported";
    const pendingName = getPref("pendingCollectionName") || "To Read";

    Zotero.debug(
      `Collaboration: processing action ${action.action_type} for ${action.item_title || action.item_key}`,
    );

    switch (action.action_type) {
      case "claim": {
        if (!action.item_key) break;
        const item = await this.findItemByKey(action.item_key);
        if (!item) break;
        // Tag the item
        item.addTag("auto_claimed");
        if (action.reporter_name)
          item.addTag(`claimed_by:${action.reporter_name}`);
        if (action.report_date) item.addTag(`claim_date:${action.report_date}`);
        await item.saveTx();
        // Move to Claimed collection
        const claimedCol = await this.findCollection(claimedName);
        const pendingCol = await this.findCollection(pendingName);
        const reportedCol = await this.findCollection(reportedName);
        await this.routeToWorkflowCollection(item.id, claimedCol, [
          pendingCol,
          reportedCol,
        ]);
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
          if (
            t.tag.startsWith("claimed_by:") ||
            t.tag.startsWith("claim_date:") ||
            t.tag.startsWith("reported_by:") ||
            t.tag.startsWith("report_date:")
          ) {
            item.removeTag(t.tag);
          }
        }
        await item.saveTx();
        // Move back to pending
        const pendingCol = await this.findCollection(pendingName);
        const claimedCol = await this.findCollection(claimedName);
        const reportedCol = await this.findCollection(reportedName);
        await this.routeToWorkflowCollection(item.id, pendingCol, [
          claimedCol,
          reportedCol,
        ]);
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
          if (
            t.tag.startsWith("reported_by:") ||
            t.tag.startsWith("report_date:")
          ) {
            item.removeTag(t.tag);
          }
        }
        await item.saveTx();
        // Move back to claimed collection
        const claimedCol = await this.findCollection(claimedName);
        const pendingCol = await this.findCollection(pendingName);
        const reportedCol = await this.findCollection(reportedName);
        await this.routeToWorkflowCollection(item.id, claimedCol, [
          pendingCol,
          reportedCol,
        ]);
        break;
      }
      case "report": {
        if (!action.item_key) break;
        const item = await this.findItemByKey(action.item_key);
        if (!item) break;
        item.addTag("auto_reported");
        if (action.reporter_name)
          item.addTag(`reported_by:${action.reporter_name}`);
        if (action.report_date)
          item.addTag(`report_date:${action.report_date}`);
        await item.saveTx();
        const reportedCol = await this.findCollection(reportedName);
        const claimedCol = await this.findCollection(claimedName);
        const pendingCol = await this.findCollection(pendingName);
        await this.routeToWorkflowCollection(item.id, reportedCol, [
          claimedCol,
          pendingCol,
        ]);
        break;
      }
      case "add_by_doi": {
        if (!action.doi) break;
        const libID =
          Number(getPref("lastSyncedLibraryID")) ||
          Zotero.Libraries.userLibraryID;

        // Pre-check: if a DOI-matching item already exists, claim it instead of adding duplicate
        const s = new Zotero.Search();
        s.addCondition("libraryID", "is", libID);
        s.addCondition("DOI", "is", action.doi);
        const existingIDs = await s.search();
        if (existingIDs.length > 0) {
          Zotero.debug(
            `Collaboration: DOI ${action.doi} already exists - claiming existing item instead of adding duplicate`,
          );
          for (const id of existingIDs) {
            const existingItem = await Zotero.Items.getAsync(id);
            if (!existingItem || !existingItem.isRegularItem()) continue;
            if (action.reporter_name) {
              existingItem.addTag("auto_claimed");
              existingItem.addTag(`claimed_by:${action.reporter_name}`);
              if (action.report_date)
                existingItem.addTag(`claim_date:${action.report_date}`);
              await existingItem.saveTx();
              const claimedCol = await this.findCollection(claimedName);
              const pendingCol = await this.findCollection(pendingName);
              const reportedCol = await this.findCollection(reportedName);
              await this.routeToWorkflowCollection(
                existingItem.id,
                claimedCol,
                [pendingCol, reportedCol],
              );
            } else {
              existingItem.addTag(`added_by:web`);
              await existingItem.saveTx();
              const pendingCol = await this.findCollection(pendingName);
              const claimedCol = await this.findCollection(claimedName);
              const reportedCol = await this.findCollection(reportedName);
              await this.routeToWorkflowCollection(
                existingItem.id,
                pendingCol,
                [claimedCol, reportedCol],
              );
            }
          }
          break;
        }

        const translator = Zotero.Translate;
        const translate = new translator("search");
        translate.setTranslator("11645bd4-0420-45e1-95d8-b6e2951bcd33"); // DOI
        translate.setSearch({ itemType: "journalArticle", DOI: action.doi });
        const translators = await translate.getTranslators();
        if (translators.length)
          translate.setTranslator(translators[0].translatorID);
        const newItems = await translate.translate({
          libraryID: libID,
          saveAttachments: false,
        });
        if (newItems.length) {
          const newItem = newItems[0];
          if (action.reporter_name)
            newItem.addTag(`added_by:${action.reporter_name}`);
          if (action.report_date)
            newItem.addTag(`added_date:${action.report_date}`);
          // If reporter_name is present, also claim the newly added item
          if (action.reporter_name) {
            newItem.addTag("auto_claimed");
            newItem.addTag(`claimed_by:${action.reporter_name}`);
            if (action.report_date)
              newItem.addTag(`claim_date:${action.report_date}`);
            const claimedCol = await this.findCollection(claimedName);
            const pendingCol = await this.findCollection(pendingName);
            const reportedCol = await this.findCollection(reportedName);
            await this.routeToWorkflowCollection(newItem.id, claimedCol, [
              pendingCol,
              reportedCol,
            ]);
          } else {
            // No reporter_name: submitted from To Read section
            newItem.addTag(`added_by:web`);
            const pendingCol = await this.findCollection(pendingName);
            const claimedCol = await this.findCollection(claimedName);
            const reportedCol = await this.findCollection(reportedName);
            await this.routeToWorkflowCollection(newItem.id, pendingCol, [
              claimedCol,
              reportedCol,
            ]);
          }
          await newItem.saveTx();
        }
        break;
      }
      case "web_action": {
        // Web already applied this change via Zotero Group API. Skip local processing;
        // just mark as processed so silentSyncBack triggers and pushes updated data
        // back to Supabase, keeping the web frontend in sync.
        Zotero.debug(
          `Collaboration: web_action signal received (source: ${action.source_slug}), skipping local processing`,
        );
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
          Zotero.debug(
            `Collaboration: undo_add failed for ${action.item_key}, item may already be deleted: ${e}`,
          );
        }
        break;
      }
      default:
        Zotero.debug(
          `Collaboration: unknown action_type ${action.action_type}`,
        );
    }
  }

  private async findItemByKey(key: string): Promise<Zotero.Item | null> {
    const libID =
      getPref("lastSyncedLibraryID") || String(Zotero.Libraries.userLibraryID);
    return Zotero.Items.getByLibraryAndKeyAsync(
      Number(libID),
      key,
    ) as Promise<Zotero.Item | null>;
  }

  private findTagValue(
    tags: Array<{ tag: string }>,
    prefix: string,
  ): string | undefined {
    const found = tags.find((t) =>
      t.tag.toLowerCase().startsWith(prefix.toLowerCase()),
    );
    return found
      ? found.tag.slice(prefix.length).trim() || undefined
      : undefined;
  }

  private hasWorkflowTag(
    tags: Array<{ tag: string }>,
    target: string,
  ): boolean {
    return tags.some((t) => t.tag.toLowerCase() === target.toLowerCase());
  }

  private isReportDatePassed(value: string): boolean {
    const match = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const due = new Date(year, month - 1, day);
    if (
      due.getFullYear() !== year ||
      due.getMonth() !== month - 1 ||
      due.getDate() !== day
    ) {
      return false;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return due <= today;
  }

  private getSyncedRootCollection(): Zotero.Collection | null {
    const libID = Number(getPref("lastSyncedLibraryID"));
    const rootKey = getPref("lastSyncedCollectionKey").trim();
    if (!libID || !rootKey) return null;
    const root = Zotero.Collections.getByLibraryAndKey(libID, rootKey) as
      | Zotero.Collection
      | false;
    return root && !root.deleted ? root : null;
  }

  private async collectItemsInSubtree(
    root: Zotero.Collection,
  ): Promise<Zotero.Item[]> {
    const seen = new Set<string>();
    const result: Zotero.Item[] = [];
    const stack: Zotero.Collection[] = [root];
    while (stack.length) {
      const current = stack.pop()!;
      if (current.deleted) continue;
      const items = await current.getChildItems();
      for (const item of items) {
        if (!item.isRegularItem() || item.deleted || seen.has(item.key)) {
          continue;
        }
        seen.add(item.key);
        result.push(item);
      }
      for (const child of current.getChildCollections()) {
        if (!child.deleted) stack.push(child);
      }
    }
    return result;
  }

  private async collectItemsInSyncedScope(): Promise<Zotero.Item[]> {
    const libID = Number(getPref("lastSyncedLibraryID"));
    if (!libID) return [];
    const root = this.getSyncedRootCollection();
    if (root) return this.collectItemsInSubtree(root);
    return Zotero.Items.getAll(libID);
  }

  private async removeFromSyncedRootCollection(itemID: number): Promise<void> {
    const root = this.getSyncedRootCollection();
    if (root && root.hasItem(itemID)) await root.removeItem(itemID);
  }

  private isCollectionInSyncedScope(target: Zotero.Collection): boolean {
    const root = this.getSyncedRootCollection();
    return root
      ? this.findCollectionInSubtree(root, target.name) === target
      : false;
  }

  private async routeToWorkflowCollection(
    itemID: number,
    target: Zotero.Collection | null,
    stale: Array<Zotero.Collection | null>,
  ): Promise<void> {
    for (const col of stale) {
      if (col?.hasItem(itemID)) await col.removeItem(itemID);
    }
    if (!target) return;
    await target.addItem(itemID);
    if (this.isCollectionInSyncedScope(target)) {
      await this.removeFromSyncedRootCollection(itemID);
    }
  }

  private async autoTransitionDueItemsToReported(): Promise<number> {
    const libID = Number(getPref("lastSyncedLibraryID"));
    if (!libID) return 0;
    const claimedName = getPref("claimedCollectionName") || "Claimed";
    const pendingName = getPref("pendingCollectionName") || "To Read";
    const reportedName = getPref("reportedCollectionName") || "Reported";
    const reportedCol = await this.findCollection(reportedName);
    if (!reportedCol) {
      Zotero.debug(
        `Collaboration: "${reportedName}" not found; skipping report-date auto-transition`,
      );
      return 0;
    }
    const claimedCol = await this.findCollection(claimedName);
    const pendingCol = await this.findCollection(pendingName);
    const items = await this.collectItemsInSyncedScope();
    const syncedRoot = this.getSyncedRootCollection();
    const reportedInSyncedScope = syncedRoot
      ? this.findCollectionInSubtree(syncedRoot, reportedCol.name) ===
        reportedCol
      : false;
    let moved = 0;
    for (const item of items) {
      if (!item.isRegularItem() || item.deleted) continue;
      const tags = item.getTags();
      const dueDate =
        this.findTagValue(tags, "claim_date:") ||
        this.findTagValue(tags, "report-date:") ||
        this.findTagValue(tags, "report_date:");
      if (!dueDate || !this.isReportDatePassed(dueDate)) continue;
      const alreadyReported = reportedCol.hasItem(item.id);
      const hasReportedTag = this.hasWorkflowTag(tags, "auto_reported");
      const hasReportedDate = Boolean(this.findTagValue(tags, "report_date:"));
      const isInClaimed = Boolean(claimedCol?.hasItem(item.id));
      const isInPending = Boolean(pendingCol?.hasItem(item.id));
      const isInSyncedRoot = Boolean(syncedRoot?.hasItem(item.id));
      if (
        alreadyReported &&
        hasReportedTag &&
        hasReportedDate &&
        !isInClaimed &&
        !isInPending &&
        (!reportedInSyncedScope || !isInSyncedRoot)
      ) {
        continue;
      }
      try {
        item.addTag("auto_reported");
        if (!hasReportedDate) item.addTag(`report_date:${dueDate}`);
        await item.saveTx();
        if (claimedCol?.hasItem(item.id)) await claimedCol.removeItem(item.id);
        if (pendingCol?.hasItem(item.id)) await pendingCol.removeItem(item.id);
        if (!alreadyReported) await reportedCol.addItem(item.id);
        if (reportedInSyncedScope)
          await this.removeFromSyncedRootCollection(item.id);
        moved++;
        Zotero.debug(
          `Collaboration: auto-moved due item ${item.key} to "${reportedName}"`,
        );
      } catch (e) {
        Zotero.debug(
          `Collaboration: failed to auto-move item ${item.key} to "${reportedName}": ${e}`,
        );
      }
    }
    return moved;
  }

  private findCollectionInSubtree(
    root: Zotero.Collection | null,
    name: string,
  ): Zotero.Collection | null {
    if (!root || root.deleted) return null;
    const stack: Zotero.Collection[] = [root];
    while (stack.length) {
      const current = stack.pop()!;
      if (!current.deleted && current.name === name) return current;
      for (const child of current.getChildCollections()) {
        if (!child.deleted) stack.push(child);
      }
    }
    return null;
  }

  private async findOrCreateCollection(
    name: string,
  ): Promise<Zotero.Collection | null> {
    const libID =
      Number(getPref("lastSyncedLibraryID")) || Zotero.Libraries.userLibraryID;
    const cols = Zotero.Collections.getByLibrary(libID) as Zotero.Collection[];
    const existing = cols
      .filter((c) => !c.deleted)
      .find((c) => c.name === name);
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
  private async findCollection(
    name: string,
  ): Promise<Zotero.Collection | null> {
    const libID =
      Number(getPref("lastSyncedLibraryID")) || Zotero.Libraries.userLibraryID;
    const rootKey = getPref("lastSyncedCollectionKey").trim();
    if (rootKey) {
      const root = Zotero.Collections.getByLibraryAndKey(libID, rootKey) as
        | Zotero.Collection
        | false;
      const local = this.findCollectionInSubtree(root ? root : null, name);
      if (local) return local;
    }
    const cols = Zotero.Collections.getByLibrary(libID) as Zotero.Collection[];
    const existing = cols
      .filter((c) => !c.deleted)
      .find((c) => c.name === name);
    if (!existing) {
      Zotero.debug(
        `Collaboration: collection "${name}" not found in library ${libID}; skipping (will not auto-create an empty folder)`,
      );
    }
    return existing ?? null;
  }

  /** Main poll loop. */
  async pollAndProcess(): Promise<void> {
    let processedCount = 0;
    let transitionedCount = 0;
    try {
      const actions = await this.fetchPendingActions();
      if (actions.length) {
        Zotero.debug(
          `Collaboration: found ${actions.length} pending action(s)`,
        );
        for (const action of actions) {
          try {
            await this.processAction(action);
            await this.markProcessed(action);
            processedCount++;
          } catch (e) {
            Zotero.debug(
              `Collaboration: error processing action ${action.id}: ${e}`,
            );
          }
        }
      }
    } catch (e) {
      Zotero.debug(`Collaboration: poll error: ${e}`);
    }

    try {
      transitionedCount = await this.autoTransitionDueItemsToReported();
      if (transitionedCount > 0) {
        Zotero.debug(
          `Collaboration: auto-moved ${transitionedCount} due item(s) to Reported`,
        );
      }
    } catch (e) {
      Zotero.debug(`Collaboration: report-date transition failed: ${e}`);
    }

    // Push updated state back to Supabase after local workflow changes
    if (processedCount > 0 || transitionedCount > 0) {
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
