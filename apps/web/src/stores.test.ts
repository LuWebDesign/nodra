import { beforeEach, describe, expect, it } from "vitest";
import { elementId, layerId } from "@nodra/domain";
import { beginGesture, commitGesture, createElement, previewGestureFromBase } from "@nodra/editor-core";
import { useDocumentStore } from "./stores.js";

describe("document store persistence boundary", () => {
  beforeEach(() => useDocumentStore.setState(useDocumentStore.getInitialState(), true));

  it("renders gesture previews without replacing committed project state", () => {
    const state = useDocumentStore.getState();
    const rectangle = { type: "rectangle" as const, id: elementId("preview"), layerId: layerId("layer-1"), position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, cornerRadius: 0, rotation: 0, style: { stroke: "#000", strokeWidth: 1 } };
    const preview = previewGestureFromBase(beginGesture(state.editor), createElement(rectangle));
    state.setEditor(preview);
    expect(useDocumentStore.getState().document.elements).toHaveLength(1);
    expect(useDocumentStore.getState().project.pages[0]?.elements).toHaveLength(0);
    state.setEditor(commitGesture(preview));
    expect(useDocumentStore.getState().project.pages[0]?.elements).toHaveLength(1);
  });
});
