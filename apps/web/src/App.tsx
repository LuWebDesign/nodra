import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode, type WheelEvent } from "react";
import { createProject, elementId, layerId, pageId, projectFromDocument, revision, type DocumentSnapshot, hasRotation, type DimensionElement, type Element, type SketchConstraint, type ElementId, type PointMm, type ProjectSnapshot, type SplineElement, type TextElement, type ExplicitConnection } from "@nodra/domain";
import { addSketchConstraint, addToSelection, appendSketchEdge, appendSplineNode, beginGesture, cancelGesture, clearSelection, closePath, cutLineAtPoint, cutPathSegment, cutSketchEdge, closeSplineElement, commitGesture, convertTextToGlyphs, createElement, createPathCubicNode, createPathNode, createSketchLine, deleteContourNodes, deleteElement, deleteElementNodes, deletePathNodes, deleteSketchConstraint, dispatch, duplicateElements, flipElements, insertFormaNode, invalidDimensionIdsForShapeOperation, moveElements, movePathHandle, movePathNode, openPath, updateSplineNode, previewGesture, previewGestureFromBase, redo, resizeElement, resizeElementToDimensions, resizeElements, resizeElementsToDimensions, rotateElement, updateDimensionValue, setDimensionDriving, rotateElementsAroundCenter, select, selectForPointerDown, setPathJoin, shapeOperation, splitPathSegment, undo, updateContourNode, updateElement, updateElementNode, updateElementStyles, updatePage, updateSketchConstraint, updateSplineHandle, type FlipAxis, type ShapeOperation } from "@nodra/editor-core";
import { boundsOfElements, connectableNodeAddress, contourVertexNodes, dimensionKindForPlacement, dimensionOffsetForAlignedPlacement, dimensionOffsetForPlacement, elementCenter, editableGeometryNodes, glyphGeometryNodes, groupCenter, groupHandlePoints, pathGeometryNodes, pointMidpoint, dimensionGeometry, realGeometryNodes, solveSketchConstraints, resizeHandle, rotatedResizeHandles, rotationFromDrag, rotationHandlePoints, visibleBezierHandleGuides, type Direction, type GroupHandle, type ResizeHandle } from "@nodra/geometry";
import { DebouncedAutosave, DexieProjectRepository, requestStoragePersistence, type FontRecord } from "@nodra/persistence";
import { validateDesign, validateProject } from "@nodra/validation";
import { renderSvg } from "@nodra/renderer-svg";
import { canActivateRotation, centerPageInCanvas, clientPointToCanvas, clientPointToPage, cubicPlacementControls, formaNodeKey, hoveredSelectionCenter, isDrawingTool, marqueeSelection, movementExceedsThreshold, normalizeBounds, normalizeDrag, pagePointToCanvas, pathGuides, pickDimensionTarget, pickElement, pickFormaElement, pickFormaNode, pickFormaSegment, pickHoverNode, pickCuttableSegment, pickNode, pickPathNode, pickPathSegment, pointerDownIntent, visibleEditablePathNodeIndexes, screenDeltaToMm, screenPointToMm, selectedNodeAnchor, selectedPathAnchorIds, alignmentGuides, snapCreationPoint, snapFormaNodePoint, snapMoveDelta, viewportPointToCanvas, zoomAtPoint, type AlignmentGuide, type ContourNodeHit, type CuttableSegmentHit, type DimensionTarget, type FormaNodeHit, type HoverNode, type NodeHit, type PathNodeHit, type SnapGuide, type TransformMode, type CreationSnap } from "./interaction.js";
import { aspectSize, formatMm, geometryValue, rotationDegreesValue, rotationPatch, type GeometryField, type PropertyElement, type RotatableElement } from "./propertyBar.js";
import { useDocumentStore, usePersistenceStore, useSelectionStore, useUiStore, useViewportStore, type Tool } from "./stores.js";
import { pathJoinGuidance, pathJoinOptions } from "./pathJoins.js";
import { textSizeFor } from "./textMetrics.js";
import { extractTextGlyphOutlines, fontFamilyFromFileName, FontOutlineError } from "./fontOutline.js";
import { circleGeometry, creationGuides, cursorNodeGuides, directionalGuide, lineAngleDegrees, nodeAlignmentGuides, type CreationGuide } from "./interaction.js";

const defaultFonts = ["Arial", "Helvetica", "Times New Roman", "Courier New", "Inter"] as const;
type DesktopFileBridge = {
  openProject: () => Promise<{ readonly path: string; readonly project: ProjectSnapshot } | undefined>;
  saveProject: (project: ProjectSnapshot, currentPath?: string) => Promise<string | undefined>;
  initialProject: () => Promise<{ readonly path: string; readonly project: ProjectSnapshot } | undefined>;
  checkForUpdates: () => Promise<void>;
};
const desktopFileBridge = (): DesktopFileBridge | undefined => {
  const candidate = (globalThis as typeof globalThis & { __KOND_DESKTOP__?: DesktopFileBridge }).__KOND_DESKTOP__;
  return candidate;
};
const projectMirrorKey = (projectId: string) => `nodra:project-mirror:${projectId}`;
const loadProjectMirror = (projectId: string): ProjectSnapshot | undefined => {
  try {
    const raw = localStorage.getItem(projectMirrorKey(projectId));
    if (!raw) return undefined;
    const checked = validateProject(JSON.parse(raw));
    return checked.success && checked.data.id === projectId ? checked.data : undefined;
  } catch { return undefined; }
};
const saveProjectMirror = (project: ProjectSnapshot): void => {
  try { localStorage.setItem(projectMirrorKey(project.id), JSON.stringify(project)); } catch { /* best-effort reload mirror */ }
};
const defaultStyle = { stroke: "#000000", strokeWidth: 1 };
const pointAlignedToNodeGuides = (point: PointMm, guides: readonly CreationGuide[]): PointMm => guides.reduce((current, guide) => guide.target.y === guide.source.y ? { x: guide.target.x, y: current.y } : { x: current.x, y: guide.target.y }, point);
const defaultClosedFill = "rgba(101,217,255,0.22)";
const isPropertyElement = (element: Element): element is PropertyElement => element.type === "rectangle" || element.type === "ellipse";
const isRotatableElement = (element: Element): element is RotatableElement => hasRotation(element);
const palette = [
  { name: "Negro", color: "#111827" }, { name: "Rojo", color: "#ef4444" }, { name: "Naranja", color: "#f59e0b" },
  { name: "Verde", color: "#22c55e" }, { name: "Azul", color: "#3b82f6" }, { name: "Violeta", color: "#a855f7" },
  { name: "Blanco", color: "#ffffff" }, { name: "Rosa", color: "#ec4899" }, { name: "Cian", color: "#22d3ee" },
  { name: "Lima", color: "#a3e635" }, { name: "Gris", color: "#9ca3af" },
] as const;
type DimensionMode = "auto" | "radius" | "diameter";
const id = () => elementId(`element-${crypto.randomUUID()}`);
const newDimension = (layer: string, first: NodeHit, second: NodeHit, placement: PointMm, mode: DimensionMode = "auto"): DimensionElement => { const midpoint = pointMidpoint(first.node.point, second.node.point); const sameEllipse = first.elementId === second.elementId && (first.node.kind === "center" && (second.node.kind === "edge-midpoint" || second.node.kind === "cardinal") || second.node.kind === "center" && (first.node.kind === "edge-midpoint" || first.node.kind === "cardinal")); const kind = sameEllipse ? mode === "radius" ? "radius" : "diameter" : dimensionKindForPlacement(first.node.point, second.node.point, placement); const circularCenter = first.node.kind === "center" ? first.node.point : second.node.point; return { type: "dimension", id: id(), layerId: layerId(layer), kind, references: [{ kind: "node", elementId: first.elementId, nodeIndex: first.nodeIndex, ...(first.node.nodeId && first.node.kind !== "control" ? { nodeId: first.node.nodeId } : {}) }, { kind: "node", elementId: second.elementId, nodeIndex: second.nodeIndex, ...(second.node.nodeId && second.node.kind !== "control" ? { nodeId: second.node.nodeId } : {}) }], offset: kind === "diameter" || kind === "radius" ? { x: placement.x - (sameEllipse ? circularCenter.x : midpoint.x), y: placement.y - (sameEllipse ? circularCenter.y : midpoint.y) } : kind === "aligned" ? dimensionOffsetForAlignedPlacement(first.node.point, second.node.point, placement) : dimensionOffsetForPlacement(kind, midpoint, placement), precision: 2, units: "mm", rotation: 0, style: { stroke: "#2563eb", strokeWidth: 0.45 } }; };
const newCircleDimension = (layer: string, hit: Extract<DimensionTarget, { kind: "circle" }>["hit"], placement: PointMm, mode: DimensionMode): DimensionElement => newDimension(layer, hit.center, hit.rim, placement, mode === "auto" ? "diameter" : mode);
const newAngularDimension = (layer: string, first: Extract<DimensionTarget, { kind: "line" }>, second: Extract<DimensionTarget, { kind: "line" }>, placement: PointMm): DimensionElement => ({ type: "dimension", id: id(), layerId: layerId(layer), kind: "angular", references: [{ kind: "line", elementId: first.hit.elementId, ...(first.hit.edgeIndex !== undefined ? { edgeIndex: first.hit.edgeIndex } : {}) }, { kind: "line", elementId: second.hit.elementId, ...(second.hit.edgeIndex !== undefined ? { edgeIndex: second.hit.edgeIndex } : {}) }], offset: { x: placement.x - first.hit.line.start.x, y: placement.y - first.hit.line.start.y }, precision: 2, units: "mm", rotation: 0, style: { stroke: "#2563eb", strokeWidth: 0.45 } });
const newElement = (tool: Exclude<Tool, "select" | "dimension" | "radius" | "pan" | "forma" | "pen" | "spline" | "text">, layer: string, start: PointMm, end: PointMm, nextId = id()): Element => tool === "line"
  ? { type: "line", id: nextId, layerId: layerId(layer), start, end, rotation: 0, style: defaultStyle }
  : tool === "rectangle"
    ? { type: "rectangle", id: nextId, layerId: layerId(layer), ...normalizeDrag(start, end), cornerRadius: 0, rotation: 0, style: defaultStyle }
     : (() => { const geometry = circleGeometry(start, end); return { type: "ellipse" as const, id: nextId, layerId: layerId(layer), position: geometry?.position ?? start, size: geometry?.size ?? { width: 0, height: 0 }, rotation: 0, style: defaultStyle }; })();
const creationConnections = (element: Element, snaps: readonly (CreationSnap | undefined)[]): readonly ExplicitConnection[] => snaps.flatMap((snap) => {
  if (!snap?.node) return [];
  const sourceNodes = realGeometryNodes(element);
  let sourceIndex = 0; let sourceDistance = Number.POSITIVE_INFINITY;
  sourceNodes.forEach((node, index) => { const distance = Math.hypot(node.point.x - snap.point.x, node.point.y - snap.point.y); if (distance < sourceDistance) { sourceDistance = distance; sourceIndex = index; } });
  const sourceAddress = connectableNodeAddress(element, sourceIndex);
  if (!sourceAddress || !snap.address || snap.node.elementId === element.id) return [];
  return [{ id: `connection-${crypto.randomUUID()}`, first: { elementId: element.id, node: sourceAddress }, second: { elementId: snap.node.elementId, node: snap.address } }];
});
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
type CreationDraft = { readonly tool: "rectangle" | "ellipse" | "line"; readonly points: readonly PointMm[]; readonly pointer: PointMm; readonly snaps?: readonly (CreationSnap | undefined)[]; readonly elementId?: ElementId; readonly currentNodeId?: string };

type FormaNodeOverlay =
  | { readonly kind: "contour"; readonly key: string; readonly elementId: ElementId; readonly point: PointMm; readonly contour: ContourNodeHit }
  | { readonly kind: "path"; readonly key: string; readonly elementId: ElementId; readonly point: PointMm; readonly nodeIndex: number; readonly pathNode?: PathNodeHit };

type InspectorTab = "properties" | "transform" | "text";

const toolCursorIcons: Record<Tool, string> = { radius: "R", select: "↖", forma: "⌘", pen: "✒", spline: "✒", text: "T", rectangle: "□", ellipse: "○", line: "╱", cut: "✂", dimension: "⟷", pan: "✣" };
const toolCursorLabels: Record<Tool, string> = { radius: "Radio", select: "Seleccion", forma: "Forma", pen: "Pluma", spline: "Spline", text: "Texto", rectangle: "Rectángulo", ellipse: "Círculo", line: "Línea", cut: "Cortar segmentos", dimension: "Cota", pan: "Desplazar" };

export function App() {
  const { mode, tool, setMode, setTool } = useUiStore();
  const { editor, project, setEditor, setProject, setProjectPreferences } = useDocumentStore();
  const document = editor.document;
  const selection = editor.selection;
  const { zoom, panMm, setZoom, setPanMm } = useViewportStore();
  const persist = usePersistenceStore();
  const [online, setOnline] = useState(navigator.onLine);
  const [grid, setGrid] = useState(false);
      const [lineCursorAngle, setLineCursorAngle] = useState<number>();
  const [marquee, setMarquee] = useState<{ start: PointMm; end: PointMm }>();
  const [snapGuide, setSnapGuide] = useState<SnapGuide>();
  const [alignmentGuideState, setAlignmentGuideState] = useState<readonly AlignmentGuide[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [cursorPoint, setCursorPoint] = useState<PointMm>();
  const [documentCursorPoint, setDocumentCursorPoint] = useState<PointMm>();
  const [creationPoint, setCreationPoint] = useState<PointMm>();
  const [aspectLock, setAspectLock] = useState(false);
  const [cornerRadiusLock, setCornerRadiusLock] = useState(false);
  const [centerHover, setCenterHover] = useState<{ elementId: ElementId; point: PointMm }>();
  const [transformMode, setTransformMode] = useState<TransformMode>("resize");
  const [selectedFormaNodeKeys, setSelectedFormaNodeKeys] = useState<readonly string[]>([]);
  const [editModeElementIds, setEditModeElementIds] = useState<readonly ElementId[]>([]);
  const [selectedSplineNodeKey, setSelectedSplineNodeKey] = useState<string>();
  const [selectedPathSegment, setSelectedPathSegment] = useState<{ readonly elementId: ElementId; readonly segmentIndex: number }>();
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("properties");
  const designValidation = useMemo(() => validateDesign(document.elements, document.page), [document.elements, document.page]);
  const [transformDirection, setTransformDirection] = useState<Direction>("center");
  const [directionTooltipVisible, setDirectionTooltipVisible] = useState(false);
  const [penDraftPoint, setPenDraftPoint] = useState<PointMm>();
  const [splineDraftPoint, setSplineDraftPoint] = useState<PointMm>();
  const [activeSplineId, setActiveSplineId] = useState<ElementId>();
  const [textFontFamily, setTextFontFamily] = useState("Arial");
  const [textFontWeight, setTextFontWeight] = useState<"normal" | "bold">("normal");
  const [textFontStyle, setTextFontStyle] = useState<"normal" | "italic">("normal");
  const [availableFonts, setAvailableFonts] = useState<readonly string[]>(defaultFonts);
  const [localFonts, setLocalFonts] = useState<readonly FontRecord[]>([]);
  const [fontSources, setFontSources] = useState<Record<string, ArrayBuffer>>({});
  const [fontLoadError, setFontLoadError] = useState<string>();
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [nativeProjectPath, setNativeProjectPath] = useState<string>();
  const [textDraft, setTextDraft] = useState<{ readonly position: PointMm; readonly value: string; readonly elementId?: ElementId; readonly fontSize?: number; readonly element?: TextElement }>();
  type DimensionDraft = { readonly phase: "first"; readonly first: DimensionTarget } | { readonly phase: "placement"; readonly first: DimensionTarget; readonly second: DimensionTarget };
  const [dimensionDraft, setDimensionDraft] = useState<DimensionDraft>();
   const [dimensionMode, setDimensionMode] = useState<DimensionMode>("auto");
   const [dimensionEditDraft, setDimensionEditDraft] = useState<{ readonly id: ElementId; readonly value: string; readonly position: PointMm }>();
    const [dimensionEditError, setDimensionEditError] = useState<string>();
       const [constraintValueDraft, setConstraintValueDraft] = useState<{ readonly kind: "distance-horizontal" | "distance-vertical"; readonly value: string }>();
   const [constraintDraft, setConstraintDraft] = useState<{ readonly sketchId: ElementId; readonly constraint: SketchConstraint }>();
   const [constraintValueEdits, setConstraintValueEdits] = useState<Record<string, string>>({});
   const dimensionInputRef = useRef<HTMLInputElement>(null);
   useEffect(() => { if (!dimensionEditDraft) return; const frame = requestAnimationFrame(() => { dimensionInputRef.current?.focus(); dimensionInputRef.current?.select(); }); return () => cancelAnimationFrame(frame); }, [dimensionEditDraft?.id]);
      const [creationDraft, setCreationDraft] = useState<CreationDraft>();
  const [dimensionNodeHover, setDimensionNodeHover] = useState<NodeHit>();
  const [nodeHover, setNodeHover] = useState<HoverNode>();
  const [cutSegmentHover, setCutSegmentHover] = useState<CuttableSegmentHit>();
  const [pendingShapeOperation, setPendingShapeOperation] = useState<{ readonly operation: "weld" | "subtract"; readonly ids: readonly ElementId[]; readonly invalidDimensionCount: number }>();
  const textDraftRef = useRef(textDraft);
  textDraftRef.current = textDraft;
  const textInput = useRef<HTMLTextAreaElement>(null);
  const repository = useMemo(() => new DexieProjectRepository(), []);
  const autosave = useMemo(() => new DebouncedAutosave(repository), [repository]);
  const canvas = useRef<HTMLDivElement>(null);
  const pageElement = useRef<HTMLDivElement>(null);
  const editorRef = useRef(editor);
  const interaction = useRef<ActiveInteraction | undefined>(undefined);
  const creationDraftRef = useRef<CreationDraft | undefined>(undefined);
  const viewportInteracted = useRef(false);
  const centeredViewport = useRef<string | undefined>(undefined);
  const recoveredNotice = useRef(false);
  const restoredFontIds = useRef(new Set<string>());
  const directionTooltipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  editorRef.current = editor;
  creationDraftRef.current = creationDraft;

  useLayoutEffect(() => {
    pageElement.current = canvas.current ? canvas.current.querySelector<HTMLDivElement>(".page") : null;
    return () => { pageElement.current = null; };
  }, [document.id, document.page.width, document.page.height]);

  useEffect(() => () => {
    if (directionTooltipTimer.current) clearTimeout(directionTooltipTimer.current);
  }, []);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => { setOnline(false); persist.set("offline", "Sin conexión — la edición permanece local"); };
    addEventListener("online", on);
    addEventListener("offline", off);
    void requestStoragePersistence();
    const mirrored = loadProjectMirror(document.id);
    if (mirrored) {
      setProject(mirrored);
      recoveredNotice.current = true;
      persist.set("recovered", "Revisión local recuperada");
    }
    void repository.getProject(document.id).then((result) => {
      if (!result.ok) return;
      const recovered = "pages" in result.revision.document ? result.revision.document : createProject(result.revision.document);
      if (mirrored && mirrored.revision > recovered.revision) return;
      setProject(recovered);
      recoveredNotice.current = true;
      persist.set("recovered", "Revisión local recuperada");
    }).finally(() => setPersistenceReady(true));
    return () => {
      removeEventListener("online", on);
      removeEventListener("offline", off);
    };
  }, [repository]);

  useEffect(() => {
    const bridge = desktopFileBridge();
    if (!bridge) return;
    void bridge.initialProject().then((result) => {
      if (!result) return;
      setProject(result.project);
      setNativeProjectPath(result.path);
      useSelectionStore.getState().setSelected(undefined);
      persist.set("recovered", "Proyecto abierto desde archivo");
    }).catch((error: unknown) => {
      persist.set("failed", error instanceof Error ? error.message : "No se pudo abrir el proyecto inicial");
    });
  }, [setProject]);

  useEffect(() => {
    const bridge = desktopFileBridge();
    if (!bridge) return;
    void bridge.checkForUpdates().catch((error: unknown) => {
      console.warn("No se pudo buscar actualizaciones", error);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void repository.listFonts(document.id).then(async (fonts) => {
      if (!cancelled) setLocalFonts(fonts);
      for (const font of fonts) {
        if (cancelled) return;
        if (restoredFontIds.current.has(font.id)) continue;
        try {
          const bytes = await font.blob.arrayBuffer();
          const face = new FontFace(font.family, bytes);
          await face.load();
          if (cancelled) return;
          globalThis.document.fonts.add(face);
          restoredFontIds.current.add(font.id);
          setAvailableFonts((current) => current.includes(font.family) ? current : [...current, font.family]);
          setFontSources((current) => ({ ...current, [font.family]: bytes }));
        } catch {
          if (!cancelled) setFontLoadError("No se pudo restaurar una fuente cargada.");
        }
      }
    }).catch(() => { if (!cancelled) setFontLoadError("No se pudieron restaurar las fuentes cargadas."); });
    return () => { cancelled = true; };
  }, [document.id, repository]);

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
  useEffect(() => { setDimensionDraft(undefined); setDimensionNodeHover(undefined); setNodeHover(undefined); setCutSegmentHover(undefined); setTransformMode("resize"); }, [tool, project.activePageId, selectionKey]);
  useEffect(() => { creationDraftRef.current = undefined; setCreationDraft(undefined); setCreationPoint(undefined); }, [tool, project.activePageId]);
  useEffect(() => {
    setActiveSplineId(undefined);
    setSplineDraftPoint(undefined);
    setSelectedSplineNodeKey(undefined);
    if (tool !== "spline" && tool !== "forma" && editorRef.current.selection.some((id) => editorRef.current.document.elements.some((element) => element.id === id && element.type === "spline"))) setEditorState(clearSelection(editorRef.current));
  }, [tool]);
  useEffect(() => { setSelectedPathSegment(undefined); setSelectedFormaNodeKeys([]); if (tool !== "forma") setEditModeElementIds([]); }, [tool, project.activePageId]);

  useEffect(() => {
    setCenterHover(undefined);
    const target = canvas.current;
    if (!target || mode !== "design" || tool !== "select" || transformMode !== "resize" || !selectedElement) return;
    const update = (event: globalThis.PointerEvent) => {
      if (interaction.current) { setCenterHover(undefined); return; }
       const point = documentPointAtClient(event.clientX, event.clientY);
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
     const point = (value: PointMm) => viewportPointToCanvas(value, zoom, panMm);
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
    if (transformMode === "resize" && tool !== "forma") for (const element of selectedElements.filter((candidate) => candidate.type !== "spline" && candidate.type !== "text")) for (const [nodeIndex, node] of realGeometryNodes(element).entries()) {
      const screen = point(node.point);
      const hitArea = globalThis.document.createElementNS("http://www.w3.org/2000/svg", "circle");
      hitArea.dataset.realNode = element.id;
      hitArea.dataset.realNodeIndex = String(nodeIndex);
      hitArea.setAttribute("cx", String(screen.x));
      hitArea.setAttribute("cy", String(screen.y));
      hitArea.setAttribute("r", "8");
      hitArea.setAttribute("fill", "transparent");
      hitArea.style.pointerEvents = "auto";
       hitArea.style.cursor = "default";
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
       const pointer = documentCursorPoint;
       if (!pointer) return;
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
    if (!persistenceReady) return;
    if (!preserveRecoveryNotice || !online) persist.set(online ? "saving" : "offline", online ? "Guardando localmente" : "Sin conexión — la edición permanece local");
    saveProjectMirror(project);
    autosave.schedule({ id: project.id, name: "Diseño sin título", updatedAt: Date.now() }, project);
    void autosave.flush().then((result) => { if (result?.ok && online && !preserveRecoveryNotice) persist.set("saved", "Guardado localmente"); });
  }, [persistenceReady, project, online]);

  const dimensionPreview = dimensionDraft?.phase === "placement" && documentCursorPoint ? dimensionDraft.first.kind === "node" && dimensionDraft.second.kind === "node" ? newDimension("layer-1", dimensionDraft.first.hit, dimensionDraft.second.hit, documentCursorPoint, tool === "radius" ? "radius" : dimensionMode) : dimensionDraft.first.kind === "line" && dimensionDraft.second.kind === "line" ? newAngularDimension("layer-1", dimensionDraft.first, dimensionDraft.second, documentCursorPoint) : undefined : undefined;
  const rendered = renderSvg({ ...document, elements: dimensionPreview ? [...document.elements, dimensionPreview] : document.elements }, { zoom: 1, panMm: { x: 0, y: 0 } });
  const setEditorState = (next: typeof editor) => {
    editorRef.current = next;
    if (!next.gesture && (persistenceReady || next.document.revision > document.revision)) saveProjectMirror(projectFromDocument(project, next.document));
    setEditor(next);
  };
  const openDesktopProject = async () => {
    const bridge = desktopFileBridge();
    if (!bridge) return;
    try {
      const result = await bridge.openProject();
      if (!result) return;
      setProject(result.project);
      setNativeProjectPath(result.path);
      useSelectionStore.getState().setSelected(undefined);
      persist.set("recovered", "Proyecto abierto");
    } catch (error) {
      persist.set("failed", error instanceof Error ? error.message : "No se pudo abrir el proyecto");
    }
  };
  const saveDesktopProject = async (saveAs = false) => {
    const bridge = desktopFileBridge();
    if (!bridge) return;
    try {
      const path = await bridge.saveProject(project, saveAs ? undefined : nativeProjectPath);
      if (!path) return;
      setNativeProjectPath(path);
      persist.set("saved", `Proyecto guardado en ${path}`);
    } catch (error) {
      persist.set("failed", error instanceof Error ? error.message : "No se pudo guardar el proyecto");
    }
  };
  /** The only client-coordinate ingress for document interactions. */
  const documentPointAtClient = (clientX: number, clientY: number): PointMm => {
    const page = pageElement.current;
    if (!page) return screenPointToMm(clientPointToCanvas({ x: clientX, y: clientY }, canvas.current!.getBoundingClientRect()), { x: 0, y: 0 }, zoom, panMm);
    const rect = page.getBoundingClientRect();
    const style = getComputedStyle(page);
    const borderLeft = parseFloat(style.borderLeftWidth) || 0;
    const borderTop = parseFloat(style.borderTopWidth) || 0;
    const borderRight = parseFloat(style.borderRightWidth) || 0;
    const borderBottom = parseFloat(style.borderBottomWidth) || 0;
    return clientPointToPage({ x: clientX, y: clientY }, document.page, {
      rect,
      renderedWidth: rect.width - borderLeft - borderRight,
      renderedHeight: rect.height - borderTop - borderBottom,
      borderLeft,
      borderTop,
    });
  };
  const canvasPointAt = (event: PointerEvent<HTMLElement> | WheelEvent<HTMLElement>) => clientPointToCanvas({ x: event.clientX, y: event.clientY }, canvas.current!.getBoundingClientRect());
  const pointAt = (event: PointerEvent<HTMLElement> | WheelEvent<HTMLElement>) => documentPointAtClient(event.clientX, event.clientY);

  useEffect(() => {
    if (!textDraft) return;
    const frame = requestAnimationFrame(() => textInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [textDraft]);

  const deleteLocalFont = async (font: FontRecord) => {
    if (!confirm(`¿Eliminar la fuente local "${font.family}"?`)) return;
    try {
      await repository.deleteFont(document.id, font.id);
      restoredFontIds.current.delete(font.id);
      setLocalFonts((current) => current.filter((item) => item.id !== font.id));
      setFontSources((current) => {
        const next = { ...current };
        delete next[font.family];
        return next;
      });
      setAvailableFonts((current) => defaultFonts.includes(font.family as typeof defaultFonts[number]) || localFonts.some((item) => item.id !== font.id && item.family === font.family) ? current : current.filter((family) => family !== font.family));
      if (textFontFamily === font.family) setTextFontFamily("Arial");
      persist.set("saved", `Fuente local eliminada: ${font.family}`);
      setFontLoadError(undefined);
    } catch (error) {
      setFontLoadError(`No se pudo eliminar la fuente local${error instanceof Error ? `: ${error.message}` : "."}`);
    }
  };

  const loadFontFile = async (file: File, familyOverride?: string) => {
    const family = familyOverride?.trim() || fontFamilyFromFileName(file.name);
    try {
      const bytes = await file.arrayBuffer();
      const face = new FontFace(family, bytes);
      await face.load();
      globalThis.document.fonts.add(face);
      setAvailableFonts((current) => current.includes(family) ? current : [...current, family]);
      setTextFontFamily(family);
      setFontSources((current) => ({ ...current, [family]: bytes }));
      const record: FontRecord = { id: `${document.id}:${family}`, projectId: document.id, family, name: file.name, ...(file.type ? { format: file.type } : {}), blob: new Blob([bytes], { type: file.type }), savedAt: Date.now() };
      setFontLoadError(undefined);
      try {
        await repository.saveFont(record);
        restoredFontIds.current.add(record.id);
        setLocalFonts((current) => [record, ...current.filter((font) => font.id !== record.id)]);
        persist.set("saved", `Fuente guardada localmente: ${family}`);
      } catch (error) {
        setFontLoadError(`La fuente se cargó, pero no se pudo guardar localmente${error instanceof Error ? `: ${error.message}` : "."}`);
      }
    } catch { setFontLoadError("No se pudo cargar la fuente. Seleccione un archivo TTF, OTF, WOFF o WOFF2 válido."); }
  };

  const commitTextDraft = (expectedDraft = textDraftRef.current) => {
    const draft = textDraftRef.current;
    if (!draft || draft !== expectedDraft) return;
    // Clear the ref synchronously. Blur can run after the canvas pointer-down
    // handler and must not commit the same draft a second time.
    textDraftRef.current = undefined;
    if (!draft.value.trim()) { setTextDraft(undefined); return; }
    const current = editorRef.current;
    const source = draft.element;
    const fontFamily = source?.fontFamily ?? textFontFamily;
    const fontWeight = source?.fontWeight ?? textFontWeight;
    const fontStyle = source?.fontStyle ?? textFontStyle;
    const fontSize = source?.fontSize ?? draft.fontSize ?? 24;
    const text: TextElement = {
      type: "text", id: draft.elementId ?? id(), layerId: layerId(current.document.layers[0]?.id ?? "layer-1"),
      position: draft.position, size: textSizeFor(draft.value, fontSize, fontFamily, fontWeight, fontStyle, source?.lineHeight ?? 1.2), text: draft.value,
       fontFamily, fontSize, fontWeight, fontStyle, textAlign: source?.textAlign ?? "left", lineHeight: source?.lineHeight ?? 1.2, rotation: source?.rotation ?? 0,
       style: { stroke: "#000000", fill: "#000000", strokeWidth: 0.1 },
    };
    // Inline editing changes only the text content and its measured bounds. The
    // existing element keeps its position and all typography/style properties.
    const next = draft.elementId ? dispatch(current, updateElement(draft.elementId, { text: text.text, size: text.size })) : dispatch(current, createElement(text));
    setEditorState(select(next, [text.id]));
    setTextDraft(undefined);
    setTool("select");
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
     const point = documentPointAtClient(event.clientX, event.clientY);
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

  const convertSelectedText = () => {
    if (selectedElement?.type !== "text") return;
    if (!confirm("Convertir a curvas hará que el texto ya no sea editable. ¿Continuar?")) return;
    try {
      const outlines = extractTextGlyphOutlines(selectedElement, (family) => fontSources[family], "editable");
      const next = dispatch(editorRef.current, convertTextToGlyphs(selectedElement.id, outlines));
      if (next === editorRef.current) { persist.set("failed", "No se pudo convertir el texto a curvas."); return; }
      setEditorState(next);
      persist.set("saved", "Texto convertido a curvas");
    } catch (error) {
      persist.set("failed", error instanceof FontOutlineError ? error.message : "No se pudo convertir el texto a curvas");
    }
  };

  type TextTypographyPatch = { readonly fontFamily?: string; readonly fontSize?: number; readonly fontWeight?: "normal" | "bold"; readonly fontStyle?: "normal" | "italic"; readonly lineHeight?: number; readonly scaleX?: number; readonly scaleY?: number };
  const updateTextElement = (element: TextElement, patch: TextTypographyPatch) => {
    const fontFamily = patch.fontFamily ?? element.fontFamily;
    const fontSize = patch.fontSize ?? element.fontSize;
    const fontWeight = patch.fontWeight ?? element.fontWeight;
    const fontStyle = patch.fontStyle ?? element.fontStyle;
    const lineHeight = patch.lineHeight ?? element.lineHeight;
    const size = patch.fontFamily || patch.fontSize || patch.fontWeight || patch.fontStyle || patch.lineHeight ? textSizeFor(element.text, fontSize, fontFamily, fontWeight, fontStyle, lineHeight) : element.size;
    setEditorState(dispatch(editorRef.current, updateElement(element.id, { ...patch, size })));
  };

  const beginTextEdit = (element: TextElement) => {
    setEditorState(select(editorRef.current, [element.id]));
    setTextFontFamily(element.fontFamily);
    setTextFontWeight(element.fontWeight);
    setTextFontStyle(element.fontStyle);
    setTextDraft({ position: element.position, value: element.text, elementId: element.id, fontSize: element.fontSize, element });
  };

  const onCanvasPointerDown = (event: PointerEvent<HTMLDivElement>) => {
     // Commit before handling the next canvas target. This makes pointer-down
     // the authoritative boundary for a draft instead of relying on blur order.
     const hadTextDraft = Boolean(textDraftRef.current);
     commitTextDraft();
     if (hadTextDraft) {
       if (tool !== "text") return;
       const point = pointAt(event);
       const hit = pickElement(editorRef.current.document, point, zoom);
       const existing = hit ? editorRef.current.document.elements.find((element): element is TextElement => element.id === hit && element.type === "text") : undefined;
       if (!existing) return;
       beginTextEdit(existing);
       return;
     }
     if (interaction.current) return;
     setCenterHover(undefined);
       setCursorPoint(canvasPointAt(event));
       setDocumentCursorPoint(pointAt(event));
       if (isDrawingTool(tool)) { const pointer = pointAt(event); const draft = creationDraftRef.current; const direction = project.preferences.lineGuidesEnabled && tool === "line" && draft?.points.length ? directionalGuide(draft.points.at(-1)!, pointer, project.preferences.lineGuideAngle, 3) : undefined; setLineCursorAngle(undefined); setCreationPoint(direction?.snappedPoint ?? pointer); }
     setSnapGuide(undefined);
     setAlignmentGuideState([]);
     if (tool !== "forma") setEditModeElementIds([]);
     setSelectedSplineNodeKey(undefined);
     const resizeTarget = tool === "forma" ? null : (event.target as HTMLElement).closest<HTMLElement>("[data-resize-handle]");
    if (resizeTarget) { resizePointerDown(event, resizeTarget.dataset.resizeHandle as ResizeHandle); return; }
    if (tool === "pan") {
      event.currentTarget.setPointerCapture(event.pointerId);
      interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "pan", dragged: false };
      return;
    }
      const point = pointAt(event);
       const rawCreationPoint = isDrawingTool(tool) ? point : undefined;
        const creationSnap = rawCreationPoint ? snapCreationPoint(editorRef.current.document, rawCreationPoint, zoom) : undefined;
            const draftForDirection = creationDraftRef.current;
            const direction = project.preferences.lineGuidesEnabled && tool === "line" && draftForDirection?.points.length ? directionalGuide(draftForDirection.points.at(-1)!, rawCreationPoint!, project.preferences.lineGuideAngle, 3) : undefined;
            const nodeGuidesForClick = tool === "line" && draftForDirection?.points.length ? nodeAlignmentGuides(editorRef.current.document, draftForDirection.points.at(-1)!, rawCreationPoint!, zoom, 5) : [];
            const nodeGuidedPoint = nodeGuidesForClick.length ? pointAlignedToNodeGuides(rawCreationPoint!, nodeGuidesForClick) : undefined;
            const creationPointForClick = creationSnap?.point ?? nodeGuidedPoint ?? direction?.snappedPoint ?? rawCreationPoint;
           const inferredPoint = snapCreationPoint(editorRef.current.document, point, zoom)?.point ?? point;
      if (tool === "rectangle" || tool === "ellipse") {
        const creationPoint = creationPointForClick ?? point;
        const draft = creationDraftRef.current;
        if (!draft) {
          const nextDraft = { tool, points: [creationPoint], pointer: creationPoint, snaps: [creationSnap] } as const;
         creationDraftRef.current = nextDraft;
         setCreationDraft(nextDraft);
       } else {
          const element = newElement(tool, editorRef.current.document.layers[0]?.id ?? "layer-1", draft.points[0]!, creationPoint, id());
          if (tool === "rectangle" || circleGeometry(draft.points[0]!, creationPoint)) {
            const next = dispatch(editorRef.current, createElement(element, creationConnections(element, [...(draft.snaps ?? []), creationSnap])));
           if (next !== editorRef.current) setEditorState(select(next, [element.id]));
         }
         creationDraftRef.current = undefined;
         setCreationDraft(undefined);
       }
       return;
     }
      if (tool === "line") {
        const creationPoint = creationPointForClick ?? point;
        const draft = creationDraftRef.current;
        const snappedSketchNode = creationSnap?.address?.kind === "sketch" && creationSnap.node ? { elementId: creationSnap.node.elementId, nodeId: creationSnap.address.nodeId } : undefined;
        if (!draft) {
          const nextDraft = { tool, points: [creationPoint], pointer: creationPoint, snaps: [creationSnap], ...(snappedSketchNode ? { elementId: snappedSketchNode.elementId, currentNodeId: snappedSketchNode.nodeId } : {}) } as const;
         creationDraftRef.current = nextDraft;
         setCreationDraft(nextDraft);
       } else if (draft.points.length === 1 && !draft.elementId) {
          const sketch = createSketchLine(id(), layerId(editorRef.current.document.layers[0]?.id ?? "layer-1"), { ...defaultStyle, strokeWidth: 1.5 }, draft.points[0]!, creationPoint);
          const next = dispatch(editorRef.current, createElement(sketch, creationConnections(sketch, [...(draft.snaps ?? []), creationSnap])));
          const nextDraft = { tool, points: [...draft.points, creationPoint], pointer: creationPoint, elementId: sketch.id, currentNodeId: sketch.nodes[1]!.id } as const;
         creationDraftRef.current = nextDraft;
         setCreationDraft(nextDraft);
         setEditorState(select(next, [sketch.id]));
       } else if (draft.elementId && draft.currentNodeId) {
          const targetNodeId = snappedSketchNode?.elementId === draft.elementId ? snappedSketchNode.nodeId : undefined;
          const next = dispatch(editorRef.current, appendSketchEdge(draft.elementId, draft.currentNodeId, creationPoint, targetNodeId));
          const sketch = next.document.elements.find((element): element is Extract<Element, { type: "sketch" }> => element.id === draft.elementId && element.type === "sketch");
          const currentNodeId = targetNodeId ?? sketch?.nodes.find((node) => node.point.x === creationPoint.x && node.point.y === creationPoint.y)?.id ?? draft.currentNodeId;
          const nextDraft = { ...draft, points: [...draft.points, creationPoint], pointer: creationPoint, currentNodeId };
         creationDraftRef.current = nextDraft;
         setCreationDraft(nextDraft);
         setEditorState(select(next, [draft.elementId]));
       }
       return;
     }
     const pickedElement = tool === "forma" ? pickFormaElement(editorRef.current.document, point, zoom) : pickElement(editorRef.current.document, point, zoom);
    const picked = pickedElement ? editorRef.current.document.elements.find((element) => element.id === pickedElement) : undefined;
    if (tool === "forma" && picked?.type === "text") {
      setEditorState(clearSelection(editorRef.current));
      return;
    }
     if (tool === "text") {
       const hit = pickElement(editorRef.current.document, point, zoom);
       const existing = hit ? editorRef.current.document.elements.find((element): element is TextElement => element.id === hit && element.type === "text") : undefined;
       if (existing) beginTextEdit(existing);
       else setTextDraft({ position: point, value: "" });
       return;
    }
     if (tool === "cut") {
        const hit = pickCuttableSegment(editorRef.current.document, point, zoom);
        const element = hit ? editorRef.current.document.elements.find((candidate) => candidate.id === hit.elementId) : undefined;
        const segment = element?.type === "path" ? element.segments[hit?.segmentIndex ?? -1] : undefined;
        if (hit && element?.type === "line") {
              const next = dispatch(editorRef.current, cutLineAtPoint(hit.elementId, point));
              if (next !== editorRef.current) setEditorState(select(next, next.document.elements.filter((candidate) => candidate.type === "path" && (candidate.id === hit.elementId || candidate.id.startsWith(`${hit.elementId}:piece:`))).map((candidate) => candidate.id)));
            } else if (hit && element?.type === "sketch") {
          let next = dispatch(editorRef.current, cutSketchEdge(hit.elementId, hit.segmentIndex, point));
          if (next !== editorRef.current) setEditorState(select(next, next.document.elements.some((candidate) => candidate.id === hit.elementId) ? [hit.elementId] : []));
            } else if (hit && (element?.type === "rectangle" || element?.type === "ellipse" || segment?.type === "line")) {
          const next = dispatch(editorRef.current, cutPathSegment(hit.elementId, hit.segmentIndex, point));
          if (next !== editorRef.current) setEditorState(select(next, [hit.elementId]));
        }
        return;
      }
      if (tool === "spline") { addSplinePoint(inferredPoint); return; }
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
           interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "pen-place", start, placement: inferredPoint, ...(last && selectedPath ? { pathId: selectedPath.id } : {}), startClient: { x: event.clientX, y: event.clientY }, dragged: false };
         } else addPenPoint(inferredPoint);
      }
      return;
    }
      const rawFormaNodeHit = tool === "forma" ? pickFormaNode(editorRef.current.document, point, zoom) : undefined;
      const formaNodeHit = rawFormaNodeHit && editModeElementIds.includes(rawFormaNodeHit.elementId) ? rawFormaNodeHit : undefined;
      const contourNodeHit = formaNodeHit?.contourNode;
      const nodeHit = tool !== "forma" && transformMode === "resize" ? pickNode(editorRef.current.document, point, zoom) : undefined;
      const pathSegmentHit = tool === "forma" && !formaNodeHit ? (() => { const hit = pickPathSegment(editorRef.current.document, point, zoom); return hit && editModeElementIds.includes(hit.elementId) ? hit : undefined; })() : undefined;
        if ((tool === "dimension" || tool === "radius")) {
           if (dimensionDraft?.phase === "first" && dimensionDraft.first.kind === "circle") {
             const placement = pointAt(event);
             const dimension = newCircleDimension("layer-1", dimensionDraft.first.hit, placement, tool === "radius" ? "radius" : dimensionMode);
             const created = dispatch(editorRef.current, createElement(dimension));
             if (created === editorRef.current) return;
             const next = dispatch(created, setDimensionDriving(dimension.id, true));
             setEditModeElementIds([dimensionDraft.first.hit.elementId]);
             setEditorState(select(next, [dimensionDraft.first.hit.elementId]));
             const placedValue = dimensionGeometry(dimension, next.document.elements)?.value;
             if (placedValue !== undefined) { setDimensionEditError(undefined); setDimensionEditDraft({ id: dimension.id, value: placedValue.toFixed(2), position: pagePointToCanvas(placement, zoom, panMm) }); }
             setDimensionDraft(undefined);
             setDimensionNodeHover(undefined);
             return;
           }
           if (dimensionDraft?.phase === "placement") {
            const placement = pointAt(event);
            const dimension = dimensionDraft.first.kind === "node" && dimensionDraft.second.kind === "node" ? newDimension("layer-1", dimensionDraft.first.hit, dimensionDraft.second.hit, placement, tool === "radius" ? "radius" : dimensionMode) : dimensionDraft.first.kind === "line" && dimensionDraft.second.kind === "line" ? newAngularDimension("layer-1", dimensionDraft.first, dimensionDraft.second, placement) : undefined;
            if (!dimension) return;
            const created = dispatch(editorRef.current, createElement(dimension));
            if (created === editorRef.current) return;
            const next = dimension.kind === "radius" || dimension.kind === "diameter" ? dispatch(created, setDimensionDriving(dimension.id, true)) : created;
            const selectedTargetId = dimensionDraft.first.hit.elementId;
            setEditModeElementIds([selectedTargetId]);
            setEditorState(select(next, [selectedTargetId]));            const placedValue = dimensionGeometry(dimension, next.document.elements)?.value;
            if (placedValue !== undefined) { setDimensionEditError(undefined); setDimensionEditDraft({ id: dimension.id, value: placedValue.toFixed(2), position: pagePointToCanvas(placement, zoom, panMm) }); }
           setDimensionDraft(undefined);
           setDimensionNodeHover(undefined);
           return;
         }
           const dimensionTarget = pickDimensionTarget(editorRef.current.document, point, zoom);
          if (!dimensionTarget) {
            if (dimensionDraft?.phase === "first" && dimensionDraft.first.kind === "line") {
              setDimensionDraft({ phase: "placement", first: dimensionDraft.first, second: dimensionDraft.first });
              setDimensionNodeHover(undefined);
            }
            return;
          }
          if (!dimensionDraft) { setDimensionDraft({ phase: "first", first: dimensionTarget }); return; }
          if (dimensionDraft.phase === "first") {
            if (dimensionDraft.first.kind === "node" && dimensionTarget.kind === "node" && dimensionDraft.first.hit.elementId === dimensionTarget.hit.elementId && dimensionDraft.first.hit.nodeIndex === dimensionTarget.hit.nodeIndex) return;
           if (dimensionDraft.first.kind === "line" && dimensionTarget.kind === "line" && dimensionDraft.first.hit.elementId === dimensionTarget.hit.elementId && (dimensionDraft.first.hit.edgeIndex ?? 0) === (dimensionTarget.hit.edgeIndex ?? 0)) {
             setDimensionDraft({ phase: "placement", first: dimensionDraft.first, second: dimensionTarget });
             setDimensionNodeHover(undefined);
             return;
           }
             if (dimensionDraft.first.kind === "node" && dimensionTarget.kind === "circle" && dimensionDraft.first.hit.elementId === dimensionTarget.hit.elementId && dimensionDraft.first.hit.node.nodeId === "center") {
               setDimensionDraft({ phase: "placement", first: dimensionDraft.first, second: { kind: "node", hit: dimensionTarget.hit.rim } });
               setDimensionNodeHover(undefined);
               return;
             }
             if (dimensionDraft.first.kind !== dimensionTarget.kind) return;
            setDimensionDraft({ phase: "placement", first: dimensionDraft.first, second: dimensionTarget });
           setDimensionNodeHover(undefined);
           return;
         }
       }
          const domDimensionId = (event.target as unknown as globalThis.Element).closest("[data-dimension]")?.getAttribute("data-element-id") as ElementId | null;
          const hit = domDimensionId ?? formaNodeHit?.elementId ?? pathSegmentHit?.elementId ?? nodeHit?.elementId ?? pickElement(editorRef.current.document, point, zoom);
    if (isDrawingTool(tool) && pointerDownIntent(tool, hit) === "draw") {
      event.currentTarget.setPointerCapture(event.pointerId);
      setEditorState(beginGesture(editorRef.current));
      interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "draw", dragged: false, start: point, startClient: { x: event.clientX, y: event.clientY }, tool, ids: [id()] };
      return;
    }
    if (hit) {
      const hitElement = editorRef.current.document.elements.find((element): element is DimensionElement => element.id === hit && element.type === "dimension");
      if (tool === "select" && hitElement) {
        const value = dimensionGeometry(hitElement, editorRef.current.document.elements)?.value;
        if (value !== undefined) {
          setEditorState(select(editorRef.current, [hitElement.id]));
          setDimensionEditError(undefined); setDimensionEditDraft({ id: hitElement.id, value: value.toFixed(2), position: pagePointToCanvas(point, zoom, panMm) });
          return;
        }
      }
      const next = selectForPointerDown(editorRef.current, hit, event.shiftKey);
      setEditorState(next);
      if (!next.selection.includes(hit)) return;
      event.currentTarget.setPointerCapture(event.pointerId);
        if (tool === "forma") {
           const hitElement = editorRef.current.document.elements.find((element) => element.id === hit);
           if (hitElement && hitElement.type !== "text" && hitElement.type !== "dimension" && !editModeElementIds.includes(hitElement.id)) {
             setSelectedFormaNodeKeys([]);
             setSelectedPathSegment(undefined);
             setEditModeElementIds([hitElement.id]);
             return;
           }
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
     const point = documentPointAtClient(event.clientX, event.clientY);
     if (!(tool === "forma" ? pickFormaElement(editorRef.current.document, point, zoom) : pickElement(editorRef.current.document, point, zoom))) {
      setSelectedSplineNodeKey(undefined);
      setEditModeElementIds([]);
      setActiveSplineId(undefined);
      setEditorState(clearSelection(editorRef.current));
      return;
    }
    if (tool === "forma") {
       const hit = pickFormaElement(editorRef.current.document, point, zoom);
      const hitElement = hit ? editorRef.current.document.elements.find((element) => element.id === hit) : undefined;
      if (!hitElement || hitElement.type === "text" || hitElement.type === "dimension") return;
      if (!editModeElementIds.includes(hitElement.id)) {
        setSelectedFormaNodeKeys([]);
        setSelectedPathSegment(undefined);
        setEditModeElementIds([hitElement.id]);
        setEditorState(select(editorRef.current, [hitElement.id]));
        return;
      }
      if (pickFormaNode(editorRef.current.document, point, zoom)) return;
      const segment = pickFormaSegment(editorRef.current.document, point, zoom);
      if (segment) setEditorState(dispatch(select(editorRef.current, [segment.elementId]), insertFormaNode(segment.elementId, segment, point)));
      return;
    }
    if (tool === "select") {
          const hit = pickElement(editorRef.current.document, point, zoom);
          const dimension = editorRef.current.document.elements.find((element): element is DimensionElement => element.id === hit && element.type === "dimension");
          const value = dimension ? dimensionGeometry(dimension, editorRef.current.document.elements)?.value : undefined;
          if (dimension && value !== undefined) { setDimensionEditError(undefined); setDimensionEditDraft({ id: dimension.id, value: value.toFixed(2), position: pagePointToCanvas(point, zoom, panMm) }); }
        }
        if ((event.target as HTMLElement).closest("textarea")) return;
    const hit = pickElement(editorRef.current.document, point, zoom);
    const hitElement = hit ? editorRef.current.document.elements.find((element) => element.id === hit) : undefined;
      if (hitElement?.type === "text") {
       beginTextEdit(hitElement);
       return;
    }
    if (tool === "select" && hitElement && (hitElement.type === "path" || hitElement.type === "glyph" || hitElement.type === "spline")) {
      event.preventDefault();
      setSelectedFormaNodeKeys([]);
      setSelectedPathSegment(undefined);
      setEditModeElementIds([hitElement.id]);
      setTool("forma");
      setEditorState(select(editorRef.current, [hitElement.id]));
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
      setDocumentCursorPoint(pointAt(event));
       if (isDrawingTool(tool)) { const pointer = pointAt(event); const draft = creationDraftRef.current; const direction = project.preferences.lineGuidesEnabled && tool === "line" && draft?.points.length ? directionalGuide(draft.points.at(-1)!, pointer, project.preferences.lineGuideAngle, 3) : undefined; const nodeGuidesForMove = tool === "line" && draft?.points.length ? nodeAlignmentGuides(editorRef.current.document, draft.points.at(-1)!, pointer, zoom, 5) : []; const nodeGuidedPoint = nodeGuidesForMove.length ? pointAlignedToNodeGuides(pointer, nodeGuidesForMove) : undefined; setLineCursorAngle(tool === "line" && draft?.points.length ? direction?.angle ?? lineAngleDegrees(draft.points.at(-1)!, pointer) : undefined); setCreationPoint(nodeGuidedPoint ?? direction?.snappedPoint ?? pointer); }
      const feedbackTool = tool === "text" || tool === "pan" ? undefined : tool;
     if (tool === "cut" && !interaction.current) setCutSegmentHover(pickCuttableSegment(editorRef.current.document, pointAt(event), zoom));
     else setCutSegmentHover(undefined);
     if (feedbackTool && !interaction.current && (tool !== "dimension" && tool !== "radius" || dimensionDraft?.phase !== "placement")) setNodeHover(pickHoverNode(editorRef.current.document, pointAt(event), zoom, feedbackTool));
     else setNodeHover(undefined);
     if ((tool === "dimension" || tool === "radius") && dimensionDraft?.phase !== "placement" && !interaction.current) setDimensionNodeHover(pickNode(editorRef.current.document, pointAt(event), zoom));
    else if (tool !== "dimension" && tool !== "radius") setDimensionNodeHover(undefined);
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
         : movePathHandle(active.pathNode.elementId, pathNode.segmentIndex ?? -1, pathNode.handle ?? "control1", point, pathNode.ringIndex);
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
      const point = snapFormaNodePoint(editorRef.current.document, pointAt(event), zoom, active.formaNode);
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
          const keys = formaNodes.filter((node) => editModeElementIds.includes(node.elementId) && node.point.x >= bounds.x && node.point.x <= bounds.x + bounds.width && node.point.y >= bounds.y && node.point.y <= bounds.y + bounds.height).map((node) => node.key);
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
          if (event.key === "Enter" && constraintDraft) { event.preventDefault(); confirmConstraintDraft(); return; }
          if (event.key === "Escape" && constraintDraft) { event.preventDefault(); cancelConstraintDraft(); return; }
      if (event.key === "Escape") {
        creationDraftRef.current = undefined;
        setCreationDraft(undefined);
        if (interaction.current) {
           setEditorState(cancelGesture(editorRef.current));
           if (interaction.current.kind === "pen-place") setPenDraftPoint(undefined);
          interaction.current = undefined;
          setMarquee(undefined);
          setSnapGuide(undefined);
          setAlignmentGuideState([]);
        }
           setDimensionDraft(undefined);
           setDimensionNodeHover(undefined);
           creationDraftRef.current = undefined;
           setCreationDraft(undefined);
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
    }, [activeSplineId, constraintDraft, editModeElementIds, selectionKey, selectedFormaNodeKeys, tool, selectedElements]);

     const editableSelectionIds = tool === "pen" ? selection : editModeElementIds;
      const formaNodes: readonly FormaNodeOverlay[] = (tool === "forma" || tool === "pen") ? selectedElements.filter((element) => editableSelectionIds.includes(element.id) && element.type !== "text" && element.type !== "dimension").flatMap((element): readonly FormaNodeOverlay[] => {
        try {
        type EditablePathNode = ReturnType<typeof pathGeometryNodes>[number] & { readonly ringIndex?: number };
       const visiblePathNodes = (nodes: readonly EditablePathNode[], segmentForNode: (node: EditablePathNode) => { readonly startNodeId: string; readonly endNodeId: string } | undefined) => {
         const selectedAnchors = new Set(selectedFormaNodeKeys.flatMap((key) => { const match = key.match(new RegExp(`^${element.id}:p:(\\d+)$`)); const node = match ? nodes[Number(match[1])] : undefined; return node?.kind === "anchor" ? [node.nodeId] : []; }));
         const touchesSelectedAnchor = (node: EditablePathNode) => { const segment = node.kind === "control" ? segmentForNode(node) : undefined; return Boolean(segment && (selectedAnchors.has(segment.startNodeId) || selectedAnchors.has(segment.endNodeId))); };
         return nodes.map((node, nodeIndex) => ({ node, nodeIndex })).filter(({ node }) => node.kind === "anchor" || selectedAnchors.has(node.nodeId) || touchesSelectedAnchor(node));
       };
        return element.type === "contour"
       ? contourVertexNodes(element).map((node) => ({ kind: "contour" as const, key: `${node.elementId}:c:${node.ringIndex}:${node.pointIndex}`, elementId: node.elementId, point: node.point, contour: node }))
        : element.type === "path" ? (() => { const pathNodes = pathGeometryNodes(element); const selectedIndexes = selectedFormaNodeKeys.flatMap((key) => { const match = key.match(new RegExp(`^${element.id}:p:(\\d+)$`)); return match ? [Number(match[1])] : []; }); const visibleIndexes = new Set(visibleEditablePathNodeIndexes(pathNodes, element.segments, selectedIndexes)); return pathNodes.map((node, nodeIndex) => ({ node, nodeIndex })).filter(({ nodeIndex }) => visibleIndexes.has(nodeIndex)).map(({ node, nodeIndex }) => ({ kind: "path" as const, key: `${element.id}:p:${nodeIndex}`, elementId: element.id, point: node.point, nodeIndex, pathNode: { elementId: element.id, node } })); })()
          : element.type === "glyph" ? visiblePathNodes(glyphGeometryNodes(element), (node) => node.segmentIndex === undefined || node.ringIndex === undefined ? undefined : element.contours[node.ringIndex]?.segments[node.segmentIndex]).map(({ node, nodeIndex }) => ({ kind: "path" as const, key: `${element.id}:p:${nodeIndex}`, elementId: element.id, point: node.point, nodeIndex, pathNode: { elementId: element.id, node } }))
          : realGeometryNodes(element).map((node, nodeIndex) => ({ kind: "path" as const, key: `${element.id}:p:${nodeIndex}`, elementId: element.id, point: node.point, nodeIndex }));
        } catch {
          // Forma overlays are optional feedback; skip only this malformed element.
          return [];
        }
      }) : [];
      const selectedPathAnchor = selectedElement?.type === "path"
       ? (() => { const selectedPathOverlay = formaNodes.find((node): node is Extract<FormaNodeOverlay, { readonly kind: "path" }> => node.kind === "path" && "pathNode" in node && node.pathNode?.node.kind === "anchor" && selectedFormaNodeKeys.includes(node.key)); const anchor = selectedPathOverlay?.pathNode?.node; return anchor?.kind === "anchor" ? selectedElement.nodes.find((node) => node.id === anchor.nodeId) : undefined; })()
        : undefined;
    const selectedSketchConstraintNodes = selectedElement?.type === "sketch" ? selectedFormaNodeKeys.flatMap((key) => { const match = key.match(new RegExp(`^${selectedElement.id}:p:(\\d+)$`)); const node = match ? selectedElement.nodes[Number(match[1])] : undefined; return node ? [{ elementId: selectedElement.id, nodeId: node.id }] : []; }) : [];
        const addRelationToSelectedSketch = (kind: SketchConstraint["kind"], value?: number) => {
          if (selectedElement?.type !== "sketch" || constraintDraft) return;
          const required = kind === "fixed" ? 1 : 2;
          if (selectedSketchConstraintNodes.length !== required) return;
          const constraint: SketchConstraint = { id: `constraint-${crypto.randomUUID()}`, kind, references: selectedSketchConstraintNodes as unknown as SketchConstraint["references"], ...(value !== undefined ? { value } : {}) };
          const preview = previewGesture(beginGesture(editorRef.current), addSketchConstraint(selectedElement.id, constraint));
           if (!preview.gesture || preview.document === editorRef.current.document) return;
           setConstraintDraft({ sketchId: selectedElement.id, constraint });
           setEditorState(preview);
        };
        const confirmConstraintDraft = () => { if (!constraintDraft) return; setEditorState(commitGesture(editorRef.current)); setConstraintDraft(undefined); };
         const cancelConstraintDraft = () => { if (!constraintDraft) return; setEditorState(cancelGesture(editorRef.current)); setConstraintDraft(undefined); };
         const removeSketchConstraint = (sketchId: ElementId, constraintId: string) => { if (!constraintDraft) setEditorState(dispatch(editorRef.current, deleteSketchConstraint(sketchId, constraintId))); };
         const saveSketchConstraintValue = (sketch: Extract<Element, { type: "sketch" }>, constraint: SketchConstraint) => { const value = Number(constraintValueEdits[constraint.id] ?? constraint.value); if (!Number.isFinite(value) || value <= 0) return; const next = dispatch(editorRef.current, updateSketchConstraint(sketch.id, constraint.id, { ...constraint, value })); if (next !== editorRef.current) { setEditorState(next); setConstraintValueEdits((current) => { const nextValues = { ...current }; delete nextValues[constraint.id]; return nextValues; }); } };
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
   const handlePoints = selectedElement?.type === "line" || selectedElement?.type === "path" ? undefined : selectedElement?.type === "contour" && selectedBounds ? [groupHandlePoints(selectedBounds).nw, groupHandlePoints(selectedBounds).n, groupHandlePoints(selectedBounds).ne, groupHandlePoints(selectedBounds).e, groupHandlePoints(selectedBounds).se, groupHandlePoints(selectedBounds).s, groupHandlePoints(selectedBounds).sw, groupHandlePoints(selectedBounds).w] as const : selectedElement && isPropertyElement(selectedElement) ? rotatedResizeHandles(selectedElement) : (selectedElement?.type === "spline" || selectedElement?.type === "text") && selectedBounds ? [groupHandlePoints(selectedBounds).nw, groupHandlePoints(selectedBounds).n, groupHandlePoints(selectedBounds).ne, groupHandlePoints(selectedBounds).e, groupHandlePoints(selectedBounds).se, groupHandlePoints(selectedBounds).s, groupHandlePoints(selectedBounds).sw, groupHandlePoints(selectedBounds).w] as const : undefined;
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
   // The page uses border-box sizing; include the border so its content box
   // remains exactly document width × zoom for both SVG rendering and input.
   const pageStyle = { width: document.page.width * zoom + 2, height: document.page.height * zoom + 2, left: -panMm.x * zoom, top: -panMm.y * zoom };
   const pendingDimensionOverlay = (tool === "dimension" || tool === "radius") && dimensionDraft && cursorPoint ? (() => {
     const firstPoint = dimensionDraft.first.kind === "node" ? dimensionDraft.first.hit.node.point : dimensionDraft.first.kind === "circle" ? dimensionDraft.first.hit.center.node.point : dimensionDraft.first.hit.line.start;
     const start = pagePointToCanvas(firstPoint, zoom, panMm);
     const secondPoint = dimensionDraft.phase === "placement" ? dimensionDraft.second.kind === "node" ? dimensionDraft.second.hit.node.point : dimensionDraft.second.kind === "circle" ? dimensionDraft.second.hit.center.node.point : dimensionDraft.second.hit.line.start : undefined;
     const end = secondPoint ? pagePointToCanvas(secondPoint, zoom, panMm) : cursorPoint ?? pagePointToCanvas(firstPoint, zoom, panMm);
        return <svg className="dimension-pending-overlay" aria-hidden="true"><line x1={start.x} y1={start.y} x2={end.x} y2={end.y} /></svg>;
   })() : undefined;
     const cutSegmentHoverOverlay = tool === "cut" && cutSegmentHover ? <svg className="cut-segment-hover-overlay" viewBox={`0 0 ${document.page.width} ${document.page.height}`} style={{ left: pageStyle.left + 1, top: pageStyle.top + 1, width: document.page.width * zoom, height: document.page.height * zoom, right: "auto", bottom: "auto" }} aria-label="Segmento de corte bajo el puntero">{cutSegmentHover.points ? <polyline points={cutSegmentHover.points.map((point) => `${point.x},${point.y}`).join(" ")} /> : <line x1={cutSegmentHover.start.x} y1={cutSegmentHover.start.y} x2={cutSegmentHover.end.x} y2={cutSegmentHover.end.y} />}</svg> : undefined;
     const cursorNodeGuideOverlay = tool === "line" && documentCursorPoint ? (() => { const guides = cursorNodeGuides(document, documentCursorPoint, zoom, 5); return guides.length ? <svg className="node-guide-overlay" viewBox={`0 0 ${document.page.width} ${document.page.height}`} style={{ left: pageStyle.left + 1, top: pageStyle.top + 1, width: document.page.width * zoom, height: document.page.height * zoom, right: "auto", bottom: "auto" }} aria-label="Guía de nodo">{guides.map((guide, index) => <line key={`cursor-node-guide-${index}`} className="creation-guide creation-guide-node-alignment" x1={guide.source.x} y1={guide.source.y} x2={guide.target.x} y2={guide.target.y} />)}</svg> : undefined; })() : undefined;
         const pendingCreationOverlay = creationDraft && creationPoint ? (() => {
      const start = creationDraft.tool === "line" ? creationDraft.points.at(-1)! : creationDraft.points[0]!;
       const pointer = creationPoint;
      const rectangle = creationDraft.tool === "rectangle" ? normalizeDrag(creationDraft.points[0]!, pointer) : undefined;
      const circle = creationDraft.tool === "ellipse" ? circleGeometry(creationDraft.points[0]!, pointer) : undefined;
      const shape = rectangle ? <rect x={rectangle.position.x} y={rectangle.position.y} width={rectangle.size.width} height={rectangle.size.height} /> : circle ? <circle cx={creationDraft.points[0]!.x} cy={creationDraft.points[0]!.y} r={circle.radius} /> : undefined;
       const guides: readonly CreationGuide[] = creationGuides(document, pointer, zoom);
           const nodeGuides = creationDraft.tool === "line" ? nodeAlignmentGuides(document, start, pointer, zoom, 5) : [];
       return <svg className="creation-pending-overlay" viewBox={`0 0 ${document.page.width} ${document.page.height}`} style={{ left: pageStyle.left + 1, top: pageStyle.top + 1, width: document.page.width * zoom, height: document.page.height * zoom, right: "auto", bottom: "auto" }} aria-label="Vista previa de creación"><g className="creation-preview-shape">{shape}</g><line className="creation-preview-radius" x1={start.x} y1={start.y} x2={pointer.x} y2={pointer.y} />{nodeGuides.map((guide, index) => <line key={`node-guide-${index}`} className="creation-guide creation-guide-node-alignment" x1={guide.source.x} y1={guide.source.y} x2={guide.target.x} y2={guide.target.y} />)}{guides.map((guide, index) => <line key={index} className={`creation-guide creation-guide-${guide.kind}`} x1={guide.source.x} y1={guide.source.y} x2={guide.target.x} y2={guide.target.y} />)}</svg>;
    })() : undefined;
   const dimensionHoverStyle = dimensionNodeHover && (tool === "dimension" || tool === "radius") ? (() => { const point = pagePointToCanvas(dimensionNodeHover.node.point, zoom, panMm); return { left: point.x, top: point.y }; })() : undefined;
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
       const selectedEditOverlay = tool === "forma" ? selectedElements.filter((element) => editModeElementIds.includes(element.id) && element.type !== "spline" && element.type !== "line" && element.type !== "text").map((element) => {
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
        const pathGuideOverlay = selectedElements.filter((element) => (element.type === "path" || element.type === "glyph") && (tool === "pen" || editModeElementIds.includes(element.id))).flatMap((element) => {
          const activeIndexes = editableGeometryNodes(element).flatMap((node) => selectedFormaNodeKeys.includes(`${element.id}:p:${node.nodeIndex}`) && node.kind === "anchor" ? [node.nodeIndex] : []);
          return visibleBezierHandleGuides(element, activeIndexes).map((guide) => <line key={`${element.id}-${guide.nodeIndex}`} x1={guide.anchor.x} y1={guide.anchor.y} x2={guide.point.x} y2={guide.point.y} stroke="#1683ff" strokeWidth={1 / zoom} strokeDasharray={`${3 / zoom} ${2 / zoom}`} markerEnd="url(#forma-handle-arrow)" pointerEvents="none" />);
        });
       const splineOverlay = document.elements.filter((element): element is SplineElement => element.type === "spline").map((spline) => {
      const editing = tool === "spline" || editModeElementIds.includes(spline.id);
      const visible = tool === "spline" ? selection.includes(spline.id) || selectedSplineNodeKey?.startsWith(`${spline.id}:`) : editModeElementIds.includes(spline.id);
      return <g key={`spline-overlay-${spline.id}`} data-spline-overlay={spline.id}>

        {editing && visible && <path data-spline-edit-path={spline.id} d={splinePathData(spline)} fill="none" stroke="#1683ff" strokeWidth={1 / zoom} pointerEvents="none" />}
        <path data-spline-hit={spline.id} d={splinePathData(spline)} fill={spline.closed ? "transparent" : "none"} stroke="#2563eb" strokeOpacity={0.01} strokeWidth={12 / zoom} style={{ pointerEvents: tool === "select" || tool === "forma" ? "visiblePainted" : "none", cursor: tool === "select" ? "move" : tool === "forma" ? "crosshair" : "default" }} onDoubleClick={(event) => { if (tool === "forma") { event.preventDefault(); event.stopPropagation(); setEditModeElementIds([spline.id]); setSelectedSplineNodeKey(undefined); setEditorState(select(editorRef.current, [spline.id])); } }} onPointerDown={(event) => selectSplineObject(event, spline)} onPointerMove={(event) => onCanvasPointerMove(event as unknown as PointerEvent<HTMLDivElement>)} onPointerUp={(event) => finishPointer(event as unknown as PointerEvent<HTMLDivElement>, false)} onPointerCancel={(event) => finishPointer(event as unknown as PointerEvent<HTMLDivElement>, true)} />
         {visible && spline.nodes.map((node, nodeIndex) => {
           const formaNodeIndex = selectedFormaNodeKeys.flatMap((key) => key === `${spline.id}:p:${editableGeometryNodes(spline).findIndex((candidate) => candidate.kind === "anchor" && candidate.nodeId === node.id)}` ? [nodeIndex] : [])[0];
           const selectedNodeIndex = spline.nodes.findIndex((candidate) => selectedSplineNodeKey === `${spline.id}:${candidate.id}`);
           const activeNodeIndex = selectedNodeIndex >= 0 ? selectedNodeIndex : formaNodeIndex ?? -1;
           const showHandles = editing && activeNodeIndex === nodeIndex;
           const selected = selectedSplineNodeKey === `${spline.id}:${node.id}` || formaNodeIndex === nodeIndex;
          const controlColor = editing ? "#1683ff" : "#111827";
              const nodeSize = 5 / zoom;
          const handle = (kind: "in" | "out", offset: { readonly dx: number; readonly dy: number }) => {
            const point = { x: node.anchor.x + offset.dx, y: node.anchor.y + offset.dy };
             return <g key={`${node.id}-${kind}`}><line x1={node.anchor.x} y1={node.anchor.y} x2={point.x} y2={point.y} stroke="#1683ff" strokeWidth={1 / zoom} strokeDasharray={`${3 / zoom} ${2 / zoom}`} markerEnd="url(#forma-handle-arrow)" /><circle role="button" aria-label={`Mover handle ${kind === "in" ? "entrante" : "saliente"} de spline`} data-spline-handle={`${spline.id}:${node.id}:${kind}`} cx={point.x} cy={point.y} r={5 / zoom} fill="transparent" stroke="none" style={{ pointerEvents: "auto", cursor: "move" }} onPointerDown={(event) => beginSplineHandle(event, spline.id, node.id, kind)} onPointerMove={moveSplineHandle} onPointerUp={(event) => finishSplineHandle(event, false)} onPointerCancel={(event) => finishSplineHandle(event, true)} /></g>;
          };
          return <g key={node.id}>


             <rect role="button" aria-label="Ancla de spline" data-spline-node={node.id} x={node.anchor.x - nodeSize / 2} y={node.anchor.y - nodeSize / 2} width={nodeSize} height={nodeSize} fill={selected ? "#dbeafe" : "#ffffff"} stroke={controlColor} strokeWidth={1 / zoom} transform={editing ? `rotate(45 ${node.anchor.x} ${node.anchor.y})` : undefined} style={{ pointerEvents: "auto", cursor: "move" }} onPointerDown={(event) => selectSplineAnchor(event, spline, node.id)} onPointerMove={(event) => onCanvasPointerMove(event as unknown as PointerEvent<HTMLDivElement>)} onPointerUp={(event) => finishPointer(event as unknown as PointerEvent<HTMLDivElement>, false)} onPointerCancel={(event) => finishPointer(event as unknown as PointerEvent<HTMLDivElement>, true)} />
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
    const clearDimensionDrafts = () => setDrafts((current) => {
      const next = { ...current };
      const prefix = selectedElements.length > 1 ? "group" : element.id;
      delete next[`${prefix}:width`];
      delete next[`${prefix}:height`];
      return next;
    });
    if (selectedElements.length > 1 && selectedBounds) {
      const current = field === "x" ? selectedBounds.x : field === "y" ? selectedBounds.y : field === "width" ? selectedBounds.width : selectedBounds.height;
      if (field === "x" || field === "y") setEditorState(dispatch(editorRef.current, moveElements(selection, { x: field === "x" ? value - current : 0, y: field === "y" ? value - current : 0 })));
       else {
         const size = aspectLock ? aspectSize(selectedBounds.width, selectedBounds.height, field, value) : { width: field === "width" ? value : selectedBounds.width, height: field === "height" ? value : selectedBounds.height };
          setEditorState(dispatch(editorRef.current, resizeElementsToDimensions(selection, size, false)));
       }
       } else {
         const next = field === "width" || field === "height"
           ? dispatch(editorRef.current, resizeElementToDimensions(element.id, field, value, aspectLock))
           : dispatch(editorRef.current, updateElement(element.id, { position: { ...element.position, [field]: value } }));
         if (next === editorRef.current && (field === "width" || field === "height")) persist.set("failed", "No se puede redimensionar sin romper una conexión existente.");
         setEditorState(next);
       }
      clearDimensionDrafts();
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
    if (operation !== "weld" && operation !== "subtract") {
      const next = dispatch(current, shapeOperation(current.selection, operation));
      if (next !== current) setEditorState(next);
      return;
    }
    const invalidDimensionCount = invalidDimensionIdsForShapeOperation(current.document, current.selection, operation).length;
    if (invalidDimensionCount > 0) {
      setPendingShapeOperation({ operation, ids: [...current.selection], invalidDimensionCount });
      return;
    }
    const next = dispatch(current, shapeOperation(current.selection, operation));
    if (next !== current) setEditorState(next);
  };
  const confirmPendingShapeOperation = () => {
    const pending = pendingShapeOperation;
    if (!pending) return;
    const current = editorRef.current;
    const next = dispatch(current, shapeOperation(pending.ids, pending.operation));
    setPendingShapeOperation(undefined);
    if (next !== current) setEditorState(next);
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
    const isActive = selectedElements.some((element) => "flipX" in element && Boolean(axis === "horizontal" ? element.flipX : element.flipY));
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
      {(() => {
        const hasSelectedDimension = selectedElements.some((element) => element.type === "dimension");
        const dimensionDescription = "Las cotas son anotaciones: se ignoran como geometría y se conservan si sus referencias siguen existiendo.";
        const weldDescription = hasSelectedDimension ? dimensionDescription : "Combinar los objetos cerrados seleccionados en una sola forma.";
        const subtractDescription = hasSelectedDimension ? dimensionDescription : "Usar el último objeto seleccionado como objetivo y los anteriores como cortadores.";
        const outlineDescription = hasSelectedDimension ? dimensionDescription : "Crear un contorno real alrededor de los objetos cerrados seleccionados.";
        const isClosedShapeSelection = (element: Element) => element.type !== "line" && element.type !== "text" && element.type !== "dimension" && (element.type !== "path" && element.type !== "spline" || element.closed);
        const selectedShapes = selectedElements.filter((element) => element.type !== "dimension");
        const hasNonClosedShape = selectedShapes.some((element) => !isClosedShapeSelection(element));
        return <>
          <button type="button" className="shape-operation-button" aria-label="Soldar" title={weldDescription} aria-description={weldDescription} disabled={!selectedShapes.length || hasNonClosedShape} onClick={() => applyShapeOperation("weld")}>Soldar<span className="shape-operation-description" role="tooltip">{weldDescription}</span></button>
          <button type="button" className="shape-operation-button" aria-label="Recortar" title={subtractDescription} aria-description={subtractDescription} disabled={selectedShapes.length < 2 || hasNonClosedShape} onClick={() => applyShapeOperation("subtract")}>Recortar<span className="shape-operation-description" role="tooltip">{subtractDescription}</span></button>
          <button type="button" className="shape-operation-button" aria-label="Crear límites" title={outlineDescription} aria-description={outlineDescription} disabled={!selectedElements.length || selectedElements.some((element) => element.type === "line" || element.type === "dimension")} onClick={() => applyShapeOperation("outline")}>Crear límites<span className="shape-operation-description" role="tooltip">{outlineDescription}</span></button>
        </>;
      })()}
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

  const textPropertyPanel = () => {
    if (selectedElement?.type !== "text") return <p className="muted">Seleccione un texto para editar sus propiedades.</p>;
    const boxWidth = selectedElement.size.width * (selectedElement.scaleX ?? 1);
    const boxHeight = selectedElement.size.height * (selectedElement.scaleY ?? 1);
    const resizeTextBox = (axis: "width" | "height", value: number) => {
      if (!Number.isFinite(value) || value <= 0) return;
      updateTextElement(selectedElement, axis === "width" ? { scaleX: value / selectedElement.size.width } : { scaleY: value / selectedElement.size.height });
    };
    const selectedLocalFont = localFonts.find((font) => font.family === selectedElement.fontFamily);
    return <div className="text-properties"><div className="text-box-fields"><label className="field"><span>Ancho caja</span><input type="number" min="1" step="0.1" value={formatMm(boxWidth)} onChange={(event) => resizeTextBox("width", Number(event.target.value))} /></label><label className="field"><span>Alto caja</span><input type="number" min="1" step="0.1" value={formatMm(boxHeight)} onChange={(event) => resizeTextBox("height", Number(event.target.value))} /></label></div><label className="field"><span>Tamaño (mm)</span><input type="number" min="1" value={selectedElement.fontSize} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value > 0) updateTextElement(selectedElement, { fontSize: value }); }} /></label><label className="field"><span>Tipografía</span><div className="font-select-row"><select value={selectedElement.fontFamily} onChange={(event) => updateTextElement(selectedElement, { fontFamily: event.target.value })}>{availableFonts.map((font) => <option key={font} style={{ fontFamily: font }}>{font}</option>)}</select>{selectedLocalFont && <button type="button" className="font-delete-button" aria-label={`Eliminar fuente local ${selectedLocalFont.family}`} title="Eliminar fuente local" onClick={() => void deleteLocalFont(selectedLocalFont)}>×</button>}</div></label><label className="field"><span>Interlineado</span><input type="number" min="0.5" step="0.1" value={selectedElement.lineHeight} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value > 0) updateTextElement(selectedElement, { lineHeight: value }); }} /></label><div className="text-style-buttons"><button type="button" aria-pressed={selectedElement.fontWeight === "bold"} onClick={() => updateTextElement(selectedElement, { fontWeight: selectedElement.fontWeight === "bold" ? "normal" : "bold" })}>Negrita</button><button type="button" aria-pressed={selectedElement.fontStyle === "italic"} onClick={() => updateTextElement(selectedElement, { fontStyle: selectedElement.fontStyle === "italic" ? "normal" : "italic" })}>Cursiva</button></div><label className="font-upload-button">Cargar fuente para esta familia<input type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadFontFile(file, selectedElement.fontFamily); event.currentTarget.value = ""; }} /></label><button type="button" aria-label="Convertir texto a curvas" title="Requiere una fuente cargada para esta familia" disabled={!fontSources[selectedElement.fontFamily]} onClick={convertSelectedText}>Convertir a curvas</button>{!fontSources[selectedElement.fontFamily] && <p className="muted">Cargue una fuente TTF, OTF, WOFF o WOFF2 para habilitar la conversión.</p>}{fontLoadError && <p className="muted">{fontLoadError}</p>}</div>;
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
    {pendingShapeOperation && <div className="nodra-modal-backdrop" role="presentation"><section className="nodra-modal" role="dialog" aria-modal="true" aria-labelledby="shape-operation-confirmation-title"><h2 id="shape-operation-confirmation-title">Confirmar operación</h2><p>Esta operación eliminará {pendingShapeOperation.invalidDimensionCount} cotas porque sus referencias dejarán de existir. ¿Continuar?</p><div className="nodra-modal-actions"><button type="button" onClick={() => setPendingShapeOperation(undefined)}>Cancelar</button><button type="button" className="nodra-modal-primary" onClick={confirmPendingShapeOperation}>Continuar</button></div></section></div>}
    <header className="topbar">
      <div className="brand" aria-label="KOND DESIGN"><span className="brand-kond">KOND</span> <span className="brand-design">DESIGN</span></div>
      <nav aria-label="Modo de espacio de trabajo"><button className={mode === "design" ? "active" : ""} onClick={() => setMode("design")}>Diseño</button><button className={mode === "prepare" ? "active" : ""} onClick={() => setMode("prepare")}>Preparar <small>Vista previa</small></button></nav>
      <div className="top-actions">{desktopFileBridge() && <><button aria-label="Abrir proyecto" title="Abrir proyecto" onClick={() => void openDesktopProject()}>Abrir</button><button aria-label="Guardar proyecto" title="Guardar proyecto" onClick={() => void saveDesktopProject()}>Guardar</button><button aria-label="Guardar como" title="Guardar como" onClick={() => void saveDesktopProject(true)}>Guardar como</button></>}<button aria-label="Deshacer" onClick={() => setEditorState(undo(editorRef.current))}>↶</button><button aria-label="Rehacer" onClick={() => setEditorState(redo(editorRef.current))}>↷</button><span className="project-name">Diseño sin título</span></div>
    </header>
    {mode === "prepare" ? <section className="prepare"><div><div className="prepare-icon">◇</div><h1>Preparar aún no está disponible</h1><p>Nodra ofrece actualmente solo un espacio de trabajo de Diseño sin conexión. No hay hardware conectado, controlado ni listo.</p><button onClick={() => setMode("design")}>Volver a Diseño</button></div></section> : <div className="workspace">
      <section className="properties-bar" aria-label="Barra de propiedades">
        {tool === "dimension" && <div className="dimension-mode-controls" role="group" aria-label="Modo de cota"><button type="button" className={dimensionMode === "auto" ? "active" : ""} onClick={() => setDimensionMode("auto")}>Lineal</button><button type="button" className={dimensionMode === "radius" ? "active" : ""} onClick={() => setDimensionMode("radius")}>Radio</button><button type="button" className={dimensionMode === "diameter" ? "active" : ""} onClick={() => setDimensionMode("diameter")}>Diámetro</button></div>}
         <div className="page-selector"><label>Fuente de texto<select aria-label="Tipografía del texto" value={textFontFamily} onChange={(event) => { const family = event.target.value; setTextFontFamily(family); const textElements = selectedElements.filter((element): element is TextElement => element.type === "text"); let next = editorRef.current; for (const element of textElements) next = dispatch(next, updateElement(element.id, { fontFamily: family, size: textSizeFor(element.text, element.fontSize, family, element.fontWeight, element.fontStyle, element.lineHeight) })); if (textElements.length) setEditorState(next); }}>{availableFonts.map((font) => <option key={font} style={{ fontFamily: font }}>{font}</option>)}</select><label className="font-upload-button">+ Fuente<input type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadFontFile(file); event.currentTarget.value = ""; }} /></label></label><label>Página<select aria-label="Página activa" value={project.activePageId} onChange={(event) => switchPage(event.target.value)}>{project.pages.map((page, index) => <option key={page.id} value={page.id}>{index + 1} · {page.page.width} × {page.page.height} mm</option>)}</select></label><button type="button" onClick={createPageAndSelect}>+ Nueva página</button></div>
           {selectedElements.length > 0 ? <div className="property-fields">
                {objectPropertySections()}{mirrorButton("horizontal")}{mirrorButton("vertical")}{shapeOperations()}
         </div> : <p className="muted">Seleccione un objeto para editar sus propiedades.</p>}
      </section>
         <aside className="workspace-tools"><div className="tool-column" role="toolbar" aria-label="Herramientas de diseño">{(["select", "forma", "pen", "spline", "text", "rectangle", "ellipse", "line", "cut", "dimension", "pan"] as const).map((item) => <ToolButton key={item} label={toolCursorLabels[item]} icon={item} active={tool === item} onClick={() => { setTransformMode("resize"); setPenDraftPoint(undefined); creationDraftRef.current = undefined; setCreationDraft(undefined); if (item === "forma" && selectedElements.some((element) => element.type === "text")) setEditorState(clearSelection(editorRef.current)); if (item !== "forma") setEditModeElementIds([]); setTool(item); }} />)}</div></aside>
      <section className="canvas-area">
        <header className="canvas-header"><span>DISEÑO / SIN TÍTULO</span><span>{document.elements.length} objetos · {document.page.width} × {document.page.height} mm</span><div className="zoom-controls"><button aria-label="Alejar" onClick={() => setZoom(zoom - 0.5)}>−</button><span className="zoom-label">{Math.round(zoom * 100 / 3)}%</span><button aria-label="Acercar" onClick={() => setZoom(zoom + 0.5)}>+</button></div></header>
             <div ref={canvas} className={`${grid ? "canvas" : "canvas no-grid"}${isDrawingTool(tool) ? " drawing-tool" : ""}`} onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove} onPointerUp={(event) => finishPointer(event, false)} onPointerCancel={(event) => finishPointer(event, true)} onLostPointerCapture={cancelPointerInteraction} onPointerLeave={() => { setCursorPoint(undefined); setNodeHover(undefined); setCutSegmentHover(undefined); setDimensionNodeHover(undefined); }} onDoubleClick={onCanvasDoubleClick} onWheel={onWheel}>
            {rulerHorizontal}{rulerVertical}<span className="ruler-corner" aria-hidden="true" />
            <div className="page" style={pageStyle}>{/* SAFETY: renderSvg emits allowlisted SVG from validated document data. */}<div className={`page-svg${textDraft ? " editing-text" : ""}`} dangerouslySetInnerHTML={{ __html: rendered.success ? rendered.svg : "" }} />{(alignmentGuideOverlay.length > 0 || splineOverlay.length > 0 || selectedEditOverlay.length > 0 || pathGuideOverlay.length > 0) && <svg data-spline-overlay-layer="true" viewBox={`0 0 ${document.page.width} ${document.page.height}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible", zIndex: 5 }}><defs><marker id="forma-handle-arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L5,2.5 L0,5 Z" fill="#1683ff" /></marker></defs>{alignmentGuideOverlay}{selectedEditOverlay}{pathGuideOverlay}{splineOverlay}</svg>}</div>
              {textDraft && (() => {
                const existing = textDraft.element;
                const lines = textDraft.value.split("\n");
                const inputWidth = existing ? existing.size.width * zoom : Math.max(70, Math.max(...lines.map((line) => line.length), 1) * ((textDraft.fontSize ?? 24) * 0.98));
                const inputHeight = existing ? existing.size.height * zoom : Math.max(30, lines.length * (textDraft.fontSize ?? 24) * 1.2);
                const inputFontSize = (existing?.fontSize ?? textDraft.fontSize ?? 24) * zoom;
                return <textarea ref={textInput} autoFocus value={textDraft.value} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); }} aria-label="Texto editable" rows={Math.max(1, lines.length)} wrap={existing ? "off" : undefined} onChange={(event) => setTextDraft((current) => current ? { ...current, value: event.target.value } : current)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); textDraftRef.current = undefined; setTextDraft(undefined); } else if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); commitTextDraft(); } }} onBlur={() => { const blurredDraft = textDraftRef.current; window.setTimeout(() => { if (globalThis.document.activeElement !== textInput.current) commitTextDraft(blurredDraft); }, 0); }} placeholder="Escriba aquí…" style={{ caretColor: "#111827", position: "absolute", left: pagePointToCanvas(textDraft.position, zoom, panMm).x, top: pagePointToCanvas(textDraft.position, zoom, panMm).y, zIndex: 8, width: `${inputWidth}px`, height: `${inputHeight}px`, padding: 0, fontFamily: existing?.fontFamily ?? textFontFamily, fontSize: `${inputFontSize}px`, fontWeight: existing?.fontWeight ?? textFontWeight, fontStyle: existing?.fontStyle ?? textFontStyle, textAlign: existing?.textAlign ?? "left", lineHeight: existing?.lineHeight ?? 1.2, color: "#111827", background: "transparent", border: "none", outline: "none", resize: "none", overflow: "hidden", transform: existing ? `rotate(${existing.rotation}rad) scale(${existing.scaleX ?? 1}, ${existing.scaleY ?? 1})` : undefined, transformOrigin: existing ? "top left" : undefined }} />;
              })()}
            {formaNodes.length > 0 && <div className="contour-node-overlay" role="group" aria-label={tool === "pen" ? "Nodos y controles del trazado" : "Nodos de forma"}>{formaNodes.map((node) => { const screen = pagePointToCanvas(node.point, zoom, panMm); const selected = selectedFormaNodeKeys.includes(node.key); const pathNode = node.kind === "path" ? node.pathNode : undefined; return <button key={node.key} type="button" className={`contour-node${(tool === "forma" || tool === "pen") && !(node.kind === "path" && pathNode?.node.kind === "control") ? " editing-node" : ""}${selected ? " active selected" : ""}`} data-contour-node={node.key} aria-label={node.kind === "contour" ? `Nodo del contorno, anillo ${node.contour.ringIndex + 1}, punto ${node.contour.pointIndex + 1}` : pathNode?.node.kind === "control" ? `Control Bézier ${pathNode.node.handle === "control1" ? "saliente" : "entrante"}` : `Nodo editable ${node.nodeIndex + 1}`} style={{ left: screen.x, top: screen.y }} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setSelectedFormaNodeKeys((current) => event.shiftKey ? current.includes(node.key) ? current.filter((value) => value !== node.key) : [...current, node.key] : [node.key]); if (tool === "pen" && pathNode?.node.kind === "anchor") { const currentPath = editorRef.current.document.elements.find((element) => element.id === node.elementId && element.type === "path"); if (currentPath?.type === "path" && !currentPath.closed && currentPath.nodes[0]?.id === pathNode.node.nodeId) { setPenDraftPoint(undefined); setEditorState(dispatch(select(editorRef.current, [node.elementId]), closePath(node.elementId))); return; } } canvas.current?.setPointerCapture(event.pointerId); if (pathNode) { setEditorState(beginGesture(select(editorRef.current, [node.elementId]))); interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "path-node", pathNode, startClient: { x: event.clientX, y: event.clientY }, dragged: false }; } else { setEditorState(beginGesture(editorRef.current)); interaction.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, kind: "contour-node", ...(node.kind === "contour" ? { contourNode: node.contour } : {}), formaNode: node.kind === "contour" ? { elementId: node.contour.elementId, contourNode: node.contour, point: node.point } : { elementId: node.elementId, nodeIndex: node.nodeIndex, point: node.point }, startClient: { x: event.clientX, y: event.clientY }, dragged: false }; } }} />; })}</div>}
          {centerHoverStyle && <div className="selection-center-feedback" style={centerHoverStyle} aria-hidden="true"><span className="selection-center-mark">×</span><span className="selection-center-label">centro</span></div>}
            {tool === "select" && transformMode === "resize" && (handlePoints || groupPoints) && <div className="resize-handles">{handleNames.map((handle) => <button key={handle} type="button" className={`resize-handle resize-handle-${handle}`} data-resize-handle={handle} aria-label={`Redimensionar ${handle}`} style={handleStyle(handle)} onPointerDown={(event) => resizePointerDown(event, handle)} onPointerUp={(event) => finishPointer(event, false)} onPointerCancel={(event) => finishPointer(event, true)} />)}{groupPoints && !isDrawingTool(tool) && <button type="button" className="resize-handle resize-handle-center" data-resize-handle="center" aria-label="Centro del grupo" style={handleStyle("center")} onPointerDown={(event) => event.stopPropagation()} />}</div>}
           {transformMode === "rotate" && selectedElements.length > 0 && <div className="rotation-controls" aria-label="Controles de rotación"><span className="rotation-center" style={selectedElements.length > 1 && selectedBounds ? { left: pagePointToCanvas(groupCenter(selectedBounds), zoom, panMm).x, top: pagePointToCanvas(groupCenter(selectedBounds), zoom, panMm).y } : centerStyle} aria-hidden="true" />{rotationPoints.map((point, index) => { const screen = pagePointToCanvas(point, zoom, panMm); return <button key={index} type="button" className="rotation-handle" aria-label={`Rotar objeto, control ${index + 1}`} style={{ left: screen.x, top: screen.y }} onPointerDown={rotationPointerDown} onPointerUp={(event) => finishPointer(event, false)} onPointerCancel={(event) => finishPointer(event, true)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 8A6 6 0 1 0 16 12" /><path d="m12.5 4 3 4-5 .5" /></svg></button>; })}</div>}
          {marqueeStyle && <div className="marquee" style={marqueeStyle} />}
           {pendingDimensionOverlay}{pendingCreationOverlay}{cursorNodeGuideOverlay}{cutSegmentHoverOverlay}{dimensionEditDraft && <form className="dimension-value-editor dimension-value-modal" role="dialog" aria-label="Modificar cota" style={{ left: dimensionEditDraft.position.x + 12, top: dimensionEditDraft.position.y - 18 }} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setDimensionEditDraft(undefined); } }} onSubmit={(event) => { event.preventDefault(); const command = updateDimensionValue(dimensionEditDraft.id, Number(dimensionEditDraft.value)); const applied = command.apply(editorRef.current.document); if (!applied.success) { setDimensionEditError(applied.error); return; } const next = dispatch(editorRef.current, command); if (next !== editorRef.current) { setEditorState(next); setDimensionEditError(undefined); setDimensionEditDraft(undefined); } else setDimensionEditError("La cota no produjo cambios."); }}>{dimensionEditError && <div role="alert" className="dimension-edit-error">{dimensionEditError}</div>}<label>Valor<input ref={dimensionInputRef} autoFocus type="number" onFocus={(event) => event.currentTarget.select()} min="0.01" step="0.01" value={dimensionEditDraft.value} onChange={(event) => setDimensionEditDraft((current) => current ? { ...current, value: event.target.value } : current)} /></label><button type="submit">Confirmar</button><button type="button" onClick={() => setDimensionEditDraft(undefined)}>Cancelar</button></form>}
              {constraintValueDraft && <form className="dimension-value-editor constraint-value-editor" onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setConstraintValueDraft(undefined); } }} onSubmit={(event) => { event.preventDefault(); const value = Number(constraintValueDraft.value); if (Number.isFinite(value) && value > 0) { addRelationToSelectedSketch(constraintValueDraft.kind, value); setConstraintValueDraft(undefined); } }}><label>Distancia en mm<input autoFocus type="number" min="0.01" step="0.01" value={constraintValueDraft.value} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setConstraintValueDraft((current) => current ? { ...current, value: event.target.value } : current)} /></label><button type="submit">Confirmar</button><button type="button" onClick={() => setConstraintValueDraft(undefined)}>Cancelar</button></form>}{cursorPoint && <span className="tool-cursor" style={{ left: cursorPoint.x, top: cursorPoint.y }} aria-label={`Herramienta activa: ${toolCursorLabels[tool]}`} title={dimensionNodeHover && (tool === "dimension" || tool === "radius") ? "Nodo de dimensión" : tool === "forma" && documentCursorPoint && pickFormaSegment(document, documentCursorPoint, zoom) ? "Doble clic para insertar un nodo" : undefined}>{toolCursorIcons[tool]}{tool === "line" && creationDraft && lineCursorAngle !== undefined && <span className="line-guide-cursor-hud" data-line-guide-hud="true"><span aria-hidden="true">{Math.abs(lineCursorAngle) < 0.1 ? "↔" : Math.abs(Math.abs(lineCursorAngle) - 90) < 0.1 ? "↕" : "↗"}</span><span>{lineCursorAngle.toFixed(1)}°</span></span>}</span>}
            {nodeHover && tool !== "dimension" && tool !== "radius" && !interaction.current && (() => { const point = "node" in nodeHover ? nodeHover.node.point : nodeHover.point; const screen = pagePointToCanvas(point, zoom, panMm); return <span className="node-hover-feedback" data-node-hover-feedback={`${nodeHover.elementId}:${nodeHover.nodeIndex ?? "forma"}`} style={{ left: screen.x, top: screen.y }} aria-label="Nodo bajo el puntero" />; })()}
           {dimensionHoverStyle && <span className="node-hover-feedback" data-dimension-node-target={`${dimensionNodeHover!.elementId}:${dimensionNodeHover!.nodeIndex}`} style={dimensionHoverStyle} aria-label="Nodo de dimensión bajo el puntero" title="Nodo de dimensión" />}
          <span className="canvas-hint">{(tool === "dimension" || tool === "radius") ? !dimensionDraft ? "Cota: seleccione el primer nodo" : dimensionDraft.phase === "first" ? "Cota: seleccione el segundo nodo" : "Cota: coloque la cota" : `Clic: relleno · clic derecho: contorno · ${toolCursorLabels[tool]}`}</span>
        </div>
      </section>
       <aside className="inspector">
         <div className="inspector-tabs" role="tablist" aria-label="Inspector">
           <button type="button" role="tab" aria-selected={inspectorTab === "properties"} className={inspectorTab === "properties" ? "active" : ""} onClick={() => setInspectorTab("properties")}>Propiedades</button>
            <button type="button" role="tab" aria-selected={inspectorTab === "transform"} className={inspectorTab === "transform" ? "active" : ""} onClick={() => setInspectorTab("transform")}>Transformar</button>
           <button type="button" role="tab" aria-selected={inspectorTab === "text"} className={inspectorTab === "text" ? "active" : ""} onClick={() => setInspectorTab("text")}>Texto</button>
         </div>
         <div className="inspector-tab-content" role="tabpanel">{selectedElement?.type === "sketch" && (() => { const solved = solveSketchConstraints(selectedElement); const statusLabel = solved.status === "underdefined" ? "subdefinido" : solved.status === "defined" ? "definido" : solved.status === "overdefined" ? "sobredimensionado" : "conflicto"; const constraintLabel = (id: string) => { const constraint = selectedElement.constraints?.find((candidate) => candidate.id === id); if (!constraint) return id; const labels = { horizontal: "Horizontal", vertical: "Vertical", coincident: "Coincidente", fixed: "Fijar al origen", parallel: "Paralela", perpendicular: "Perpendicular", equal: "Igual", "distance-horizontal": "Distancia H", "distance-vertical": "Distancia V", distance: "Distancia", angle: "Ángulo" } as const; return `${labels[constraint.kind]} (${id})`; }; return <section className="constraint-controls" aria-label="Relaciones geométricas"><div className="panel-title">RELACIONES</div><p className="muted">Seleccione dos nodos en Forma.</p><div className={`constraint-status constraint-status-${solved.status}`} role="status"><span className="constraint-status-icon" aria-hidden="true">{solved.status === "defined" ? "✓" : solved.status === "underdefined" ? "○" : solved.status === "overdefined" ? "!" : "×"}</span><span><strong>Estado: {statusLabel}</strong><small>{solved.status === "underdefined" ? "Faltan relaciones o cotas para fijar toda la geometría." : solved.status === "defined" ? "La geometría está completamente restringida." : solved.status === "overdefined" ? "Hay relaciones redundantes que conviene revisar." : "Hay relaciones incompatibles entre sí."}</small></span></div>{solved.conflicts.length > 0 && <div className="constraint-issues" role="alert"><strong>{solved.status === "overdefined" ? "Relaciones redundantes:" : "Relaciones en conflicto:"}</strong><ul>{solved.conflicts.map((constraintId) => <li key={constraintId}>{constraintLabel(constraintId)}</li>)}</ul></div>}{selectedElement.constraints && selectedElement.constraints.length > 0 && <><div className="constraint-list-heading"><strong>Relaciones aplicadas</strong><span>{selectedElement.constraints.length}</span></div><ul className="constraint-list" aria-label="Relaciones aplicadas">{selectedElement.constraints.map((constraint) => <li key={constraint.id}><span>{constraintLabel(constraint.id)}</span>{(constraint.kind === "distance-horizontal" || constraint.kind === "distance-vertical") && <><input aria-label={`Valor ${constraintLabel(constraint.id)}`} type="number" min="0.01" step="0.01" value={constraintValueEdits[constraint.id] ?? constraint.value ?? ""} onChange={(event) => setConstraintValueEdits((current) => ({ ...current, [constraint.id]: event.target.value }))} /><button type="button" onClick={() => saveSketchConstraintValue(selectedElement, constraint)} disabled={constraintDraft !== undefined}>Guardar</button></>}<button type="button" onClick={() => removeSketchConstraint(selectedElement.id, constraint.id)} disabled={constraintDraft !== undefined}>Eliminar</button></li>)}</ul></>}{constraintDraft && <div className="constraint-draft-actions"><span>Vista previa</span><button type="button" onClick={confirmConstraintDraft}>Confirmar relación</button><button type="button" onClick={cancelConstraintDraft}>Cancelar</button></div>}<div className="constraint-buttons"><button type="button" onClick={() => addRelationToSelectedSketch("horizontal")} disabled={selectedSketchConstraintNodes.length !== 2}>Horizontal</button><button type="button" onClick={() => addRelationToSelectedSketch("vertical")} disabled={selectedSketchConstraintNodes.length !== 2}>Vertical</button><button type="button" onClick={() => addRelationToSelectedSketch("coincident")} disabled={selectedSketchConstraintNodes.length !== 2}>Coincidente</button><button type="button" onClick={() => addRelationToSelectedSketch("fixed")} disabled={selectedSketchConstraintNodes.length !== 1}>Fijar al origen</button><button type="button" onClick={() => setConstraintValueDraft({ kind: "distance-horizontal", value: "10.00" })} disabled={selectedSketchConstraintNodes.length !== 2}>Distancia H</button><button type="button" onClick={() => setConstraintValueDraft({ kind: "distance-vertical", value: "10.00" })} disabled={selectedSketchConstraintNodes.length !== 2}>Distancia V</button></div></section>})()}
                {selectedElement?.type === "dimension" && (selectedElement.kind === "radius" || selectedElement.kind === "diameter") && <section className="inspector-card dimension-driving-card" role="group" aria-label="Modo de cota"><div className="panel-title">RESTRICCIÓN</div><p className="muted">Una cota conductora controla el círculo mediante una restricción explícita.</p><button type="button" aria-pressed={selectedElement.driving === true} onClick={() => setEditorState(dispatch(editorRef.current, setDimensionDriving(selectedElement.id, selectedElement.driving !== true)))}>{selectedElement.driving ? "Convertir en conducida" : "Convertir en conductora"}</button></section>}
                 {inspectorTab === "properties" && <>{selectedElements.length === 0 ? <section className="inspector-card"><div className="panel-title">PÁGINA</div><div className="preset-row"><button onClick={() => setPage(1200, 900)}>Horizontal</button><button onClick={() => setPage(900, 1200)}>Vertical</button></div><div className="fields"><Field label="W" value={document.page.width} onChange={(value) => setPage(value, document.page.height)} /><Field label="H" value={document.page.height} onChange={(value) => setPage(document.page.width, value)} /></div><label className="grid-toggle"><input type="checkbox" checked={grid} onChange={(event) => setGrid(event.target.checked)} /> Mostrar cuadrícula del espacio de trabajo</label><label className="grid-toggle"><input type="checkbox" checked={project.preferences.lineGuidesEnabled} onChange={(event) => setProjectPreferences({ ...project.preferences, lineGuidesEnabled: event.target.checked })} /> Guías angulares de línea (45°)</label></section> : <section className="inspector-card inspector-object-card"><div className="panel-title">OBJETO</div>{propertyElement ? <div className="inspector-object-properties">{objectPropertySections(true)}</div> : <><div className="selected-type">{selectedElement?.type === "contour" ? "CONTORNO" : selectedElement?.type === "path" ? "TRAZADO" : selectedElement?.type === "spline" ? "SPLINE" : "LÍNEA"}</div><p className="muted">{selectedElement?.type === "contour" ? "Los contornos conservan su geometría real; las dimensiones no están disponibles." : selectedElement?.type === "path" ? "Los trazados conservan sus nodos y segmentos." : selectedElement?.type === "spline" ? "Las splines conservan sus nodos y handles relativos." : "Las líneas no tienen dimensiones rectangulares."}</p>{selectedElement && isRotatableElement(selectedElement) && rotationField(selectedElement)}</>}</section>}{pathClosureControls}{splineClosureControls}{pathJoinControls}{pathSegmentControls}</>}
              {inspectorTab === "transform" && transformControls()}
            {inspectorTab === "text" && <section className="inspector-card"><div className="panel-title">TEXTO</div>{textPropertyPanel()}</section>}
         </div>
         <section className="inspector-lower-card"><div className="panel-title">CAPAS</div>{document.layers.map((layer) => <div className="layer" key={layer.id}><span>{layer.name}</span><span>{layer.visible ? "Visible" : "Oculta"}</span></div>)}</section>
         <section className="inspector-lower-card"><div className="panel-title">OBJETOS</div><p className="muted">Estructura de objetos próximamente.</p></section>
         <section className="inspector-lower-card"><div className="panel-title">SÍMBOLOS</div><p className="muted">No hay símbolos configurados.</p></section>
         <section className="inspector-lower-card design-validation-card"><div className="panel-title">VALIDACIÓN DEL DISEÑO</div><div className={designValidation.ready ? "validation-status ok" : "validation-status warning"}><span aria-hidden="true">{designValidation.ready ? "●" : "▲"}</span><span>{designValidation.ready ? "Todo listo para procesar" : "Revisar antes de procesar"}</span></div><div className={`validation-check ${designValidation.openCurveCount ? "warning" : "ok"}`}><span aria-hidden="true">{designValidation.openCurveCount ? "▲" : "●"}</span><span>{designValidation.openCurveCount ? `${designValidation.openCurveCount} ${designValidation.openCurveCount === 1 ? "curva abierta" : "curvas abiertas"}` : "No hay curvas abiertas"}</span></div><div className={`validation-check ${designValidation.duplicateLineCount ? "warning" : "ok"}`}><span aria-hidden="true">{designValidation.duplicateLineCount ? "▲" : "●"}</span><span>{designValidation.duplicateLineCount ? `${designValidation.duplicateLineCount} ${designValidation.duplicateLineCount === 1 ? "línea duplicada" : "líneas duplicadas"}` : "No hay líneas duplicadas"}</span></div><div className={`validation-check ${designValidation.outsideElementCount ? "warning" : "ok"}`}><span aria-hidden="true">{designValidation.outsideElementCount ? "▲" : "●"}</span><span>{designValidation.outsideElementCount ? `${designValidation.outsideElementCount} objetos fuera del área` : "Todos los objetos dentro del área"}</span></div></section>
       </aside>
    </div>}
     <footer className="statusbar"><div className="status-message"><span className={`status-dot ${persist.state === "saving" ? "saving" : ""}`} />{persist.message}</div>{paletteControls()}</footer>
  </main>;
}

const toolDescriptions: Record<string, string> = { Seleccion: "Seleccione, coloque o transforme objetos.", Forma: "Editar la forma mediante sus nodos.", Pluma: "Cree un trazado Bézier con clics y arrastre para editar sus controles.", Spline: "Cree curvas con nodos y handles. Haga clic en el primer nodo para cerrarla; arrastre nodos y controles para editarla.", Texto: "Escriba texto editable sobre la hoja.", Rectángulo: "Dibuje formas rectangulares.", Círculo: "Fije el centro, defina el radio y haga clic para crear un círculo.", Línea: "Cree líneas por segmentos con clics; haga clic en el primer nodo para cerrar.", Desplazar: "Desplace el espacio de trabajo.", Cota: "Mida y cree cotas asociativas entre nodos.", Radio: "Cree una cota radial explícita desde el centro hasta el borde de un círculo." };
function ToolIcon({ icon }: { icon: Tool }) {
  const shape = icon === "select" ? <path d="m5 3 13 8-6 2-3 6z" /> : icon === "text" ? <><path d="M6 5h12M12 5v14M8 19h8" /><path d="M5 5h2M17 5h2" /></> : icon === "forma" ? <><rect x="5" y="5" width="14" height="14" rx="1" /><circle cx="5" cy="5" r="1.5" fill="currentColor" /><circle cx="12" cy="5" r="1.5" fill="currentColor" /><circle cx="19" cy="5" r="1.5" fill="currentColor" /><circle cx="5" cy="12" r="1.5" fill="currentColor" /><circle cx="19" cy="12" r="1.5" fill="currentColor" /><circle cx="5" cy="19" r="1.5" fill="currentColor" /><circle cx="12" cy="19" r="1.5" fill="currentColor" /><circle cx="19" cy="19" r="1.5" fill="currentColor" /></> : icon === "pen" ? <><path d="M4 19 9 14" /><path d="M9 14c3-5 6-7 11-8" /><path d="M14 8 18 4" /><path d="M5 19h4" /><rect x="3" y="17" width="4" height="4" /><rect x="18" y="3" width="4" height="4" /><circle cx="9" cy="14" r="1.5" fill="currentColor" /></> : icon === "spline" ? <><path d="M4 18c4 0 4-10 9-10 3 0 3 4 7 0" /><path d="M4 18 9 14M13 8 18 6" /><circle cx="4" cy="18" r="2" fill="currentColor" /><circle cx="13" cy="8" r="2" fill="currentColor" /><circle cx="20" cy="8" r="2" fill="currentColor" /></> : icon === "rectangle" ? <rect x="5" y="5" width="14" height="14" rx="1" /> : icon === "ellipse" || icon === "radius" ? <circle cx="12" cy="12" r="7" /> : icon === "line" ? <path d="M5 19 19 5" /> : icon === "dimension" ? <><path d="M5 7h14M5 17h14" /><path d="M5 4v16M19 4v16" /><path d="m8 4-3 3 3 3M16 14l3 3-3 3" /></> : <><path d="M12 4v16M4 12h16" /><path d="m9 7 3-3 3 3M9 17l3 3 3-3M7 9l-3 3 3 3M17 9l3 3-3 3" /></>;
  return <svg className="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shape}</svg>;
}
function ToolButton({ label, icon, active, onClick }: { label: string; icon: Tool; active: boolean; onClick: () => void }) {
  const description = `${label} — ${toolDescriptions[label]}`;
  return <button className={active ? "tool active" : "tool"} aria-label={label} aria-pressed={active} aria-description={description} onClick={onClick}><ToolIcon icon={icon} /><small>{label}</small><span className="tool-description" role="tooltip">{description}</span></button>;
}
function Field({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="field"><span>{label}</span><input type="number" min="1" step="0.1" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
