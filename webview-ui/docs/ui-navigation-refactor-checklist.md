# UI Navigation Refactor Checklist

Use this checklist to apply `ui-navigation-guidelines.md` to the current workbench page by page.

This is an execution document, not a design essay. Each section should translate into concrete code changes, review points, and regression checks.

## Scope

Top-level workbench views:

- `home`
- `chat`
- `history`
- `vcn`
- `compute`
- `objectStorage`
- `adb`
- `dbSystems`
- `sqlWorkbench`
- `settings`

Nested workspaces and sub-surfaces currently in scope:

- `SecurityListView` under `VCN`
- Bucket workspace under `Object Storage`
- Object browser under bucket workspace
- selected-resource context strips and action bars across resource pages

## Shared Refactor Goals

Apply these rules everywhere before making page-specific exceptions:

- inventory-card primary click means selection only
- navigation uses explicit verb-first buttons
- `Select` never means `Open`
- `Show in List` never means navigate
- child workspaces use explicit `Open ...` and `Back to ...`
- cross-feature jumps stay in header or selected-resource actions, not hidden on card click

## Shared Component Checklist

### Workbench Shell

- Audit left primary nav and secondary groups for consistent feature naming.
- Ensure secondary navigation is treated as feature switching, not resource selection.
- Keep Home shortcut tiles as the only whole-card navigation pattern.

### Card Components

- Split card intent into two stable categories:
  - navigation tile
  - selectable resource card
- Stop introducing new hybrid cards that both navigate and contain task actions.
- Standardize selected-state visuals across `WorkbenchInventoryCard` and `WorkbenchActionInventoryCard`.
- Standardize highlighted-state visuals across inventory pages.
- Ensure keyboard focus is visible on whole-card interactions.
- Review whether `WorkbenchActionInventoryCard` should become a semantic button wrapper for its primary selection target instead of a plain clickable container.

### Action Labels

- Replace ambiguous labels with explicit destination labels.
- Use `Open <Destination>` for navigation.
- Use `Back to <Parent>` for reverse navigation.
- Use `Select` / `Selected` only for current-resource context.
- Use `Show in List` only for scroll/reveal behavior.

### Selected-Resource Action Bar

- Normalize selected-resource actions exposed through `setResource(...)`.
- Prefer putting cross-feature navigation in the selected-resource action area when card action rows are already dense.
- Keep action order consistent:
  1. reveal or clear-filter utility
  2. open related destination
  3. task actions

### Accessibility

- Whole-card selection must remain keyboard reachable.
- Nested buttons and inputs inside cards must not steal or mask the primary selection affordance.
- Navigation actions must be reachable without hover-only cues.
- Confirm selected state and lifecycle state are visually distinct in all themes.

## Top-Level Pages

## Home

Role:

- navigation hub
- not a resource inventory

Keep:

- whole-card navigation for quick actions
- whole-card navigation for capability areas
- explicit destination buttons in hero section
- recent destinations as click-to-open items

Checklist:

- Keep Home as the only page where whole-card click is expected to navigate.
- Optionally rename Home shortcut component usage to align with `NavigationTile` terminology.
- Ensure all Home cards navigate only and never embed lifecycle or destructive actions.
- Confirm destination names match canonical feature names from `App.tsx`.

Regression check:

- A user should understand that Home cards are entry points, not selected resources.

## Chat

Role:

- top-level tool surface

Current interaction model:

- no resource inventory
- explicit header actions for `New` and `History`

Checklist:

- Keep Chat free of resource-card navigation patterns.
- Keep `History` as an explicit button action, not an implicit tab switch on another control.
- Ensure compartment selection remains configuration, not navigation.
- Keep message rows non-navigational unless they intentionally open a resource in the future.

Potential copy cleanup:

- keep `New`
- consider `Open History` only if you want stronger navigation wording across the app
- otherwise keep `History` as a local mode switch because it behaves like a sibling tool view

Regression check:

- No click inside the transcript should unexpectedly navigate to another workbench page.

## History

Role:

- top-level assistant support page

Checklist:

- Replace generic `Back` with `Back to Chat` for clarity.
- Keep `Clear` as a pure action with guardrail.
- Keep history rows non-interactive unless you later support reopen/resume flows.
- Do not introduce row-click navigation without an explicit affordance.

Regression check:

- Header actions should clearly separate return navigation and destructive clearing.

## VCN

Role:

- resource inventory page with hierarchical child workspace

Target model:

- click card to select VCN
- explicit button to open Security Lists
- explicit back action to return from Security Lists

Checklist:

- Keep VCN card click mapped to selection only.
- Keep `Open Security Lists` in selected-resource actions and/or card action row.
- Do not make the VCN card itself navigate into `SecurityListView`.
- Keep `Show in List` behavior scoped to reveal only.
- Keep selected VCN context visible while inside Security Lists.
- Ensure `Open Compute` remains explicit cross-feature navigation.

Potential cleanup:

- If card footer actions become necessary, keep `Select` and `Open Security Lists` separate.
- Consider a shared selected-resource header pattern with Compute, ADB, and DB Systems.

Regression check:

- A user can select a VCN without leaving the inventory.
- A user can open Security Lists without guessing whether the card body or button is the entry point.

## Security Lists

Role:

- child workspace under a selected VCN

Target model:

- child workspace, not a separate top-level feature

Checklist:

- Keep `Back to VCNs` wording explicit.
- Keep create, edit, and delete fully inside the Security Lists workspace.
- Keep list rows non-navigational unless a deeper nested editor is introduced.
- If a security list becomes selectable later, keep selection separate from edit/open behavior.
- Preserve parent VCN context in the header so the child workspace never feels detached.

Regression check:

- The user always knows which VCN the current Security Lists workspace belongs to.

## Compute

Role:

- resource inventory page with inline task actions and cross-feature link to VCN

Target model:

- click card to select instance
- explicit buttons for start/stop/SSH
- explicit `Open VCN` or `Open VCNs`

Checklist:

- Keep compute card click mapped to selection only.
- Keep SSH-related controls as task actions only.
- Keep `Open VCN` as explicit cross-feature navigation in selected-resource actions.
- Ensure `Show in List` only reveals the selected instance.
- Do not make instance cards open VCN or terminal flows on body click.
- Review action-row density and move lower-frequency navigation out of the card if needed.

Potential cleanup:

- If a future terminal workspace is added, expose it as `Open Terminal Workspace` rather than overloading SSH connect or card click.

Regression check:

- Users can safely click a compute card to inspect it without triggering SSH or navigation.

## Object Storage

Role:

- resource inventory page with nested child workspaces

Current model:

- bucket inventory
- bucket workspace
- object browser inside bucket workspace

Target model:

- click bucket card to select bucket
- explicit button opens bucket workspace
- explicit button opens object browser
- explicit back actions step out one level at a time

Checklist:

- Keep bucket inventory click mapped to selection only.
- Replace any ambiguous bucket-entry affordance with explicit `Open Bucket Workspace`.
- Keep `Open Object Browser` explicit from inside the bucket workspace or selected-resource action area.
- Keep `Back to Buckets` for leaving the bucket workspace.
- Keep `Back to Bucket Workspace` for leaving object browser if two-step hierarchy is preserved.
- Keep folder rows as explicit within-surface navigation because they operate inside the object browser, not across pages.
- Do not introduce bucket-card body navigation to object browser.
- Re-evaluate the current `Open SQL Workbench` action on buckets:
  - if SQL Workbench is unrelated, remove it
  - if it is a temporary cross-tool shortcut, move it to a lower-priority context area and review naming

Potential cleanup:

- The distinction between `Bucket Workspace` and `Object Browser` should be clearer in copy and breadcrumbing.
- Consider whether bucket overview and object browser should remain separate or merge into one child workspace with tabs.

Regression check:

- A user can remain oriented across three levels: bucket inventory, bucket workspace, object browser.

## Autonomous Database

Role:

- resource inventory page with inline lifecycle actions and explicit cross-feature navigation to SQL Workbench

Target model:

- click ADB card to select
- `Start` / `Stop` are task actions
- `Open SQL Workbench` is explicit navigation

Checklist:

- Keep database card click mapped to selection only.
- Keep `Select` / `Selected` visible and separate from lifecycle actions.
- Keep `Open SQL Workbench` in selected-resource actions or a dedicated non-ambiguous location.
- Do not make card body click open SQL Workbench.
- Ensure wallet download remains an action, not a navigation step.
- Ensure diagnostics, connection profile, and SQL execution surfaces read as work areas for the selected resource, not hidden pages.

Potential cleanup:

- If both page-level and card-level `Open SQL Workbench` actions exist, pick one primary location and keep the other only if justified by usage frequency.

Regression check:

- A user can select a database, start or stop it, and separately decide to open SQL Workbench.

## DB Systems

Role:

- resource inventory page with inline lifecycle, SSH, and cross-feature SQL navigation

Target model:

- click DB System card to select
- SSH fields and lifecycle buttons remain card/task controls
- `Open SQL Workbench` is explicit navigation

Checklist:

- Keep DB System card click mapped to selection only.
- Keep SSH IP selection and credential overrides as inline task configuration only.
- Keep `Connect SSH` as an action, not a workspace change.
- Keep `Open SQL Workbench` explicit in selected-resource actions or page-level context actions.
- Do not overload card body click with navigation.
- Review whether dense inline form controls reduce card click discoverability; if so, strengthen selected-state treatment and card header affordance.

Potential cleanup:

- Consider moving lower-frequency navigation to the selected-resource header if card actions feel overloaded.

Regression check:

- A user can edit SSH inputs inside a card without uncertainty about what a card click does.

## SQL Workbench

Role:

- cross-resource tool surface

Target model:

- top-level feature
- accepts preselected context from ADB or DB Systems
- target switching inside the page is selection, not feature navigation

Checklist:

- Keep SQL Workbench as a top-level feature in the shell.
- Make incoming source context explicit:
  - selected ADB
  - selected DB System
  - manually chosen target
- Keep target-type switching explicit through segmented controls or explicit selectors.
- Avoid `Back` patterns that imply SQL Workbench is a child page of ADB or DB Systems.
- If `Back` exists, reserve it for local sub-workspaces only.
- Ensure connection profile, results, favorites, history, and assistant areas behave as tool panels, not hidden navigation states.
- Keep `Select Target` semantics separate from `Connect`.

Potential cleanup:

- Clarify whether the page is organized around target selection first and workspace second, or vice versa.
- Reduce any UI that makes the target inventory feel like a navigation menu.

Regression check:

- A user should perceive SQL Workbench as one tool that can point at different targets, not as a separate detail page for each resource.

## Settings

Role:

- top-level administrative feature with internal tab navigation

Target model:

- tabs are explicit local navigation
- fields and cards are configuration, not resource selection

Checklist:

- Keep settings tab changes as explicit local navigation only.
- Do not introduce resource-card semantics into settings profile lists unless selection is strictly local editing context.
- When a profile is chosen for editing, make it clear that this is local editing scope, not a global workbench navigation event.
- Keep destructive actions explicit and guarded.
- Keep `Done` or return actions explicit if shown.

Potential cleanup:

- Profile selector areas should avoid looking like navigational resource cards unless they truly behave that way.

Regression check:

- Users can distinguish between editing scope, active runtime profile, and page navigation.

## Profiles And Compartments Subsurface

Role:

- settings sub-surface for editing profile-scoped configuration

Checklist:

- Keep profile selection scoped to the settings page.
- Do not style editable profile rows like navigational destination cards.
- Keep `Selected` meaning local editing target only.
- Make any global profile switching action explicit and separate from local edit selection.

Regression check:

- Users do not confuse "profile selected for editing" with "globally active profile".

## App-Level Cleanup

These items affect multiple views at once.

- Review `VIEW_DEFINITIONS` labels and descriptions for consistent canonical feature names.
- Review `PRIMARY_GROUPS` ordering for feature discoverability.
- Confirm `DEFAULT_VIEW_BY_PRIMARY` matches the most useful landing page for each primary area.
- Keep top-level feature switching in `App.tsx`, not reimplemented inside resource cards.
- Review recent-destination and Home shortcut naming against the navigation-copy rules.

## Suggested Execution Order

Use this order to reduce churn and keep behavior coherent during refactoring:

1. Shared naming and action-label cleanup
2. Card component contract cleanup
3. Selected-resource action-bar normalization
4. Hierarchical resource pages:
   - VCN
   - Security Lists
   - Object Storage
5. Resource inventory pages with dense inline actions:
   - Compute
   - Autonomous Database
   - DB Systems
6. SQL Workbench target-selection cleanup
7. Assistant pages:
   - Chat
   - History
8. Settings and profile-editing surfaces
9. Home terminology alignment

## Definition Of Done

This refactor is done only when every page passes all of these checks:

- primary card click meaning is obvious before interaction
- selection does not navigate
- navigation has explicit labeled controls
- action buttons do not silently navigate
- sibling resource pages use the same interaction model
- nested workspaces have explicit forward and backward paths
- selected-resource context remains visible when entering child workspaces
- copy matches `ui-copy-guidelines.md`
- copy matches `ui-navigation-guidelines.md`
