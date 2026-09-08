import { describe, expect, it } from "vitest";
import { createDocument, elementId, layerId, revision, type DocumentSnapshot, type ElementId } from "@nodra/domain";
import type { Transaction } from "./index.js";
import { createSketchSession, isSketchScopedDocumentChange, isSketchSessionHistoryLocked, reduceSketchSession, type SketchSessionEvent } from "./sketchSession.js";

const layer = { id: layerId("layer"), name: "Layer", visible: true, order: 0 };
const sketchId = elementId("sketch");
const otherId = elementId("other-sketch");
const sketch = (id: ElementId) => ({ type: "sketch" as const, id, layerId: layer.id, nodes: [], edges: [], style: { stroke: "#000", strokeWidth: 1 } });
const document = createDocument("doc", [layer]);
const entry = { ...document, elements: [sketch(sketchId), sketch(otherId)] };
const changed = { ...entry, revision: revision(1), elements: [{ ...sketch(sketchId), nodes: [{ id: "n", point: { x: 1, y: 2 } }] }, sketch(otherId)] };
    const changedAfterCheckpoint = { ...changed, revision: revision(2), elements: [{ ...sketch(sketchId), nodes: [{ id: "n", point: { x: 3, y: 4 } }] }, sketch(otherId)] };
    const otherChanged = { ...entry, revision: revision(1), elements: [sketch(sketchId), { ...sketch(otherId), nodes: [{ id: "n", point: { x: 1, y: 2 } }] }] };
const transaction = (before: DocumentSnapshot, after: DocumentSnapshot, command = "gesture"): Transaction => ({ command, before, after, selectionBefore: [], selectionAfter: [] });
const enter = { type: "enter", sketchId } as const;
const reduce = (state: ReturnType<typeof createSketchSession>, event: SketchSessionEvent) => reduceSketchSession(state, event);

describe("sketch session reducer", () => {
      it("exposes the document scope guard used by editor integrations", () => {
        expect(isSketchScopedDocumentChange(entry, changed, sketchId)).toBe(true);
        expect(isSketchScopedDocumentChange(entry, otherChanged, sketchId)).toBe(false);
      });
  it("locks history controls during the whole session lifecycle", () => {
    const idle = createSketchSession(entry);
    const active = reduce(idle, enter);
    const worked = reduce(active, { type: "commit-gesture", sketchId, affectedElementIds: [sketchId], transaction: transaction(entry, changed) });
    const confirming = reduce(worked, { type: "cancel-session" });
    expect(isSketchSessionHistoryLocked(idle)).toBe(false);
    expect(isSketchSessionHistoryLocked(active)).toBe(true);
    expect(isSketchSessionHistoryLocked(confirming)).toBe(true);
  });

  it("enters an existing sketch and rejects missing sketches", () => {
    const idle = createSketchSession(entry, { undo: [], redo: [] });
    const active = reduce(idle, enter);
    expect(active.status).toBe("active");
    expect(reduce(idle, { type: "enter", sketchId: elementId("missing") })).toBe(idle);
  });

  it("tracks previews, clears them with Escape, and never exits", () => {
    const active = reduce(createSketchSession(entry), enter);
    const pending = reduce(active, { type: "begin-preview", previewId: "line", sketchId });
    expect(pending.status).toBe("active");
    expect(pending.status === "active" && pending.pending?.id).toBe("line");
    const updated = reduce(pending, { type: "update-preview", previewId: "line", sketchId });
    expect(updated.status === "active" && updated.pending?.sequence).toBe(1);
    const cleared = reduce(updated, { type: "escape" });
    expect(cleared.status).toBe("active");
    expect(cleared.status === "active" && cleared.pending).toBeUndefined();
    expect(reduce(cleared, { type: "escape" })).toBe(cleared);
  });

  it("retains each changed gesture marker and ignores no-op or out-of-scope commits", () => {
    const active = reduce(createSketchSession(entry), enter);
    const first = transaction(entry, changed, "line");
    const committed = reduce(active, { type: "commit-gesture", sketchId, affectedElementIds: [sketchId], transaction: first });
    expect(committed.status === "active" && committed.committed).toHaveLength(1);
    expect(committed.status === "active" && committed.editorHistory.undo).toHaveLength(1);
    expect(reduce(committed, { type: "commit-gesture", sketchId, affectedElementIds: [sketchId], transaction: transaction(changed, changed) })).toBe(committed);
    expect(reduce(committed, { type: "commit-gesture", sketchId: otherId, affectedElementIds: [otherId], transaction: transaction(changed, changed) })).toBe(committed);
    expect(reduce(committed, { type: "commit-gesture", sketchId, affectedElementIds: [otherId], transaction: first })).toBe(committed);
  });

  it("rejects a transaction that mutates another element despite its affected ids", () => {
        const active = reduce(createSketchSession(entry), enter);
        const rejected = reduce(active, { type: "commit-gesture", sketchId, affectedElementIds: [sketchId], transaction: transaction(entry, otherChanged) });
        expect(rejected).toBe(active);
      });

      it("accepts without synthetic history and cancels without work immediately", () => {
    const idle = createSketchSession(entry);
    const active = reduce(idle, enter);
    expect(reduce(active, { type: "cancel-session" })).toEqual(idle);
    const changedActive = reduce(active, { type: "commit-gesture", sketchId, affectedElementIds: [sketchId], transaction: transaction(entry, changed) });
    const accepted = reduce(changedActive, { type: "accept" });
    expect(accepted).toEqual({ status: "idle", document: changed, editorHistory: { undo: [transaction(entry, changed)], redo: [] }, selection: [] });
  });

  it("checkpoints explicitly and cancels only work after the latest checkpoint", () => {
        const active = reduce(createSketchSession(entry), enter);
        const checkpointed = reduce(active, { type: "commit-gesture", sketchId, affectedElementIds: [sketchId], transaction: transaction(entry, changed) });
        const afterCheckpoint = reduce(checkpointed, { type: "checkpoint", document: changed, editorHistory: { undo: [transaction(entry, changed)], redo: [] }, selection: [sketchId] });
        const worked = reduce(afterCheckpoint, { type: "commit-gesture", sketchId, affectedElementIds: [sketchId], transaction: transaction(changed, changedAfterCheckpoint) });
        const confirming = reduce(worked, { type: "cancel-session" });
        expect(confirming.status).toBe("confirming-cancel");
        expect(reduce(confirming, { type: "confirm-cancel" })).toEqual({ status: "idle", document: changed, editorHistory: { undo: [transaction(entry, changed)], redo: [] }, selection: [sketchId] });
      });

      it("confirms cancellation by restoring the exact entry boundary", () => {
    const initialHistory = { undo: [transaction(document, entry, "prior")], redo: [transaction(entry, document, "redo")] };
    const active = reduce(createSketchSession(entry, initialHistory, [otherId]), enter);
    const worked = reduce(active, { type: "commit-gesture", sketchId, affectedElementIds: [sketchId], transaction: transaction(entry, changed) });
    const confirming = reduce(worked, { type: "cancel-session" });
    expect(confirming.status).toBe("confirming-cancel");
    const dismissed = reduce(confirming, { type: "escape" });
    expect(dismissed.status).toBe("active");
    expect(dismissed.status === "active" && dismissed.document).toEqual(worked.status === "active" ? worked.document : undefined);
    const declined = reduce(confirming, { type: "decline-cancel" });
    expect(declined.status).toBe("active");
    expect(reduce(confirming, { type: "confirm-cancel" })).toEqual({ status: "idle", document: entry, editorHistory: initialHistory, selection: [otherId] });
  });

  it("keeps scope and invalid transitions isolated", () => {
    const active = reduce(createSketchSession(entry), enter);
    expect(reduce(active, { type: "begin-preview", previewId: "x", sketchId: otherId })).toBe(active);
    expect(reduce(active, { type: "commit-gesture", sketchId, affectedElementIds: [], transaction: transaction(entry, changed) })).toBe(active);
    expect(reduce(active, { type: "accept" })).toEqual({ status: "idle", document: entry, editorHistory: { undo: [], redo: [] }, selection: [] });
    const fresh = createSketchSession(entry);
    expect(reduce(fresh, { type: "confirm-cancel" })).toBe(fresh);
    expect(reduce(fresh, { type: "accept" })).toBe(fresh);
  });

  it("does not alias entry snapshots or history nested state", () => {
    const history = { undo: [transaction(document, entry)], redo: [] };
    const idle = createSketchSession(entry, history);
    const active = reduce(idle, enter);
    expect(active.status).toBe("active");
    if (active.status !== "active") return;
    (entry.elements as unknown as Array<unknown>).push({});
    (history.undo as unknown as Array<unknown>).push(transaction(document, document));
    expect(active.entryDocument.elements).toHaveLength(2);
    expect(active.entryEditorHistory.undo).toHaveLength(1);
  });
});
