# Issue: Agregar cotas de medición al editor de Kond Design

## Resumen

Agregar un sistema de **cotas** inspirado en el flujo de SolidWorks, adaptado a Kond Design como editor 2D en milímetros, con origen superior izquierdo, render SVG, comandos con historial y persistencia local. La primera versión debe priorizar cotas asociativas de medición/annotación, no un solver paramétrico.

## Referencia de funcionamiento: SolidWorks

SolidWorks usa las cotas como una pieza central del flujo CAD:

- **Smart Dimension / Cota inteligente**: el usuario selecciona entidades y el sistema infiere el tipo de cota según el contexto.
- **Cotas conductoras vs. conducidas**:
  - Conductoras: modifican la geometría del croquis/modelo.
  - Conducidas: solo muestran una medición de referencia.
- **Tipos frecuentes**:
  - Lineal horizontal/vertical.
  - Alineada entre dos puntos o extremos.
  - Angular entre dos líneas.
  - Radio y diámetro para arcos/círculos.
  - Ordenadas desde un origen común.
  - Baseline/chain para series de medidas.
- **Asociatividad**: la cota queda vinculada a la geometría; si el elemento cambia, el valor de la cota se actualiza.
- **Estilo visual**: líneas de extensión, línea de cota, flechas, texto centrado o desplazado, tolerancias, precisión, unidades y escala.
- **Interacción**: seleccionar geometría, mover el cursor para colocar la cota, confirmar; luego se puede arrastrar la posición del texto/línea sin romper la referencia.

## Adaptación propuesta para Kond Design

Kond Design ya trabaja en `mm`, renderiza a SVG y tiene comandos/gestos con undo/redo. Por eso conviene separar el problema en dos niveles:

### V1 recomendada: cotas de anotación asociativas

Las cotas muestran medidas reales y se actualizan si cambia la geometría referenciada, pero **no editan la geometría**. Esto evita introducir un solver de restricciones y encaja con el editor actual.

Tipos V1:

1. **Cota lineal horizontal/vertical** entre dos nodos reales o bordes.
2. **Cota alineada** entre dos puntos.
3. **Cota de línea** usando endpoints de un elemento `line`.
4. **Cota de tamaño** para rectángulo/elipse: ancho y alto.
5. **Cota radial/diámetro** para elipse/círculo cuando el tamaño lo permita.

Fuera de V1:

- Cotas conductoras que cambian geometría.
- Solver de restricciones.
- Tolerancias avanzadas, GD&T, dual dimensions.
- Cotas 3D o vinculadas a manufactura.

## Modelo de dominio sugerido

Agregar un nuevo tipo de elemento o una nueva colección de anotaciones. Para mantener compatibilidad con render, selección, capas y persistencia, la opción más simple es un nuevo `DimensionElement` dentro del dominio.

Campos conceptuales:

```ts
type DimensionKind = "linear" | "aligned" | "angular" | "radius" | "diameter";
type DimensionReference =
  | { type: "element-point"; elementId: ElementId; pointKind: "start" | "end" | "center" | "corner" | "edge-midpoint"; index?: number }
  | { type: "fixed-point"; point: PointMm };

interface DimensionElement {
  type: "dimension";
  id: ElementId;
  layerId: LayerId;
  kind: DimensionKind;
  references: readonly DimensionReference[];
  offset: PointMm;
  textPosition?: PointMm;
  precision: number;
  units: "mm";
  style: VisualStyle;
}
```

Notas:

- Usar `ElementId` preserva la selección/capas, pero el render y hit-testing deberán tratarlo como anotación, no como geometría de corte.
- Las referencias deben poder resolverse contra `realGeometryNodes`, endpoints y centros ya existentes en `@nodra/geometry`.
- Si una referencia queda rota por eliminación de un elemento, la cota puede quedar como inválida/huérfana visualmente o convertirse en puntos fijos. V1 debería definir esto explícitamente.

## Cambios por paquete

### `packages/domain`

- Agregar `DimensionElement` al union `Element`.
- Subir `CURRENT_SCHEMA_VERSION`.
- Definir tipos de referencia y estilo mínimo de cota.

### `packages/validation`

- Validar tipo `dimension`.
- Validar referencias, precisión no negativa y unidades `mm`.
- Migrar documentos previos sin cotas.

### `packages/geometry`

- Agregar helpers para resolver referencias de cota contra geometría actual.
- Calcular medida en mm: distancia, proyección horizontal/vertical, ángulo, radio/diámetro.
- Calcular geometría de render: líneas de extensión, flechas y caja de texto.
- Hit testing para seleccionar/mover cotas.

### `packages/editor-core`

- Comandos: `createDimension`, `updateDimensionPlacement`, `deleteDimension` reutilizando delete existente si es `Element`.
- Las cotas deben entrar en historial como un único commit por gesto.
- Mover/duplicar elementos: decidir si las cotas asociadas se mantienen, se duplican o quedan referenciando originales.
- Eliminar elemento referenciado: definir política V1.

### `packages/renderer-svg`

- Renderizar cotas como SVG no destructivo: líneas, flechas y texto.
- Escapar texto/atributos como en el renderer actual.
- Considerar `vector-effect="non-scaling-stroke"` o compensación por zoom para legibilidad.
- No mezclar cotas con semántica de corte/grabado salvo que el producto decida exportarlas.

### `apps/web`

- Nueva herramienta `Cota` en la barra de herramientas.
- Flujo: seleccionar primer punto/nodo, seleccionar segundo punto/nodo, arrastrar offset, confirmar.
- Previsualización durante el gesto, commit al soltar/click final.
- Panel de propiedades en español: precisión, tipo, mostrar unidad, posición de texto.
- Integrar con snapping a nodos reales existentes.

## Criterios de aceptación

- Puedo crear una cota entre dos puntos reales de una línea/rectángulo y ver el valor en mm.
- La cota se actualiza si muevo o redimensiono el elemento referenciado.
- Puedo seleccionar y mover la posición visual de la cota sin cambiar la geometría medida.
- Undo/redo funciona para crear, mover y borrar cotas.
- El documento persiste y recupera cotas desde IndexedDB.
- SVG renderiza cotas sin romper elementos existentes.
- La UI mantiene copy en español.
- Las pruebas cubren validación, cálculo geométrico, comandos/historial, render SVG y un flujo básico web.

## Riesgos y decisiones abiertas

- **Asociatividad rota**: decidir qué ocurre al borrar un elemento referenciado.
- **Exportación**: definir si las cotas se exportan siempre, nunca, o como capa de anotación opcional.
- **Legibilidad**: texto y flechas no deberían escalar hasta volverse ilegibles al hacer zoom.
- **Cotas conductoras**: postergar hasta tener un modelo de restricciones; no conviene mezclarlo con V1.
- **Unidades**: Kond usa mm por ADR 0004; no introducir pulgadas/dual units en V1.

## Plan de implementación sugerido

1. Diseñar `DimensionElement` y migración de schema.
2. Implementar resolución/cálculo geométrico puro con tests.
3. Render SVG de cota con snapshots/asserters de salida.
4. Comandos de creación y actualización de placement con undo/redo.
5. Integrar herramienta `Cota` en web con preview.
6. Agregar propiedades básicas y pruebas de interacción.

## Verificación esperada

Ejecutar en orden:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```
