import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { elementId, layerId, type Element, type ElementId, type PointMm } from "@nodra/domain";
import { addToSelection, beginGesture, cancelGesture, clearSelection, commitGesture, createElement, createEditor, deleteElement, dispatch, moveElements, previewGesture, redo, resizeElement, select, selectForPointerDown, undo, updateElement } from "@nodra/editor-core";
import { boundsOf, mmToScreen, resizeCorner, rotatedCorners, type ResizeCorner } from "@nodra/geometry";
import { DebouncedAutosave, DexieProjectRepository, requestStoragePersistence } from "@nodra/persistence";
import { renderSvg } from "@nodra/renderer-svg";
import { elementsContainedBy, normalizeBounds, normalizeDrag, pickElement, screenDeltaToMm, screenPointToMm } from "./interaction.js";
import { useDocumentStore, usePersistenceStore, useUiStore, useViewportStore, type Tool } from "./stores.js";

const style = { stroke: "#65d9ff", fill: "#65d9ff22", strokeWidth: 0.7 };
const id = () => elementId(`element-${crypto.randomUUID()}`);
const newElement = (tool: Exclude<Tool, "select" | "pan">, layer: string, start: PointMm, end: PointMm, elementId = id()): Element => tool === "line" ? { type: "line", id: elementId, layerId: layerId(layer), start, end, rotation: 0, style } : { type: tool, id: elementId, layerId: layerId(layer), ...normalizeDrag(start, end), rotation: 0, style };

type ActiveInteraction = { pointerId: number; lastX: number; lastY: number; kind: "move" | "pan" | "draw" | "resize" | "marquee"; ids?: readonly ElementId[]; dragged: boolean; start?: PointMm; previewed?: boolean; tool?: Exclude<Tool, "select" | "pan">; corner?: ResizeCorner; element?: Extract<Element, { type: "rectangle" | "ellipse" }> };

export function App() {
  const { mode, tool, setMode, setTool } = useUiStore();
  const { editor, setEditor } = useDocumentStore();
  const document = editor.document;
  const selection = editor.selection;
  const { zoom, panMm, setZoom, setPanMm } = useViewportStore();
  const persist = usePersistenceStore();
  const [online, setOnline] = useState(navigator.onLine);
  const [marquee, setMarquee] = useState<{ start: PointMm; end: PointMm }>();
  const repository = useMemo(() => new DexieProjectRepository(), []);
  const autosave = useMemo(() => new DebouncedAutosave(repository), [repository]);
  const canvas = useRef<HTMLDivElement>(null);
  const editorRef = useRef(editor);
  const interaction = useRef<ActiveInteraction | undefined>(undefined);
  const suppressClick = useRef(false);
  editorRef.current = editor;

  useEffect(() => { const on = () => setOnline(true); const off = () => setOnline(false); addEventListener("online", on); addEventListener("offline", off); void requestStoragePersistence(); void repository.getProject(document.id).then((result) => { if (result.ok) { setEditor(createEditor(result.revision.document)); persist.set("recovered", "Recovered local revision"); } }); return () => { removeEventListener("online", on); removeEventListener("offline", off); void repository.close(); }; }, [repository]);
  useEffect(() => { persist.set(online ? "saving" : "offline", online ? "Saving locally" : "Offline — editing remains local"); autosave.schedule({ id: document.id, name: "Untitled design", updatedAt: Date.now() }, document); void autosave.flush().then((result) => { if (result?.ok) persist.set("saved", "Saved locally"); }); }, [document, online]);
  const rendered = renderSvg(document, { zoom, panMm });
  const selectedElements = selection.map((selectedId) => document.elements.find((element) => element.id === selectedId)).filter((element): element is Element => Boolean(element));
  const selectedElement = selectedElements.length === 1 ? selectedElements[0] : undefined;
  const setEditorState = (next: typeof editor) => { editorRef.current = next; setEditor(next); };
  const pointAt = (event: PointerEvent<HTMLElement>) => { const rect = canvas.current!.getBoundingClientRect(); return screenPointToMm({ x: event.clientX, y: event.clientY }, { x: rect.left, y: rect.top }, zoom, panMm); };
  const resizePointerDown = (event: PointerEvent<HTMLElement>, corner: ResizeCorner) => { if (!selectedElement || selectedElement.type === "line") return; event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setEditorState(beginGesture(editorRef.current)); interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "resize", ids: [selectedElement.id], corner, element: selectedElement, dragged: false }; };
  const onCanvasPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (interaction.current) return;
    const resizeTarget = (event.target as HTMLElement).closest<HTMLElement>("[data-resize-corner]");
    if (resizeTarget) { resizePointerDown(event, resizeTarget.dataset.resizeCorner as ResizeCorner); return; }
    if (tool === "pan") { event.currentTarget.setPointerCapture(event.pointerId); interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "pan", dragged: false }; return; }
    const point = pointAt(event);
    if (tool === "select") {
      const hit = pickElement(document, point, zoom);
      if (hit) {
        const next = selectForPointerDown(editorRef.current, hit, event.shiftKey);
        setEditorState(next);
        if (!next.selection.includes(hit)) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setEditorState(beginGesture(next));
        interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "move", ids: next.selection, dragged: false };
      } else {
        event.currentTarget.setPointerCapture(event.pointerId);
        interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "marquee", start: point, dragged: false };
        setMarquee({ start: point, end: point });
      }
      suppressClick.current = true;
      return;
    }
    if ((event.target as HTMLElement).closest("[data-element-id]") || !canvas.current) return;
    event.currentTarget.setPointerCapture(event.pointerId); setEditorState(beginGesture(editorRef.current));
    interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "draw", dragged: false, start: point, tool, ids: [id()] };
  };
  const onCanvasPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = interaction.current; if (!active || active.pointerId !== event.pointerId) return;
    if (active.kind === "marquee" && active.start) { active.dragged = true; setMarquee({ start: active.start, end: pointAt(event) }); return; }
    if (active.kind === "resize" && active.element && active.corner) { const geometry = resizeCorner(active.element, active.corner, pointAt(event)); setEditorState(previewGesture(editorRef.current, resizeElement(active.element.id, geometry.position, geometry.size))); active.dragged = true; return; }
    if (active.kind === "pan" || active.kind === "move") { const delta = screenDeltaToMm({ x: event.clientX - active.lastX, y: event.clientY - active.lastY }, zoom); active.lastX = event.clientX; active.lastY = event.clientY; if (delta.x === 0 && delta.y === 0) return; active.dragged = true; if (active.kind === "pan") { const viewport = useViewportStore.getState(); setPanMm({ x: viewport.panMm.x - delta.x, y: viewport.panMm.y - delta.y }); } else if (active.ids) setEditorState(previewGesture(editorRef.current, moveElements(active.ids, delta))); return; }
    if (!active.start || !active.tool || !active.ids?.[0]) return; const element = newElement(active.tool, document.layers[0]?.id ?? "layer-1", active.start, pointAt(event), active.ids[0]); const command = active.previewed ? updateElement(element.id, element.type === "line" ? { start: element.start, end: element.end } : { position: element.position, size: element.size }) : createElement(element); setEditorState(previewGesture(editorRef.current, command)); active.previewed = true; active.dragged = true;
  };
  const finishPointer = (event: PointerEvent<HTMLDivElement | HTMLButtonElement>, cancelled: boolean) => {
    const active = interaction.current; if (!active || active.pointerId !== event.pointerId) return;
    if (active.kind === "marquee") { if (!cancelled && active.start && active.dragged) { const nextIds = elementsContainedBy(document, normalizeBounds(active.start, pointAt(event))); setEditorState(event.shiftKey ? addToSelection(editorRef.current, nextIds) : select(editorRef.current, nextIds)); } else if (!cancelled && !active.dragged) setEditorState(clearSelection(editorRef.current)); setMarquee(undefined); }
    else if (active.kind === "resize" && active.element && active.corner && !cancelled) { const geometry = resizeCorner(active.element, active.corner, pointAt(event)); setEditorState(previewGesture(editorRef.current, resizeElement(active.element.id, geometry.position, geometry.size))); setEditorState(commitGesture(editorRef.current)); }
    else if (active.kind === "resize" || active.kind === "move") setEditorState(cancelled ? cancelGesture(editorRef.current) : commitGesture(editorRef.current));
    else if (active.kind === "draw") { const end = active.start ? pointAt(event) : undefined; const zeroLengthLine = active.tool === "line" && active.start && end && active.start.x === end.x && active.start.y === end.y; if (cancelled || zeroLengthLine) setEditorState(cancelGesture(editorRef.current)); else if (active.start && active.tool && active.ids?.[0] && end) { const element = newElement(active.tool, document.layers[0]?.id ?? "layer-1", active.start, end, active.ids[0]); const command = active.previewed ? updateElement(element.id, element.type === "line" ? { start: element.start, end: element.end } : { position: element.position, size: element.size }) : createElement(element); setEditorState(previewGesture(editorRef.current, command)); setEditorState(commitGesture(editorRef.current)); } }
    suppressClick.current = !cancelled || active.dragged; interaction.current = undefined; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (selection.length && event.key === "Delete") { let next = editor; for (const selectedId of selection) next = dispatch(next, deleteElement(selectedId)); setEditor(next); } if (selection.length && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); const delta = { x: event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0, y: event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0 }; setEditor(dispatch(editor, moveElements(selection, delta))); } if (event.metaKey || event.ctrlKey) { if (event.key === "z") setEditor(event.shiftKey ? redo(editor) : undo(editor)); if (event.key === "y") setEditor(redo(editor)); } }; addEventListener("keydown", onKey); return () => removeEventListener("keydown", onKey); }, [editor, selection]);
  const handleCorners = selectedElement && selectedElement.type !== "line" ? rotatedCorners(selectedElement) : undefined;
  const handleNames: readonly ResizeCorner[] = ["nw", "ne", "se", "sw"];
  const handleStyle = (corner: ResizeCorner) => { const point = handleCorners?.[handleNames.indexOf(corner)]; if (!point) return undefined; const screen = mmToScreen(point, { zoom, panMm }); return `left:${screen.x}px;top:${screen.y}px`; };
  const marqueeStyle = marquee ? (() => { const bounds = normalizeBounds(marquee.start, marquee.end); const topLeft = mmToScreen({ x: bounds.x, y: bounds.y }, { zoom, panMm }); return { left: topLeft.x, top: topLeft.y, width: bounds.width * zoom, height: bounds.height * zoom }; })() : undefined;
  return <main className="app-shell"><header className="topbar"><div className="brand">NODRA <span>EDITOR</span></div><nav aria-label="Workspace mode"><button className={mode === "design" ? "active" : ""} onClick={() => setMode("design")}>Design</button><button className={mode === "prepare" ? "active" : ""} onClick={() => setMode("prepare")}>Prepare <small>Preview</small></button></nav><div className="top-actions"><button aria-label="Undo" onClick={() => setEditor(undo(editor))}>↶</button><button aria-label="Redo" onClick={() => setEditor(redo(editor))}>↷</button><span className="project-name">Untitled design</span></div></header>{mode === "prepare" ? <section className="prepare"><div><div className="prepare-icon">◇</div><h1>Prepare is not available yet</h1><p>Nodra currently provides an offline Design workspace only. No hardware is connected, controlled, or ready.</p><button onClick={() => setMode("design")}>Return to Design</button></div></section> : <div className="workspace"><aside className="toolbar" aria-label="Design tools"><ToolButton label="Select" icon="↖" active={tool === "select"} onClick={() => setTool("select")} /><ToolButton label="Rectangle" icon="□" active={tool === "rectangle"} onClick={() => setTool("rectangle")} /><ToolButton label="Ellipse" icon="○" active={tool === "ellipse"} onClick={() => setTool("ellipse")} /><ToolButton label="Line" icon="╱" active={tool === "line"} onClick={() => setTool("line")} /><ToolButton label="Pan" icon="✣" active={tool === "pan"} onClick={() => setTool("pan")} /><div className="toolbar-spacer" /><button aria-label="Zoom out" onClick={() => setZoom(zoom - 0.5)}>−</button><span className="zoom-label">{Math.round(zoom * 100 / 3)}%</span><button aria-label="Zoom in" onClick={() => setZoom(zoom + 0.5)}>+</button></aside><section className="canvas-area"><div className="canvas-header"><span>DESIGN / UNTITLED</span><span>{document.elements.length} objects</span></div><div className="canvas" ref={canvas} onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove} onPointerUp={(event) => finishPointer(event, false)} onPointerCancel={(event) => finishPointer(event, true)}>{rendered.success ? <div className="rendered" dangerouslySetInnerHTML={{ __html: rendered.svg }} /> : <div className="render-error">{rendered.error}</div>}{selectedElements.map((element) => { const bounds = boundsOf(element); const point = mmToScreen({ x: bounds.x, y: bounds.y }, { zoom, panMm }); return <div className="selection-box" key={element.id} style={{ left: point.x, top: point.y, width: bounds.width * zoom, height: bounds.height * zoom }} />; })}{marqueeStyle && <div className="marquee" style={marqueeStyle} />}{handleCorners && <div className="resize-handles" aria-label="Resize handles">{handleNames.map((corner) => <button type="button" className={`resize-handle resize-handle-${corner}`} data-resize-corner={corner} aria-label={`Resize ${corner}`} style={{ left: handleStyle(corner)?.match(/left:([^;]+)/)?.[1], top: handleStyle(corner)?.match(/top:([^;]+)/)?.[1] }} onPointerDown={(event) => resizePointerDown(event, corner)} key={corner} />)}</div>}<div className="canvas-hint">Select objects with document-aware picking · Shift-click or drag to marquee-select · Drag to move</div></div></section><aside className="inspector"><section><div className="panel-title">INSPECTOR</div>{selectedElement && selectedElement.type !== "line" ? <div className="fields"><Field label="X" value={selectedElement.position.x} onChange={(value) => setEditor(dispatch(editor, updateElement(selectedElement.id, { position: { ...selectedElement.position, x: value } })))} /><Field label="Y" value={selectedElement.position.y} onChange={(value) => setEditor(dispatch(editor, updateElement(selectedElement.id, { position: { ...selectedElement.position, y: value } })))} /><Field label="W" value={selectedElement.size.width} onChange={(value) => setEditor(dispatch(editor, updateElement(selectedElement.id, { size: { ...selectedElement.size, width: Math.max(1, value) } })))} /><Field label="H" value={selectedElement.size.height} onChange={(value) => setEditor(dispatch(editor, updateElement(selectedElement.id, { size: { ...selectedElement.size, height: Math.max(1, value) } })))} /><span className="selected-type">{selectedElement.type}{selection.length > 1 ? ` + ${selection.length - 1} more` : ""}</span></div> : <p className="muted">{selection.length ? `${selection.length} object${selection.length === 1 ? "" : "s"} selected` : "Select an object to inspect it."}</p>}</section><section><div className="panel-title">LAYERS</div>{document.layers.map((layer) => <div className="layer" key={layer.id}><span>{layer.name}</span><span>{layer.visible ? "Visible" : "Hidden"}</span></div>)}</section></aside></div>}<footer className="statusbar"><span className={`status-dot ${persist.state}`} />{persist.message}<span className="status-separator">·</span><span>{online ? "Online" : "Offline"}</span><span className="status-right">Local-first workspace</span></footer></main>;
}
function ToolButton({ label, icon, active, onClick }: { label: string; icon: string; active: boolean; onClick: () => void }) { return <button className={active ? "tool active" : "tool"} aria-label={label} title={label} onClick={onClick}><strong>{icon}</strong><small>{label}</small></button>; }
function Field({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <label className="field"><span>{label}</span><input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>; }
