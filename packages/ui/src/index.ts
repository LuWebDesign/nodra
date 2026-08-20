export type Tool = "select" | "rectangle" | "ellipse" | "line";
export interface ToolbarProps { readonly activeTool: Tool; readonly disabled?: boolean; readonly onToolChange: (tool: Tool) => void }
export interface PropertiesProps { readonly title: string; readonly fields: readonly PropertyField[] }
export interface PropertyField { readonly label: string; readonly value: string; readonly editable?: boolean }
export interface LayersProps { readonly layers: readonly LayerItem[]; readonly onVisibilityChange: (id: string, visible: boolean) => void }
export interface LayerItem { readonly id: string; readonly name: string; readonly visible: boolean; readonly selected?: boolean }
export interface ViewportProps { readonly zoom: number; readonly status: string; readonly onZoomChange: (zoom: number) => void }
export interface PersistenceStatusProps { readonly status: "saved" | "pending" | "failed" | "local-recovery"; readonly message?: string }
export interface PreparePlaceholderProps { readonly label?: string }
export interface UiNode { readonly kind: string; readonly props: Record<string, unknown> }

export function toolbar(props: ToolbarProps): UiNode {
  return { kind: "toolbar", props: { activeTool: props.activeTool, disabled: props.disabled ?? false, tools: ["select", "rectangle", "ellipse", "line"], onToolChange: props.onToolChange } };
}
export function properties(props: PropertiesProps): UiNode { return { kind: "properties", props: { title: props.title, fields: props.fields } }; }
export function layers(props: LayersProps): UiNode { return { kind: "layers", props: { layers: props.layers, onVisibilityChange: props.onVisibilityChange } }; }
export function viewport(props: ViewportProps): UiNode { return { kind: "viewport", props: { zoom: props.zoom, status: props.status, onZoomChange: props.onZoomChange } }; }
export function persistenceStatus(props: PersistenceStatusProps): UiNode { return { kind: "persistence-status", props: { status: props.status, message: props.message } }; }
export function preparePlaceholder(props: PreparePlaceholderProps = {}): UiNode {
  return { kind: "prepare-placeholder", props: { label: props.label ?? "Prepare is not available yet. No hardware execution is connected." } };
}
