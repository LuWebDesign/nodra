# Laser Operation Metadata Specification

## Purpose

Define inert semantic metadata describing intended laser operations while keeping it independent from visual appearance and hardware control.

## Requirements

### Requirement: Store semantic operation intent

Each supported drawable MAY contain validated semantic operation metadata describing intended processing, such as operation class, order, and relevant parameters. Metadata MUST remain editable document data and MUST be preserved through native serialization.

#### Scenario: Preserve operation metadata

- GIVEN a primitive with valid operation metadata
- WHEN the document is edited, saved, and loaded
- THEN the metadata remains associated with the same primitive and retains its values

#### Scenario: Missing metadata

- GIVEN a supported primitive without operation metadata
- WHEN the document is validated
- THEN validation accepts it when metadata is optional and does not invent an execution claim

### Requirement: Decouple metadata from visual color

The system MUST NOT infer semantic operation meaning solely from visual color, and changing visual color MUST NOT change operation metadata. Visual representation MAY communicate metadata, but it MUST remain a separate value.

#### Scenario: Change appearance

- GIVEN a primitive with operation metadata and a visual color
- WHEN the user changes its visual color
- THEN the metadata is unchanged

#### Scenario: Same color, different intent

- GIVEN two primitives with the same visual color
- WHEN their operation metadata differs
- THEN both metadata values remain distinct and inspectable

### Requirement: Never control hardware

Metadata handling MUST NOT start, stop, configure, or claim completion of laser hardware operations. Unsupported execution data MUST be rejected or displayed as inert information.

#### Scenario: Inspect inert metadata

- GIVEN a document containing operation metadata
- WHEN the user inspects it offline
- THEN the editor displays intended data only and provides no hardware execution result

#### Scenario: Execution request

- GIVEN a user requests hardware execution from the foundation editor
- WHEN no execution capability is available
- THEN the request is refused without changing the document or claiming execution
