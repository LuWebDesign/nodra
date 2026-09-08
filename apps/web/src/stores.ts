import { create } from "zustand";
import type { DocumentSnapshot, ElementId, PointMm, ProjectPreferences, ProjectSnapshot } from "@nodra/domain";
import { createDocument, createProject, documentFromProject, projectFromDocument } from "@nodra/domain";
import { createEditor, type EditorState } from "@nodra/editor-core";
import type { SaveResult } from "@nodra/persistence";
import { INITIAL_ZOOM, MAX_ZOOM, MIN_ZOOM } from "./interaction.js";

export type Tool = "select" | "forma" | "pen" | "spline" | "text" | "rectangle" | "circle" | "line" | "arc" | "cut" | "dimension" | "radius" | "pan";
export const SAVE_INTERVAL_MS = 20 * 60 * 1000;
export type SaveMode = "manual" | "prompted-autosave";
export interface SavePolicy { readonly mode: SaveMode; readonly intervalMs: number }
const savePolicyKey = "nodra:save-policy";
export const defaultSavePolicy: SavePolicy = { mode: "prompted-autosave", intervalMs: SAVE_INTERVAL_MS };
const loadSavePolicy = (): SavePolicy => {
  try {
    const raw = localStorage.getItem(savePolicyKey);
    if (!raw) return defaultSavePolicy;
    const value = JSON.parse(raw) as Partial<SavePolicy>;
    return value.mode === "manual" || value.mode === "prompted-autosave" ? { mode: value.mode, intervalMs: SAVE_INTERVAL_MS } : defaultSavePolicy;
  } catch { return defaultSavePolicy; }
};
const saveSavePolicy = (policy: SavePolicy): void => { try { localStorage.setItem(savePolicyKey, JSON.stringify(policy)); } catch { /* best effort application preference */ } };
export const useSavePolicyStore = create<{ policy: SavePolicy; setMode: (mode: SaveMode) => void }>((set) => ({ policy: loadSavePolicy(), setMode: (mode) => set((state) => { const policy = { ...state.policy, mode, intervalMs: SAVE_INTERVAL_MS }; saveSavePolicy(policy); return { policy }; }) }));
export const useUiStore = create<{ mode: "design" | "prepare"; tool: Tool; setMode: (mode: "design" | "prepare") => void; setTool: (tool: Tool) => void }>((set) => ({ mode: "design", tool: "select", setMode: (mode) => set({ mode }), setTool: (tool) => set({ tool }) }));
export const useDocumentStore = create<{ editor: EditorState; project: ProjectSnapshot; document: DocumentSnapshot; setEditor: (editor: EditorState, options?: { readonly syncProject?: boolean }) => void; setProject: (project: ProjectSnapshot) => void; setProjectPreferences: (preferences: ProjectPreferences) => void }>((set) => { const document = createDocument("nodra-local", [{ id: "layer-1" as never, name: "Capa de diseño", visible: true, order: 0 }]); const project = createProject(document); return { editor: createEditor(document), project, document, setEditor: (editor, options = {}) => set((state) => ({ editor, document: editor.document, project: options.syncProject === false || editor.gesture ? state.project : projectFromDocument(state.project, editor.document) })), setProject: (project) => { const document = documentFromProject(project); set({ project, document, editor: createEditor(document) }); }, setProjectPreferences: (preferences) => set((state) => ({ project: { ...state.project, preferences } })) }; });
export const useSelectionStore = create<{ selected: ElementId | undefined; setSelected: (selected: ElementId | undefined) => void }>((set) => ({ selected: undefined, setSelected: (selected) => set({ selected }) }));
export const useViewportStore = create<{ zoom: number; panMm: PointMm; setZoom: (zoom: number) => void; setPanMm: (panMm: PointMm) => void }>((set) => ({ zoom: INITIAL_ZOOM, panMm: { x: 0, y: 0 }, setZoom: (zoom) => set({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)) }), setPanMm: (panMm) => set({ panMm }) }));
export const usePersistenceStore = create<{ state: "saved" | "saving" | "offline" | "recovered" | "failed"; message: string; set: (state: "saved" | "saving" | "offline" | "recovered" | "failed", message?: string) => void }>((set) => ({ state: "saved", message: "Documento local listo", set: (state, message = "") => set({ state, message }) }));
export type PersistenceStatus = SaveResult["status"];

/** Recovery mirrors may only follow committed editor state outside an active sketch session. */
export const shouldPersistEditorSnapshot = (status: "idle" | "active" | "confirming-cancel", gesture: boolean): boolean => status === "idle" && !gesture;
