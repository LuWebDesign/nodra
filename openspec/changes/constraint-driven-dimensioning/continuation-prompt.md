Continuá el trabajo en Nodra desde la rama `feat/dimensioning-v2`.

## Contexto

La rama parte de `origin/main` y contiene la evolución de cotas y restricciones geométricas. El trabajo está documentado en `openspec/changes/constraint-driven-dimensioning/`.

## Objetivo del cambio

Construir un sistema profesional de cotas y restricciones:

- Las relaciones geométricas controlan el comportamiento.
- Las cotas controlan tamaño y posición.
- El origen permite evitar croquis flotantes.
- Estados visuales: azul subdefinido, negro definido, rojo conflicto, amarillo sobredimensionado.
- Evitar un solver que fuerce o mueva geometría de forma errática.

## Implementado

- Rama nueva: `feat/dimensioning-v2`.
- Referencias asociativas de cotas con `nodeId` estable y compatibilidad con `nodeIndex`.
- Cotas lineales/alineadas/angulares existentes preservadas.
- Diámetro automático para elipse usando centro + nodo de borde; render con `Ø`.
- Selección de cotas por texto y por línea principal, sin capturar líneas auxiliares invisibles.
- Cota eliminada automáticamente al eliminar el objeto referenciado.
- Editor de valor en milímetros: doble clic, apertura automática al colocar, dos decimales, foco/selección automática, Enter confirma, Escape/Cancelar cancela.
- Comando seguro `updateDimensionValue` para rectángulos sin rotación, cotas H/V, preservando el centro.
- Modelo `SketchConstraint` con relaciones: `horizontal`, `vertical`, `coincident`, `distance-horizontal`, `distance-vertical`, `fixed`.
- Solver determinista inicial en `@nodra/geometry` y comando `solveSketch` en editor-core.
- Panel RELACIONES en español para croquis: Horizontal, Vertical, Coincidente, Fijar al origen, Distancia H y Distancia V.
- Rechazo de conflictos/sobredimensiones sin mutar el documento.
- Estado visual del croquis derivado del solver.
- Icono SVG dedicado para Cota y feedback de nodo naranja estándar.
- Contrato actualizado en `skills/nodra-editor-tools-contract/references/tool-behavior-matrix.md`.

## Verificación reciente

- `corepack pnpm lint` ✅
- `corepack pnpm typecheck` ✅
- `corepack pnpm test` ✅ 246 tests
- Tests enfocados de geometría/renderer/validación/interacción también pasan.

## Artefactos

- Propuesta: `openspec/changes/constraint-driven-dimensioning/proposal.md`
- Diseño: `openspec/changes/constraint-driven-dimensioning/design.md`
- Tareas: `openspec/changes/constraint-driven-dimensioning/tasks.md`

## Próximos pasos

1. Revisar y corregir cualquier limitación del solver inicial.
2. Agregar comandos completos para actualizar/eliminar restricciones.
3. Mostrar estado y conflictos de forma más explícita en la UI.
4. Implementar cotas conductoras para líneas y sketches.
5. Agregar radio/arcos, tangente, paralelo, perpendicular, concéntrico e igualdad.
6. Agregar tests E2E del flujo de restricciones.
7. Mantener entregas divididas si superan 400 líneas.

No mezclar relaciones nuevas con heurísticas implícitas. Toda mutación debe pasar por `editor-core`, validación y un único registro de historial.
