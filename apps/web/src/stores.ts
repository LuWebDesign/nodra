import { create } from "zustand";
import type { DocumentSnapshot, ElementId, PointMm } from "@nodra/domain";
import { createDocument } from "@nodra/domain";
import type { EditorState } from "@nodra/editor-core";
import type { SaveResult } from "@nodra/persistence";

export type Tool = "select" | "rectangle" | "ellipse" | "line" | "pan";
export const useUiStore = create<{ mode: "design" | "prepare"; tool: Tool; setMode: (mode: "design" | "prepare") => void; setTool: (tool: Tool) => void }>((set) => ({ mode: "design", tool: "select", setMode: (mode) => set({ mode }), setTool: (tool) => set({ tool }) }));
export const useDocumentStore = create<{ editor: EditorState; setEditor: (editor: EditorState) => void; document: DocumentSnapshot; setDocument: (document: DocumentSnapshot) => void }>((set) => { const document = createDocument("nodra-local", [{ id: "layer-1" as never, name: "Design layer", visible: true, order: 0 }]); return { editor: { document, selection: [], undo: [], redo: [], gesture: undefined }, document, setEditor: (editor) => set({ editor, document: editor.document }), setDocument: (document) => set({ document }) }; });
export const useSelectionStore = create<{ selected: ElementId | undefined; setSelected: (selected: ElementId | undefined) => void }>((set) => ({ selected: undefined, setSelected: (selected) => set({ selected }) }));
export const useViewportStore = create<{ zoom: number; panMm: PointMm; setZoom: (zoom: number) => void }>((set) => ({ zoom: 3, panMm: { x: 20, y: 20 }, setZoom: (zoom) => set({ zoom: Math.max(0.5, Math.min(8, zoom)) }) }));
export const usePersistenceStore = create<{ state: "saved" | "saving" | "offline" | "recovered"; message: string; set: (state: "saved" | "saving" | "offline" | "recovered", message?: string) => void }>((set) => ({ state: "saved", message: "Local document ready", set: (state, message = "") => set({ state, message }) }));
export type PersistenceStatus = SaveResult["status"];
