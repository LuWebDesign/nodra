/**
 * Absolute model-space tolerance in millimetres. 1e-8 mm is below document and
 * display precision while matching the strictest existing topology operations.
 * Never use this value as a screen-pixel or snapping tolerance.
 */
export const GEOMETRY_EPSILON = 1e-8;

/**
 * Dimensionless tolerance in the normalized [0, 1] curve domain. 1e-9 removes
 * numerically duplicate cuts such as 0.2 and 0.20000000001 without conflating
 * visibly distinct model-space points; geometric coincidence is checked apart.
 */
export const PARAMETER_EPSILON = 1e-9;
