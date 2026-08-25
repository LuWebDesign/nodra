import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode, type WheelEvent } from "react";
import { createProject, elementId, layerId, pageId, revision, type DocumentSnapshot, type Element, type ElementId, type PointMm, type ProjectSnapshot, type SplineElement } from "@nodra/domain";
import { addToSelection, appendSplineNode, beginGesture, cancelGesture, clearSelection, closePath, closeSplineElement, commitGesture, createElement, createPathCubicNode, createPathNode, deleteContourNodes, deleteElement, deleteElementNodes, deletePathNodes, dispatch, duplicateElements, flipElements, insertFormaNode, moveElements, movePathHandle, movePathNode, openPath, updateSplineNode, previewGesture, previewGestureFromBase, redo, resizeElement, resizeElements, rotateElement, rotateElementsAroundCenter, select, selectForPointerDown, setPathJoin, shapeOperation, splitPathSegment, undo, updateContourNode, updateElement, updateElementNode, updateElementStyles, updatePage, updateSplineHandle, type FlipAxis, type ShapeOperation } from "@nodra/editor-core";
import { boundsOfElements, contourVertexNodes, elementCenter, groupCenter, groupHandlePoints, pathGeometryNodes, realGeometryNodes, resizeHandle, rotatedResizeHandles, rotationFromDrag, rotationHandlePoints, type Direction, type GroupHandle, type ResizeHandle } from "@nodra/geometry";
import { DebouncedAutosave, DexieProjectRepository, requestStoragePersistence } from "@nodra/persistence";
import { renderSvg } from "@nodra/renderer-svg";
import { canActivateRotation, centerPageInCanvas, clientPointToCanvas, cubicPlacementControls, formaNodeKey, hoveredSelectionCenter, isDrawingTool, marqueeSelection, movementExceedsThreshold, normalizeBounds, normalizeDrag, pagePointToCanvas, pathGuides, pickElement, pickFormaNode, pickFormaSegment, pickNode, pickPathNode, pickPathSegment, pointerDownIntent, screenDeltaToMm, screenPointToMm, selectedNodeAnchor, selectedPathAnchorIds, alignmentGuides, snapMoveDelta, zoomAtPoint, type AlignmentGuide, type ContourNodeHit, type FormaNodeHit, type NodeHit, type PathNodeHit, type SnapGuide, type TransformMode } from "./interaction.js";
import { aspectGeometryPatch, aspectSize, formatMm, geometryValue, rotationDegreesValue, rotationPatch, type GeometryField, type PropertyElement, type RotatableElement } from "./propertyBar.js";
import { useDocumentStore, usePersistenceStore, useUiStore, useViewportStore, type Tool } from "./stores.js";
import { pathJoinGuidance, pathJoinOptions } from "./pathJoins.js";

const defaultStyle = { stroke: "#000000", strokeWidth: 1 };
const defaultClosedFill = "rgba(101,217,255,0.22)";
const isPropertyElement = (element: Element): element is PropertyElement => element.type === "rectangle" || element.type === "ellipse";
const isRotatableElement = (element: Element): element is RotatableElement => element.type !== "path" && element.type !== "spline";
const palette = [
  { name: "Negro", color: "#111827" }, { name: "Rojo", color: "#ef4444" }, { name: "Naranja", color: "#f59e0b" },
  { name: "Verde", color: "#22c55e" }, { name: "Azul", color: "#3b82f6" }, { name: "Violeta", color: "#a855f7" },
  { name: "Blanco", color: "#ffffff" }, { name: "Rosa", color: "#ec4899" }, { name: "Cian", color: "#22d3ee" },
  { name: "Lima", color: "#a3e635" }, { name: "Gris", color: "#9ca3af" },
] as const;
const id = () => elementId(`element-${crypto.randomUUID()}`);
const newElement = (tool: Exclude<Tool, "select" | "pan" | "forma" | "pen" | "spline">, layer: string, start: PointMm, end: PointMm, nextId = id()): Element => tool === "line"
  ? { type: "line", id: nextId, layerId: layerId(layer), start, end, rotation: 0, style: defaultStyle }
  : tool === "rectangle"
    ? { type: "rectangle", id: nextId, layerId: layerId(layer), ...normalizeDrag(start, end), cornerRadius: 0, rotation: 0, style: defaultStyle }
     : { type: tool, id: nextId, layerId: layerId(layer), ...normalizeDrag(start, end), rotation: 0, style: defaultStyle };
const splinePathData = (spline: SplineElement): string => {
  const first = spline.nodes[0];
  if (!first) return "";
  let path = `M ${first.anchor.x} ${first.anchor.y}`;
  for (let index = 1; index < spline.nodes.length; index += 1) {
    const start = spline.nodes[index - 1]!;
    const end = spline.nodes[index]!;
    const out = start.outHandle ? { x: start.anchor.x + start.outHandle.dx, y: start.anchor.y + start.outHandle.dy } : start.anchor;
    const incoming = end.inHandle ? { x: end.anchor.x + end.inHandle.dx, y: end.anchor.y + end.inHandle.dy } : end.anchor;
    path += ` C ${out.x} ${out.y} ${incoming.x} ${incoming.y} ${end.anchor.x} ${end.anchor.y}`;
  }
  if (spline.closed && spline.nodes.length > 1) {
    const last = spline.nodes.at(-1)!;
    const out = last.outHandle ? { x: last.anchor.x + last.outHandle.dx, y: last.anchor.y + last.outHandle.dy } : last.anchor;
    const incoming = first.inHandle ? { x: first.anchor.x + first.inHandle.dx, y: first.anchor.y + first.inHandle.dy } : first.anchor;
    path += ` C ${out.x} ${out.y} ${incoming.x} ${incoming.y} ${first.anchor.x} ${first.anchor.y} Z`;
  }
  return path;
};

type ActiveInteraction = {
  pointerId: number;
  lastX: number;
  lastY: number;
  kind: "move" | "pan" | "draw" | "resize" | "rotate" | "marquee" | "contour-node" | "path-node" | "spline-node" | "spline-handle" | "pen-place";
  ids?: readonly ElementId[];
  dragged: boolean;
  start?: PointMm;
  placement?: PointMm;
  startClient?: PointMm;
  previewed?: boolean;
  tool?: Exclude<Tool, "select" | "pan">;
  handle?: GroupHandle;
  anchor?: NodeHit;
  formaNode?: FormaNodeHit;
  element?: Element;
  document?: DocumentSnapshot;
  shiftKey?: boolean;
  center?: PointMm;
  contourNode?: ContourNodeHit;
  pathNode?: PathNodeHit;
  pathId?: ElementId;
  splineId?: ElementId;
  splineNodeId?: string;
  splineHandle?: "in" | "out";
};

type FormaNodeOverlay =
  | { readonly kind: "contour"; readonly key: string; readonly elementId: ElementId; readonly point: PointMm; readonly contour: ContourNodeHit }
  | { readonly kind: "path"; readonly key: string; readonly elementId: ElementId; readonly point: PointMm; readonly nodeIndex: number; readonly pathNode?: PathNodeHit };

type InspectorTab = "properties" | "transform" | "text";

const toolCursorIcons: Record<Tool, string> = { select: "↖", forma: "⌘", pen: "✒", spline: "✒", rectangle: "□", ellipse: "○", line: "╱", pan: "✣" };
const toolCursorLabels: Record<Tool, string> = { select: "Seleccion", forma: "Forma", pen: "Pluma", spline: "Spline", rectangle: "Rectángulo", ellipse: "Elipse", line: "Línea", pan: "Desplazar" };

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
  const [alignmentGuideState, setAlignmentGuideState] = useState<readonly AlignmentGuide[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [cursorPoint, setCursorPoint] = useState<PointMm>();
  const [aspectLock, setAspectLock] = useState(false);
  const [cornerRadiusLock, setCornerRadiusLock] = useState(false);
  const [centerHover, setCenterHover] = useState<{ elementId: ElementId; point: PointMm }>();
  const [transformMode, setTransformMode] = useState<TransformMode>("resize");
  const [selectedFormaNodeKeys, setSelectedFormaNodeKeys] = useState<readonly string[]>([]);
  const [selectedSplineNodeKey, setSelectedSplineNodeKey] = useState<string>();
  const [selectedPathSegment, setSelectedPathSegment] = useState<{ readonly elementId: ElementId; readonly segmentIndex: number }>();
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("properties");
  const [transformDirection, setTransformDirection] = useState<Direction>("center");
  const [directionTooltipVisible, setDirectionTooltipVisible] = useState(false);
  const [penDraftPoint, setPenDraftPoint] = useState<PointMm>();
  const [splineDraftPoint, setSplineDraftPoint] = useState<PointMm>();
  const [activeSplineId, setActiveSplineId] = useState<ElementId>();
  const repository = useMemo(() => new DexieProjectRepository(), []);
  const autosave = useMemo(() => new DebouncedAutosave(repository), [repository]);
  const canvas = useRef<HTMLDivElement>(null);
  const editorRef = useRef(editor);
  const interaction = useRef<ActiveInteraction | undefined>(undefined);
  const viewportInteracted = useRef(false);
  const centeredViewport = useRef<string | undefined>(undefined);
  const recoveredNotice = useRef(false);
  const directionTooltipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  editorRef.current = editor;

  useEffect(() => () => {
    if (directionTooltipTimer.current) clearTimeout(directionTooltipTimer.current);
  }, []);

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
      recoveredNotice.current = true;
      persist.set("recovered", "Revisión local recuperada");
    });
    return () => {
      removeEventListener("online", on);
      removeEventListener("offline", off);
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
    : selectedElement && isPropertyElement(selectedElement) ? selectedElement : undefined;
  const selectionKey = selection.join(":");
  useEffect(() => { setTransformMode("resize"); }, [tool, project.activePageId, selectionKey]);
  useEffect(() => {
    setActiveSplineId(undefined);
    setSplineDraftPoint(undefined);
    setSelectedSplineNodeKey(undefined);
    if (tool !== "spline" && tool !== "forma" && editorRef.current.selection.some((id) => editorRef.current.document.elements.some((element) => element.id === id && element.type === "spline"))) setEditorState(clearSelection(editorRef.current));
  }, [tool]);
  useEffect(() => { setSelectedPathSegment(undefined); setSelectedFormaNodeKeys([]); }, [tool, project.activePageId]);

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
     const defs = globalThis.document.createElementNS("http://www.w3.org/2000/svg", "defs");
     for (const [id, color] of [["bezier-guide-incoming", "#f59e0b"], ["bezier-guide-outgoing", "#2563eb"]] as const) {
       const marker = globalThis.document.createElementNS("http://www.w3.org/2000/svg", "marker");
       marker.id = id; marker.setAttribute("viewBox", "0 0 6 6"); marker.setAttribute("refX", "5"); marker.setAttribute("refY", "3"); marker.setAttribute("markerWidth", "6"); marker.setAttribute("markerHeight", "6"); marker.setAttribute("orient", "auto-start-reverse"); marker.setAttribute("markerUnits", "userSpaceOnUse");
       const arrow = globalThis.document.createElementNS("http://www.w3.org/2000/svg", "path");
       arrow.setAttribute("d", "M 0 0 L 6 3 L 0 6 z"); arrow.setAttribute("fill", color); marker.append(arrow); defs.append(marker);
     }
     overlay.append(defs);
     const guideLine = (anchor: PointMm, control: PointMm, direction: "incoming" | "outgoing") => {
       const line = globalThis.document.createElementNS("http://www.w3.org/2000/svg", "line");
       const a = point(anchor); const b = point(control); const color = "#1683ff";
       line.dataset.bezierGuide = direction; line.setAttribute("x1", String(a.x)); line.setAttribute("y1", String(a.y)); line.setAttribute("x2", String(b.x)); line.setAttribute("y2", String(b.y)); line.setAttribute("stroke", color); line.setAttribute("stroke-width", "1"); line.setAttribute("stroke-dasharray", "3 2"); line.style.pointerEvents = "none"; overlay.append(line);
     };
     for (const element of selectedElements) if (element.type === "path") for (const guide of pathGuides(element)) guideLine(guide.anchor, guide.control, guide.direction);
    if (transformMode === "resize" && tool !== "forma") for (const element of selectedElements.filter((candidate) => candidate.type !== "spline")) for (const [nodeIndex, node] of realGeometryNodes(element).entries()) {
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
const mark = globalThis.document.createElementNS("http://www.w3.org/2000/svg", "rect");
      mark.setAttribute("x", String(screen.x - 2.5));
      mark.setAttribute("y", String(screen.y - 2.5));
      mark.setAttribute("width", "5");
      mark.setAttribute("height", "5");
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
    const pen = interaction.current;
    if (tool === "pen" && pen?.kind === "pen-place" && pen.start && pen.placement && cursorPoint) {
      const end = pen.placement;
      const pointer = screenPointToMm(cursorPoint, { x: 0, y: 0 }, zoom, panMm);
      const controls = cubicPlacementControls(pen.start, end, pointer);
       guideLine(pen.start, controls.control1, "outgoing");
       guideLine(end, controls.control2, "incoming");
       for (const [value, direction] of [[controls.control1, "outgoing"], [controls.control2, "incoming"]] as const) {
         const mark = globalThis.document.createElementNS("http://www.w3.org/2000/svg", "circle");
         const screen = point(value); mark.dataset.bezierGuideControl = direction; mark.setAttribute("cx", String(screen.x)); mark.setAttribute("cy", String(screen.y)); mark.setAttribute("r", "4"); mark.setAttribute("fill", "#ffffff"); mark.setAttribute("stroke", direction === "incoming" ? "#f59e0b" : "#2563eb"); mark.setAttribute("stroke-width", "1.5"); mark.style.pointerEvents = "none"; overlay.append(mark);
      }
    }
    target.append(overlay);
    return () => overlay.remove();
  }, [cursorPoint, document, panMm, selectedElements, snapGuide, tool, transformMode, zoom]);

  useEffect(() => {
    if (!interaction.current) {
      setSnapGuide(undefined);
      setAlignmentGuideState([]);
    }
  }, [editor]);
  useEffect(() => {
    const preserveRecoveryNotice = recoveredNotice.current;
    recoveredNotice.current = false;
    if (!preserveRecoveryNotice) persist.set(online ? "saving" : "offline", online ? "Guardando localmente" : "Sin conexión — la edición permanece local");
    autosave.schedule({ id: project.id, name: "Diseño sin título", updatedAt: Date.now() }, project);
    void autosave.flush().then((result) => { if (result?.ok && !preserveRecoveryNotice) persist.set("saved", "Guardado localmente"); });
  }, [project, online]);

  const rendered = renderSvg(document, { zoom: 1, panMm: { x: 0, y: 0 } });
  const setEditorState = (next: typeof editor) => { editorRef.current = next; setEditor(next); };
  const canvasPointAt = (event: PointerEvent<HTMLElement> | WheelEvent<HTMLElement>) => clientPointToCanvas({ x: event.clientX, y: event.clientY }, canvas.current!.getBoundingClientRect());
  const pointAt = (event: PointerEvent<HTMLElement> | WheelEvent<HTMLElement>) => screenPointToMm(canvasPointAt(event), { x: 0, y: 0 }, zoom, panMm);

  useEffect(() => {
    if (!textDraft) return;
    const frame = requestAnimationFrame(() => textInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [textDraft]);

  const commitTextDraft = () => {
    const draft = textDraft;
    if (!draft?.value.trim()) { setTextDraft(undefined); return; }
    const current = editorRef.current;
    const lines = draft.value.split("\\n");
    const text: TextElement = {
      type: "text", id: draft.elementId ?? id(), layerId: layerId(current.document.layers[0]?.id ?? "layer-1"),
      position: draft.position, size: { width: Math.max(24, Math.max(...lines.map((line) => line.length), 1) * 13), height: Math.max(24, lines.length * 29) }, text: draft.value,
      fontFamily: textFontFamily, fontSize: 24, fontWeight: "normal", fontStyle: "normal", textAlign: "left", lineHeight: 1.2, rotation: 0,
      style: { stroke: "#000000", fill: "#000000", strokeWidth: 0.1 },
    };
    const next = draft.elementId ? dispatch(current, updateElement(draft.elementId, { text: text.text, fontFamily: text.fontFamily })) : dispatch(current, createElement(text));
    setEditorState(select(next, [text.id]));
    setTextDraft(undefined);
  };

  const addPenPoint = (point: PointMm) => {
    const current = editorRef.current;
    if (!penDraftPoint) {
      setPenDraftPoint(point);
      return;
    }
    const firstId = `path-node-${crypto.randomUUID()}`;
    const secondId = `path-node-${crypto.randomUUID()}`;
    const path = { type: "path" as const, id: id(), layerId: layerId(current.document.layers[0]?.id ?? "layer-1"), nodes: [{ id: firstId, anchor: penDraftPoint, join: "corner" as const }, { id: secondId, anchor: point, join: "corner" as const }], segments: [{ type: "line" as const, startNodeId: firstId, endNodeId: secondId }], closed: false, style: defaultStyle };
    const next = dispatch(current, createElement(path));
    setPenDraftPoint(undefined);
    setEditorState(select(next, [path.id]));
  };

  const addSplinePoint = (point: PointMm) => {
    const current = editorRef.current;
    const active = activeSplineId ? current.document.elements.find((element): element is SplineElement => element.id === activeSplineId && element.type === "spline") : undefined;
    if (!active) {
      if (!splineDraftPoint) {
        setSplineDraftPoint(point);
        return;
      }
      const spline: SplineElement = { type: "spline", id: id(), layerId: layerId(document.layers[0]?.id ?? "layer-1"), nodes: [{ id: `spline-node-${crypto.randomUUID()}`, anchor: splineDraftPoint, continuity: "smooth" }, { id: `spline-node-${crypto.randomUUID()}`, anchor: point, continuity: "smooth" }], closed: false, style: defaultStyle };
      const next = dispatch(current, createElement(spline));
      setSplineDraftPoint(undefined);
      setEditorState(select(next, [spline.id]));
      setActiveSplineId(spline.id);
      return;
    }
    const first = active.nodes[0];
    if (!active.closed && active.nodes.length >= 3 && first && Math.hypot(first.anchor.x - point.x, first.anchor.y - point.y) <= 8 / zoom) {
      setEditorState(dispatch(current, closeSplineElement(active.id)));
      setActiveSplineId(undefined);
      return;
    }
    const next = dispatch(current, appendSplineNode(active.id, { id: `spline-node-${crypto.randomUUID()}`, anchor: point, continuity: "smooth" }));
    setEditorState(select(next, [active.id]));
  };

      const selectSplineObject = (event: PointerEvent<SVGPathElement>, spline: SplineElement) => {
        if (tool !== "select") return;
        event.preventDefault();
        event.stopPropagation();
        const next = selectForPointerDown(editorRef.current, spline.id, event.shiftKey);
        setSelectedSplineNodeKey(undefined);
        setEditorState(beginGesture(next));
        event.currentTarget.setPointerCapture(event.pointerId);
        interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "move", ids: next.selection, startClient: { x: event.clientX, y: event.clientY }, dragged: false, shiftKey: event.shiftKey };
      };

      const selectSplineAnchor = (event: PointerEvent<SVGRectElement>, spline: SplineElement, nodeId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedSplineNodeKey(`${spline.id}:${nodeId}`);
    const selected = select(editorRef.current, [spline.id]);
    if (tool === "spline" && nodeId === spline.nodes[0]?.id && activeSplineId === spline.id && !spline.closed && spline.nodes.length >= 3) {
      setEditorState(dispatch(selected, closeSplineElement(spline.id)));
      setSelectedSplineNodeKey(undefined);
      setActiveSplineId(undefined);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setEditorState(beginGesture(selected));
    interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "spline-node", splineId: spline.id, splineNodeId: nodeId, startClient: { x: event.clientX, y: event.clientY }, dragged: false };
  };

  const beginSplineHandle = (event: PointerEvent<SVGElement>, splineId: ElementId, nodeId: string, handle: "in" | "out") => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const selected = select(editorRef.current, [splineId]);
    setEditorState(beginGesture(selected));
    interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "spline-handle", splineId, splineNodeId: nodeId, splineHandle: handle, dragged: false };
  };

  const moveSplineHandle = (event: PointerEvent<SVGElement>) => {
    const active = interaction.current;
    if (!active || active.kind !== "spline-handle" || active.pointerId !== event.pointerId || !active.splineId || !active.splineNodeId || !active.splineHandle || !canvas.current) return;
    const canvasPoint = clientPointToCanvas({ x: event.clientX, y: event.clientY }, canvas.current.getBoundingClientRect());
    const point = screenPointToMm(canvasPoint, { x: 0, y: 0 }, zoom, panMm);
    setEditorState(previewGestureFromBase(editorRef.current, updateSplineHandle(active.splineId, active.splineNodeId, active.splineHandle, point)));
    active.dragged = true;
  };

  const finishSplineHandle = (event: PointerEvent<SVGElement>, cancelled: boolean) => {
    const active = interaction.current;
    if (!active || active.kind !== "spline-handle" || active.pointerId !== event.pointerId) return;
    setEditorState(cancelled ? cancelGesture(editorRef.current) : commitGesture(editorRef.current));
    interaction.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

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
     setAlignmentGuideState([]);
     setSelectedSplineNodeKey(undefined);
     const resizeTarget = tool === "forma" ? null : (event.target as HTMLElement).closest<HTMLElement>("[data-resize-handle]");
    if (resizeTarget) { resizePointerDown(event, resizeTarget.dataset.resizeHandle as ResizeHandle); return; }
    if (tool === "pan") {
      event.currentTarget.setPointerCapture(event.pointerId);
      interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "pan", dragged: false };
      return;
    }
    const point = pointAt(event);
    if (tool === "text") {
      const hit = pickElement(editorRef.current.document, point, zoom);
      const existing = hit ? editorRef.current.document.elements.find((element): element is TextElement => element.id === hit && element.type === "text") : undefined;
      if (existing) { setEditorState(select(editorRef.current, [existing.id])); setTextFontFamily(existing.fontFamily); }
      setTextDraft({ position: existing?.position ?? point, value: existing?.text ?? "", ...(existing ? { elementId: existing.id } : {}) });
      return;
    }
    if (tool === "spline") { addSplinePoint(point); return; }
    if (tool === "pen") {
      const pathNode = pickPathNode(editorRef.current.document, point, zoom);
      if (pathNode) {
        const selectedPath = editorRef.current.document.elements.find((element) => element.id === pathNode.elementId && element.type === "path");
        if (selectedPath?.type === "path" && pathNode.node.kind === "anchor" && selectedPath.nodes[0]?.id === pathNode.node.nodeId && !selectedPath.closed) {
          setPenDraftPoint(undefined);
          setEditorState(dispatch(select(editorRef.current, [pathNode.elementId]), closePath(pathNode.elementId)));
          return;
        }
        setEditorState(select(editorRef.current, [pathNode.elementId]));
        event.currentTarget.setPointerCapture(event.pointerId);
        setEditorState(beginGesture(editorRef.current));
        interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "path-node", pathNode, startClient: { x: event.clientX, y: event.clientY }, dragged: false };
      } else {
        const pathSegmentHit = pickPathSegment(editorRef.current.document, point, zoom);
        if (pathSegmentHit) {
          setPenDraftPoint(undefined);
          setSelectedPathSegment({ elementId: pathSegmentHit.elementId, segmentIndex: pathSegmentHit.segmentIndex });
          setEditorState(select(editorRef.current, [pathSegmentHit.elementId]));
          return;
        }
        const selectedPath = editorRef.current.selection.length === 1 ? editorRef.current.document.elements.find((element) => element.id === editorRef.current.selection[0] && element.type === "path") : undefined;
        const last = selectedPath?.type === "path" && !selectedPath.closed ? selectedPath.nodes.at(-1) : undefined;
        const start = last?.anchor ?? penDraftPoint;
        if (start) {
          event.currentTarget.setPointerCapture(event.pointerId);
          setEditorState(beginGesture(editorRef.current));
          interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "pen-place", start, placement: point, ...(last && selectedPath ? { pathId: selectedPath.id } : {}), startClient: { x: event.clientX, y: event.clientY }, dragged: false };
        } else addPenPoint(point);
      }
      return;
    }
      const formaNodeHit = tool === "forma" ? pickFormaNode(editorRef.current.document, point, zoom) : undefined;
      const contourNodeHit = formaNodeHit?.contourNode;
      const nodeHit = tool !== "forma" && transformMode === "resize" ? pickNode(editorRef.current.document, point, zoom) : undefined;
      const pathSegmentHit = tool === "forma" && !formaNodeHit ? pickPathSegment(editorRef.current.document, point, zoom) : undefined;
      const hit = formaNodeHit?.elementId ?? pathSegmentHit?.elementId ?? nodeHit?.elementId ?? pickElement(editorRef.current.document, point, zoom);
    if (isDrawingTool(tool) && pointerDownIntent(tool, hit) === "draw") {
      event.currentTarget.setPointerCapture(event.pointerId);
      setEditorState(beginGesture(editorRef.current));
      interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "draw", dragged: false, start: point, startClient: { x: event.clientX, y: event.clientY }, tool, ids: [id()] };
      return;
    }
    if (hit) {
      const next = selectForPointerDown(editorRef.current, hit, event.shiftKey);
      setEditorState(next);
      if (!next.selection.includes(hit)) return;
      event.currentTarget.setPointerCapture(event.pointerId);
        if (tool === "forma") {
           if (formaNodeHit && next.selection.includes(formaNodeHit.elementId)) {
             setSelectedPathSegment(undefined);
             const key = formaNodeKey(formaNodeHit);
            setSelectedFormaNodeKeys((current) => event.shiftKey ? current.includes(key) ? current.filter((value) => value !== key) : [...current, key] : [key]);
            setEditorState(beginGesture(next));
             interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "contour-node", ...(contourNodeHit ? { contourNode: contourNodeHit } : {}), formaNode: formaNodeHit, startClient: { x: event.clientX, y: event.clientY }, dragged: false };
           } else if (pathSegmentHit) {
             setSelectedPathSegment({ elementId: pathSegmentHit.elementId, segmentIndex: pathSegmentHit.segmentIndex });
          } else setSelectedPathSegment(undefined);
          return;
       }
       const anchor = selectedNodeAnchor(nodeHit, next.selection);
      if (isDrawingTool(tool)) {
        setEditorState(beginGesture(next));
        interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "draw", ids: [id()], start: point, startClient: { x: event.clientX, y: event.clientY }, dragged: false, shiftKey: event.shiftKey, tool };
      } else {
        setEditorState(beginGesture(next));
        interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "move", ids: next.selection, ...(anchor ? { anchor } : {}), startClient: { x: event.clientX, y: event.clientY }, dragged: false, shiftKey: event.shiftKey };
      }
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedPathSegment(undefined);
    interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "marquee", start: point, startClient: { x: event.clientX, y: event.clientY }, dragged: false, shiftKey: event.shiftKey, document: editorRef.current.document };
  };

  const onCanvasDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    const point = screenPointToMm(clientPointToCanvas({ x: event.clientX, y: event.clientY }, event.currentTarget.getBoundingClientRect()), { x: 0, y: 0 }, zoom, panMm);
    if (!pickElement(editorRef.current.document, point, zoom)) {
      setSelectedSplineNodeKey(undefined);
      setActiveSplineId(undefined);
      setEditorState(clearSelection(editorRef.current));
      return;
    }
    if (tool === "forma") {
      if (pickFormaNode(editorRef.current.document, point, zoom)) return;
      const segment = pickFormaSegment(editorRef.current.document, point, zoom);
      if (segment) {
        setEditorState(dispatch(select(editorRef.current, [segment.elementId]), insertFormaNode(segment.elementId, segment, point)));
      }
      return;
    }
    const hit = pickElement(editorRef.current.document, point, zoom);
    const hitElement = hit ? editorRef.current.document.elements.find((element) => element.id === hit) : undefined;
    if (hitElement?.type === "text") {
      setEditorState(select(editorRef.current, [hitElement.id]));
      setTextFontFamily(hitElement.fontFamily);
      setTextDraft({ position: hitElement.position, value: hitElement.text, elementId: hitElement.id });
      return;
    }
    if (canActivateRotation(tool, editorRef.current.selection, hit) && hitElement && isRotatableElement(hitElement)) {
      event.preventDefault();
      setCenterHover(undefined);
      setTransformMode("rotate");
    }
  };

  const cancelPointerInteraction = () => {
    const active = interaction.current;
    if (!active) return;
    if (["draw", "move", "resize", "rotate", "marquee", "contour-node", "path-node", "spline-node", "spline-handle", "pen-place"].includes(active.kind)) setEditorState(cancelGesture(editorRef.current));
    interaction.current = undefined;
    setMarquee(undefined);
    setSnapGuide(undefined);
    setAlignmentGuideState([]);
    setPenDraftPoint(undefined);
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
      const command = active.ids.length === 1 && element && isPropertyElement(element) ? (() => { const geometry = resizeHandle(element, active.handle as ResizeHandle, pointAt(event)); return resizeElement(element.id, geometry.position, geometry.size); })() : resizeElements(active.ids, active.handle as ResizeHandle, pointAt(event));
      const base = editorRef.current.gesture?.base ?? editorRef.current.document;
      const preview = command.apply(base);
      setAlignmentGuideState(preview.success ? alignmentGuides(preview.document, active.ids, { x: 0, y: 0 }, zoom, 8) : []);
      setEditorState(previewGestureFromBase(editorRef.current, command));
      active.dragged = true;
      return;
    }
    if (active.kind === "rotate" && active.ids && active.center && active.start) {
      const rotation = rotationFromDrag(active.element && isRotatableElement(active.element) ? active.element.rotation : 0, active.center, active.start, pointAt(event), event.shiftKey ? Math.PI / 12 : 0);
      setEditorState(previewGestureFromBase(editorRef.current, active.ids.length === 1 && active.element && isRotatableElement(active.element) ? rotateElement(active.element.id, rotation) : rotateElementsAroundCenter(active.ids, rotation - (active.element && isRotatableElement(active.element) ? active.element.rotation : 0))));
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
      setAlignmentGuideState(alignmentGuides(editorRef.current.gesture?.base ?? editorRef.current.document, active.ids, rawDelta, zoom, 8));
      if (rawDelta.x === 0 && rawDelta.y === 0) return;
      active.dragged = true;
      setEditorState(previewGestureFromBase(editorRef.current, moveElements(active.ids, snapped.delta)));
      return;
    }
     if (active.kind === "spline-node" && active.splineId && active.splineNodeId) {
       active.dragged = true;
       setEditorState(previewGestureFromBase(editorRef.current, updateSplineNode(active.splineId, active.splineNodeId, pointAt(event))));
       return;
     }
     if (active.kind === "path-node" && active.pathNode && active.startClient && movementExceedsThreshold(active.startClient, { x: event.clientX, y: event.clientY })) {
      const pathNode = active.pathNode.node;
      const point = pointAt(event);
      const command = pathNode.kind === "anchor"
        ? movePathNode(active.pathNode.elementId, pathNode.nodeId, point)
        : movePathHandle(active.pathNode.elementId, pathNode.segmentIndex ?? -1, pathNode.handle ?? "control1", point);
      active.dragged = true;
      setEditorState(previewGestureFromBase(editorRef.current, command));
      return;
    }
    if (active.kind === "pen-place" && active.start && active.startClient && movementExceedsThreshold(active.startClient, { x: event.clientX, y: event.clientY })) {
      active.dragged = true;
      if (active.pathId) {
        const end = active.placement ?? pointAt(event);
        const controls = cubicPlacementControls(active.start, end, pointAt(event));
        setEditorState(previewGestureFromBase(editorRef.current, createPathCubicNode(active.pathId, { id: `path-node-${crypto.randomUUID()}`, anchor: end, join: "corner" }, controls.control1, controls.control2)));
      }
      return;
    }
    if (active.kind === "contour-node" && active.formaNode) {
      const point = pointAt(event);
      if (!active.startClient || !movementExceedsThreshold(active.startClient, { x: event.clientX, y: event.clientY })) return;
      active.dragged = true;
      const command = active.formaNode.contourNode ? updateContourNode(active.formaNode.elementId, active.formaNode.contourNode, point) : updateElementNode(active.formaNode.elementId, active.formaNode.nodeIndex ?? -1, point);
      setEditorState(previewGestureFromBase(editorRef.current, command));
      return;
    }
    if (!active.start || !active.tool || !isDrawingTool(active.tool) || !active.ids?.[0] || !active.startClient || !movementExceedsThreshold(active.startClient, { x: event.clientX, y: event.clientY })) return;
    const element = newElement(active.tool, document.layers[0]?.id ?? "layer-1", active.start, pointAt(event), active.ids[0]);
    const command = active.previewed ? updateElement(element.id, element.type === "line" ? { start: element.start, end: element.end } : isPropertyElement(element) ? { position: element.position, size: element.size } : {}) : createElement(element);
    setEditorState(previewGesture(editorRef.current, command));
    active.previewed = true;
    active.dragged = true;
  };

  const finishPointer = (event: PointerEvent<HTMLDivElement | HTMLButtonElement>, cancelled: boolean) => {
    const active = interaction.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.kind === "marquee") {
      if (!cancelled && active.start && active.dragged && active.document) {
        if (tool === "forma") {
          const bounds = normalizeBounds(active.start, pointAt(event));
          const keys = formaNodes.filter((node) => node.point.x >= bounds.x && node.point.x <= bounds.x + bounds.width && node.point.y >= bounds.y && node.point.y <= bounds.y + bounds.height).map((node) => node.key);
          setSelectedFormaNodeKeys((current) => active.shiftKey ? [...new Set([...current, ...keys])] : keys);
        } else {
          const nextIds = marqueeSelection(active.document, active.start, pointAt(event));
          setEditorState(active.shiftKey ? addToSelection(editorRef.current, nextIds) : select(editorRef.current, nextIds));
        }
      } else if (!cancelled && !active.dragged) setEditorState(clearSelection(editorRef.current));
      setMarquee(undefined);
    } else if (active.kind === "resize" && active.ids && active.handle && active.handle !== "center" && !cancelled) {
      const element = active.element;
      const command = active.ids.length === 1 && element && isPropertyElement(element) ? (() => { const geometry = resizeHandle(element, active.handle as ResizeHandle, pointAt(event)); return resizeElement(element.id, geometry.position, geometry.size); })() : resizeElements(active.ids, active.handle as ResizeHandle, pointAt(event));
      setEditorState(commitGesture(previewGestureFromBase(editorRef.current, command)));
    } else if (active.kind === "rotate" && active.ids && active.center && active.start && !cancelled) {
      const rotation = rotationFromDrag(active.element && isRotatableElement(active.element) ? active.element.rotation : 0, active.center, active.start, pointAt(event), event.shiftKey ? Math.PI / 12 : 0);
      setEditorState(commitGesture(previewGestureFromBase(editorRef.current, active.ids.length === 1 && active.element && isRotatableElement(active.element) ? rotateElement(active.element.id, rotation) : rotateElementsAroundCenter(active.ids, rotation - (active.element && isRotatableElement(active.element) ? active.element.rotation : 0)))));
      } else if (["resize", "rotate", "move", "contour-node", "path-node", "spline-node"].includes(active.kind)) {
       setEditorState(cancelled ? cancelGesture(editorRef.current) : commitGesture(editorRef.current));
     } else if (active.kind === "pen-place") {
       if (cancelled || !active.start) { setEditorState(cancelGesture(editorRef.current)); setPenDraftPoint(undefined); }
       else {
         const end = active.placement ?? pointAt(event);
         const node = { id: `path-node-${crypto.randomUUID()}`, anchor: end, join: "corner" as const };
         if (active.pathId) {
           const command = active.dragged ? (() => { const controls = cubicPlacementControls(active.start!, end, pointAt(event)); return createPathCubicNode(active.pathId!, node, controls.control1, controls.control2); })() : createPathNode(active.pathId, node);
           setEditorState(commitGesture(previewGestureFromBase(editorRef.current, command)));
         } else {
           const firstId = `path-node-${crypto.randomUUID()}`;
           const segment = active.dragged ? (() => { const controls = cubicPlacementControls(active.start!, end, pointAt(event)); return { type: "cubicBezier" as const, startNodeId: firstId, endNodeId: node.id, control1: controls.control1, control2: controls.control2 }; })() : { type: "line" as const, startNodeId: firstId, endNodeId: node.id };
           const path = { type: "path" as const, id: id(), layerId: layerId(editorRef.current.document.layers[0]?.id ?? "layer-1"), nodes: [{ id: firstId, anchor: active.start, join: "corner" as const }, node], segments: [segment], closed: false, style: defaultStyle };
           const next = dispatch(editorRef.current, createElement(path));
           setPenDraftPoint(undefined);
           setEditorState(select(next, [path.id]));
         }
       }
     } else if (active.kind === "draw") {
      const end = active.start ? pointAt(event) : undefined;
      const zeroLengthLine = active.tool === "line" && active.start && end && active.start.x === end.x && active.start.y === end.y;
      if (cancelled || !active.dragged || zeroLengthLine) setEditorState(cancelGesture(editorRef.current));
      else if (active.start && active.tool && isDrawingTool(active.tool) && active.ids?.[0] && end) {
        const element = newElement(active.tool, editorRef.current.document.layers[0]?.id ?? "layer-1", active.start, end, active.ids[0]);
        const command = active.previewed ? updateElement(element.id, element.type === "line" ? { start: element.start, end: element.end } : isPropertyElement(element) ? { position: element.position, size: element.size } : {}) : createElement(element);
        setEditorState(commitGesture(previewGesture(editorRef.current, command)));
      }
    }
    interaction.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setSnapGuide(undefined);
    setAlignmentGuideState([]);
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const next = zoomAtPoint(zoom, panMm, canvasPointAt(event), zoom * 1.0015 ** -event.deltaY);
    setZoom(next.zoom);
    setPanMm(next.panMm);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (interaction.current) {
           setEditorState(cancelGesture(editorRef.current));
           if (interaction.current.kind === "pen-place") setPenDraftPoint(undefined);
          interaction.current = undefined;
          setMarquee(undefined);
          setSnapGuide(undefined);
          setAlignmentGuideState([]);
        }
        setTransformMode("resize");
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && tool === "pen" && selectedFormaNodeKeys.length) {
        event.preventDefault();
        let next = editorRef.current;
        let changed = false;
        for (const element of selectedElements) if (element.type === "path") {
          const nodeIds = selectedPathAnchorIds(element, selectedFormaNodeKeys);
          if (nodeIds.length) {
            const updated = dispatch(next, deletePathNodes(element.id, nodeIds));
            changed ||= updated !== next;
            next = updated;
          }
        }
        if (changed) setEditorState(next);
        setSelectedFormaNodeKeys([]);
      } else if ((event.key === "Delete" || event.key === "Backspace") && tool === "forma" && selectedFormaNodeKeys.length) {
        event.preventDefault();
        let next = editorRef.current;
        for (const element of selectedElements) {
          const contourAddresses = selectedFormaNodeKeys.flatMap((key) => { const match = key.match(new RegExp(`^${element.id}:c:(\\d+):(\\d+)$`)); return match ? [{ ringIndex: Number(match[1]), pointIndex: Number(match[2]) }] : []; });
          const primitiveIndexes = selectedFormaNodeKeys.flatMap((key) => { const match = key.match(new RegExp(`^${element.id}:p:(\\d+)$`)); return match ? [Number(match[1])] : []; });
          if (contourAddresses.length) next = dispatch(next, deleteContourNodes(element.id, contourAddresses));
          if (primitiveIndexes.length) next = dispatch(next, deleteElementNodes(element.id, primitiveIndexes));
        }
        setSelectedFormaNodeKeys([]); setEditorState(next);
      } else if (selection.length && event.key === "Delete" && !(selectedFormaNodeKeys.length && selectedElements.some((element) => element.type === "path"))) {
        event.preventDefault();
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
    }, [activeSplineId, selectionKey, selectedFormaNodeKeys, tool, selectedElements]);

     const formaNodes: readonly FormaNodeOverlay[] = (tool === "forma" || tool === "pen") ? selectedElements.filter((element) => element.type !== "spline").flatMap((element): readonly FormaNodeOverlay[] => element.type === "contour"
      ? contourVertexNodes(element).map((node) => ({ kind: "contour" as const, key: `${node.elementId}:c:${node.ringIndex}:${node.pointIndex}`, elementId: node.elementId, point: node.point, contour: node }))
        : element.type === "path" ? pathGeometryNodes(element).map((node, nodeIndex) => ({ kind: "path" as const, key: `${element.id}:p:${nodeIndex}`, elementId: element.id, point: node.point, nodeIndex, pathNode: { elementId: element.id, node } }))
        : realGeometryNodes(element).map((node, nodeIndex) => ({ kind: "path" as const, key: `${element.id}:p:${nodeIndex}`, elementId: element.id, point: node.point, nodeIndex }))) : [];
      const selectedPathAnchor = selectedElement?.type === "path"
       ? (() => { const selectedPathOverlay = formaNodes.find((node): node is Extract<FormaNodeOverlay, { readonly kind: "path" }> => node.kind === "path" && "pathNode" in node && node.pathNode?.node.kind === "anchor" && selectedFormaNodeKeys.includes(node.key)); const anchor = selectedPathOverlay?.pathNode?.node; return anchor?.kind === "anchor" ? selectedElement.nodes.find((node) => node.id === anchor.nodeId) : undefined; })()
        : undefined;
     const activeSpline = activeSplineId ? document.elements.find((element): element is SplineElement => element.id === activeSplineId && element.type === "spline") : undefined;
         const activePenPath = selectedElements.find((element): element is Extract<Element, { type: "path" }> => element.type === "path" && !element.closed);
         const pointerMm = cursorPoint ? screenPointToMm(cursorPoint, { x: 0, y: 0 }, zoom, panMm) : undefined;
         const splineCloseTarget = tool === "spline" && activeSpline && !activeSpline.closed && activeSpline.nodes.length >= 3 && pointerMm && (() => { const first = activeSpline.nodes[0]; return Boolean(first && Math.hypot(first.anchor.x - pointerMm.x, first.anchor.y - pointerMm.y) <= 10 / zoom); })();
         const penCloseTarget = tool === "pen" && activePenPath && pointerMm && (() => { const first = activePenPath.nodes[0]; return Boolean(first && Math.hypot(first.anchor.x - pointerMm.x, first.anchor.y - pointerMm.y) <= 10 / zoom); })();
         const closeTargetActive = Boolean(activePenPath) || Boolean(splineCloseTarget);
         const closeCursorActive = Boolean(splineCloseTarget || penCloseTarget);
    const splitSelectedPathSegment = () => {
      const target = selectedPathSegment;
      if (!target || selectedElement?.id !== target.elementId) return;
      const newNodeId = `path-node-${crypto.randomUUID()}`;
      const next = dispatch(editorRef.current, splitPathSegment(target.elementId, target.segmentIndex, newNodeId));
      if (next === editorRef.current) return;
      const path = next.document.elements.find((element) => element.id === target.elementId && element.type === "path");
      const nodeIndex = path?.type === "path" ? path.nodes.findIndex((node) => node.id === newNodeId) : -1;
      setSelectedPathSegment(undefined);
      if (nodeIndex >= 0) setSelectedFormaNodeKeys([`${target.elementId}:p:${nodeIndex}`]);
      setEditorState(next);
    };
    const pathSegmentControls = selectedElement?.type === "path" && selectedPathSegment?.elementId === selectedElement.id ? <section className="path-join-card" role="group" aria-label="Segmento seleccionado">
      <div className="panel-title">SEGMENTO DEL TRAZADO</div>
      <p className="muted">Divide el segmento seleccionado en su punto medio.</p>
      <button type="button" aria-label="Dividir segmento del trazado en el punto medio" onClick={splitSelectedPathSegment}>Dividir segmento</button>
    </section> : null;
    const pathJoinControls = selectedElement?.type === "path" && selectedPathAnchor ? <section className="path-join-card" role="group" aria-label="Unión del ancla seleccionada">
     <div className="panel-title">UNIÓN DEL ANCLA</div>
     <p className="muted">{pathJoinGuidance}</p>
     <div className="path-join-buttons">{pathJoinOptions.map((option) => <button key={option.value} type="button" className="path-join-button" aria-label={option.label} aria-pressed={selectedPathAnchor.join === option.value} title={option.description} onClick={() => setEditorState(dispatch(editorRef.current, setPathJoin(selectedElement.id, selectedPathAnchor.id, option.value)))}>{option.label}</button>)}</div>
    </section> : null;
     const pathClosureControls = selectedElement?.type === "path" ? <section className="path-join-card path-closure-card" role="group" aria-label="Cierre del trazado">
      <div className="panel-title">CIERRE DEL TRAZADO</div>
      <p className="muted">{selectedElement.closed ? "Este trazado está cerrado y conserva sus anclas y controles." : "Cierra el trazado seleccionado con un solo comando."}</p>
      <button type="button" aria-label={selectedElement.closed ? "Reabrir trazado" : "Cerrar trazado"} onClick={() => setEditorState(dispatch(editorRef.current, selectedElement.closed ? openPath(selectedElement.id) : closePath(selectedElement.id)))}>{selectedElement.closed ? "Reabrir trazado" : "Cerrar trazado"}</button>
      {selectedElement.closed && <p className="muted path-fill-hint">Relleno: {selectedElement.style.fill ?? defaultClosedFill}. Elija un color en COLORES para cambiar el relleno; los objetos abiertos mantienen solo el contorno.</p>}
     </section> : null;
     const splineClosureControls = selectedElement?.type === "spline" ? <section className="path-join-card path-closure-card" role="group" aria-label="Cierre de la spline">
       <div className="panel-title">CIERRE DE LA SPLINE</div>
       <p className="muted">Cierra la spline y conserva la continuidad de sus handles relativos.</p>
       <button type="button" aria-label="Cerrar spline" disabled={selectedElement.closed || selectedElement.nodes.length < 3} onClick={() => setEditorState(dispatch(editorRef.current, closeSplineElement(selectedElement.id)))}>Cerrar spline</button>
     </section> : null;
   const groupPoints = selectedBounds ? groupHandlePoints(selectedBounds) : undefined;
   const handlePoints = selectedElement?.type === "line" || selectedElement?.type === "path" ? undefined : selectedElement?.type === "contour" && selectedBounds ? [groupHandlePoints(selectedBounds).nw, groupHandlePoints(selectedBounds).n, groupHandlePoints(selectedBounds).ne, groupHandlePoints(selectedBounds).e, groupHandlePoints(selectedBounds).se, groupHandlePoints(selectedBounds).s, groupHandlePoints(selectedBounds).sw, groupHandlePoints(selectedBounds).w] as const : selectedElement && isPropertyElement(selectedElement) ? rotatedResizeHandles(selectedElement) : selectedElement?.type === "spline" && selectedBounds ? [groupHandlePoints(selectedBounds).nw, groupHandlePoints(selectedBounds).n, groupHandlePoints(selectedBounds).ne, groupHandlePoints(selectedBounds).e, groupHandlePoints(selectedBounds).se, groupHandlePoints(selectedBounds).s, groupHandlePoints(selectedBounds).sw, groupHandlePoints(selectedBounds).w] as const : undefined;
  const handleNames: readonly ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const handleStyle = (handle: GroupHandle) => {
     const point = selectedElements.length > 1 ? groupPoints?.[handle] : handle === "center" ? undefined : handlePoints?.[handleNames.indexOf(handle)];
    if (!point) return undefined;
    const screen = pagePointToCanvas(point, zoom, panMm);
    return { left: `${screen.x}px`, top: `${screen.y}px` };
  };
  const rotationPoints = selectedElements.length > 1 && selectedBounds && transformMode === "rotate" ? [groupHandlePoints(selectedBounds).nw, groupHandlePoints(selectedBounds).ne, groupHandlePoints(selectedBounds).se, groupHandlePoints(selectedBounds).sw] : selectedElement && isRotatableElement(selectedElement) && transformMode === "rotate" ? rotationHandlePoints(selectedElement, 18 / zoom) : [];
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
  const rulerMajorStep = [1, 5, 10, 25, 50, 100, 250, 500].find((step) => step * zoom >= 50) ?? 1000;
  const rulerValues = (limit: number) => Array.from({ length: Math.floor(limit / rulerMajorStep) + 1 }, (_, index) => index * rulerMajorStep);
  const rulerXValues = rulerValues(document.page.width);
  const rulerYValues = rulerValues(document.page.height);
  const rulerHorizontal = <div className="ruler-horizontal" data-ruler-horizontal="true" aria-hidden="true">
    {rulerXValues.map((value) => <span className="ruler-tick ruler-tick-horizontal" key={`ruler-x-${value}`} style={{ left: (value - panMm.x) * zoom }}><i /><b>{value}</b></span>)}
  </div>;
  const rulerVertical = <div className="ruler-vertical" data-ruler-vertical="true" aria-hidden="true">
    {rulerYValues.map((value) => <span className="ruler-tick ruler-tick-vertical" key={`ruler-y-${value}`} style={{ top: (value - panMm.y) * zoom }}><i /><b>{value}</b></span>)}
  </div>;
       const selectedEditOverlay = tool === "forma" ? selectedElements.filter((element) => element.type !== "spline" && element.type !== "line").map((element) => {
         if (element.type === "rectangle") return <rect key={`edit-${element.id}`} x={element.position.x} y={element.position.y} width={element.size.width} height={element.size.height} rx={element.cornerRadius} fill="none" stroke="#1683ff" strokeWidth={1 / zoom} transform={`rotate(${element.rotation * 180 / Math.PI} ${element.position.x + element.size.width / 2} ${element.position.y + element.size.height / 2})`} pointerEvents="none" />;
         if (element.type === "ellipse") return <ellipse key={`edit-${element.id}`} cx={element.position.x + element.size.width / 2} cy={element.position.y + element.size.height / 2} rx={element.size.width / 2} ry={element.size.height / 2} fill="none" stroke="#1683ff" strokeWidth={1 / zoom} transform={`rotate(${element.rotation * 180 / Math.PI} ${element.position.x + element.size.width / 2} ${element.position.y + element.size.height / 2})`} pointerEvents="none" />;
         if (element.type === "contour") return <path key={`edit-${element.id}`} d={element.contours.map((contour) => `${contour.points.map((point, pointIndex) => `${pointIndex === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")} Z`).join(" ")} fill="none" stroke="#1683ff" strokeWidth={1 / zoom} pointerEvents="none" />;
         if (element.type === "path") {
           const nodes = new Map(element.nodes.map((node) => [node.id, node.anchor]));
           const first = element.nodes[0]?.anchor;
           if (!first) return null;
           const d = element.segments.reduce((value, segment) => {
             const end = nodes.get(segment.endNodeId);
             if (!end) return value;
             return `${value}${segment.type === "cubicBezier" ? ` C ${segment.control1.x} ${segment.control1.y} ${segment.control2.x} ${segment.control2.y} ${end.x} ${end.y}` : ` L ${end.x} ${end.y}`}`;
           }, `M ${first.x} ${first.y}`) + (element.closed ? " Z" : "");
           return <path key={`edit-${element.id}`} d={d} fill="none" stroke="#1683ff" strokeWidth={1 / zoom} pointerEvents="none" />;
         }
         return null;
       }) : [];
       const alignmentGuideOverlay = alignmentGuideState.map((guide, index) => guide.orientation === "vertical"
         ? <line key={`alignment-guide-v-${index}`} data-alignment-guide="vertical" x1={guide.coordinate} y1={guide.start} x2={guide.coordinate} y2={guide.end} stroke="#1683ff" strokeWidth={0.75 / zoom} strokeDasharray={`${3 / zoom} ${3 / zoom}`} vectorEffect="non-scaling-stroke" pointerEvents="none" />
         : <line key={`alignment-guide-h-${index}`} data-alignment-guide="horizontal" x1={guide.start} y1={guide.coordinate} x2={guide.end} y2={guide.coordinate} stroke="#1683ff" strokeWidth={0.75 / zoom} strokeDasharray={`${3 / zoom} ${3 / zoom}`} vectorEffect="non-scaling-stroke" pointerEvents="none" />);
       const pathGuideOverlay = selectedElements.filter((element): element is Extract<Element, { type: "path" }> => element.type === "path").flatMap((path) => path.segments.flatMap((segment) => segment.type === "cubicBezier" ? (() => {
         const start = path.nodes.find((node) => node.id === segment.startNodeId)?.anchor;
         const end = path.nodes.find((node) => node.id === segment.endNodeId)?.anchor;
         return start && end ? [<line key={`${path.id}-${segment.startNodeId}-out`} x1={start.x} y1={start.y} x2={segment.control1.x} y2={segment.control1.y} stroke="#1683ff" strokeWidth={1 / zoom} strokeDasharray={`${3 / zoom} ${2 / zoom}`} pointerEvents="none" />, <line key={`${path.id}-${segment.endNodeId}-in`} x1={end.x} y1={end.y} x2={segment.control2.x} y2={segment.control2.y} stroke="#1683ff" strokeWidth={1 / zoom} strokeDasharray={`${3 / zoom} ${2 / zoom}`} pointerEvents="none" />] : [];
       })() : []));
       const splineOverlay = document.elements.filter((element): element is SplineElement => element.type === "spline").map((spline) => {
      const editing = tool === "forma" || tool === "spline";
      const visible = selection.includes(spline.id) || selectedSplineNodeKey?.startsWith(`${spline.id}:`);
      return <g key={`spline-overlay-${spline.id}`} data-spline-overlay={spline.id}>

        {editing && visible && <path data-spline-edit-path={spline.id} d={splinePathData(spline)} fill="none" stroke="#1683ff" strokeWidth={1 / zoom} pointerEvents="none" />}
        <path data-spline-hit={spline.id} d={splinePathData(spline)} fill={spline.closed ? "transparent" : "none"} stroke="#2563eb" strokeOpacity={0.01} strokeWidth={12 / zoom} style={{ pointerEvents: tool === "select" ? "visiblePainted" : "none", cursor: tool === "select" ? "move" : "default" }} onPointerDown={(event) => selectSplineObject(event, spline)} onPointerMove={(event) => onCanvasPointerMove(event as unknown as PointerEvent<HTMLDivElement>)} onPointerUp={(event) => finishPointer(event as unknown as PointerEvent<HTMLDivElement>, false)} onPointerCancel={(event) => finishPointer(event as unknown as PointerEvent<HTMLDivElement>, true)} />
        {visible && spline.nodes.map((node, nodeIndex) => {
          const selectedNodeIndex = spline.nodes.findIndex((candidate) => selectedSplineNodeKey === `${spline.id}:${candidate.id}`);
          const previousNodeIndex = selectedNodeIndex > 0 ? selectedNodeIndex - 1 : spline.closed && selectedNodeIndex === 0 ? spline.nodes.length - 1 : -1;
          const nextNodeIndex = selectedNodeIndex >= 0 && selectedNodeIndex < spline.nodes.length - 1 ? selectedNodeIndex + 1 : spline.closed && selectedNodeIndex === spline.nodes.length - 1 ? 0 : -1;
          const showHandles = editing && selectedNodeIndex >= 0 && (nodeIndex === selectedNodeIndex || nodeIndex === previousNodeIndex || nodeIndex === nextNodeIndex);
          const selected = selectedSplineNodeKey === `${spline.id}:${node.id}`;
          const controlColor = editing ? "#1683ff" : "#111827";
              const nodeSize = 5 / zoom;
              const closeNode = nodeIndex === 0 && splineCloseTarget;
              const renderedNodeSize = closeNode ? 8 / zoom : nodeSize;
          const handle = (kind: "in" | "out", offset: { readonly dx: number; readonly dy: number }) => {
            const point = { x: node.anchor.x + offset.dx, y: node.anchor.y + offset.dy };
            return <g key={`${node.id}-${kind}`}><line x1={node.anchor.x} y1={node.anchor.y} x2={point.x} y2={point.y} stroke="#1683ff" strokeWidth={1 / zoom} strokeDasharray={`${3 / zoom} ${2 / zoom}`} /><rect role="button" aria-label={`Mover handle ${kind === "in" ? "entrante" : "saliente"} de spline`} data-spline-handle={`${spline.id}:${node.id}:${kind}`} x={point.x - 3 / zoom} y={point.y - 3 / zoom} width={6 / zoom} height={6 / zoom} fill="#ffffff" stroke="#1683ff" strokeWidth={1 / zoom} style={{ pointerEvents: "auto", cursor: "move" }} onPointerDown={(event) => beginSplineHandle(event, spline.id, node.id, kind)} onPointerMove={moveSplineHandle} onPointerUp={(event) => finishSplineHandle(event, false)} onPointerCancel={(event) => finishSplineHandle(event, true)} /></g>;
          };
          return <g key={node.id}>


            <rect role="button" aria-label={nodeIndex === 0 && splineCloseTarget ? "Cerrar spline en el primer nodo" : "Ancla de spline"} data-spline-node={node.id} data-spline-close-target={nodeIndex === 0 && splineCloseTarget ? "true" : undefined} x={node.anchor.x - renderedNodeSize / 2} y={node.anchor.y - renderedNodeSize / 2} width={renderedNodeSize} height={renderedNodeSize} fill={selected ? "#dbeafe" : "#ffffff"} stroke={closeNode ? "#14b8a6" : controlColor} strokeWidth={1 / zoom} transform={editing ? `rotate(45 ${node.anchor.x} ${node.anchor.y})` : undefined} style={{ pointerEvents: "auto", cursor: nodeIndex === 0 && splineCloseTarget ? "pointer" : "move" }} onPointerDown={(event) => selectSplineAnchor(event, spline, node.id)} onPointerMove={(event) => onCanvasPointerMove(event as unknown as PointerEvent<HTMLDivElement>)} onPointerUp={(event) => finishPointer(event as unknown as PointerEvent<HTMLDivElement>, false)} onPointerCancel={(event) => finishPointer(event as unknown as PointerEvent<HTMLDivElement>, true)} />
            {showHandles && node.inHandle && handle("in", node.inHandle)}{showHandles && node.outHandle && handle("out", node.outHandle)}
          </g>;
        })}
      </g>;
    });
    
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
       else {
         const size = aspectLock ? aspectSize(selectedBounds.width, selectedBounds.height, field, value) : { width: field === "width" ? value : selectedBounds.width, height: field === "height" ? value : selectedBounds.height };
         setEditorState(dispatch(editorRef.current, resizeElements(selection, "se", { x: selectedBounds.x + size.width, y: selectedBounds.y + size.height }, aspectLock)));
       }
     } else setEditorState(dispatch(editorRef.current, updateElement(element.id, aspectGeometryPatch(element, field, value, aspectLock))));
  };

  const cornerRadiusField = (element: Extract<Element, { type: "rectangle" }>) => {
    const values = element.cornerRadii ?? { topLeft: element.cornerRadius, topRight: element.cornerRadius, bottomRight: element.cornerRadius, bottomLeft: element.cornerRadius };
    const corners = [{ key: "topLeft", label: "Sup. izq." }, { key: "topRight", label: "Sup. der." }, { key: "bottomLeft", label: "Inf. izq." }, { key: "bottomRight", label: "Inf. der." }] as const;
    return <div className="corner-radius-fields">{corners.map(({ key, label }) => { const draftKey = `${element.id}:corner:${key}`; return <label className="field" key={key}><span>{label}</span><input inputMode="decimal" min="0" aria-label={`Radio ${label} en milímetros`} value={drafts[draftKey] ?? formatMm(values[key])} onChange={(event) => setDrafts((current) => ({ ...current, [draftKey]: event.target.value }))} onBlur={() => { const value = Number((drafts[draftKey] ?? "").trim()); if (Number.isFinite(value) && value >= 0) { setDrafts((current) => { const next = { ...current }; delete next[draftKey]; return next; }); setEditorState(dispatch(editorRef.current, updateElement(element.id, { cornerRadii: cornerRadiusLock ? { topLeft: value, topRight: value, bottomLeft: value, bottomRight: value } : { ...values, [key]: value } }))); } else setDrafts((current) => ({ ...current, [draftKey]: formatMm(values[key]) })); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); } if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDrafts((current) => ({ ...current, [draftKey]: formatMm(values[key]) })); event.currentTarget.blur(); } }} /> </label>; })}<button type="button" className="property-aspect-lock corner-radius-lock" aria-label={cornerRadiusLock ? "Desbloquear radios de esquina" : "Vincular radios de esquina"} title={cornerRadiusLock ? "Desbloquear radios de esquina" : "Vincular radios de esquina"} aria-pressed={cornerRadiusLock} onClick={() => setCornerRadiusLock((current) => !current)}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{cornerRadiusLock ? <><rect x="5" y="8" width="10" height="9" rx="1.5" /><path d="M7.5 8V6a2.5 2.5 0 0 1 5 0v2" /></> : <><rect x="5" y="8" width="10" height="9" rx="1.5" /><path d="M7.5 8V6a2.5 2.5 0 0 1 4.6-1.3" /><path d="m12.4 4.8 1.8 1.6" /></>}</svg></button></div>;
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
  const rotationField = (element: RotatableElement) => {
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
  const applyShapeOperation = (operation: ShapeOperation) => {
    const current = editorRef.current;
    const next = dispatch(current, shapeOperation(current.selection, operation));
    if (next === current) return;
    setEditorState(next);
  };
  const paletteControls = () => <div className="status-palette" role="group" aria-label="Paleta de colores"><span className="status-palette-label">COLORES</span><div className="palette"><button className="swatch no-fill" aria-label="Sin relleno" title="Sin relleno" onClick={() => applyPalette(null, "fill")} onContextMenu={(event) => event.preventDefault()}>×</button>{palette.map(({ name, color }) => <button key={color} className="swatch" aria-label={name} title={`Clic izquierdo: relleno · clic derecho: contorno (${name})`} style={{ background: color }} onClick={() => applyPalette(color, "fill")} onContextMenu={(event) => { event.preventDefault(); applyPalette(color, "stroke"); }} />)}</div></div>;
  const transformDirections: readonly { direction: Direction; label: string; marker: string }[] = [
    { direction: "north-west", label: "Noroeste", marker: "↖" }, { direction: "north", label: "Norte", marker: "↑" }, { direction: "north-east", label: "Noreste", marker: "↗" },
    { direction: "west", label: "Oeste", marker: "←" }, { direction: "center", label: "Centro: superponer", marker: "•" }, { direction: "east", label: "Este", marker: "→" },
    { direction: "south-west", label: "Suroeste", marker: "↙" }, { direction: "south", label: "Sur", marker: "↓" }, { direction: "south-east", label: "Sureste", marker: "↘" },
  ];
  const transformControls = () => {
    const distanceKey = "transform:distance";
    const countKey = "transform:count";
    const showDirectionTooltip = () => {
      if (directionTooltipTimer.current) clearTimeout(directionTooltipTimer.current);
      setDirectionTooltipVisible(true);
      directionTooltipTimer.current = setTimeout(() => {
        setDirectionTooltipVisible(false);
        directionTooltipTimer.current = undefined;
      }, 3000);
    };
    const duplicate = () => {
      const distance = Number((drafts[distanceKey] ?? "10").trim());
      const count = Number((drafts[countKey] ?? "1").trim());
      if (!selectedElements.length || !Number.isFinite(distance) || distance < 0 || !Number.isInteger(count) || count < 1) return;
      setEditorState(dispatch(editorRef.current, duplicateElements(selection, transformDirection, distance, count)));
    };
      return <section className="inspector-card transform-card"><div className="panel-title">REPRODUCCIÓN DIRECCIONAL</div><div className="transform-layout"><div className="direction-grid" role="group" aria-label="Dirección de reproducción" aria-describedby="transform-direction-description" onPointerEnter={showDirectionTooltip} onPointerDown={showDirectionTooltip} onFocusCapture={showDirectionTooltip}>{transformDirections.map(({ direction, label, marker }) => <button key={direction} type="button" className={transformDirection === direction ? "direction-button active" : "direction-button"} aria-label={label} aria-pressed={transformDirection === direction} onClick={() => { showDirectionTooltip(); setTransformDirection(direction); }}><span aria-hidden="true">{marker}</span></button>)}<span id="transform-direction-description" className={directionTooltipVisible ? "direction-tooltip visible" : "direction-tooltip"} role="tooltip">Crea copias separadas por el espacio indicado. El centro superpone la copia.</span></div><div className="transform-fields"><label className="field"><span>Distancia (mm)</span><input inputMode="decimal" aria-label="Distancia entre copias en milímetros" value={drafts[distanceKey] ?? "10"} onChange={(event) => setDrafts((current) => ({ ...current, [distanceKey]: event.target.value }))} /></label><label className="field"><span>Copias</span><input inputMode="numeric" aria-label="Cantidad de copias" value={drafts[countKey] ?? "1"} onChange={(event) => setDrafts((current) => ({ ...current, [countKey]: event.target.value }))} /></label><button type="button" aria-label="Reproducir copias" className="transform-action" disabled={!selectedElements.length} onClick={duplicate}>Reproducir</button></div></div></section>;
  };
  const mirrorButton = (axis: FlipAxis) => {
    const label = axis === "horizontal" ? "Espejo horizontal" : "Espejo vertical";
    const description = axis === "horizontal" ? "Voltear la selección horizontalmente." : "Voltear la selección verticalmente.";
    const isActive = selectedElements.some((element) => isRotatableElement(element) && Boolean(axis === "horizontal" ? element.flipX : element.flipY));
    return <button type="button" className={isActive ? "property-transform-button active" : "property-transform-button"} aria-label={label} aria-pressed={isActive} title={description} aria-description={description} onClick={() => {
      const current = editorRef.current;
      if (current.selection.length) setEditorState(dispatch(current, flipElements(current.selection, axis)));
    }}>
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {axis === "horizontal" ? <><path d="M3 10h14M6 7l-3 3 3 3M14 7l3 3-3 3" /><path d="M10 3v14" strokeDasharray="2 2" /></> : <><path d="M10 3v14M7 6l3-3 3 3M7 14l3 3 3-3" /><path d="M3 10h14" strokeDasharray="2 2" /></>}
      </svg>
      <span className="property-tool-description" role="tooltip">{description}</span>
     </button>;
    };

  const shapeOperations = () => <div className="shape-operation-group" role="group" aria-label="Operaciones de forma">
    <div className="shape-operation-copy"><div className="panel-title">OPERACIONES DE FORMA</div></div>
    <div className="shape-operation-buttons">
      <button type="button" className="shape-operation-button" aria-label="Soldar" title="Combinar los objetos cerrados seleccionados en una sola forma." aria-description="Combinar los objetos cerrados seleccionados en una sola forma." disabled={!selectedElements.length || selectedElements.some((element) => element.type === "line")} onClick={() => applyShapeOperation("weld")}>Soldar<span className="shape-operation-description" role="tooltip">Combinar los objetos cerrados seleccionados en una sola forma.</span></button>
      <button type="button" className="shape-operation-button" aria-label="Recortar" title="Usar el último objeto seleccionado como objetivo y los anteriores como cortadores." aria-description="Usar el último objeto seleccionado como objetivo y los anteriores como cortadores." disabled={selectedElements.length < 2 || selectedElements.some((element) => element.type === "line")} onClick={() => applyShapeOperation("subtract")}>Recortar<span className="shape-operation-description" role="tooltip">Usar el último objeto seleccionado como objetivo y los anteriores como cortadores.</span></button>
      <button type="button" className="shape-operation-button" aria-label="Crear límites" title="Crear un contorno real alrededor de los objetos cerrados seleccionados." aria-description="Crear un contorno real alrededor de los objetos cerrados seleccionados." disabled={!selectedElements.length || selectedElements.some((element) => element.type === "line")} onClick={() => applyShapeOperation("outline")}>Crear límites<span className="shape-operation-description" role="tooltip">Crear un contorno real alrededor de los objetos cerrados seleccionados.</span></button>
    </div>
  </div>;

  const aspectLockButton = () => {
    const label = aspectLock ? "Desbloquear proporción" : "Bloquear proporción";
    return <button type="button" className="property-aspect-lock" aria-label={label} title={label} aria-pressed={aspectLock} onClick={() => setAspectLock((current) => !current)}>
     <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <title>{label}</title>
      {aspectLock ? <><rect x="5" y="8" width="10" height="9" rx="1.5" /><path d="M7.5 8V6a2.5 2.5 0 0 1 5 0v2" /></> : <><rect x="5" y="8" width="10" height="9" rx="1.5" /><path d="M7.5 8V6a2.5 2.5 0 0 1 4.6-1.3" /><path d="m12.4 4.8 1.8 1.6" /></>}
    </svg>
    </button>;
  };

  const objectPropertySections = (inspector = false) => propertyElement ? <>
     <div className={inspector ? "inspector-property-card" : "property-card"} role="group" aria-label="Posición">
       {geometryInput(propertyElement, "x", "X")}{geometryInput(propertyElement, "y", "Y")}
     </div>
     {inspector && <div className="inspector-property-card inspector-dimensions-card" role="group" aria-label="Dimensiones">
       <div className="inspector-dimensions-fields">
         {geometryInput(propertyElement, "width", "Ancho", dimensionIcon("width", "Ancho"))}
         {geometryInput(propertyElement, "height", "Alto", dimensionIcon("height", "Alto"))}
       </div>
       {aspectLockButton()}
     </div>}
    {inspector && selectedElement?.type === "rectangle" && <div className="inspector-property-card inspector-radius-card" role="group" aria-label="Radio de esquina">{cornerRadiusField(selectedElement)}</div>}
    {selectedElement && isRotatableElement(selectedElement) && rotationField(selectedElement)}
  </> : null;

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
                {objectPropertySections()}{mirrorButton("horizontal")}{mirrorButton("vertical")}{shapeOperations()}
         </div> : <p className="muted">Seleccione un objeto para editar sus propiedades.</p>}
      </section>
        <aside className="workspace-tools"><div className="tool-column" role="toolbar" aria-label="Herramientas de diseño">{(["select", "forma", "pen", "spline", "rectangle", "ellipse", "line", "pan"] as const).map((item) => <ToolButton key={item} label={toolCursorLabels[item]} icon={item} active={tool === item} onClick={() => { setTransformMode("resize"); setPenDraftPoint(undefined); setTool(item); }} />)}</div></aside>
      <section className="canvas-area">
        <header className="canvas-header"><span>DISEÑO / SIN TÍTULO</span><span>{document.elements.length} objetos · {document.page.width} × {document.page.height} mm</span><div className="zoom-controls"><button aria-label="Alejar" onClick={() => setZoom(zoom - 0.5)}>−</button><span className="zoom-label">{Math.round(zoom * 100 / 3)}%</span><button aria-label="Acercar" onClick={() => setZoom(zoom + 0.5)}>+</button></div></header>
            <div ref={canvas} className={`${grid ? "canvas" : "canvas no-grid"}${isDrawingTool(tool) ? " drawing-tool" : ""}${closeTargetActive ? " close-target-active" : ""}`} onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove} onPointerUp={(event) => finishPointer(event, false)} onPointerCancel={(event) => finishPointer(event, true)} onLostPointerCapture={cancelPointerInteraction} onPointerLeave={() => setCursorPoint(undefined)} onDoubleClick={onCanvasDoubleClick} onWheel={onWheel}>
           {rulerHorizontal}{rulerVertical}<span className="ruler-corner" aria-hidden="true" />
           <div className="page" style={pageStyle}>{/* SAFETY: renderSvg emits allowlisted SVG from validated document data. */}<div className="page-svg" dangerouslySetInnerHTML={{ __html: rendered.success ? rendered.svg : "" }} />{(alignmentGuideOverlay.length > 0 || splineOverlay.length > 0 || selectedEditOverlay.length > 0 || pathGuideOverlay.length > 0) && <svg data-spline-overlay-layer="true" viewBox={`0 0 ${document.page.width} ${document.page.height}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible", zIndex: 5 }}>{alignmentGuideOverlay}{selectedEditOverlay}{pathGuideOverlay}{splineOverlay}</svg>}</div>
            {formaNodes.length > 0 && <div className="contour-node-overlay" role="group" aria-label={tool === "pen" ? "Nodos y controles del trazado" : "Nodos de forma"}>{formaNodes.map((node) => { const screen = pagePointToCanvas(node.point, zoom, panMm); const selected = selectedFormaNodeKeys.includes(node.key); const pathNode = node.kind === "path" ? node.pathNode : undefined; return <button key={node.key} type="button" className={`contour-node${(tool === "forma" || tool === "pen") && !(node.kind === "path" && pathNode?.node.kind === "control") ? " editing-node" : ""}${selected ? " active selected" : ""}`} data-contour-node={node.key} aria-label={node.kind === "contour" ? `Nodo del contorno, anillo ${node.contour.ringIndex + 1}, punto ${node.contour.pointIndex + 1}` : pathNode?.node.kind === "control" ? `Control Bézier ${pathNode.node.handle === "control1" ? "saliente" : "entrante"}` : `Nodo editable ${node.nodeIndex + 1}`} style={{ left: screen.x, top: screen.y }} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setSelectedFormaNodeKeys((current) => event.shiftKey ? current.includes(node.key) ? current.filter((value) => value !== node.key) : [...current, node.key] : [node.key]); if (tool === "pen" && pathNode?.node.kind === "anchor") { const currentPath = editorRef.current.document.elements.find((element) => element.id === node.elementId && element.type === "path"); if (currentPath?.type === "path" && !currentPath.closed && currentPath.nodes[0]?.id === pathNode.node.nodeId) { setPenDraftPoint(undefined); setEditorState(dispatch(select(editorRef.current, [node.elementId]), closePath(node.elementId))); return; } } canvas.current?.setPointerCapture(event.pointerId); if (pathNode) { setEditorState(beginGesture(select(editorRef.current, [node.elementId]))); interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "path-node", pathNode, startClient: { x: event.clientX, y: event.clientY }, dragged: false }; } else { setEditorState(beginGesture(editorRef.current)); interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "contour-node", ...(node.kind === "contour" ? { contourNode: node.contour } : {}), formaNode: node.kind === "contour" ? { elementId: node.contour.elementId, contourNode: node.contour, point: node.point } : { elementId: node.elementId, nodeIndex: node.nodeIndex, point: node.point }, startClient: { x: event.clientX, y: event.clientY }, dragged: false }; } }} />; })}</div>}
          {centerHoverStyle && <div className="selection-center-feedback" style={centerHoverStyle} aria-hidden="true"><span className="selection-center-mark">×</span><span className="selection-center-label">centro</span></div>}
            {tool === "select" && transformMode === "resize" && (handlePoints || groupPoints) && <div className="resize-handles">{handleNames.map((handle) => <button key={handle} type="button" className={`resize-handle resize-handle-${handle}`} data-resize-handle={handle} aria-label={`Redimensionar ${handle}`} style={handleStyle(handle)} onPointerDown={(event) => resizePointerDown(event, handle)} onPointerUp={(event) => finishPointer(event, false)} onPointerCancel={(event) => finishPointer(event, true)} />)}{groupPoints && !isDrawingTool(tool) && <button type="button" className="resize-handle resize-handle-center" data-resize-handle="center" aria-label="Centro del grupo" style={handleStyle("center")} onPointerDown={(event) => event.stopPropagation()} />}</div>}
           {transformMode === "rotate" && selectedElements.length > 0 && <div className="rotation-controls" aria-label="Controles de rotación"><span className="rotation-center" style={selectedElements.length > 1 && selectedBounds ? { left: pagePointToCanvas(groupCenter(selectedBounds), zoom, panMm).x, top: pagePointToCanvas(groupCenter(selectedBounds), zoom, panMm).y } : centerStyle} aria-hidden="true" />{rotationPoints.map((point, index) => { const screen = pagePointToCanvas(point, zoom, panMm); return <button key={index} type="button" className="rotation-handle" aria-label={`Rotar objeto, control ${index + 1}`} style={{ left: screen.x, top: screen.y }} onPointerDown={rotationPointerDown} onPointerUp={(event) => finishPointer(event, false)} onPointerCancel={(event) => finishPointer(event, true)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 8A6 6 0 1 0 16 12" /><path d="m12.5 4 3 4-5 .5" /></svg></button>; })}</div>}
          {marqueeStyle && <div className="marquee" style={marqueeStyle} />}
           {cursorPoint && <span className={`tool-cursor${closeCursorActive ? " close-cursor" : ""}`} style={{ left: cursorPoint.x, top: cursorPoint.y }} aria-label={`Herramienta activa: ${toolCursorLabels[tool]}`} title={closeCursorActive ? "Cerrar trazado" : tool === "forma" && pickFormaSegment(document, screenPointToMm(cursorPoint, { x: 0, y: 0 }, zoom, panMm), zoom) ? "Doble clic para insertar un nodo" : undefined}>{toolCursorIcons[tool]}</span>}
          <span className="canvas-hint">Clic: relleno · clic derecho: contorno · {toolCursorLabels[tool]}</span>
        </div>
      </section>
       <aside className="inspector">
         <div className="inspector-tabs" role="tablist" aria-label="Inspector">
           <button type="button" role="tab" aria-selected={inspectorTab === "properties"} className={inspectorTab === "properties" ? "active" : ""} onClick={() => setInspectorTab("properties")}>Propiedades</button>
            <button type="button" role="tab" aria-selected={inspectorTab === "transform"} className={inspectorTab === "transform" ? "active" : ""} onClick={() => setInspectorTab("transform")}>Transformar</button>
           <button type="button" role="tab" aria-selected={inspectorTab === "text"} className={inspectorTab === "text" ? "active" : ""} onClick={() => setInspectorTab("text")}>Texto</button>
         </div>
         <div className="inspector-tab-content" role="tabpanel">
                {inspectorTab === "properties" && <>{selectedElements.length === 0 ? <section className="inspector-card"><div className="panel-title">PÁGINA</div><div className="preset-row"><button onClick={() => setPage(1200, 900)}>Horizontal</button><button onClick={() => setPage(900, 1200)}>Vertical</button></div><div className="fields"><Field label="W" value={document.page.width} onChange={(value) => setPage(value, document.page.height)} /><Field label="H" value={document.page.height} onChange={(value) => setPage(document.page.width, value)} /></div><label className="grid-toggle"><input type="checkbox" checked={grid} onChange={(event) => setGrid(event.target.checked)} /> Mostrar cuadrícula del espacio de trabajo</label></section> : <section className="inspector-card inspector-object-card"><div className="panel-title">OBJETO</div>{propertyElement ? <div className="inspector-object-properties">{objectPropertySections(true)}</div> : <><div className="selected-type">{selectedElement?.type === "contour" ? "CONTORNO" : selectedElement?.type === "path" ? "TRAZADO" : selectedElement?.type === "spline" ? "SPLINE" : "LÍNEA"}</div><p className="muted">{selectedElement?.type === "contour" ? "Los contornos conservan su geometría real; las dimensiones no están disponibles." : selectedElement?.type === "path" ? "Los trazados conservan sus nodos y segmentos." : selectedElement?.type === "spline" ? "Las splines conservan sus nodos y handles relativos." : "Las líneas no tienen dimensiones rectangulares."}</p>{selectedElement && isRotatableElement(selectedElement) && rotationField(selectedElement)}</>}</section>}{pathClosureControls}{splineClosureControls}{pathJoinControls}{pathSegmentControls}</>}
              {inspectorTab === "transform" && transformControls()}
           {inspectorTab === "text" && <section className="inspector-card"><div className="panel-title">TEXTO</div>{selectedElement?.type === "text" ? <div className="text-properties"><label className="field"><span>Tamaño (mm)</span><input type="number" min="1" value={selectedElement.fontSize} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value > 0) setEditorState(dispatch(editorRef.current, updateElement(selectedElement.id, { fontSize: value }))); }} /></label><label className="field"><span>Tipografía</span><select value={selectedElement.fontFamily} onChange={(event) => setEditorState(dispatch(editorRef.current, updateElement(selectedElement.id, { fontFamily: event.target.value })))}><option>Arial</option><option>Helvetica</option><option>Times New Roman</option><option>Courier New</option><option>Inter</option></select></label><div className="text-style-buttons"><button type="button" aria-pressed={selectedElement.fontWeight === "bold"} onClick={() => setEditorState(dispatch(editorRef.current, updateElement(selectedElement.id, { fontWeight: selectedElement.fontWeight === "bold" ? "normal" : "bold" })))}>Negrita</button><button type="button" aria-pressed={selectedElement.fontStyle === "italic"} onClick={() => setEditorState(dispatch(editorRef.current, updateElement(selectedElement.id, { fontStyle: selectedElement.fontStyle === "italic" ? "normal" : "italic" })))}>Cursiva</button></div></div> : <p className="muted">Seleccione un texto para editar sus propiedades.</p>}</section>}
         </div>
         <section className="inspector-lower-card"><div className="panel-title">CAPAS</div>{document.layers.map((layer) => <div className="layer" key={layer.id}><span>{layer.name}</span><span>{layer.visible ? "Visible" : "Oculta"}</span></div>)}</section>
         <section className="inspector-lower-card"><div className="panel-title">OBJETOS</div><p className="muted">Estructura de objetos próximamente.</p></section>
         <section className="inspector-lower-card"><div className="panel-title">SÍMBOLOS</div><p className="muted">No hay símbolos configurados.</p></section>
         <section className="inspector-lower-card"><div className="panel-title">VALIDACIÓN DEL DISEÑO</div><p className="muted">La validación del diseño estará disponible próximamente.</p></section>
       </aside>
    </div>}
     <footer className="statusbar"><div className="status-message"><span className={`status-dot ${persist.state === "saving" ? "saving" : ""}`} />{persist.message}</div>{paletteControls()}</footer>
  </main>;
}

const toolDescriptions: Record<string, string> = { Seleccion: "Seleccione, coloque o transforme objetos.", Forma: "Editar la forma mediante sus nodos.", Pluma: "Cree un trazado Bézier con clics y arrastre para editar sus controles.", Spline: "Cree curvas con nodos y handles. Haga clic en el primer nodo para cerrarla; arrastre nodos y controles para editarla.", Rectángulo: "Dibuje formas rectangulares.", Elipse: "Dibuje formas elípticas.", Línea: "Dibuje líneas rectas.", Desplazar: "Desplace el espacio de trabajo." };
function ToolIcon({ icon }: { icon: Tool }) {
  const shape = icon === "select" ? <path d="m5 3 13 8-6 2-3 6z" /> : icon === "forma" ? <><rect x="5" y="5" width="14" height="14" rx="1" /><circle cx="5" cy="5" r="1.5" fill="currentColor" /><circle cx="12" cy="5" r="1.5" fill="currentColor" /><circle cx="19" cy="5" r="1.5" fill="currentColor" /><circle cx="5" cy="12" r="1.5" fill="currentColor" /><circle cx="19" cy="12" r="1.5" fill="currentColor" /><circle cx="5" cy="19" r="1.5" fill="currentColor" /><circle cx="12" cy="19" r="1.5" fill="currentColor" /><circle cx="19" cy="19" r="1.5" fill="currentColor" /></> : icon === "pen" ? <><path d="M4 19 9 14" /><path d="M9 14c3-5 6-7 11-8" /><path d="M14 8 18 4" /><path d="M5 19h4" /><rect x="3" y="17" width="4" height="4" /><rect x="18" y="3" width="4" height="4" /><circle cx="9" cy="14" r="1.5" fill="currentColor" /></> : icon === "spline" ? <><path d="M4 18c4 0 4-10 9-10 3 0 3 4 7 0" /><path d="M4 18 9 14M13 8 18 6" /><circle cx="4" cy="18" r="2" fill="currentColor" /><circle cx="13" cy="8" r="2" fill="currentColor" /><circle cx="20" cy="8" r="2" fill="currentColor" /></> : icon === "rectangle" ? <rect x="5" y="5" width="14" height="14" rx="1" /> : icon === "ellipse" ? <circle cx="12" cy="12" r="7" /> : icon === "line" ? <path d="M5 19 19 5" /> : <><path d="M12 4v16M4 12h16" /><path d="m9 7 3-3 3 3M9 17l3 3 3-3M7 9l-3 3 3 3M17 9l3 3-3 3" /></>;
  return <svg className="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shape}</svg>;
}
function ToolButton({ label, icon, active, onClick }: { label: string; icon: Tool; active: boolean; onClick: () => void }) {
  const description = `${label} — ${toolDescriptions[label]}`;
  return <button className={active ? "tool active" : "tool"} aria-label={label} aria-pressed={active} title={description} aria-description={description} onClick={onClick}><ToolIcon icon={icon} /><small>{label}</small><span className="tool-description" role="tooltip">{description}</span></button>;
}
function Field({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="field"><span>{label}</span><input type="number" min="1" step="0.1" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
