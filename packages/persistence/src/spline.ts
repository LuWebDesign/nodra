import type { SplineElement } from "@nodra/domain";
import { splineElementSchema } from "@nodra/validation";

export type SplineParseResult =
  | { readonly success: true; readonly spline: SplineElement }
  | { readonly success: false; readonly error: string };

export function serializeSpline(spline: SplineElement): string {
  const checked = splineElementSchema.safeParse(spline);
  if (!checked.success)
    throw new Error(
      `Cannot serialize invalid spline: ${checked.error.message}`,
    );
  return JSON.stringify(checked.data);
}

export function parseSpline(input: string): SplineParseResult {
  try {
    const checked = splineElementSchema.safeParse(JSON.parse(input) as unknown);
    if (!checked.success)
      return { success: false, error: checked.error.message };
    // SAFETY: splineElementSchema validates the complete runtime shape; branded IDs are runtime strings.
    return { success: true, spline: checked.data as unknown as SplineElement };
  } catch {
    return { success: false, error: "Malformed spline JSON" };
  }
}
