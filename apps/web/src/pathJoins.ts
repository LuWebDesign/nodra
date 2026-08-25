import type { PathJoin } from "@nodra/domain";

export const pathJoinOptions: readonly { readonly value: PathJoin; readonly label: string; readonly description: string }[] = [
  { value: "corner", label: "Esquina", description: "Los controles se ajustan de forma independiente." },
  { value: "smooth", label: "Suave", description: "Mantiene una dirección continua en el ancla." },
  { value: "symmetric", label: "Simétrica", description: "Mantiene dirección y longitudes iguales." },
];

export const pathJoinGuidance = "Seleccione un ancla del trazado para cambiar cómo se unen sus segmentos.";
