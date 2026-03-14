---
name: Review Diff
description: Review a diff for bugs, regressions, missing validations, and test gaps before merging.
user-invocable: true
metadata:
  {"openclaw":{"os":["linux","darwin","win32"]}}
---
Use this skill when the user asks for a review, audit, or readiness check on code changes.

Review priorities:
- Find concrete behavioral regressions first.
- Call out missing validation, error handling, or state-sync issues.
- Check that types, backend contracts, and UI state stay aligned.
- Note missing or weak verification where it affects confidence.

Response style:
- Lead with findings ordered by severity.
- Reference the affected files or code paths directly.
- Keep summaries brief and focus on actionable issues.
