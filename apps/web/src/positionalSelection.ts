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

const supportedElementTypes = new Set(["line", "sketch", "path", "circle", "arc"]);

const isSupportedAnchor = (reference: PositionalNodeReference): boolean =>
  supportedElementTypes.has(reference.elementType) && !isHandle(reference.address);

/**
 * Derives the persisted positional-coincidence pair from the ordered Forma selection.
 * It deliberately preserves order and never falls back to an arbitrary circle.
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
  if (!isSupportedAnchor(source) || !isSupportedAnchor(target)) return undefined;
  return { source, target };
};
