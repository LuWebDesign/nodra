# Native Project Format Specification

## Purpose

Define the versioned, editable `.nodra` document contract and its safe validation behavior.

## Requirements

### Requirement: Persist a versioned editable document

The native format MUST be JSON with an explicit schema version, stable document identity, revision, layers, editable supported primitives, canonical millimetre geometry, and top-left origin semantics. It MUST preserve semantic operation metadata independently from visual presentation.

#### Scenario: Round-trip a document

- GIVEN a valid document containing layers and supported primitives
- WHEN it is serialized and loaded
- THEN its version, identity, revision, geometry, ordering, editability, and metadata are unchanged

#### Scenario: Unknown future version

- GIVEN a document with a schema version the reader does not support
- WHEN it is loaded
- THEN loading MUST fail safely with an actionable validation result and MUST NOT produce a partially loaded document

### Requirement: Validate all native records

The system MUST validate documents at every native-format boundary. Invalid IDs, revisions, layer references, unsupported element data, non-finite values, negative dimensions, and malformed metadata MUST be rejected.

#### Scenario: Corrupt document

- GIVEN a native record with malformed JSON or invalid document data
- WHEN validation runs
- THEN the record is rejected and the existing valid document remains available

#### Scenario: Valid empty document

- GIVEN a versioned document with no drawable elements
- WHEN validation runs
- THEN it is accepted as an editable empty document

### Requirement: Preserve explicit non-goals

The format MUST NOT claim support for cloud synchronization, collaboration, hardware execution, or out-of-scope advanced primitives merely because unknown data is present.

#### Scenario: Unsupported payload

- GIVEN a document containing an unsupported primitive or execution claim
- WHEN it is loaded
- THEN the system MUST reject it or report it as unsupported without silently treating it as supported
