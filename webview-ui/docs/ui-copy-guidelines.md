# UI Copy Guidelines

Use these rules for buttons, action labels, and short interactive text in the webview UI.

## Core Rules

- Use Title Case for button labels and short action text.
- Prefer verb-first labels.
- Keep labels short and concrete.
- Reuse the destination's canonical UI name instead of inventing synonyms.

## Action Verbs

- `Open <Destination>`
  Use for navigation to another page, workspace, browser, panel, or tool.
  Examples: `Open SQL Workspace`, `Open Bucket Workspace`, `Open Object Browser`, `Open Security Lists`, `Open SQL Workbench`.

- `Back to <Parent>`
  Use for returning to the previous inventory, overview, or parent surface.
  Examples: `Back to Autonomous Databases`, `Back to Buckets`, `Back to Target Inventory`, `Back to Overview`.

- `Show <Item>`
  Use only when revealing or focusing something inside the current page or list.
  Examples: `Show Database`, `Show DB System`, `Show Instance`, `Show Object`, `Show Security List`.

- `Select` / `Selected`
  Use only for selection state, not navigation.

- `<Task Verb> <Target>`
  Use direct execution verbs for actions that perform work in the current surface instead of navigating.
  Examples: `Run Assistant`, `Execute SQL`, `Download Wallet`, `Save`.

## Naming Rules

- Use plural names for inventory pages.
  Examples: `Autonomous Databases`, `DB Systems`, `Security Lists`, `VCNs`.

- Use singular names for a selected resource workspace when the UI is scoped to one resource.
  Examples: `Bucket Workspace`, `SQL Workspace`, `Object Browser`.

- Do not mix `Manage`, `Go to`, `View`, and `Open` for the same kind of action. Prefer `Open`.

- Do not use generic `Open Workspace` when a more specific destination exists. Prefer `Open SQL Workspace` or `Open Bucket Workspace`.

## Tooltips

- Use Title Case for short icon-button tooltips.
- Prefer the same wording as the visible action when possible.
- Use concise noun or verb phrases, not full sentences, for common controls.

Examples:

- `Refresh`
- `Clear Filter`
- `Show Security List`
- `Delete Security List`

## Guardrails

- Use `Action + Resource` for titles.
  Examples: `Delete DB System`, `Save SQL Connection Profile`

- Use `Actioning this <resource>` in descriptions with a concrete consequence.
- Use Title Case for confirm buttons.
  Examples: `Delete DB System`, `Clear SQL History`

## Examples

- Good: `Open SQL Workspace`
- Good: `Open Security Lists`
- Good: `Back to Target Inventory`
- Good: `Show Latest Upload`
- Avoid: `Manage Security Lists`
- Avoid: `Open ADB`
- Avoid: `Open Workspace` when the destination name is known
