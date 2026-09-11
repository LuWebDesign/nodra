# SKILL.md style guide

Use this guide when maintaining project skills. Existing repository conventions take precedence whenever they are stronger than this guide.

## Purpose and boundaries

A `SKILL.md` is a concise runtime contract: it tells an agent when to activate, what rules to preserve, how to choose a path, what steps to take, and what evidence to return. It is not a domain manual. References and assets hold the supporting facts, matrices, examples, templates, and long rationale that the runtime contract should point to rather than reproduce.

Do not invent project-specific behavior. Preserve the author's intent, terminology, boundaries, and stated limitations while making the contract clearer and more actionable.

## Frontmatter

Use YAML frontmatter with these required fields:

```yaml
---
name: skill-name
description: "Trigger: specific activation words first. Action this skill governs."
license: Apache-2.0
metadata:
  author: "nodra-maintainers"
  version: "1.0"
---
```

- Keep `description` on one quoted physical line, under 250 characters.
- Put concrete trigger words first: name the observable tasks, artifacts, or concepts that should activate the skill.
- Make the remainder state the behavior or contract governed; avoid vague claims.

## Required body order

Keep these sections, in this order:

1. `## Activation Contract` — when to load the skill and what to read first.
2. `## Hard Rules` — imperative invariants, boundaries, and prohibitions.
3. `## Decision Gates` — branching choices in a compact table.
4. `## Execution Steps` — ordered inspection, change, and verification actions.
5. `## Output Contract` — exact evidence and artifacts to return.
6. `## References` — links to repository sources and supporting assets.

Write rules as concise imperatives (“Preserve…”, “Do not…”). Use decision tables when conditions lead to different actions:

| Situation | Action |
|---|---|
| Observable condition | Required choice or evidence |

## Size and content

Target **180–450 tokens** for the `SKILL.md` body, with an absolute maximum of **1000 tokens**. Move long rationale, examples, templates, edge-case inventories, and detailed matrices into nearby `references/` or other assets. Keep links specific and maintain them when sources move.

Make triggers unambiguous: distinguish neighboring skills, name meaningful activation terms, and avoid catch-all wording. Make the output contract verifiable: require the affected area, decisions, commands/results, tests or evidence, and unresolved risks appropriate to that skill.

## Validation checklist

- [ ] Frontmatter parses and contains `name`, `description`, `license`, and `metadata.author`/`metadata.version`.
- [ ] Description is one quoted line, under 250 characters, with trigger words first.
- [ ] Required sections appear once and in the prescribed order.
- [ ] Rules are imperative, actionable, and faithful to existing behavior.
- [ ] Branching behavior uses decision tables where useful.
- [ ] Body is 180–450 tokens when practical and never exceeds 1000.
- [ ] Long supporting material is moved to references/assets and linked.
- [ ] Trigger terms and output requirements are clear.
- [ ] When a skill name or path changes, refresh the project skill registry and every affected index or reference.
- [ ] Check links, paths, formatting, and repository-specific validation commands.
