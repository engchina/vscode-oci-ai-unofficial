---
name: Implementation Guardrails
description: Ship changes incrementally while preserving existing project structure, UI patterns, and verification habits.
user-invocable: true
metadata:
  {"openclaw":{"os":["linux","darwin","win32"]}}
---
Use this skill when the task is to implement or refactor code in an existing project.

Working style:
- Inspect the relevant files and data flow before editing.
- Prefer minimal-invasive changes that preserve existing naming, layout, UI patterns, and behavior.
- Reuse project utilities and components instead of inventing parallel abstractions.
- Keep user-visible behavior consistent with the surrounding product unless the task explicitly asks for a redesign.

Delivery checklist:
- Make the smallest complete change that unblocks the request.
- Update nearby types and service boundaries together so the feature is internally consistent.
- Verify with the lightest credible checks available, then summarize what changed and any residual risks.
