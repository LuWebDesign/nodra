# Project skill template

Copy this structure to `skills/{skill-name}/SKILL.md`. Keep the body roughly 180–450 tokens and move facts, matrices, and edge cases to local `references/` files.

```markdown
---
name: {skill-name}
description: "Trigger: {specific activation words}. {Action this skill governs}."
license: Apache-2.0
metadata:
  author: "nodra-maintainers"
  version: "1.0"
---

## Activation Contract
Load when {observable task}; read `{paths}` first.

## Hard Rules
- {Invariant}
- {Boundary or forbidden action}

## Decision Gates
| Need | Action |
|---|---|
| {condition} | {choice} |

## Execution Steps
1. {Inspect}
2. {Change or verify}
3. {Test/report}

## Output Contract
Return {exact evidence and artifacts}.

## References
- [{topic}](references/{file}.md)
```

Descriptions must be one quoted physical line, begin with triggers, and stay under 250 characters. Skills guide but do not replace technical analysis; examples are not mandatory implementations. Keep generated output out of edits and preserve the project's Spanish UI convention.
