import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode, type WheelEvent } from "react";
import { createProject, elementId, layerId, pageId, revision, type DocumentSnapshot, type Element, type ElementId, type PointMm, type ProjectSnapshot } from "@nodra/domain";
import { addToSelection, beginGesture, cancelGesture, clearSelection, commitGesture, createElement, deleteElement, dispatch, moveElements, previewGesture, previewGestureFromBase, redo, resizeElement, resizeElements, rotateElement, rotateElementsAroundCenter, select, selectForPointerDown, undo, updateElement, updateElementStyles, updatePage } from "@nodra/editor-core";
import { boundsOfElements, elementCenter, groupCenter, groupHandlePoints, realGeometryNodes, resizeHandle, rotatedResizeHandles, rotationFromDrag, rotationHandlePoints, type GroupHandle, type ResizeHandle } from "@nodra/geometry";
import { DebouncedAutosave, DexieProjectRepository, requestStoragePersistence } from "@nodra/persistence";
import { renderSvg } from "@nodra/renderer-svg";
import { canActivateRotation, centerPageInCanvas, clientPointToCanvas, hoveredSelectionCenter, isDrawingTool, marqueeSelection, movementExceedsThreshold, normalizeBounds, normalizeDrag, pagePointToCanvas, pickElement, pickNode, screenDeltaToMm, screenPointToMm, selectedNodeAnchor, snapMoveDelta, zoomAtPoint, type NodeHit, type SnapGuide, type TransformMode } from "./interaction.js";
import { cornerRadiusPatch, formatMm, geometryPatch, geometryValue, rotationDegreesValue, rotationPatch, type GeometryField, type PropertyElement } from "./propertyBar.js";
import { useDocumentStore, usePersistenceStore, useUiStore, useViewportStore, type Tool } from "./stores.js";

const defaultStyle = { stroke: "#000000", strokeWidth: 0.7 };
const palette = ["#111827", "#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ffffff"] as const;
const id = () => elementId(`element-${crypto.randomUUID()}`);
const newElement = (tool: Exclude<Tool, "select" | "pan">, layer: string, start: PointMm, end: PointMm, nextId = id()): Element => tool === "line"
  ? { type: "line", id: nextId, layerId: layerId(layer), start, end, rotation: 0, style: defaultStyle }
  : tool === "rectangle"
    ? { type: "rectangle", id: nextId, layerId: layerId(layer), ...normalizeDrag(start, end), cornerRadius: 0, rotation: 0, style: defaultStyle }
    : { type: tool, id: nextId, layerId: layerId(layer), ...normalizeDrag(start, end), rotation: 0, style: defaultStyle };

type ActiveInteraction = {
  pointerId: number;
  lastX: number;
  lastY: number;
  kind: "move" | "pan" | "draw" | "resize" | "rotate" | "marquee";
  ids?: readonly ElementId[];
  dragged: boolean;
  start?: PointMm;
  startClient?: PointMm;
  previewed?: boolean;
  tool?: Exclude<Tool, "select" | "pan">;
  handle?: GroupHandle;
  anchor?: NodeHit;
  element?: Element;
  document?: DocumentSnapshot;
  shiftKey?: boolean;
  center?: PointMm;
};

const toolCursorIcons: Record<Tool, string> = { select: "↖", rectangle: "□", ellipse: "○", line: "╱", pan: "✣" };
const toolCursorLabels: Record<Tool, string> = { select: "Seleccion", rectangle: "Rectángulo", ellipse: "Elipse", line: "Línea", pan: "Desplazar" };

export function App() {
  const { mode, tool, setMode, setTool } = useUiStore();
  const { editor, project, setEditor, setProject } = useDocumentStore();
  const document = editor.document;
  const selection = editor.selection;
  const { zoom, panMm, setZoom, setPanMm } = useViewportStore();
  const persist = usePersistenceStore();
  const [online, setOnline] = useState(navigator.onLine);
  const [grid, setGrid] = useState(false);
  const [marquee, setMarquee] = useState<{ start: PointMm; end: PointMm }>();
  const [snapGuide, setSnapGuide] = useState<SnapGuide>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [cursorPoint, setCursorPoint] = useState<PointMm>();
  const [groupAspectLock, setGroupAspectLock] = useState(false);
  const [centerHover, setCenterHover] = useState<{ elementId: ElementId; point: PointMm }>();
  const [transformMode, setTransformMode] = useState<TransformMode>("resize");
  const repository = useMemo(() => new DexieProjectRepository(), []);
  const autosave = useMemo(() => new DebouncedAutosave(repository), [repository]);
  const canvas = useRef<HTMLDivElement>(null);
  const editorRef = useRef(editor);
  const interaction = useRef<ActiveInteraction | undefined>(undefined);
  const viewportInteracted = useRef(false);
  const centeredViewport = useRef<string | undefined>(undefined);
  editorRef.current = editor;

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener("online", on);
    addEventListener("offline", off);
    void requestStoragePersistence();
    void repository.getProject(document.id).then((result) => {
      if (!result.ok) return;
      const recovered = "pages" in result.revision.document ? result.revision.document : createProject(result.revision.document);
      setProject(recovered);
      persist.set("recovered", "Revisión local recuperada");
    });
    return () => {
      removeEventListener("online", on);
      removeEventListener("offline", off);
      void repository.close();
    };
  }, [repository]);

  useLayoutEffect(() => {
    if (viewportInteracted.current || !canvas.current) return;
    const key = `${document.id}:${document.revision}:${document.page.width}:${document.page.height}`;
    const center = () => {
      if (viewportInteracted.current || centeredViewport.current === key || !canvas.current) return;
      const { width, height } = canvas.current.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      setPanMm(centerPageInCanvas({ width, height }, document.page, useViewportStore.getState().zoom));
      centeredViewport.current = key;
    };
    center();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(center);
    observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [document.id, document.revision, document.page.width, document.page.height, setPanMm]);

  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const markInteracted = () => { viewportInteracted.current = true; };
    target.addEventListener("pointerdown", markInteracted, true);
    target.addEventListener("wheel", markInteracted, true);
    return () => {
      target.removeEventListener("pointerdown", markInteracted, true);
      target.removeEventListener("wheel", markInteracted, true);
    };
  }, []);

  const selectedElements = selection.map((selectedId) => document.elements.find((element) => element.id === selectedId)).filter((element): element is Element => Boolean(element));
  const selectedElement = selectedElements.length === 1 ? selectedElements[0] : undefined;
  const selectedBounds = selectedElements.length ? boundsOfElements(selectedElements) : undefined;
  const propertyElement = selectedElements.length > 1 && selectedBounds
    ? { type: "rectangle" as const, id: selectedElements[0]!.id, layerId: selectedElements[0]!.layerId, position: { x: selectedBounds.x, y: selectedBounds.y }, size: { width: selectedBounds.width, height: selectedBounds.height }, cornerRadius: 0, rotation: 0, style: selectedElements[0]!.style }
    : selectedElement?.type !== "line" ? selectedElement : undefined;
  const selectionKey = selection.join(":");
  useEffect(() => { setTransformMode("resize"); }, [tool, project.activePageId, selectionKey]);

  useEffect(() => {
    setCenterHover(undefined);
    const target = canvas.current;
    if (!target || mode !== "design" || tool !== "select" || transformMode !== "resize" || !selectedElement) return;
    const update = (event: globalThis.PointerEvent) => {
      if (interaction.current) { setCenterHover(undefined); return; }
      const point = screenPointToMm(clientPointToCanvas({ x: event.clientX, y: event.clientY }, target.getBoundingClientRect()), { x: 0, y: 0 }, zoom, panMm);
      const center = hoveredSelectionCenter(document, selectedElement, point, zoom);
      setCenterHover(center ? { elementId: selectedElement.id, point: center } : undefined);
    };
    const clear = () => setCenterHover(undefined);
    target.addEventListener("pointermove", update);
    target.addEventListener("pointerleave", clear);
    return () => {
      target.removeEventListener("pointermove", update);
      target.removeEventListener("pointerleave", clear);
    };
  }, [document, mode, panMm, selectedElement, tool, transformMode, zoom]);

  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const overlay = globalThis.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    overlay.dataset.realNodeOverlay = "true";
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.cssText = "position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:3";
    const point = (value: PointMm) => pagePointToCanvas(value, zoom, panMm);
    if (transformMode === "resize") for (const element of selectedElements) for (const [nodeIndex, node] of realGeometryNodes(element).entries()) {
      const screen = point(node.point);
      const hitArea = globalThis.document.createElementNS("http://www.w3.org/2000/svg", "circle");
      hitArea.dataset.realNode = element.id;
      hitArea.dataset.realNodeIndex = String(nodeIndex);
      hitArea.setAttribute("cx", String(screen.x));
      hitArea.setAttribute("cy", String(screen.y));
      hitArea.setAttribute("r", "8");
      hitArea.setAttribute("fill", "transparent");
      hitArea.style.pointerEvents = "auto";
      hitArea.style.cursor = "move";
      overlay.append(hitArea);
      const mark = globalThis.document.createElementNS("http://www.w3.org/2000/svg", "circle");
      mark.setAttribute("cx", String(screen.x));
      mark.setAttribute("cy", String(screen.y));
      mark.setAttribute("r", "2.5");
      mark.setAttribute("fill", "#ffffff");
      mark.setAttribute("stroke", "#111827");
      mark.setAttribute("stroke-width", "1");
      mark.style.pointerEvents = "none";
      overlay.append(mark);
    }
    if (snapGuide && interaction.current?.kind === "move") {
      const source = point(snapGuide.source);
      const destination = point(snapGuide.target);
      const line = globalThis.document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(source.x));
      line.setAttribute("y1", String(source.y));
      line.setAttribute("x2", String(destination.x));
      line.setAttribute("y2", String(destination.y));
      line.setAttribute("stroke", "#65d9ff");
      line.setAttribute("stroke-width", "1");
      line.setAttribute("stroke-dasharray", "3 2");
      line.style.pointerEvents = "none";
      overlay.append(line);
      const sourceMark = globalThis.document.createElementNS("http://www.w3.org/2000/svg", "circle");
      sourceMark.setAttribute("cx", String(source.x));
      sourceMark.setAttribute("cy", String(source.y));
      sourceMark.setAttribute("r", "5");
      sourceMark.setAttribute("fill", "none");
      sourceMark.setAttribute("stroke", "#65d9ff");
      sourceMark.setAttribute("stroke-width", "2");
      sourceMark.style.pointerEvents = "none";
      overlay.append(sourceMark);
      const targetMark = globalThis.document.createElementNS("http://www.w3.org/2000/svg", "circle");
      targetMark.setAttribute("cx", String(destination.x));
      targetMark.setAttribute("cy", String(destination.y));
      targetMark.setAttribute("r", "8");
      targetMark.setAttribute("fill", "none");
      targetMark.setAttribute("stroke", "#65d9ff");
      targetMark.setAttribute("stroke-width", "2");
      targetMark.style.pointerEvents = "none";
      overlay.append(targetMark);
    }
    target.append(overlay);
    return () => overlay.remove();
  }, [document, panMm, selectedElements, snapGuide, transformMode, zoom]);

  useEffect(() => { if (!interaction.current) setSnapGuide(undefined); }, [editor]);
  useEffect(() => {
    persist.set(online ? "saving" : "offline", online ? "Guardando localmente" : "Sin conexión — la edición permanece local");
    autosave.schedule({ id: project.id, name: "Diseño sin título", updatedAt: Date.now() }, project);
    void autosave.flush().then((result) => { if (result?.ok) persist.set("saved", "Guardado localmente"); });
  }, [project, online]);

  const rendered = renderSvg(document, { zoom: 1, panMm: { x: 0, y: 0 } });
  const setEditorState = (next: typeof editor) => { editorRef.current = next; setEditor(next); };
  const canvasPointAt = (event: PointerEvent<HTMLElement> | WheelEvent<HTMLElement>) => clientPointToCanvas({ x: event.clientX, y: event.clientY }, canvas.current!.getBoundingClientRect());
  const pointAt = (event: PointerEvent<HTMLElement> | WheelEvent<HTMLElement>) => screenPointToMm(canvasPointAt(event), { x: 0, y: 0 }, zoom, panMm);

  const resizePointerDown = (event: PointerEvent<HTMLElement>, handle: GroupHandle) => {
    if (!selectedElements.length || handle === "center") return;
    setCenterHover(undefined);
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setEditorState(beginGesture(editorRef.current));
    interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "resize", ids: selection, ...(selectedElement ? { element: selectedElement } : {}), handle, dragged: false };
  };

  const rotationPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!selectedElements.length || transformMode !== "rotate") return;
    const center = selectedBounds ? groupCenter(selectedBounds) : elementCenter(selectedElements[0]!);
    const start = pointAt(event);
    if (Math.hypot(start.x - center.x, start.y - center.y) * zoom < 8) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setEditorState(beginGesture(editorRef.current));
    interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "rotate", ids: selection, ...(selectedElement ? { element: selectedElement } : {}), center, start, dragged: false };
  };

  const onCanvasPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (interaction.current) return;
    setCenterHover(undefined);
    setCursorPoint(canvasPointAt(event));
    setSnapGuide(undefined);
    const resizeTarget = (event.target as HTMLElement).closest<HTMLElement>("[data-resize-handle]");
    if (resizeTarget) { resizePointerDown(event, resizeTarget.dataset.resizeHandle as ResizeHandle); return; }
    if (tool === "pan") {
      event.currentTarget.setPointerCapture(event.pointerId);
      interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "pan", dragged: false };
      return;
    }
    const point = pointAt(event);
    const nodeHit = transformMode === "resize" ? pickNode(editorRef.current.document, point, zoom) : undefined;
    const hit = nodeHit?.elementId ?? pickElement(editorRef.current.document, point, zoom);
    if (isDrawingTool(tool)) {
      if (hit) setEditorState(selectForPointerDown(editorRef.current, hit, event.shiftKey));
      event.currentTarget.setPointerCapture(event.pointerId);
      setEditorState(beginGesture(editorRef.current));
      interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "draw", dragged: false, start: point, startClient: { x: event.clientX, y: event.clientY }, tool, ids: [id()] };
      return;
    }
    if (tool !== "select") return;
    if (hit) {
      const next = selectForPointerDown(editorRef.current, hit, event.shiftKey);
      setEditorState(next);
      if (!next.selection.includes(hit)) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setEditorState(beginGesture(next));
      const anchor = selectedNodeAnchor(nodeHit, next.selection);
      interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "move", ids: next.selection, ...(anchor ? { anchor } : {}), startClient: { x: event.clientX, y: event.clientY }, dragged: false, shiftKey: event.shiftKey };
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "marquee", start: point, startClient: { x: event.clientX, y: event.clientY }, dragged: false, shiftKey: event.shiftKey, document: editorRef.current.document };
  };

  const onCanvasDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    const point = screenPointToMm(clientPointToCanvas({ x: event.clientX, y: event.clientY }, event.currentTarget.getBoundingClientRect()), { x: 0, y: 0 }, zoom, panMm);
    const hit = pickElement(editorRef.current.document, point, zoom);
    if (canActivateRotation(tool, editorRef.current.selection, hit)) {
      event.preventDefault();
      setCenterHover(undefined);
      setTransformMode("rotate");
    }
  };

  const onCanvasPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    setCursorPoint(canvasPointAt(event));
    const active = interaction.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.kind === "marquee" && active.start && active.startClient) {
      if (!movementExceedsThreshold(active.startClient, { x: event.clientX, y: event.clientY })) return;
      active.dragged = true;
      setMarquee({ start: active.start, end: pointAt(event) });
      return;
    }
    if (active.kind === "resize" && active.ids && active.handle && active.handle !== "center") {
      const element = active.element;
      const command = active.ids.length === 1 && element && element.type !== "line" ? (() => { const geometry = resizeHandle(element, active.handle as ResizeHandle, pointAt(event)); return resizeElement(element.id, geometry.position, geometry.size); })() : resizeElements(active.ids, active.handle as ResizeHandle, pointAt(event));
      setEditorState(previewGestureFromBase(editorRef.current, command));
      active.dragged = true;
      return;
    }
    if (active.kind === "rotate" && active.ids && active.center && active.start) {
      const rotation = rotationFromDrag(active.element?.rotation ?? 0, active.center, active.start, pointAt(event), event.shiftKey ? Math.PI / 12 : 0);
      setEditorState(previewGestureFromBase(editorRef.current, active.ids.length === 1 && active.element ? rotateElement(active.element.id, rotation) : rotateElementsAroundCenter(active.ids, rotation - (active.element?.rotation ?? 0))));
      active.dragged = true;
      return;
    }
    if (active.kind === "pan") {
      const delta = screenDeltaToMm({ x: event.clientX - active.lastX, y: event.clientY - active.lastY }, zoom);
      active.lastX = event.clientX;
      active.lastY = event.clientY;
      if (delta.x === 0 && delta.y === 0) return;
      active.dragged = true;
      const viewport = useViewportStore.getState();
      setPanMm({ x: viewport.panMm.x - delta.x, y: viewport.panMm.y - delta.y });
      return;
    }
    if (active.kind === "move" && active.ids && active.startClient) {
      const rawDelta = screenDeltaToMm({ x: event.clientX - active.startClient.x, y: event.clientY - active.startClient.y }, zoom);
      const snapped = snapMoveDelta(editorRef.current.gesture?.base ?? editorRef.current.document, active.ids, rawDelta, zoom, 8, active.anchor);
      setSnapGuide(snapped.guide);
      if (rawDelta.x === 0 && rawDelta.y === 0) return;
      active.dragged = true;
      setEditorState(previewGestureFromBase(editorRef.current, moveElements(active.ids, snapped.delta)));
      return;
    }
    if (!active.start || !active.tool || !active.ids?.[0] || !active.startClient || !movementExceedsThreshold(active.startClient, { x: event.clientX, y: event.clientY })) return;
    const element = newElement(active.tool, document.layers[0]?.id ?? "layer-1", active.start, pointAt(event), active.ids[0]);
    const command = active.previewed ? updateElement(element.id, element.type === "line" ? { start: element.start, end: element.end } : { position: element.position, size: element.size }) : createElement(element);
    setEditorState(previewGesture(editorRef.current, command));
    active.previewed = true;
    active.dragged = true;
  };

  const finishPointer = (event: PointerEvent<HTMLDivElement | HTMLButtonElement>, cancelled: boolean) => {
    const active = interaction.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.kind === "marquee") {
      if (!cancelled && active.start && active.dragged && active.document) {
        const nextIds = marqueeSelection(active.document, active.start, pointAt(event));
        setEditorState(active.shiftKey ? addToSelection(editorRef.current, nextIds) : select(editorRef.current, nextIds));
      } else if (!cancelled && !active.dragged) setEditorState(clearSelection(editorRef.current));
      setMarquee(undefined);
    } else if (active.kind === "resize" && active.ids && active.handle && active.handle !== "center" && !cancelled) {
      const element = active.element;
      const command = active.ids.length === 1 && element && element.type !== "line" ? (() => { const geometry = resizeHandle(element, active.handle as ResizeHandle, pointAt(event)); return resizeElement(element.id, geometry.position, geometry.size); })() : resizeElements(active.ids, active.handle as ResizeHandle, pointAt(event));
      setEditorState(commitGesture(previewGestureFromBase(editorRef.current, command)));
    } else if (active.kind === "rotate" && active.ids && active.center && active.start && !cancelled) {
      const rotation = rotationFromDrag(active.element?.rotation ?? 0, active.center, active.start, pointAt(event), event.shiftKey ? Math.PI / 12 : 0);
      setEditorState(commitGesture(previewGestureFromBase(editorRef.current, active.ids.length === 1 && active.element ? rotateElement(active.element.id, rotation) : rotateElementsAroundCenter(active.ids, rotation - (active.element?.rotation ?? 0)))));
    } else if (["resize", "rotate", "move"].includes(active.kind)) {
      setEditorState(cancelled ? cancelGesture(editorRef.current) : commitGesture(editorRef.current));
    } else if (active.kind === "draw") {
      const end = active.start ? pointAt(event) : undefined;
      const zeroLengthLine = active.tool === "line" && active.start && end && active.start.x === end.x && active.start.y === end.y;
      if (cancelled || !active.dragged || zeroLengthLine) setEditorState(cancelGesture(editorRef.current));
      else if (active.start && active.tool && active.ids?.[0] && end) {
        const element = newElement(active.tool, editorRef.current.document.layers[0]?.id ?? "layer-1", active.start, end, active.ids[0]);
        const command = active.previewed ? updateElement(element.id, element.type === "line" ? { start: element.start, end: element.end } : { position: element.position, size: element.size }) : createElement(element);
        setEditorState(commitGesture(previewGesture(editorRef.current, command)));
      }
    }
    interaction.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setSnapGuide(undefined);
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const next = zoomAtPoint(zoom, panMm, canvasPointAt(event), zoom * Math.pow(1.0015, -event.deltaY));
    setZoom(next.zoom);
    setPanMm(next.panMm);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (interaction.current) {
          setEditorState(cancelGesture(editorRef.current));
          interaction.current = undefined;
          setMarquee(undefined);
          setSnapGuide(undefined);
        }
        setTransformMode("resize");
        return;
      }
      if (selection.length && event.key === "Delete") {
        let next = editorRef.current;
        for (const selectedId of selection) next = dispatch(next, deleteElement(selectedId));
        setEditorState(next);
      }
      if (event.metaKey || event.ctrlKey) {
        if (event.key === "z") setEditorState(event.shiftKey ? redo(editorRef.current) : undo(editorRef.current));
        if (event.key === "y") setEditorState(redo(editorRef.current));
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [selectionKey]);

  const groupPoints = selectedBounds ? groupHandlePoints(selectedBounds) : undefined;
  const handlePoints = selectedElement?.type === "line" ? undefined : selectedElement ? rotatedResizeHandles(selectedElement) : undefined;
  const handleNames: readonly ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const handleStyle = (handle: GroupHandle) => {
     const point = selectedElements.length > 1 ? groupPoints?.[handle] : handle === "center" ? undefined : handlePoints?.[handleNames.indexOf(handle)];
    if (!point) return undefined;
    const screen = pagePointToCanvas(point, zoom, panMm);
    return { left: `${screen.x}px`, top: `${screen.y}px` };
  };
  const rotationPoints = selectedElements.length > 1 && selectedBounds && transformMode === "rotate" ? [groupHandlePoints(selectedBounds).nw, groupHandlePoints(selectedBounds).ne, groupHandlePoints(selectedBounds).se, groupHandlePoints(selectedBounds).sw] : selectedElement && transformMode === "rotate" ? rotationHandlePoints(selectedElement, 18 / zoom) : [];
  const centerStyle = selectedElement ? (() => {
    const point = pagePointToCanvas(elementCenter(selectedElement), zoom, panMm);
    return { left: point.x, top: point.y };
  })() : undefined;
  const centerHoverStyle = centerHover && centerHover.elementId === selectedElement?.id && tool === "select" && transformMode === "resize" && !interaction.current ? (() => {
    const point = pagePointToCanvas(centerHover.point, zoom, panMm);
    return { left: point.x, top: point.y };
  })() : undefined;
  const marqueeStyle = marquee ? (() => {
    const bounds = normalizeBounds(marquee.start, marquee.end);
    const topLeft = pagePointToCanvas({ x: bounds.x, y: bounds.y }, zoom, panMm);
    return { left: topLeft.x, top: topLeft.y, width: bounds.width * zoom, height: bounds.height * zoom };
  })() : undefined;
  const pageStyle = { width: document.page.width * zoom, height: document.page.height * zoom, left: -panMm.x * zoom, top: -panMm.y * zoom };

  const setPage = (width: number, height: number) => {
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) setEditorState(dispatch(editorRef.current, updatePage(width, height)));
  };
  const resetPageInteraction = () => {
    setTransformMode("resize");
    setCenterHover(undefined);
    setMarquee(undefined);
    interaction.current = undefined;
    viewportInteracted.current = false;
    centeredViewport.current = undefined;
    setPanMm({ x: 0, y: 0 });
  };
  const switchPage = (nextPageId: string) => {
    if (nextPageId === project.activePageId) return;
    setProject({ ...project, activePageId: pageId(nextPageId) });
    resetPageInteraction();
  };
  const createPageAndSelect = () => {
    const nextId = pageId(`page-${crypto.randomUUID()}`);
    const nextPage = { id: nextId, page: { width: 1200, height: 900 }, layers: document.layers, elements: [] };
    const nextProject: ProjectSnapshot = { ...project, revision: revision(project.revision + 1), pages: [...project.pages, nextPage], activePageId: nextId };
    setProject(nextProject);
    resetPageInteraction();
  };
  const applyPalette = (color: string | null, property: "fill" | "stroke") => {
    if (selection.length && !(property === "stroke" && color === null)) setEditorState(dispatch(editorRef.current, property === "fill" ? updateElementStyles(selection, { fill: color }) : updateElementStyles(selection, { stroke: color! })));
  };

  const commitGeometry = (element: PropertyElement, field: GeometryField) => {
    const key = `${selectedElements.length > 1 ? "group" : element.id}:${field}`;
    const raw = drafts[key];
    if (raw === undefined) return;
    const value = Number(raw.trim());
    if (!raw.trim() || !Number.isFinite(value) || value <= 0) {
      setDrafts((current) => ({ ...current, [key]: formatMm(geometryValue(element, field)) }));
      return;
    }
    setDrafts((current) => { const next = { ...current }; delete next[key]; return next; });
    if (selectedElements.length > 1 && selectedBounds) {
      const current = field === "x" ? selectedBounds.x : field === "y" ? selectedBounds.y : field === "width" ? selectedBounds.width : selectedBounds.height;
      if (field === "x" || field === "y") setEditorState(dispatch(editorRef.current, moveElements(selection, { x: field === "x" ? value - current : 0, y: field === "y" ? value - current : 0 })));
       else setEditorState(dispatch(editorRef.current, resizeElements(selection, "se", { x: field === "width" ? selectedBounds.x + value : selectedBounds.x + selectedBounds.width, y: field === "height" ? selectedBounds.y + value : selectedBounds.y + selectedBounds.height }, groupAspectLock)));
    } else setEditorState(dispatch(editorRef.current, updateElement(element.id, geometryPatch(element, field, value))));
  };

  const cornerRadiusField = (element: Extract<Element, { type: "rectangle" }>) => {
    const key = `${element.id}:cornerRadius`;
    return <label className="field"><span>Radio</span><input inputMode="decimal" min="0" aria-label="Radio de esquina en milímetros" value={drafts[key] ?? formatMm(element.cornerRadius)} onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))} onBlur={() => {
      const value = Number((drafts[key] ?? "").trim());
      if (Number.isFinite(value) && value >= 0) {
        setDrafts((current) => { const next = { ...current }; delete next[key]; return next; });
        setEditorState(dispatch(editorRef.current, updateElement(element.id, cornerRadiusPatch(value)!)));
      } else setDrafts((current) => ({ ...current, [key]: formatMm(element.cornerRadius) }));
    }} /></label>;
  };

  const dimensionIcon = (kind: "width" | "height", label: "Ancho" | "Alto") => <span className="dimension-icon" aria-label={label} title={label}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === "width" ? <><path d="M2 8h12M5 5 2 8l3 3M11 5l3 3-3 3" /><path d="M2 3v10M14 3v10" /></> : <><path d="M8 2v12M5 5l3-3 3 3M5 11l3 3 3-3" /><path d="M3 2h10M3 14h10" /></>}</svg></span>;
  const geometryInput = (element: PropertyElement, field: GeometryField, label: string, visibleLabel: ReactNode = label) => {
     const key = `${selectedElements.length > 1 ? "group" : element.id}:${field}`;
    return <label className="field"><span>{visibleLabel}</span><input inputMode="decimal" aria-label={`${label} en milímetros`} value={drafts[key] ?? formatMm(geometryValue(element, field))} onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))} onBlur={() => commitGeometry(element, field)} onKeyDown={(event) => {
      if (event.key === "Enter") event.currentTarget.blur();
      if (event.key === "Escape") {
        event.stopPropagation();
        setDrafts((current) => { const next = { ...current }; delete next[key]; return next; });
        event.currentTarget.blur();
      }
    }} /></label>;
  };
  const rotationField = (element: Element) => {
    const key = `${element.id}:rotation`;
    const restore = () => setDrafts((current) => ({ ...current, [key]: formatMm(rotationDegreesValue(element)) }));
    const commit = () => {
      const raw = drafts[key];
      if (raw === undefined) return;
      const patch = rotationPatch(raw, element.rotation);
      if (!raw.trim() || !Number.isFinite(Number(raw.trim()))) { restore(); return; }
      setDrafts((current) => { const next = { ...current }; delete next[key]; return next; });
      if (patch) setEditorState(dispatch(editorRef.current, rotateElement(element.id, patch.rotation)));
    };
    return <div className="property-card property-card-rotation" role="group" aria-label="Rotación"><label className="field"><span className="rotation-property-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12.7 5A5.5 5.5 0 1 0 13 10" /><path d="m10 2 3 3-4 .5" /></svg></span><input inputMode="decimal" aria-label="Rotación en grados" value={drafts[key] ?? formatMm(rotationDegreesValue(element))} onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))} onBlur={commit} onKeyDown={(event) => {
      if (event.key === "Enter") { event.preventDefault(); commit(); event.currentTarget.blur(); }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setDrafts((current) => { const next = { ...current }; delete next[key]; return next; });
        event.currentTarget.blur();
      }
    }} /><span>°</span></label></div>;
  };

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand">NODRA <span>EDITOR</span></div>
      <nav aria-label="Modo de espacio de trabajo"><button className={mode === "design" ? "active" : ""} onClick={() => setMode("design")}>Diseño</button><button className={mode === "prepare" ? "active" : ""} onClick={() => setMode("prepare")}>Preparar <small>Vista previa</small></button></nav>
      <div className="top-actions"><button aria-label="Deshacer" onClick={() => setEditorState(undo(editorRef.current))}>↶</button><button aria-label="Rehacer" onClick={() => setEditorState(redo(editorRef.current))}>↷</button><span className="project-name">Diseño sin título</span></div>
    </header>
    {mode === "prepare" ? <section className="prepare"><div><div className="prepare-icon">◇</div><h1>Preparar aún no está disponible</h1><p>Nodra ofrece actualmente solo un espacio de trabajo de Diseño sin conexión. No hay hardware conectado, controlado ni listo.</p><button onClick={() => setMode("design")}>Volver a Diseño</button></div></section> : <div className="workspace">
      <section className="properties-bar" aria-label="Barra de propiedades">
        <div className="page-selector"><label>Página<select aria-label="Página activa" value={project.activePageId} onChange={(event) => switchPage(event.target.value)}>{project.pages.map((page, index) => <option key={page.id} value={page.id}>{index + 1} · {page.page.width} × {page.page.height} mm</option>)}</select></label><button type="button" onClick={createPageAndSelect}>+ Nueva página</button></div>
          {selectedElements.length > 0 ? <div className="property-fields">
            {propertyElement && <><div className="property-card" role="group" aria-label="Posición">{geometryInput(propertyElement, "x", "X")}{geometryInput(propertyElement, "y", "Y")}</div><div className="property-card property-card-dimensions" role="group" aria-label="Dimensiones">{geometryInput(propertyElement, "width", "Ancho", dimensionIcon("width", "Ancho"))}{geometryInput(propertyElement, "height", "Alto", dimensionIcon("height", "Alto"))}{selectedElements.length > 1 && <button type="button" aria-label="Bloquear proporción del grupo" aria-pressed={groupAspectLock} onClick={() => setGroupAspectLock((current) => !current)}>{groupAspectLock ? "🔒" : "⌁"}</button>}</div></>}{selectedElement?.type === "rectangle" && <div className="property-card property-card-radius" role="group" aria-label="Radio de esquina">{cornerRadiusField(selectedElement)}</div>}
           {selectedElement && rotationField(selectedElement)}
        </div> : <p className="muted">Seleccione un objeto para editar sus propiedades.</p>}
      </section>
      <aside className="workspace-tools"><div className="tool-column" role="toolbar" aria-label="Herramientas de diseño">{(["select", "rectangle", "ellipse", "line", "pan"] as const).map((item) => <ToolButton key={item} label={toolCursorLabels[item]} icon={item} active={tool === item} onClick={() => { setTransformMode("resize"); setTool(item); }} />)}</div></aside>
      <section className="canvas-area">
        <header className="canvas-header"><span>DISEÑO / SIN TÍTULO</span><span>{document.elements.length} objetos · {document.page.width} × {document.page.height} mm</span><div className="zoom-controls"><button aria-label="Alejar" onClick={() => setZoom(zoom - 0.5)}>−</button><span className="zoom-label">{Math.round(zoom * 100 / 3)}%</span><button aria-label="Acercar" onClick={() => setZoom(zoom + 0.5)}>+</button></div></header>
        <div ref={canvas} className={grid ? "canvas" : "canvas no-grid"} onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove} onPointerUp={(event) => finishPointer(event, false)} onPointerCancel={(event) => finishPointer(event, true)} onPointerLeave={() => setCursorPoint(undefined)} onDoubleClick={onCanvasDoubleClick} onWheel={onWheel}>
          <div className="page" style={pageStyle}><div className="page-svg" dangerouslySetInnerHTML={{ __html: rendered.success ? rendered.svg : "" }} /></div>
          {centerHoverStyle && <div className="selection-center-feedback" style={centerHoverStyle} aria-hidden="true"><span className="selection-center-mark">×</span><span className="selection-center-label">centro</span></div>}
           {transformMode === "resize" && (handlePoints || groupPoints) && <div className="resize-handles">{handleNames.map((handle) => <button key={handle} type="button" className={`resize-handle resize-handle-${handle}`} data-resize-handle={handle} aria-label={`Redimensionar ${handle}`} style={handleStyle(handle)} onPointerDown={(event) => resizePointerDown(event, handle)} onPointerUp={(event) => finishPointer(event, false)} onPointerCancel={(event) => finishPointer(event, true)} />)}{groupPoints && <button type="button" className="resize-handle resize-handle-center" data-resize-handle="center" aria-label="Centro del grupo" style={handleStyle("center")} onPointerDown={(event) => event.stopPropagation()} />}</div>}
           {transformMode === "rotate" && selectedElements.length > 0 && <div className="rotation-controls" aria-label="Controles de rotación"><span className="rotation-center" style={selectedElements.length > 1 && selectedBounds ? { left: pagePointToCanvas(groupCenter(selectedBounds), zoom, panMm).x, top: pagePointToCanvas(groupCenter(selectedBounds), zoom, panMm).y } : centerStyle} aria-hidden="true" />{rotationPoints.map((point, index) => { const screen = pagePointToCanvas(point, zoom, panMm); return <button key={index} type="button" className="rotation-handle" aria-label={`Rotar objeto, control ${index + 1}`} style={{ left: screen.x, top: screen.y }} onPointerDown={rotationPointerDown} onPointerUp={(event) => finishPointer(event, false)} onPointerCancel={(event) => finishPointer(event, true)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 8A6 6 0 1 0 16 12" /><path d="m12.5 4 3 4-5 .5" /></svg></button>; })}</div>}
          {marqueeStyle && <div className="marquee" style={marqueeStyle} />}
          {cursorPoint && <span className="tool-cursor" style={{ left: cursorPoint.x, top: cursorPoint.y }} aria-label={`Herramienta activa: ${toolCursorLabels[tool]}`}>{toolCursorIcons[tool]}</span>}
          <span className="canvas-hint">Clic: relleno · clic derecho: contorno · {toolCursorLabels[tool]}</span>
        </div>
      </section>
      <aside className="inspector">
        <section><div className="panel-title">PÁGINA</div><div className="preset-row"><button onClick={() => setPage(1200, 900)}>Horizontal</button><button onClick={() => setPage(900, 1200)}>Vertical</button></div><div className="fields"><Field label="W" value={document.page.width} onChange={(value) => setPage(value, document.page.height)} /><Field label="H" value={document.page.height} onChange={(value) => setPage(document.page.width, value)} /></div><label className="grid-toggle"><input type="checkbox" checked={grid} onChange={(event) => setGrid(event.target.checked)} /> Mostrar cuadrícula del espacio de trabajo</label></section>
        <section><div className="panel-title">APARIENCIA</div><div className="muted">Paleta: clic izquierdo para relleno · clic derecho para contorno</div><div className="palette"><button className="swatch no-fill" aria-label="Sin relleno" title="Sin relleno" onClick={() => applyPalette(null, "fill")} onContextMenu={(event) => event.preventDefault()}>×</button>{palette.map((color) => <button key={color} className="swatch" aria-label={`Color ${color}`} title={`Clic izquierdo: relleno · clic derecho: contorno (${color})`} style={{ background: color }} onClick={() => applyPalette(color, "fill")} onContextMenu={(event) => { event.preventDefault(); applyPalette(color, "stroke"); }} />)}</div></section>
        <section><div className="panel-title">CAPAS</div>{document.layers.map((layer) => <div className="layer" key={layer.id}><span>{layer.name}</span><span>{layer.visible ? "Visible" : "Oculta"}</span></div>)}</section>
      </aside>
    </div>}
    <footer className="statusbar"><span className={`status-dot ${persist.state === "saving" ? "saving" : ""}`} />{persist.message}</footer>
  </main>;
}

const toolDescriptions: Record<string, string> = { Seleccion: "Seleccione, coloque o transforme objetos.", Rectángulo: "Dibuje formas rectangulares.", Elipse: "Dibuje formas elípticas.", Línea: "Dibuje líneas rectas.", Desplazar: "Desplace el espacio de trabajo." };
function ToolIcon({ icon }: { icon: Tool }) {
  const shape = icon === "select" ? <path d="m5 3 13 8-6 2-3 6z" /> : icon === "rectangle" ? <rect x="5" y="5" width="14" height="14" rx="1" /> : icon === "ellipse" ? <circle cx="12" cy="12" r="7" /> : icon === "line" ? <path d="M5 19 19 5" /> : <><path d="M12 4v16M4 12h16" /><path d="m9 7 3-3 3 3M9 17l3 3 3-3M7 9l-3 3 3 3M17 9l3 3-3 3" /></>;
  return <svg className="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shape}</svg>;
}
function ToolButton({ label, icon, active, onClick }: { label: string; icon: Tool; active: boolean; onClick: () => void }) {
  const description = `${label} — ${toolDescriptions[label]}`;
  return <button className={active ? "tool active" : "tool"} aria-label={label} aria-pressed={active} title={description} aria-description={description} onClick={onClick}><ToolIcon icon={icon} /><small>{label}</small><span className="tool-description" role="tooltip">{description}</span></button>;
}
function Field({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="field"><span>{label}</span><input type="number" min="1" step="0.1" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
