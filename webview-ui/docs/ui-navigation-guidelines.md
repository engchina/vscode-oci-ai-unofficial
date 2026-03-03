# UI Navigation Guidelines

Use these rules to keep navigation, selection, and actions consistent across the OCI workbench webview.

This document is specific to this project's current architecture:

- One VS Code Activity Bar container
- One primary webview workbench
- Multiple feature pages inside the same workbench shell
- Resource inventories that often lead to sub-workspaces or cross-feature tools

## Core Principle

Resource cards select context.

Buttons open destinations or perform actions.

Do not make users guess whether clicking a card will:

- select a resource
- open a child workspace
- navigate to another feature
- execute a task

Each interaction must have exactly one meaning.

## Interaction Model

There are only three allowed interaction types in the workbench:

1. Navigation
   Moves the user to another feature, sub-workspace, or scoped surface.
2. Selection
   Sets the current resource context inside the current page.
3. Action
   Performs work on the selected or targeted resource without changing navigation context.

Never combine these meanings into one click target.

## Required Rules

### 1. Inventory cards are for selection

- Clicking a resource card in an inventory must only select that resource.
- Selected state must update immediately and visibly.
- Selection must not implicitly navigate to another page or sub-workspace.
- Selection must not trigger lifecycle or data-modifying work.

Allowed labels:

- `Select`
- `Selected`
- `Show in List`

Not allowed on inventory-card primary click:

- opening another feature
- opening a nested workspace
- starting or stopping a resource

### 2. Navigation must be explicit

- Navigation to another destination must use a labeled button or tab.
- Use verb-first labels for navigation.
- Prefer `Open <Destination>` for forward navigation.
- Prefer `Back to <Parent>` for reverse navigation.

Examples:

- `Open SQL Workbench`
- `Open Security Lists`
- `Back to VCNs`

Avoid:

- hidden click-through cards
- unlabeled chevron-only navigation on mixed-action cards
- using `Select` to mean `Open`

### 3. Actions must stay actions

- `Start`, `Stop`, `Connect`, `Download Wallet`, `Refresh`, `Save` are actions.
- Action buttons must not also navigate.
- If an action depends on a selected item, disable the action until a selection exists.
- If an action targets the current card directly, place it in the card action row.

### 4. Child workspaces stay inside the current feature when the mental model is hierarchical

Use an embedded sub-workspace when the destination is conceptually "inside" the selected resource.

Examples:

- `VCN -> Security Lists`
- `Bucket -> Object Browser`

Use a top-level feature when the destination is a cross-resource tool.

Examples:

- `ADB/DB System -> SQL Workbench`
- `Any resource -> Chat`

### 5. Home cards may navigate, resource cards may not

Landing-page shortcut tiles may navigate on whole-card click because their only purpose is entry.

Resource inventory cards may not do this because they already contain selection state and actions.

## Component Contract

These contracts should drive future component cleanup.

### `NavigationTile`

Use for:

- Home
- Overview
- Start Here
- Quick actions

Behavior:

- whole tile is clickable
- always navigates
- contains no lifecycle actions
- may show a navigation affordance

### `SelectableResourceCard`

Use for:

- VCNs
- Autonomous Databases
- DB Systems
- Compute Instances
- Buckets
- Security Lists

Behavior:

- whole card selects
- selection state is visible
- card may include metadata
- card may include inline action buttons
- card itself does not navigate

### `ResourceActionBar`

Use for:

- page header actions
- selected-resource context actions
- card footer actions when the action clearly targets that resource

Behavior:

- contains explicit buttons only
- separates navigation from action
- groups high-frequency actions first

## Page-Level Rules

### VCN

Inventory behavior:

- clicking a VCN card selects the VCN
- selected VCN appears in context strip / page state

Navigation:

- use `Open Security Lists` to enter the security-list sub-workspace
- use `Back to VCNs` to return

Do not:

- make the VCN card itself open Security Lists

### Autonomous Database

Inventory behavior:

- clicking an ADB card selects the database

Actions on card:

- `Start`
- `Stop`
- `Select` / `Selected`

Navigation:

- use `Open SQL Workbench` from selected-resource actions or page header

Do not:

- make the database card itself open SQL Workbench

### DB Systems

Inventory behavior:

- clicking a DB System card selects the system

Actions on card:

- `Start`
- `Stop`
- `Connect SSH`
- `Select` / `Selected`

Navigation:

- use `Open SQL Workbench` explicitly

Do not:

- overload card click to both select and open a workspace

### SQL Workbench

SQL Workbench is a tool surface, not a child detail page.

Behavior:

- it may receive preselected context from ADB or DB Systems
- it should make the current target obvious
- target switching inside the page is selection, not navigation

Use:

- segmented control or explicit target picker for `ADB` vs `DB System`
- top-level workspace tabs in this order: `Connection`, `Query`, `AI Assistant`, `Library`
- `Connection` for session state and saved connection inputs
- `Query` for SQL editor plus result sub-tabs
- `AI Assistant` for generation and optimization workflows
- `Library` for favorites and history
- `Back` only when returning from a scoped sub-workspace, not for normal feature switching

Query tab structure:

- keep `SQL Editor` above results
- split results into `Result Grid` and `Explain Plan` sub-tabs
- use `Run SQL` to reveal `Result Grid`
- use `Explain Plan` to reveal `Explain Plan`

Connection panel structure:

- `Session Status`
- `Connection Form`

### Security Lists

Security Lists are a child workspace of the selected VCN.

Behavior:

- the parent VCN remains visible in the header/context
- `Back to VCNs` returns to the VCN inventory state
- create/edit/delete stay inside the Security Lists workspace

## Layout Rules

### Preferred order inside a feature page

1. Feature title and description
2. Global controls
3. Selected-resource context summary
4. Inventory or workspace surface
5. Inline notices and transient feedback

### Preferred order inside a resource card

1. Resource name
2. Stable identifier or subtitle
3. Metadata
4. Status badge
5. Action row

### Action row order

Use this order when multiple button types appear together:

1. Selection state
2. Primary task action
3. Secondary task action
4. Destructive action
5. Navigation action

If navigation is important but rare, prefer moving it to the selected-resource action bar instead of the card.

## Button Tone Hierarchy

Use one visual tone per button intent. Do not reuse the same tone for navigation, submit, and destructive actions.

### `navigation`

Use for:

- `Open ...`
- `Back to ...`
- `Show ... in List`

Behavior:

- looks lighter and more directional than task actions
- indicates movement to another surface or reveal inside the current surface
- stays visually distinct from submit and destructive controls

### `submit`

Use for:

- `Create`
- `Upload`
- `Run`
- `Connect`
- `Save`
- `PAR`

Behavior:

- indicates the primary affirmative task on the current surface
- reads stronger than `secondaryAction`
- is never used for destructive work

### `secondaryAction`

Use for:

- `Refresh`
- `Test Connection`
- `Connection Diagnostic`
- `Disconnect`
- `Copy`
- `Clear Filter`

Behavior:

- supports or inspects the current task without becoming the main submit action
- reads lighter than `submit`
- stays more visible than passive text links

### `danger`

Use for:

- `Delete`
- irreversible clearing actions

Behavior:

- stays visually separated from submit and navigation actions
- uses the strongest warning styling available in the shared workbench button set

## Workspace Sectioning

When a resource opens an embedded workspace, prefer this internal structure:

1. `Status`
2. `Actions`
3. `Content`

Apply this especially to tool or workspace surfaces that combine connection state, mutations, and browsing.

Examples:

- SQL Workbench: `Connection`, `Query`, `AI Assistant`, `Library`
- database connection panels: split `Session Status` and `Connection Form`
- Bucket Workspace: split `Status`, `Actions`, and `Content`

## Copy Rules

Follow `ui-copy-guidelines.md` and apply these additional constraints:

- `Select` always means selection only.
- `Open` always means navigation only.
- `Show` means reveal or scroll within the current surface only.
- `Back to ...` means return to the parent inventory or parent workspace only.
- `Connection` names a configuration or session tab, not a submit action.
- `Query`, `AI Assistant`, and `Library` name content tabs, not buttons.

Never use these pairs interchangeably:

- `Select` and `Open`
- `View` and `Open`
- `Manage` and `Open`

## Accessibility Rules

- If a whole card is clickable, it must have button semantics and visible focus treatment.
- If a card contains nested interactive controls, the primary card interaction must still be keyboard reachable.
- Do not rely on hover alone to reveal core navigation.
- Selected state and status state must be visually distinct.
- Navigation actions must remain discoverable without mouse hover.

## Decision Checklist

Before introducing a new interaction, answer these questions:

1. Is this click selecting context, navigating, or performing an action?
2. Can a user predict the result without trying it?
3. Is the same interaction model already used on sibling pages?
4. If this is navigation, is there an explicit verb-first label?
5. If this is selection, does it avoid side effects?

If any answer is no, redesign the interaction.

## Current Project Recommendations

Apply these decisions consistently in the current codebase:

- Keep `VCN -> Security Lists` as an explicit sub-workspace flow.
- Keep `ADB -> SQL Workbench` and `DB System -> SQL Workbench` as explicit cross-feature navigation.
- Keep resource-card click mapped to selection only across VCN, ADB, DB Systems, Compute, and Object Storage.
- Prefer selected-resource header actions for `Open ...` buttons when card rows are already busy.
- Treat Home shortcuts as the only whole-card navigation tiles in the workbench shell.

## Definition Of Done

A feature page meets this guideline only if all of the following are true:

- users can tell which item is selected
- users can tell which controls navigate
- users can tell which controls execute work
- users can tell which actions are submit, secondary, or destructive at a glance
- the same click pattern means the same thing on sibling pages
- keyboard users can reach the primary card interaction and the explicit navigation actions
