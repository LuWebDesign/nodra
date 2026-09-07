import type { ConnectableNodeAddress, ElementId } from "@nodra/domain";

export type PositionalNodeReference = {
  readonly key: string;
  readonly elementId: ElementId;
  readonly nodeIndex: number;
  readonly address: ConnectableNodeAddress;
  readonly elementType: string;
};

export type PositionalConnectionPair = {
  readonly source: PositionalNodeReference;
  readonly target: PositionalNodeReference;
};

const isHandle = (address: ConnectableNodeAddress): boolean =>
  (address.kind === "path" || address.kind === "spline") && address.handle !== undefined;

const isCircularSource = (reference: PositionalNodeReference): boolean =>
  (reference.elementType === "circle" || reference.elementType === "arc") &&
  reference.address.kind === "named" &&
  ["center", "start", "end", "n", "e", "s", "w"].includes(reference.address.name);

/**
 * Derives the persisted positional-action pair from the ordered Forma selection.
 * It deliberately does not reorder nodes or fall back to an arbitrary circle.
 */
export const positionalConnectionPair = (
  selectedKeys: readonly string[],
  references: readonly PositionalNodeReference[],
): PositionalConnectionPair | undefined => {
  if (selectedKeys.length !== 2) return undefined;
  const selected = selectedKeys.map((key) => references.filter((reference) => reference.key === key));
  if (selected.some((matches) => matches.length !== 1)) return undefined;
  const [source, target] = selected.map((matches) => matches[0]);
  if (!source || !target || source.elementId === target.elementId) return undefined;
  if (isHandle(source.address) || isHandle(target.address)) return undefined;
  if (!isCircularSource(source)) return undefined;
  return { source, target };
};
