# Diseño técnico: plataforma general de croquis paramétricos

## Estado

Implementación incremental en curso.

Entregas aplicadas: límite compartido `@nodra/constraints`, solver iterativo por componentes locales/globales, referencias estables `edgeId` para cotas y relaciones segmentarias de sketch y, desde schema 7, IDs obligatorios para segmentos de path/glifo con migración determinista y contrato explícito `TopologyEditResult` en editor-core.

Este documento define la base técnica para ampliar el sistema de croquis de Nodra sin introducir lógica específica por herramienta. No autoriza implementar de una sola vez todas las entidades y relaciones de un CAD profesional.

## 1. Contexto actual

Nodra persiste una unión heterogénea de elementos en `@nodra/domain`:

- primitivas: línea, rectángulo y elipse;
- grafos lineales: `SketchElement`;
- curvas editables: `PathElement` y `SplineElement`;
- geometría derivada: contornos y glifos;
- anotaciones: `DimensionElement`;
- texto.

El comportamiento paramétrico actual está dividido:

- `SketchElement.constraints` contiene relaciones entre nodos de un mismo sketch;
- `EllipseElement.circleConstraints` contiene restricciones de círculos;
- `DocumentSnapshot.connections` registra conexiones explícitas entre objetos;
- `DimensionElement` conserva referencias y puede enlazarse a una restricción conductora;
- `solveSketchConstraints` y `solveCircleConstraints` son solucionadores separados;
- el estado visual paramétrico solamente se aplica completamente a sketches;
- relaciones entre sketches diferentes pueden provocar la fusión de sus elementos.

Esta estructura permitió entregar las primeras capacidades, pero no escala de forma segura a relaciones entre tipos diferentes, topología editable, arcos, geometría constructiva, bloques o patrones.

## 2. Objetivos

1. Unificar el contrato paramétrico sin reemplazar las representaciones geométricas especializadas.
2. Permitir restricciones internas y externas entre entidades compatibles.
3. Resolver únicamente los componentes afectados del grafo paramétrico.
4. Derivar grados de libertad, conflictos y estado visual desde una única fuente.
5. Separar geometría medida, valor conductor y disposición visual de las cotas.
6. Preservar referencias de manera explícita durante modificaciones topológicas.
7. Mantener comandos atómicos, preview provisional y una entrada de historial por gesto.
8. Permitir incorporar nuevas entidades mediante adaptadores, no mediante cambios en cada herramienta existente.
9. Mantener el documento en milímetros y en dos dimensiones.

## 3. No objetivos iniciales

- Croquis 3D o coordenadas Z.
- Un solucionador no lineal universal en la primera fase.
- Compatibilidad inmediata con todas las herramientas de SOLIDWORKS.
- Convertir texto, glifos o resultados booleanos en geometría paramétrica automáticamente.
- Reemplazar todas las entidades por un único `SketchEntity` monolítico.
- Persistir grados de libertad, colores de definición o resultados del solver.
- Introducir Canvas, WebGL, workers, índices espaciales o nuevas librerías sin medición.
- Implementar patrones asociativos, bloques reutilizables o referencias externas en la primera migración.

## 4. Decisión principal

La plataforma utilizará:

```text
entidades especializadas persistidas
→ referencias estables
→ adaptadores paramétricos
→ grafo global de restricciones por página
→ solver por componentes conectados
→ estado paramétrico derivado
→ comandos, interacción y representación
```

La unificación ocurre en el contrato paramétrico, no en el formato geométrico de cada entidad.

## 5. Límites entre paquetes

Se añadirá un paquete público `@nodra/constraints`. En esta fase el paquete existe y el renderer consume su estado derivado; la integración directa de `editor-core` con el solver queda planificada para una fase posterior.

```text
domain      → sin dependencias
geometry    → domain
validation  → domain
constraints → domain, geometry
editor-core → domain, geometry, validation
renderer-svg→ domain, geometry, validation, constraints
persistence → domain, validation
web         → domain, geometry, validation, constraints,
              editor-core, renderer-svg, persistence
```

### `@nodra/domain`

Responsable de:

- tipos persistidos;
- referencias paramétricas;
- restricciones;
- roles de geometría;
- cotas y layout persistido;
- versión de esquema.

No contiene solver, hit testing ni comportamiento de herramientas.

### `@nodra/geometry`

Responsable de:

- coordenadas en milímetros;
- proyecciones de puntos, curvas y segmentos;
- intersecciones, distancias, tangentes y bounds;
- layout geométrico de anotaciones;
- cambios geométricos y topológicos puros.

No decide compatibilidad entre restricciones ni modifica documentos.

### `@nodra/constraints`

Responsable de:

- adaptadores paramétricos;
- matriz de capacidades;
- resolución semántica de referencias;
- construcción del grafo;
- ecuaciones y variables;
- solución por componentes;
- grados de libertad;
- redundancias, conflictos e invalidez;
- estado paramétrico derivado.

El paquete será puro y no dependerá de React, IndexedDB ni estado de herramientas.

### `@nodra/validation`

Responsable de validación estructural y migración:

- forma del documento;
- IDs únicos;
- existencia estructural de elementos y referencias;
- aridad y valores finitos;
- compatibilidad con la versión del esquema.

La compatibilidad matemática y las combinaciones soportadas se diagnostican en `@nodra/constraints`. Los comandos rechazan restricciones semánticamente inválidas antes de persistirlas.

### `@nodra/editor-core`

Responsable de:

- comandos para crear, actualizar y eliminar restricciones;
- comandos de cotas y cambios topológicos;
- aplicación validada de soluciones;
- remapeo de referencias;
- preview, commit, cancelación, undo y redo.

### `@nodra/renderer-svg`

Responsable de proyectar de forma unidireccional:

- estilo persistido;
- estado paramétrico derivado;
- cotas y símbolos;
- geometría constructiva;
- modos editor/exportación.

### `apps/web`

Responsable de:

- herramienta activa;
- selección y hover;
- drafts y captura del cursor;
- preview de operaciones;
- paneles y mensajes en español;
- composición de capas visuales transitorias.

`App.tsx` no será el propietario de reglas matemáticas ni topológicas.

## 6. Modelo persistido

### 6.1 Restricciones por página

Las restricciones generales se almacenarán junto a los elementos de cada página:

```ts
interface DocumentSnapshot {
  // Campos actuales.
  readonly constraints?: readonly Constraint[];
}

interface PageSnapshot {
  // Campos actuales.
  readonly constraints?: readonly Constraint[];
}
```

Reglas:

- una restricción no puede referenciar elementos de otra página;
- su ID es único dentro de la página;
- una relación entre elementos no cambia la identidad de esos elementos;
- crear una relación externa no fusiona sketches;
- el orden del array no determina la identidad ni la prioridad matemática.

### 6.2 Referencias estables

```ts
type ParametricReference =
  | PointReference
  | CurveReference
  | EntityReference
  | OriginReference
  | AxisReference;

interface PointReference {
  readonly kind: "point";
  readonly elementId: ElementId;
  readonly point: PointAddress;
}

type PointAddress =
  | { readonly kind: "named"; readonly name: string }
  | { readonly kind: "node"; readonly nodeId: string }
  | {
      readonly kind: "handle";
      readonly nodeId: string;
      readonly handle: "in" | "out";
    };

interface CurveReference {
  readonly kind: "curve";
  readonly elementId: ElementId;
  readonly curve: CurveAddress;
}

type CurveAddress =
  | { readonly kind: "entity" }
  | { readonly kind: "edge"; readonly edgeId: string }
  | { readonly kind: "segment"; readonly segmentId: string };

interface EntityReference {
  readonly kind: "entity";
  readonly elementId: ElementId;
}

interface OriginReference {
  readonly kind: "origin";
}

interface AxisReference {
  readonly kind: "axis";
  readonly axis: "x" | "y";
}
```

Reglas:

- no se crearán nuevas referencias persistidas mediante `edgeIndex` o `nodeIndex` cuando exista identidad estable;
- los índices antiguos continúan leyéndose durante la migración;
- las aristas de sketch usan `edgeId`;
- los segmentos de path deberán recibir IDs estables antes de aceptar relaciones externas;
- una línea o círculo nativo puede utilizar `{ kind: "entity" }` como curva completa;
- origen y ejes son referencias explícitas, no elementos visuales implícitos.

### 6.3 Restricciones tipadas

Las restricciones se modelarán como una unión discriminada. Ejemplo inicial:

```ts
type Constraint =
  | CoincidentConstraint
  | HorizontalConstraint
  | VerticalConstraint
  | ParallelConstraint
  | PerpendicularConstraint
  | EqualConstraint
  | FixedPointConstraint
  | DistanceConstraint
  | AngleConstraint
  | RadiusConstraint
  | DiameterConstraint
  | ConcentricConstraint;

interface CoincidentConstraint {
  readonly id: string;
  readonly kind: "coincident";
  readonly references: readonly [PointReference, PointReference | OriginReference];
}

interface ParallelConstraint {
  readonly id: string;
  readonly kind: "parallel";
  readonly references: readonly [CurveReference, CurveReference];
}

interface DistanceConstraint {
  readonly id: string;
  readonly kind: "distance" | "distance-horizontal" | "distance-vertical";
  readonly references: readonly [PointReference, PointReference | OriginReference];
  readonly value: number;
}

interface FixedPointConstraint {
  readonly id: string;
  readonly kind: "fixed-point";
  readonly references: readonly [PointReference];
  readonly target: PointMm;
}
```

`fixed-point` conserva la posición capturada. Coincidir con el origen es una relación diferente.

Cada clase de restricción define:

- aridad exacta;
- tipos de referencia permitidos;
- valor requerido o prohibido;
- unidades;
- ecuaciones generadas;
- condiciones de degeneración.

No se utilizará un array genérico de uno a cuatro puntos como contrato final.

### 6.4 Geometría constructiva

Las entidades geométricas compatibles podrán declarar un rol:

```ts
type GeometryRole = "profile" | "construction" | "reference";
```

Reglas:

- `profile` participa en perfiles cerrados y fabricación;
- `construction` participa en picking, cotas y restricciones, pero no cierra perfiles ni se fabrica;
- `reference` representa geometría no fabricable y normalmente no editable de forma directa;
- el rol no se representa solamente mediante color o línea discontinua.

No se crearán tipos duplicados como `ConstructionLineElement` si la geometría es idéntica.

### 6.5 Cotas y layout

La cota permanece como anotación persistida separada de la restricción numérica:

```ts
interface DimensionLayout {
  readonly offset: PointMm;
  readonly labelOffset?: PointMm;
  readonly side?: -1 | 1;
}

interface DimensionElement {
  // Identidad, estilo, tipo y referencias.
  readonly layout: DimensionLayout;
  readonly drivingConstraintId?: string;
}
```

Reglas:

- las referencias indican qué se mide;
- `layout` indica dónde se representa;
- una cota conducida deriva el valor de la geometría;
- una cota conductora enlaza una restricción numérica;
- el valor conductor vive en la restricción, no se duplica como verdad independiente;
- mover la etiqueta modifica `labelOffset`;
- mover la anotación completa modifica `offset`;
- ninguna de esas operaciones modifica referencias o valor;
- el `offset` legado migra a `layout.offset`.

## 7. Adaptadores paramétricos

Los adaptadores son código, no datos persistidos:

```ts
interface ParametricAdapter<E extends Element = Element> {
  readonly type: E["type"];

  variables(element: E): readonly ParametricVariable[];
  references(element: E): readonly ResolvedReference[];

  supports(
    element: E,
    constraint: Constraint,
    reference: ParametricReference,
  ): boolean;

  equations(
    element: E,
    constraint: Constraint,
    context: ConstraintContext,
  ): readonly ConstraintEquation[];

  applySolution(
    element: E,
    values: ReadonlyMap<VariableId, number>,
  ): E;
}
```

Variables iniciales:

| Entidad | Variables principales |
|---|---|
| Línea | `start.x`, `start.y`, `end.x`, `end.y` |
| Sketch | `node[id].x`, `node[id].y` |
| Círculo | `center.x`, `center.y`, `radius` |
| Rectángulo | `center.x`, `center.y`, `width`, `height`, `rotation` |
| Path | coordenadas de nodos y controles |
| Spline | anchors y offsets de handles |

La primera entrega implementará adaptadores de sketch y círculo, conservando resultados actuales. Línea y rectángulo se incorporarán después de estabilizar referencias y solver.

Las entidades sin adaptador son geometría no paramétrica y conservan su estilo normal. No se las clasificará falsamente como completamente definidas.

## 8. Matriz de capacidades

`@nodra/constraints` expondrá una consulta única:

```ts
interface ConstraintCapabilityResult {
  readonly supported: boolean;
  readonly reason?: string;
}

function canApplyConstraint(
  document: DocumentSnapshot,
  kind: Constraint["kind"],
  references: readonly ParametricReference[],
): ConstraintCapabilityResult;
```

La misma función se utiliza en:

- habilitación de botones;
- mensajes de incompatibilidad;
- comandos;
- validación semántica previa al commit;
- tests de la matriz.

La UI no mantendrá una segunda lista independiente de combinaciones válidas.

## 9. Grafo paramétrico

El sistema crea un grafo por página:

- nodos del grafo: variables y entidades;
- aristas: restricciones que conectan referencias;
- componentes: conjuntos conectados que pueden resolverse independientemente.

Al cambiar una entidad o restricción:

1. identificar referencias afectadas;
2. localizar su componente conectado;
3. resolver únicamente ese componente;
4. aplicar parches solamente a sus elementos;
5. conservar sin cambios los demás elementos.

Una relación entre dos objetos crea una arista en el grafo. No combina sus arrays de nodos ni elimina uno de los objetos.

## 10. Contrato del solver

```ts
type ConstraintState =
  | "underdefined"
  | "fully-defined"
  | "overdefined"
  | "conflict"
  | "invalid";

interface ConstraintDofMetadata {
  readonly nodeKeys: readonly string[];
  readonly coordinateCount: number;
  readonly constraintCount: number;
  readonly rank: number;
  readonly degreesOfFreedom: number;
  readonly status: ConstraintState;
}

interface ConstraintDiagnostic {
  readonly code:
    | "unsupported-constraint"
    | "constraint-conflict"
    | "redundant-component"
    | "non-converged-component";
  readonly constraintIds: readonly string[];
  readonly referenceKeys: readonly string[];
  readonly message: string;
}

interface ConstraintSolveResult {
  readonly document: DocumentSnapshot;
  readonly changed: boolean;
  readonly converged: boolean;
  readonly iterations: number;
  readonly nonConvergedComponents: readonly (readonly string[])[];
  readonly degreesOfFreedom: number;
  readonly affectedElementIds: readonly ElementId[];
  readonly states: readonly ConstraintComponentState[];
  readonly residuals: readonly ConstraintResidual[];
  readonly diagnostics: readonly ConstraintDiagnostic[];
}
```

`constraintDofMetadataForDocument` informa rango y DOF por componente. `solveConstraintComponents` devuelve un preview inmutable del documento y agrega `degreesOfFreedom` como la suma de todos los componentes; `affectedElementIds` contiene únicamente elementos participantes en restricciones soportadas.

Semántica:

- `underdefined`: existe al menos un movimiento válido;
- `fully-defined`: no queda movimiento válido;
- `overdefined`: existen ecuaciones redundantes;
- `conflict`: ecuaciones válidas son incompatibles;
- `invalid`: referencias, tipos o geometría degenerada impiden resolver.

El solver:

- es determinista para la misma entrada;
- no muta el documento;
- no redondea valores del modelo;
- rechaza NaN, infinitos y degeneraciones;
- devuelve diagnósticos estables;
- no oculta un estado subdefinido trasladando geometría automáticamente al origen;
- puede reemplazarse internamente sin cambiar el contrato público.

### 10.1 Grados de libertad por entidad

En un componente conectado, repartir un número de DOF entre entidades puede ser ambiguo. El estado visual de una entidad se calculará evaluando si alguna de sus variables participa en un movimiento permitido del espacio nulo del componente.

Consecuencias:

- una línea con longitud fija pero traslación o rotación libre permanece subdefinida;
- dos objetos rígidos relacionados entre sí, pero libres para trasladarse juntos, permanecen subdefinidos;
- una entidad se considera definida únicamente cuando ninguna de sus variables puede cambiar dentro del componente;
- el total de DOF pertenece al componente; el estado visual puede proyectarse por entidad.

## 11. Estado paramétrico derivado

```ts
function constraintStateForElement(
  document: DocumentSnapshot,
  elementId: ElementId,
): ConstraintState | "not-parametric";
```

El resultado no se persiste. Se invalida al cambiar:

- geometría;
- topología;
- restricciones;
- cotas conductoras;
- referencias;
- rol de geometría.

El solver y el renderer no tendrán implementaciones distintas de la clasificación.

## 12. Modificaciones topológicas

Toda operación que cree, divida, elimine o reemplace topología devuelve efectos explícitos:

```ts
type ReferenceResolution =
  | { readonly kind: "preserved"; readonly reference: ParametricReference }
  | { readonly kind: "replaced"; readonly references: readonly ParametricReference[] }
  | { readonly kind: "removed"; readonly reason: string };

interface TopologyEditResult {
  readonly elements: readonly Element[];
  readonly referenceMap: ReadonlyMap<string, ReferenceResolution>;
  readonly diagnostics: readonly TopologyDiagnostic[];
}
```

Clasificación:

1. **Transformación sin cambio topológico:** mover, girar o escalar; conserva IDs.
2. **Cambio paramétrico:** modificar radio o longitud; conserva referencias.
3. **Cambio topológico:** partir, recortar, extender, redondear o chaflanar; remapea o invalida.
4. **Generación derivada:** desfase, simetría asociativa o patrón; crea una operación y nuevas entidades.

Reglas:

- ninguna operación repara referencias comparando únicamente coordenadas;
- dividir una arista crea IDs nuevos y declara qué ocurre con la referencia original;
- eliminar una referencia conductora rechaza, degrada o elimina de acuerdo con una política explícita;
- el comando aplica geometría, remapeo, restricciones y cotas atómicamente;
- undo restaura exactamente topología y referencias anteriores.

Estado implementado de este contrato:

- los resultados exitosos de comandos topológicos exponen el mapa y los diagnósticos como metadata efímera; no se persisten ni forman parte de las transacciones de historial;
- partir segmentos declara reemplazos, borrar nodos conserva segmentos intactos y agrupa los segmentos reconstruidos como reemplazos;
- abrir un path y cortar geometría declaran referencias eliminadas;
- la reconstrucción planar deriva destinos desde la identidad del segmento fuente y sus piezas, no mediante una reparación posterior global por coordenadas;
- cotas de nodo y conexiones explícitas se remapean por identidad cuando su destino sobrevive; si el nodo o handle desaparece, el dependiente se elimina dentro de la misma transacción;
- las nuevas relaciones `parallel`, `perpendicular` y `equal` persisten dos referencias `edgeId`; las relaciones legacy de cuatro nodos se normalizan solamente cuando cada pareja identifica una arista única y ambas aristas son distintas;
- dividir o eliminar una arista elimina atómicamente las relaciones segmentarias que dependían de su identidad, sin redirigirlas silenciosamente a una de las piezas; las cotas conservan su política independiente de seguir la primera pieza.

## 13. Herramientas

Las categorías organizan interacción y UI, no crean una jerarquía persistida:

```ts
type SketchToolCategory =
  | "create"
  | "modify"
  | "constraint"
  | "dimension"
  | "transform"
  | "diagnostic";

interface SketchToolDefinition {
  readonly id: ToolId;
  readonly category: SketchToolCategory;
  readonly operationKind:
    | "geometry"
    | "topology"
    | "constraint"
    | "annotation"
    | "transform"
    | "query";
  readonly preview: boolean;
}
```

Una herramienta:

1. interpreta eventos de puntero o teclado;
2. consulta picking y capacidades;
3. produce un draft transitorio;
4. invoca un comando tipado;
5. muestra el resultado o diagnóstico.

No implementa ecuaciones, migraciones ni acceso a IndexedDB.

### 13.1 Inferencias

Las inferencias de dibujo se separan de las restricciones persistidas:

```text
cursor
→ candidatos de captura
→ preview visual
→ confirmación del gesto
→ restricción persistida según política
```

La política podrá ser configurable. Hover o proximidad por sí solos nunca persisten una relación.

### 13.2 Patrones y bloques

Quedan diferidos, pero se reservan decisiones:

- un patrón es una operación generadora, no una colección de copias sin vínculo;
- un bloque reutilizable separará definición e instancia;
- una instancia tendrá transformación propia;
- relaciones internas y externas no se mezclarán;
- no se introducirán estos tipos hasta estabilizar restricciones y remapeo topológico.

## 14. Interacción y prioridad visual

El estado transitorio permanece fuera del documento:

```ts
interface InteractionVisualState {
  readonly hovered?: readonly VisualTarget[];
  readonly selected?: readonly VisualTarget[];
  readonly previewed?: readonly VisualTarget[];
  readonly invalid?: readonly VisualTarget[];
}
```

Prioridad:

```text
inválido o conflicto
→ selección activa
→ preview de operación
→ hover
→ estado paramétrico
→ estilo persistido
```

El compositor visual debe conservar información del nivel inferior. Por ejemplo, hover sobre una entidad subdefinida produce azul resaltado, no un color que oculte su estado.

Picking:

- usa geometría real y tolerancias convertidas desde píxeles mediante zoom;
- respeta capas visibles;
- conserva precedencia explícita por herramienta;
- no depende únicamente de bounding boxes;
- no crea conexiones ni restricciones por hover.

## 15. Renderizado y exportación

El estado paramétrico es feedback de edición, no estilo de fabricación. El renderer deberá distinguir modos:

```ts
type RenderMode = "editor" | "export";
```

### Modo editor

- aplica azul, negro, rojo o amarillo según estado;
- representa geometría constructiva;
- acepta overlays de selección y hover desde web;
- conserva IDs de picking.

### Modo export

- utiliza estilos y operaciones persistidas;
- excluye geometría constructiva cuando corresponda;
- no exporta colores de diagnóstico como estilo de fabricación;
- no incluye overlays transitorios.

El renderer continúa siendo una proyección unidireccional y nunca modifica el documento.

## 16. Comandos, gestos e historial

Operaciones discretas:

```text
dispatch(command)
```

Operaciones continuas:

```text
beginGesture
→ previewGestureFromBase
→ commitGesture | cancelGesture
```

Invariantes:

- una operación confirmada produce como máximo una transacción;
- preview no avanza revisión ni persiste;
- cancelación restaura la base;
- fallo o no-op no agrega historial ni programa autosave;
- solver, topología, referencias y cotas se aplican en una misma transacción;
- cada snapshot resultante se valida estructuralmente;
- una solución conflictiva o inválida deja el documento sin cambios.

Comandos iniciales previstos:

```ts
addConstraint(constraint)
updateConstraint(id, replacement)
deleteConstraint(id)
setDimensionDriving(dimensionId, constraint)
updateDimensionValue(dimensionId, value)
updateDimensionLayout(dimensionId, layout)
applyTopologyOperation(operation)
solveAffectedComponent(referenceKeys)
```

`solveAffectedComponent` será normalmente una operación interna de los demás comandos, no una herramienta que omita validación.

## 17. Persistencia y migración

La introducción de restricciones globales requerirá una nueva versión de esquema.

Migración propuesta:

1. añadir `constraints: []` a documentos y páginas;
2. convertir `SketchElement.constraints` a restricciones globales con referencias estables;
3. convertir `circleConstraints` a restricciones globales;
4. mantener temporalmente lectura compatible de campos antiguos;
5. convertir `DimensionElement.constraintId` al enlace global correspondiente;
6. migrar `offset` a `layout.offset`;
7. conservar dimensiones conducidas sin crear restricciones artificiales;
8. mantener `connections` durante una fase de compatibilidad;
9. migrar conexiones compatibles a coincidencias solamente cuando la semántica sea equivalente;
10. validar después de migrar.

Reglas de recuperación:

- persistir únicamente snapshots confirmados y validados;
- conservar revisión e identidad del proyecto;
- no sobrescribir una revisión más nueva;
- documentos corruptos continúan reportándose como fallo observable;
- una restricción semánticamente no soportada se conserva para diagnóstico solo si su forma pertenece a la versión; los comandos no crean nuevas restricciones no soportadas.

La eliminación definitiva de campos legados ocurre en una migración posterior, después de comprobar documentos reales.

## 18. Diagnóstico

La UI consumirá diagnósticos estructurados, no analizará mensajes de error:

```text
RELACIÓN REDUNDANTE
RESTRICCIÓN EN CONFLICTO
REFERENCIA COLGANTE
GEOMETRÍA DEGENERADA
COMBINACIÓN NO SOPORTADA
CONTORNO ABIERTO
COMPONENTE SUBDEFINIDO
```

Cada diagnóstico incluye:

- código estable;
- IDs de restricciones;
- referencias afectadas;
- elementos afectados;
- mensaje español en la capa web;
- severidad y acción sugerida cuando exista.

El paquete central expone códigos y datos. La traducción y presentación pertenecen a web.

## 19. Rendimiento

La primera implementación usa estructuras locales y resolución en el hilo principal.

Medidas de diseño:

- resolver componentes conectados, no todo el documento;
- reutilizar mapas por ID dentro de una resolución;
- evitar búsquedas repetidas por coordenadas;
- no guardar resultados derivados en snapshots;
- medir documentos con cantidades representativas antes de introducir cache, workers o índices espaciales.

Una optimización futura no puede cambiar determinismo, tolerancias ni semántica de historial.

## 20. Estrategia de pruebas

### Domain y validation

- parseo de cada referencia;
- IDs duplicados;
- referencias colgantes;
- aridad y valores inválidos;
- migración desde el esquema actual;
- round-trip de proyecto multipágina.

### Geometry

- resolución exacta de referencias;
- intersecciones y degeneraciones;
- layout de cotas por lado y orientación;
- remapeo topológico;
- tolerancias en milímetros.

### Constraints

- matriz de capacidades;
- componentes independientes;
- DOF de línea con longitud pero posición libre;
- componente rígido con traslación global libre;
- definición completa;
- redundancia, conflicto e invalidez;
- determinismo y entrada inmutable.

### Editor-core

- add/update/delete;
- preview, commit y cancelación;
- undo/redo como una transacción;
- no-op y fallo sin revisión;
- operación topológica con remapeo atómico;
- conservación de objetos no afectados.

### Renderer

- colores por estado en modo editor;
- estilo persistido en modo export;
- hover sin ocultar estado base;
- geometría constructiva excluida de fabricación;
- documentos inválidos y versiones no soportadas.

### Web y E2E

- creación de relación válida;
- rechazo visible de relación incompatible;
- cota con preview por cursor;
- arrastre de etiqueta sin modificar medida;
- diagnóstico de referencia colgante;
- undo/redo de restricciones y cambios topológicos;
- picking con zoom y capas visibles.

Los gates completos se ejecutan en orden CI:

```text
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:e2e
corepack pnpm build
```

## 21. Entregas incrementales

### Fase 0 — contratos y evidencia

- aprobar este diseño;
- crear matriz de capacidades actual;
- capturar tests de comportamiento existente;
- documentar referencias legadas y operaciones que las rompen.

### Fase 1 — identidad y topología

- referencias tipadas;
- IDs estables de segmentos;
- contrato `TopologyEditResult`;
- remapeo en partir, cortar y eliminar;
- sin nuevas relaciones avanzadas.

### Fase 2 — restricciones globales

- colección por página;
- nuevo paquete `@nodra/constraints`;
- migración de sketches y círculos;
- eliminar fusión de sketches en relaciones externas.

### Fase 3 — solver y estado

- grafo por componentes;
- adaptadores de sketch y círculo;
- DOF y diagnósticos centralizados;
- estado visual general para entidades soportadas.

### Fase 4 — cotas

- layout separado;
- referencias de curva estables;
- etiqueta arrastrable;
- conductor/conducido mediante restricción global.

### Fase 5 — relaciones y construcción

- herramienta general de Relaciones;
- matriz contextual;
- origen, ejes y geometría constructiva;
- línea, rectángulo y círculo interoperables.

### Fase 6 — modificación avanzada

- extender;
- desfase;
- redondeo;
- chaflán;
- política completa de referencias.

### Fase 7 — nuevas entidades

- punto y arco;
- polígono y ranura;
- tangencia y concentricidad;
- splines y continuidad.

### Fase 8 — generación y reutilización

- simetría asociativa;
- patrones;
- bloques e instancias;
- referencias externas 2D.

Cada fase debe ser migrable, verificable y revertible sin eliminar documentos del usuario.

## 22. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Solver mueve geometría inesperadamente | Resolver conjunto acotado, preview inmutable y rechazo atómico |
| Referencias rotas por cortes | IDs estables y `TopologyEditResult` obligatorio |
| Migración destructiva | Lectura compatible, tests de fixtures y eliminación diferida de campos |
| Doble fuente de verdad en cotas | Valor en restricción; layout en anotación |
| UI y solver discrepan | Una matriz de capacidades y diagnósticos estructurados |
| Estado azul/negro contamina exportación | Modos `editor` y `export` separados |
| `App.tsx` continúa creciendo | Extraer controladores de interacción y mantener comandos en editor-core |
| Alcance equivalente a CAD completo | Fases con entidades y relaciones explícitamente soportadas |
| Rendimiento del solver | Componentes conectados y medición antes de optimizar |

## 23. Criterios arquitectónicos de aceptación

La base se considera preparada para escalar cuando:

1. una restricción puede conectar dos elementos sin fusionarlos;
2. todas las nuevas referencias topológicas utilizan IDs estables;
3. cada entidad paramétrica declara capacidades mediante un adaptador;
4. UI y comandos consultan la misma matriz de capacidades;
5. el solver devuelve DOF y diagnósticos por componente;
6. el estado visual se deriva del solver y no se persiste;
7. editor y exportación usan presentaciones diferentes;
8. las cotas separan referencias, valor conductor y layout;
9. partir o recortar declara el destino de cada referencia afectada;
10. una operación confirmada conserva la semántica actual de historial y persistencia;
11. una entidad no soportada permanece editable sin recibir un estado paramétrico falso;
12. agregar un nuevo adaptador no requiere reescribir las herramientas existentes.

## 24. Decisiones pendientes antes de implementar

1. Periodo de convivencia de `connections` y restricciones coincidentes.
2. Política configurable de inferencias automáticas.
3. Representación futura de operaciones derivadas para desfases, patrones y simetrías.

Decisiones resueltas durante la implementación:

- el paquete compartido se denomina `@nodra/constraints`;
- las relaciones externas iniciales admiten coincidencia, ejes, distancias, ángulo y relaciones segmentarias; `fixed` permanece local;
- el renderer consulta estados puros una vez por documento en modo `editor`, mientras el modo `export` conserva los estilos persistidos sin colores diagnósticos;
- cada `PathSegment` persistido usa un `id` estable obligatorio; los segmentos legacy reciben IDs deterministas por elemento, contorno e índice durante la migración a schema 7;
- al dividir una arista de sketch, la cota angular existente sigue la primera pieza colineal y el cambio topológico declara ambas piezas como reemplazos.
