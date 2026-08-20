# Design Editor Specification

## Purpose

Define the first functional Design mode for creating and editing laser-oriented drawings without implying hardware execution.

## Requirements

### Requirement: Create and inspect supported primitives

Design mode MUST create, select, and inspect rectangles, ellipses, and lines. The editor MUST expose the selected primitive's editable geometric properties and MUST preserve its identity when those properties change.

#### Scenario: Create and select a primitive

- GIVEN an empty Design document
- WHEN the user creates a rectangle and selects it
- THEN the document contains one rectangle and its properties are inspectable

#### Scenario: Unsupported creation request

- GIVEN Design mode
- WHEN the user requests a Bezier, boolean, or parametric primitive
- THEN the editor MUST refuse the request without changing the document

### Requirement: Transform and navigate the drawing

The editor MUST support moving, resizing, and rotating selected supported primitives, plus zooming and panning the viewport. Geometry MUST remain expressed in canonical millimetres with a top-left origin.

#### Scenario: Transform a selection

- GIVEN a selected ellipse
- WHEN the user moves, resizes, or rotates it and commits the gesture
- THEN the resulting geometry is valid and the element remains editable

#### Scenario: Degenerate transform

- GIVEN a selected primitive
- WHEN a resize would produce a non-positive size or invalid line geometry
- THEN the editor MUST reject or constrain the result and MUST NOT commit invalid geometry

### Requirement: Manage layers and history

The editor MUST support layer ordering and visibility. Each completed drag gesture MUST be one undoable transaction, and redo MUST restore a transaction that was undone.

#### Scenario: Undo one drag

- GIVEN a document with a selected element
- WHEN the user completes one drag and presses undo once
- THEN the element returns to its pre-drag state in one step

#### Scenario: New edit after undo

- GIVEN an undone transaction
- WHEN the user makes and commits a different edit
- THEN redo MUST NOT reapply the discarded transaction
