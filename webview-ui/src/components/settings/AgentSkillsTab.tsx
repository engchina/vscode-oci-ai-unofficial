import {
  AlertTriangle,
  Copy,
  Download,
  FolderOpen,
  Import,
  Loader2,
  RefreshCw,
  Slash,
  Sparkles,
  Wand2,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { SkillServiceClient } from "../../services/grpc-client"
import type {
  AgentSkillsDiagnosticReport,
  AgentSkillInfoReport,
  AgentSkillImportResult,
  AgentSkillImportScope,
  AgentSkillInstallResult,
  AgentSkillSuppression,
  AgentSkillsCheckReport,
  AgentSkillsOverview,
  AgentSkillsState,
  AgentSkillSummary,
} from "../../services/types"
import Card from "../ui/Card"
import GuardrailDialog from "../common/GuardrailDialog"
import Input from "../ui/Input"
import InlineNotice from "../ui/InlineNotice"
import Select from "../ui/Select"
import StatusBadge from "../ui/StatusBadge"
import Textarea from "../ui/Textarea"
import { AccordionItem } from "../ui/Accordion"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/Tabs"
import Toggle from "../ui/Toggle"
import { WorkbenchActionButton } from "../workbench/WorkbenchActionButtons"

const EMPTY_SKILLS: AgentSkillsState = {
  skills: [],
  watched: false,
  sources: {
    workspaceDirs: [],
    userDirs: [],
    extraDirs: [],
  },
}

const EMPTY_DIAGNOSTICS: AgentSkillsDiagnosticReport = {
  generatedAt: "",
  counts: {
    total: 0,
    ready: 0,
    missing: 0,
    allowlistBlocked: 0,
    disabled: 0,
    installableFixes: 0,
    securityFlagged: 0,
    securityCritical: 0,
    securitySuppressed: 0,
  },
  topIssues: [],
  securityRules: [],
  securityRuleStats: [],
  securityRuleSummary: [],
  suppressions: [],
  suppressionSummary: [],
  buckets: {
    ready: [],
    missing: [],
    allowlistBlocked: [],
    disabled: [],
    installableFixes: [],
    securityFlagged: [],
  },
}

const EMPTY_OVERVIEW: AgentSkillsOverview = {
  state: EMPTY_SKILLS,
  diagnostics: EMPTY_DIAGNOSTICS,
}

const EMPTY_CHECK_REPORT: AgentSkillsCheckReport = {
  generatedAt: "",
  diagnostics: EMPTY_DIAGNOSTICS,
  sections: {
    ready: [],
    missing: [],
    allowlistBlocked: [],
    disabled: [],
    installableFixes: [],
    securityFlagged: [],
  },
}

export default function AgentSkillsTab() {
  const [skillsState, setSkillsState] = useState<AgentSkillsState>(EMPTY_SKILLS)
  const [diagnostics, setDiagnostics] = useState<AgentSkillsDiagnosticReport>(EMPTY_DIAGNOSTICS)
  const [loadingSkills, setLoadingSkills] = useState(true)
  const [refreshingSkills, setRefreshingSkills] = useState(false)
  const [updatingSkillId, setUpdatingSkillId] = useState<string | null>(null)
  const [installingSkillId, setInstallingSkillId] = useState<string | null>(null)
  const [importingSkill, setImportingSkill] = useState(false)
  const [installResult, setInstallResult] = useState<AgentSkillInstallResult | null>(null)
  const [importResult, setImportResult] = useState<AgentSkillImportResult | null>(null)
  const [importSource, setImportSource] = useState("")
  const [importScope, setImportScope] = useState<AgentSkillImportScope>("workspace")
  const [replaceExisting, setReplaceExisting] = useState(false)
  const [activeView, setActiveView] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [checkReport, setCheckReport] = useState<AgentSkillsCheckReport>(EMPTY_CHECK_REPORT)
  const [selectedSkillInfo, setSelectedSkillInfo] = useState<AgentSkillInfoReport | null>(null)
  const [loadingSkillInfoId, setLoadingSkillInfoId] = useState<string | null>(null)
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null)
  const [detailActionMessage, setDetailActionMessage] = useState<string | null>(null)
  const [openFindingKey, setOpenFindingKey] = useState<string | null>(null)
  const [findingSeverityFilter, setFindingSeverityFilter] = useState("all")
  const [findingRuleFilter, setFindingRuleFilter] = useState("all")
  const [findingQuery, setFindingQuery] = useState("")
  const [suppressionNote, setSuppressionNote] = useState("")
  const [suppressionImportText, setSuppressionImportText] = useState("")
  const [pendingSuppression, setPendingSuppression] = useState<null | {
    suppression: AgentSkillSuppression
    affectedFindings: number
    affectedSkills: string[]
    findingSamples: string[]
  }>(null)
  const [riskGuardrail, setRiskGuardrail] = useState<null | {
    kind: "install" | "import"
    skill?: AgentSkillSummary
    details: string[]
  }>(null)

  const loadSkills = useCallback(async () => {
    try {
      const overview = await SkillServiceClient.getSkillsOverview()
      setSkillsState(overview.state)
      setDiagnostics(overview.diagnostics)
      setCheckReport(buildCheckReportFromOverview(overview))
    } catch {
      setSkillsState(EMPTY_OVERVIEW.state)
      setDiagnostics(EMPTY_OVERVIEW.diagnostics)
      setCheckReport(EMPTY_CHECK_REPORT)
    } finally {
      setLoadingSkills(false)
    }
  }, [])

  useEffect(() => {
    loadSkills()

    const unsubscribe = SkillServiceClient.subscribeToSkillsOverview({
      onResponse: (overview) => {
        if (!overview) {
          return
        }
        setSkillsState(overview.state)
        setDiagnostics(overview.diagnostics)
        setCheckReport(buildCheckReportFromOverview(overview))
        setLoadingSkills(false)
      },
      onError: () => {},
      onComplete: () => {},
    })

    return unsubscribe
  }, [loadSkills])

  useEffect(() => {
    if (!selectedSkillInfo) {
      return
    }
    const stillExists = skillsState.skills.some((skill) => skill.id === selectedSkillInfo.skill.id)
    if (!stillExists) {
      setSelectedSkillInfo(null)
    }
  }, [selectedSkillInfo, skillsState.skills])

  const handleRefreshSkills = useCallback(async () => {
    setRefreshingSkills(true)
    try {
      await SkillServiceClient.refreshSkills()
    } finally {
      setRefreshingSkills(false)
    }
  }, [])

  const handleToggleSkill = useCallback(async (skill: AgentSkillSummary, enabled: boolean) => {
    setUpdatingSkillId(skill.id)
    try {
      await SkillServiceClient.toggleSkill(skill.id, enabled)
    } finally {
      setUpdatingSkillId(null)
    }
  }, [])

  const handleInstallSkill = useCallback(async (skill: AgentSkillSummary) => {
    setInstallingSkillId(skill.id)
    try {
      const result = await SkillServiceClient.installSkill(skill.id, skill.preferredInstallerId)
      setInstallResult(result)
      if (result.blockedBySecurity) {
        setRiskGuardrail({
          kind: "install",
          skill,
          details: result.warnings,
        })
      }
    } finally {
      setInstallingSkillId(null)
    }
  }, [])

  const handleImportSkill = useCallback(async () => {
    const source = importSource.trim()
    if (!source) {
      return
    }

    setImportingSkill(true)
    try {
      const result = await SkillServiceClient.importSkillFromSource(
        source,
        importScope,
        replaceExisting,
      )
      setImportResult(result)
      if (result.blockedBySecurity) {
        setRiskGuardrail({
          kind: "import",
          details: result.warnings,
        })
      }
      if (result.ok) {
        setImportSource("")
      }
    } finally {
      setImportingSkill(false)
    }
  }, [importScope, importSource, replaceExisting])

  const handlePickImportSource = useCallback(async () => {
    const result = await SkillServiceClient.pickImportSource()
    if (!result.cancelled && result.path) {
      setImportSource(result.path)
    }
  }, [])

  const handleInspectSkill = useCallback(async (skill: AgentSkillSummary) => {
    setLoadingSkillInfoId(skill.id)
    try {
      const report = await SkillServiceClient.getSkillInfoReport(skill.id)
      setSelectedSkillInfo(report)
    } finally {
      setLoadingSkillInfoId(null)
    }
  }, [])

  const handleCopyJson = useCallback(async (label: string, value: unknown) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2))
      setCopiedLabel(label)
      window.setTimeout(() => {
        setCopiedLabel((current) => (current === label ? null : current))
      }, 1500)
    } catch {
      setCopiedLabel(null)
    }
  }, [])

  const handleDownloadJson = useCallback((filename: string, value: unknown) => {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }, [])

  const handleApplyFindingFilters = useCallback(
    (params: { ruleId?: string; severity?: string }) => {
      setActiveView("security")
      setFindingRuleFilter(params.ruleId ?? "all")
      setFindingSeverityFilter(params.severity ?? "all")
      setFindingQuery("")
      if (params.ruleId) {
        const matchedSkill = skillsState.skills.find((skill) =>
          skill.security.findings.some((finding) => finding.ruleId === params.ruleId),
        )
        if (matchedSkill) {
          setSelectedSkillInfo({
            generatedAt: new Date().toISOString(),
            skill: matchedSkill,
          })
        }
      }
    },
    [skillsState.skills],
  )

  const handleClearFindingFilters = useCallback(() => {
    setFindingRuleFilter("all")
    setFindingSeverityFilter("all")
    setFindingQuery("")
  }, [])

  const handleOpenFindingLocation = useCallback(async (file: string, line: number) => {
    try {
      await SkillServiceClient.openSkillFindingLocation(file, line)
      setDetailActionMessage(`Opened ${file}:${line}`)
      window.setTimeout(() => {
        setDetailActionMessage((current) => (current === `Opened ${file}:${line}` ? null : current))
      }, 1500)
    } catch (error) {
      setDetailActionMessage(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const handleAddSuppression = useCallback(
    async (suppression: AgentSkillSuppression) => {
      await SkillServiceClient.addSkillSuppression(
        suppression.scope,
        suppression.ruleId,
        suppression.file,
        suppression.note,
      )
      setDetailActionMessage("Suppression added.")
      setSuppressionNote("")
    },
    [],
  )

  const handleRemoveSuppression = useCallback(
    async (suppression: AgentSkillSuppression) => {
      await SkillServiceClient.removeSkillSuppression(
        suppression.scope,
        suppression.ruleId,
        suppression.file,
      )
      setDetailActionMessage("Suppression removed.")
    },
    [],
  )

  const handleImportSuppressions = useCallback(async () => {
    try {
      const raw = suppressionImportText.trim()
      if (!raw) {
        return
      }
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) {
        throw new Error("Suppression import must be a JSON array.")
      }
      await SkillServiceClient.setSkillSuppressions(parsed as AgentSkillSuppression[])
      setDetailActionMessage("Suppressions imported.")
      setSuppressionImportText("")
    } catch (error) {
      setDetailActionMessage(error instanceof Error ? error.message : String(error))
    }
  }, [suppressionImportText])

  const handleConfirmRiskGuardrail = useCallback(async () => {
    const guardrail = riskGuardrail
    if (!guardrail) {
      return
    }
    setRiskGuardrail(null)

    if (guardrail.kind === "install" && guardrail.skill) {
      setInstallingSkillId(guardrail.skill.id)
      try {
        const result = await SkillServiceClient.installSkill(
          guardrail.skill.id,
          guardrail.skill.preferredInstallerId,
          true,
        )
        setInstallResult(result)
      } finally {
        setInstallingSkillId(null)
      }
      return
    }

    if (guardrail.kind === "import") {
      setImportingSkill(true)
      try {
        const result = await SkillServiceClient.importSkillFromSource(
          importSource.trim(),
          importScope,
          replaceExisting,
          true,
        )
        setImportResult(result)
        if (result.ok) {
          setImportSource("")
        }
      } finally {
        setImportingSkill(false)
      }
    }
  }, [importScope, importSource, replaceExisting, riskGuardrail])

  const readySkills = skillsState.skills.filter((skill) => diagnostics.buckets.ready.includes(skill.id))
  const blockedSkills = skillsState.skills.filter((skill) => skill.enabled && !skill.effectiveEnabled)
  const disabledSkills = skillsState.skills.filter((skill) => diagnostics.buckets.disabled.includes(skill.id))
  const allowlistBlockedSkills = skillsState.skills.filter((skill) =>
    diagnostics.buckets.allowlistBlocked.includes(skill.id),
  )
  const missingRequirementSkills = skillsState.skills.filter((skill) =>
    diagnostics.buckets.missing.includes(skill.id),
  )
  const installableFixes = skillsState.skills.filter((skill) =>
    diagnostics.buckets.installableFixes.includes(skill.id),
  )
  const securityFlaggedSkills = skillsState.skills.filter((skill) =>
    diagnostics.buckets.securityFlagged.includes(skill.id),
  )

  const filteredSkills = skillsState.skills.filter((skill) => {
    if (!matchesSkillView(skill, activeView)) {
      return false
    }
    if (!searchQuery.trim()) {
      return true
    }
    const haystack = [
      skill.id,
      skill.skillKey,
      skill.name,
      skill.description ?? "",
      skill.slashCommandName ?? "",
      skill.commandTool ?? "",
      skill.primaryEnv ?? "",
      skill.gatingReasons.join(" "),
      formatMissingRequirements(skill),
    ]
      .join(" ")
      .toLowerCase()
    return haystack.includes(searchQuery.trim().toLowerCase())
  })

  const detailSecuritySkill =
    selectedSkillInfo?.skill ??
    filteredSkills.find((skill) => skill.security.findings.length > 0 || skill.security.status === "error") ??
    securityFlaggedSkills[0]
  const detailSkillSuppressions = detailSecuritySkill
    ? diagnostics.suppressionSummary.filter((entry) => entry.affectedSkills.includes(detailSecuritySkill.id))
    : []
  const findingRuleOptions =
    detailSecuritySkill
      ? Array.from(new Set(detailSecuritySkill.security.findings.map((finding) => finding.ruleId))).sort()
      : []
  const filteredSecurityFindings =
    detailSecuritySkill?.security.findings.filter((finding) => {
      if (findingSeverityFilter !== "all" && finding.severity !== findingSeverityFilter) {
        return false
      }
      if (findingRuleFilter !== "all" && finding.ruleId !== findingRuleFilter) {
        return false
      }
      if (!findingQuery.trim()) {
        return true
      }
      const haystack = [
        finding.ruleId,
        finding.severity,
        finding.message,
        finding.file,
        String(finding.line),
        finding.evidence,
        finding.recommendation,
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(findingQuery.trim().toLowerCase())
    }) ?? []
  const filteredSecurityFiles = Array.from(new Set(filteredSecurityFindings.map((finding) => finding.file))).sort()

  const handleFocusCurrentSkillCritical = useCallback(() => {
    if (!detailSecuritySkill) {
      return
    }
    setActiveView("security")
    setSelectedSkillInfo({
      generatedAt: new Date().toISOString(),
      skill: detailSecuritySkill,
    })
    setFindingSeverityFilter("critical")
    setFindingRuleFilter("all")
    setFindingQuery("")
  }, [detailSecuritySkill])

  const handleFocusCurrentRuleFiles = useCallback(() => {
    if (findingRuleFilter === "all" || filteredSecurityFiles.length === 0) {
      return
    }
    setFindingQuery(filteredSecurityFiles.join(" "))
  }, [filteredSecurityFiles, findingRuleFilter])

  const handlePreviewSuppression = useCallback(
    (suppression: AgentSkillSuppression) => {
      const { findings, skills, samples } = computeSuppressionImpact(skillsState.skills, suppression)
      setPendingSuppression({
        suppression,
        affectedFindings: findings,
        affectedSkills: skills,
        findingSamples: samples,
      })
    },
    [skillsState.skills],
  )

  const handleConfirmSuppression = useCallback(async () => {
    if (!pendingSuppression) {
      return
    }
    await handleAddSuppression(pendingSuppression.suppression)
    setPendingSuppression(null)
  }, [handleAddSuppression, pendingSuppression])

  useEffect(() => {
    setOpenFindingKey(null)
    setFindingSeverityFilter("all")
    setFindingRuleFilter("all")
    setFindingQuery("")
  }, [detailSecuritySkill?.id])

  if (loadingSkills) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-description" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title="Agent Skills">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                label={`${diagnostics.counts.ready} Ready`}
                tone={diagnostics.counts.ready > 0 ? "success" : "neutral"}
              />
              <StatusBadge
                label={`${blockedSkills.length} Blocked`}
                tone={blockedSkills.length > 0 ? "warning" : "neutral"}
              />
              <StatusBadge
                label={skillsState.watched ? "Watching" : "Manual Refresh"}
                tone={skillsState.watched ? "success" : "neutral"}
              />
            </div>
            <p className="mt-2 text-xs text-description">
              OpenClaw-style skills are discovered from bundled, workspace, and optional external
              directories. Use <code>/skills</code> to inspect them in chat, or{" "}
              <code>/skill &lt;id&gt; &lt;task&gt;</code> or its direct slash command to invoke one directly.
            </p>
          </div>
          <WorkbenchActionButton
            variant="secondary"
            onClick={handleRefreshSkills}
            disabled={refreshingSkills}
          >
            {refreshingSkills ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Refresh
          </WorkbenchActionButton>
        </div>

        {skillsState.skills.length === 0 ? (
          <InlineNotice tone="info" size="sm">
            No skills discovered yet. Add a <code>SKILL.md</code> under one of the source
            directories below to make it available.
          </InlineNotice>
        ) : (
          <InlineNotice tone="info" size="sm" icon={<Sparkles size={12} />}>
            Model-invocable skills are advertised to the assistant automatically. Slash-invocable
            skills can be called explicitly from chat.
          </InlineNotice>
        )}

        {installResult && (
          <InlineNotice
            tone={installResult.ok && installResult.warnings.length === 0 ? "success" : "warning"}
            size="sm"
            icon={
              installResult.ok && installResult.warnings.length === 0
                ? <Sparkles size={12} />
                : <AlertTriangle size={12} />
            }
          >
            <div className="flex flex-col gap-1">
              <span>{installResult.message}</span>
              {installResult.executedCommand && installResult.executedCommand.length > 0 && (
                <code>{installResult.executedCommand.join(" ")}</code>
              )}
              {installResult.targetPath && <code>{installResult.targetPath}</code>}
              {installResult.warnings.map((warning, index) => (
                <span key={`install-warning-${index}`}>{warning}</span>
              ))}
              {installResult.stderr && <span>{installResult.stderr}</span>}
            </div>
          </InlineNotice>
        )}

        <SkillSourceList skillsState={skillsState} />
      </Card>

      <Card title="Skills Check">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <DiagnosticStat label="Ready" value={diagnostics.counts.ready} tone="success" />
          <DiagnosticStat label="Missing" value={diagnostics.counts.missing} tone="warning" />
          <DiagnosticStat label="Allowlist" value={diagnostics.counts.allowlistBlocked} tone="warning" />
          <DiagnosticStat label="Disabled" value={diagnostics.counts.disabled} tone="neutral" />
          <DiagnosticStat label="Install Fixes" value={diagnostics.counts.installableFixes} tone="neutral" />
          <DiagnosticStat label="Security" value={diagnostics.counts.securityFlagged} tone="warning" />
          <DiagnosticStat label="Suppressed" value={diagnostics.counts.securitySuppressed} tone="neutral" />
        </div>

        <div className="mt-3 flex flex-col gap-2">
          {allowlistBlockedSkills.length > 0 && (
            <InlineNotice tone="warning" size="sm">
              Bundled allowlist is blocking: {allowlistBlockedSkills.map((skill) => skill.id).join(", ")}
            </InlineNotice>
          )}
          {missingRequirementSkills.length > 0 && (
            <InlineNotice tone="info" size="sm">
              Most common blockers: {formatTopIssues(diagnostics)}
            </InlineNotice>
          )}
          {securityFlaggedSkills.length > 0 && (
            <InlineNotice tone="warning" size="sm">
              Security warnings detected in: {securityFlaggedSkills.map((skill) => skill.id).join(", ")}
            </InlineNotice>
          )}
          {diagnostics.counts.missing === 0 &&
            diagnostics.counts.allowlistBlocked === 0 &&
            diagnostics.counts.disabled === 0 && (
              <InlineNotice tone="success" size="sm" icon={<Sparkles size={12} />}>
                No skill blockers detected right now.
              </InlineNotice>
            )}
        </div>
      </Card>

      <Card title="Diagnostics Detail">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <WorkbenchActionButton
              variant="secondary"
              onClick={() => handleCopyJson("check", checkReport)}
            >
              <Copy size={14} />
              {copiedLabel === "check" ? "Copied Check JSON" : "Copy Check JSON"}
            </WorkbenchActionButton>
            <WorkbenchActionButton
              variant="secondary"
              onClick={() => handleDownloadJson("skills-check-report.json", checkReport)}
            >
              <Download size={14} />
              Export Check JSON
            </WorkbenchActionButton>
            <WorkbenchActionButton
              variant="secondary"
              onClick={() => handleCopyJson("rules", diagnostics.securityRuleSummary)}
            >
              <Copy size={14} />
              {copiedLabel === "rules" ? "Copied Rule JSON" : "Copy Rule JSON"}
            </WorkbenchActionButton>
            <WorkbenchActionButton
              variant="secondary"
              onClick={() => handleDownloadJson("skills-security-rules.json", diagnostics.securityRuleSummary)}
            >
              <Download size={14} />
              Export Rule JSON
            </WorkbenchActionButton>
            {selectedSkillInfo && (
              <>
                <WorkbenchActionButton
                  variant="secondary"
                  onClick={() => handleCopyJson("skill-info", selectedSkillInfo)}
                >
                  <Copy size={14} />
                  {copiedLabel === "skill-info" ? "Copied Skill JSON" : "Copy Skill JSON"}
                </WorkbenchActionButton>
                <WorkbenchActionButton
                  variant="secondary"
                  onClick={() =>
                    handleDownloadJson(
                      `skill-${selectedSkillInfo.skill.id}-info.json`,
                      selectedSkillInfo,
                    )
                  }
                >
                  <Download size={14} />
                  Export Skill JSON
                </WorkbenchActionButton>
              </>
            )}
          </div>

          <Textarea
            label="Check Report JSON"
            readOnly
            value={JSON.stringify(checkReport, null, 2)}
            className="min-h-[180px]"
          />

          {diagnostics.securityRuleSummary.length > 0 && (
            <div className="rounded border border-[var(--vscode-panel-border)] px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium text-foreground">Top Security Rules</div>
                <WorkbenchActionButton variant="secondary" onClick={handleClearFindingFilters}>
                  Clear Filters
                </WorkbenchActionButton>
              </div>
              <div className="mt-2 flex flex-col gap-2 text-xs text-description">
                {diagnostics.securityRuleSummary.slice(0, 8).map((rule) => {
                  return (
                    <button
                      key={`${rule.ruleId}-${rule.count}`}
                      type="button"
                      onClick={() =>
                        handleApplyFindingFilters({
                          ruleId: rule.ruleId,
                          severity: rule.severity,
                        })
                      }
                      className="rounded border border-[var(--vscode-panel-border)] px-2 py-2 text-left transition-colors hover:bg-[var(--vscode-list-hoverBackground)]"
                    >
                      <div className="font-mono text-foreground">
                        {rule.ruleId} ({rule.count})
                      </div>
                      {rule.suppressedCount > 0 && (
                        <div className="mt-1 text-warning">
                          suppressed: {rule.suppressedCount} via {rule.matchingSuppressions.length} suppression(s)
                        </div>
                      )}
                      <div className="mt-1">{rule.message}</div>
                      <div className="mt-1">{rule.recommendation}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {diagnostics.suppressions.length > 0 && (
            <div className="rounded border border-[var(--vscode-panel-border)] px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium text-foreground">Active Suppressions</div>
                <div className="flex flex-wrap gap-2">
                  <WorkbenchActionButton
                    variant="secondary"
                    onClick={() => handleCopyJson("suppressions", diagnostics.suppressions)}
                  >
                    <Copy size={14} />
                    {copiedLabel === "suppressions" ? "Copied Suppressions" : "Copy Suppressions"}
                  </WorkbenchActionButton>
                  <WorkbenchActionButton
                    variant="secondary"
                    onClick={() => handleDownloadJson("skills-suppressions.json", diagnostics.suppressions)}
                  >
                    <Download size={14} />
                    Export Suppressions
                  </WorkbenchActionButton>
                </div>
              </div>
              <div className="mt-2 flex flex-col gap-2 text-xs text-description">
                {diagnostics.suppressions.map((suppression) => {
                  const summary = diagnostics.suppressionSummary.find(
                    (entry) => suppressionKeyForUi(entry.suppression) === suppressionKeyForUi(suppression),
                  )
                  return (
                    <div
                      key={suppressionKeyForUi(suppression)}
                      className="flex items-start justify-between gap-3 rounded border border-[var(--vscode-panel-border)] px-2 py-2"
                    >
                      <div>
                        <div className="font-mono text-foreground">{suppression.scope}</div>
                        {summary && (
                          <div className="mt-1">
                            affects {summary.affectedFindings} findings across {summary.affectedSkills.length} skills
                          </div>
                        )}
                        {suppression.createdAt && <div className="mt-1">created: {suppression.createdAt}</div>}
                        {suppression.note && <div className="mt-1">{suppression.note}</div>}
                        {suppression.ruleId && <div className="mt-1">rule: {suppression.ruleId}</div>}
                        {suppression.file && <div className="mt-1 break-all font-mono">{suppression.file}</div>}
                      </div>
                      <WorkbenchActionButton
                        variant="secondary"
                        onClick={() => void handleRemoveSuppression(suppression)}
                      >
                        Remove
                      </WorkbenchActionButton>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="rounded border border-[var(--vscode-panel-border)] px-3 py-3">
            <div className="text-xs font-medium text-foreground">Import Suppressions JSON</div>
            <div className="mt-2 flex flex-col gap-3">
              <Textarea
                value={suppressionImportText}
                onChange={(event) => setSuppressionImportText(event.target.value)}
                placeholder='[{"scope":"rule","ruleId":"dangerous-exec","note":"trusted internal tool"}]'
                className="min-h-[120px]"
              />
              <div className="flex flex-wrap gap-2">
                <WorkbenchActionButton variant="secondary" onClick={() => void handleImportSuppressions()}>
                  <Import size={14} />
                  Import Suppressions
                </WorkbenchActionButton>
              </div>
            </div>
          </div>

          {selectedSkillInfo ? (
            <Textarea
              label={`Skill Info JSON (${selectedSkillInfo.skill.id})`}
              readOnly
              value={JSON.stringify(selectedSkillInfo, null, 2)}
              className="min-h-[220px]"
            />
          ) : (
            <InlineNotice tone="info" size="sm">
              Use <code>Inspect</code> on any skill below to load its structured info report.
            </InlineNotice>
          )}

          {detailActionMessage && (
            <InlineNotice tone="info" size="sm">
              {detailActionMessage}
            </InlineNotice>
          )}

          {detailSkillSuppressions.length > 0 && detailSecuritySkill && (
            <InlineNotice tone="info" size="sm">
              Active suppressions affecting <code>{detailSecuritySkill.id}</code>:{" "}
              {detailSkillSuppressions
                .map((entry) => `${entry.suppression.scope}${entry.suppression.ruleId ? `:${entry.suppression.ruleId}` : ""}`)
                .join(" | ")}
            </InlineNotice>
          )}

          {detailSecuritySkill && (
            <div className="rounded border border-[var(--vscode-panel-border)]">
              <div className="border-b border-[var(--vscode-panel-border)] px-3 py-2 text-xs font-medium text-foreground">
                Security Findings: {detailSecuritySkill.id}
              </div>
              {detailSecuritySkill.security.status === "error" ? (
                <div className="px-3 py-3 text-xs text-warning">
                  Scan failed: {detailSecuritySkill.security.error ?? "Unknown error"}
                </div>
              ) : detailSecuritySkill.security.findings.length === 0 ? (
                <div className="px-3 py-3 text-xs text-description">No findings for this skill.</div>
              ) : (
                <div className="flex flex-col gap-3 px-3 py-3">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_220px]">
                    <Input
                      label="Finding Search"
                      value={findingQuery}
                      onChange={(event) => setFindingQuery(event.target.value)}
                      placeholder="Search rule, file, message, or evidence"
                    />
                    <Select
                      label="Severity"
                      value={findingSeverityFilter}
                      onChange={(event) => setFindingSeverityFilter(event.target.value)}
                      options={[
                        { value: "all", label: "All severities" },
                        { value: "critical", label: "Critical" },
                        { value: "warn", label: "Warn" },
                        { value: "info", label: "Info" },
                      ]}
                    />
                    <Select
                      label="Rule"
                      value={findingRuleFilter}
                      onChange={(event) => setFindingRuleFilter(event.target.value)}
                      options={[
                        { value: "all", label: "All rules" },
                        ...findingRuleOptions.map((ruleId) => ({
                          value: ruleId,
                          label: ruleId,
                        })),
                      ]}
                    />
                  </div>

                  <Input
                    label="Suppression Note"
                    value={suppressionNote}
                    onChange={(event) => setSuppressionNote(event.target.value)}
                    placeholder="Why this finding is acceptable or intentionally ignored"
                  />

                  <InlineNotice tone="info" size="sm">
                    Showing {filteredSecurityFindings.length} of {detailSecuritySkill.security.findings.length} findings.
                  </InlineNotice>

                  <div className="flex flex-wrap gap-2">
                    <WorkbenchActionButton
                      variant="secondary"
                      onClick={() => handleCopyJson("findings", filteredSecurityFindings)}
                    >
                      <Copy size={14} />
                      {copiedLabel === "findings" ? "Copied Findings JSON" : "Copy Findings JSON"}
                    </WorkbenchActionButton>
                    <WorkbenchActionButton
                      variant="secondary"
                      onClick={() =>
                        handleDownloadJson(
                          `skill-${detailSecuritySkill.id}-filtered-findings.json`,
                          filteredSecurityFindings,
                        )
                      }
                    >
                      <Download size={14} />
                      Export Findings JSON
                    </WorkbenchActionButton>
                    <WorkbenchActionButton
                      variant="secondary"
                      onClick={() => handleApplyFindingFilters({ severity: "critical" })}
                    >
                      Critical Only
                    </WorkbenchActionButton>
                    <WorkbenchActionButton
                      variant="secondary"
                      onClick={() => handleApplyFindingFilters({ severity: "warn" })}
                    >
                      Warn Only
                    </WorkbenchActionButton>
                    <WorkbenchActionButton variant="secondary" onClick={handleFocusCurrentSkillCritical}>
                      Current Skill Critical
                    </WorkbenchActionButton>
                    <WorkbenchActionButton
                      variant="secondary"
                      onClick={handleFocusCurrentRuleFiles}
                      disabled={findingRuleFilter === "all" || filteredSecurityFiles.length === 0}
                    >
                      Current Rule Files
                    </WorkbenchActionButton>
                    <WorkbenchActionButton variant="secondary" onClick={handleClearFindingFilters}>
                      Reset Finding Filters
                    </WorkbenchActionButton>
                  </div>

                  {findingRuleFilter !== "all" && filteredSecurityFiles.length > 0 && (
                    <InlineNotice tone="info" size="sm">
                      Files for rule <code>{findingRuleFilter}</code>: {filteredSecurityFiles.join(" | ")}
                    </InlineNotice>
                  )}

                  <div className="max-h-[360px] overflow-auto">
                    {filteredSecurityFindings.slice(0, 20).map((finding, index) => {
                      const findingKey = `${detailSecuritySkill.id}-${finding.ruleId}-${finding.file}-${finding.line}-${index}`
                      return (
                        <AccordionItem
                          key={findingKey}
                          title={`${finding.severity.toUpperCase()} ${finding.ruleId} - ${finding.message}`}
                          isOpen={openFindingKey === findingKey}
                          onToggle={() =>
                            setOpenFindingKey((current) => (current === findingKey ? null : findingKey))
                          }
                        >
                          <div className="flex flex-col gap-2 px-3 py-3 text-xs text-description">
                            <div>
                              <span className="font-medium text-foreground">File</span>
                              <div className="mt-1 break-all font-mono">{finding.file}</div>
                            <div className="mt-2">
                              <WorkbenchActionButton
                                variant="secondary"
                                onClick={() => void handleOpenFindingLocation(finding.file, finding.line)}
                              >
                                  <FolderOpen size={14} />
                                Open File
                              </WorkbenchActionButton>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <WorkbenchActionButton
                                  variant="secondary"
                                  onClick={() =>
                                    void handlePreviewSuppression({
                                      scope: "rule",
                                      ruleId: finding.ruleId,
                                      note: suppressionNote.trim() || undefined,
                                    })
                                  }
                                >
                                  Ignore Rule
                                </WorkbenchActionButton>
                                <WorkbenchActionButton
                                  variant="secondary"
                                  onClick={() =>
                                    void handlePreviewSuppression({
                                      scope: "file",
                                      file: finding.file,
                                      note: suppressionNote.trim() || undefined,
                                    })
                                  }
                                >
                                  Ignore File
                                </WorkbenchActionButton>
                                <WorkbenchActionButton
                                  variant="secondary"
                                  onClick={() =>
                                    void handlePreviewSuppression({
                                      scope: "rule-file",
                                      ruleId: finding.ruleId,
                                      file: finding.file,
                                      note: suppressionNote.trim() || undefined,
                                    })
                                  }
                                >
                                  Ignore Rule + File
                                </WorkbenchActionButton>
                              </div>
                            </div>
                          </div>
                            <div>
                              <span className="font-medium text-foreground">Line</span>
                              <div className="mt-1 font-mono">{finding.line}</div>
                            </div>
                            <div>
                              <span className="font-medium text-foreground">Evidence</span>
                              <div className="mt-1 break-all font-mono">{finding.evidence}</div>
                            </div>
                            <div>
                              <span className="font-medium text-foreground">Recommendation</span>
                              <div className="mt-1">{finding.recommendation}</div>
                            </div>
                          </div>
                        </AccordionItem>
                      )
                    })}
                    {filteredSecurityFindings.length === 0 && (
                      <div className="px-2 py-3 text-xs text-description">
                        No findings matched the current filters.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card title="Import External Skill">
        <div className="flex flex-col gap-3">
          <InlineNotice tone="info" size="sm" icon={<Import size={12} />}>
            Supports local folders, local archives, archive URLs, and git repository URLs. Use
            <code>source::subdir</code> when the skill lives inside a nested directory.
          </InlineNotice>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              label="Source"
              value={importSource}
              onChange={(event) => setImportSource(event.target.value)}
              placeholder="/path/to/skill | https://.../skill.zip | https://github.com/org/repo::skills/my-skill"
            />
            <div className="flex items-end">
              <WorkbenchActionButton variant="secondary" onClick={handlePickImportSource}>
                <FolderOpen size={14} />
                Browse
              </WorkbenchActionButton>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Select
              label="Install Scope"
              value={importScope}
              onChange={(event) => setImportScope(event.target.value as AgentSkillImportScope)}
              options={[
                { value: "workspace", label: "Workspace" },
                { value: "user", label: "User" },
              ]}
            />
            <div className="flex items-end">
              <WorkbenchActionButton
                variant="primary"
                onClick={handleImportSkill}
                disabled={importingSkill || !importSource.trim()}
              >
                {importingSkill ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Import size={14} />
                )}
                Import Skill
              </WorkbenchActionButton>
            </div>
          </div>

          <Toggle
            checked={replaceExisting}
            onChange={setReplaceExisting}
            label="Replace Existing Skill"
            description="When enabled, an existing destination folder with the same skill directory name will be overwritten."
          />

          {importResult && (
            <InlineNotice
              tone={importResult.ok && importResult.warnings.length === 0 ? "success" : "warning"}
              size="sm"
              icon={
                importResult.ok && importResult.warnings.length === 0
                  ? <Sparkles size={12} />
                  : <AlertTriangle size={12} />
              }
            >
              <div className="flex flex-col gap-1">
                <span>{importResult.message}</span>
                {importResult.targetDirectory && <code>{importResult.targetDirectory}</code>}
                {importResult.resolvedSourcePath && <code>{importResult.resolvedSourcePath}</code>}
                {importResult.warnings.map((warning, index) => (
                  <span key={`import-warning-${index}`}>{warning}</span>
                ))}
              </div>
            </InlineNotice>
          )}
        </div>
      </Card>

      <Card title="Discovered Skills">
        {skillsState.skills.length === 0 ? (
          <div className="rounded border border-dashed border-[var(--vscode-panel-border)] px-3 py-5 text-center text-xs text-description">
            No skills available.
          </div>
        ) : (
          <Tabs value={activeView} onValueChange={setActiveView} className="gap-3">
            <TabsList>
              <TabsTrigger value="all">All ({skillsState.skills.length})</TabsTrigger>
              <TabsTrigger value="ready">Ready ({diagnostics.counts.ready})</TabsTrigger>
              <TabsTrigger value="missing">Missing ({diagnostics.counts.missing})</TabsTrigger>
              <TabsTrigger value="allowlist">Allowlist ({diagnostics.counts.allowlistBlocked})</TabsTrigger>
              <TabsTrigger value="disabled">Disabled ({diagnostics.counts.disabled})</TabsTrigger>
              <TabsTrigger value="security">Security ({diagnostics.counts.securityFlagged})</TabsTrigger>
            </TabsList>

            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
              <Input
                label="Search Skills"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Filter by id, name, slash command, env, or blocker"
              />
              <Select
                label="View"
                value={activeView}
                onChange={(event) => setActiveView(event.target.value)}
                options={[
                  { value: "all", label: `All (${skillsState.skills.length})` },
                  { value: "ready", label: `Ready (${diagnostics.counts.ready})` },
                  { value: "missing", label: `Missing (${diagnostics.counts.missing})` },
                  { value: "allowlist", label: `Allowlist (${diagnostics.counts.allowlistBlocked})` },
                  { value: "disabled", label: `Disabled (${diagnostics.counts.disabled})` },
                  { value: "security", label: `Security (${diagnostics.counts.securityFlagged})` },
                ]}
              />
            </div>

            <TabsContent value={activeView}>
              {filteredSkills.length === 0 ? (
                <div className="rounded border border-dashed border-[var(--vscode-panel-border)] px-3 py-5 text-center text-xs text-description">
                  No skills matched the current filters.
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {filteredSkills.map((skill) => {
                    const skillStatus = getSkillStatus(skill)
                    return (
                      <div
                        key={skill.id}
                        className="rounded border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_95%,black_5%)] p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium">{skill.name}</span>
                              <StatusBadge label={skillStatus.label} tone={skillStatus.tone} size="compact" />
                              <StatusBadge label={skill.source} tone="neutral" size="compact" />
                              {skill.modelInvocable && (
                                <StatusBadge label="Auto" tone="success" size="compact" />
                              )}
                              {skill.userInvocable && (
                                <StatusBadge label="Slash" tone="neutral" size="compact" />
                              )}
                              {skill.commandDispatch === "tool" && (
                                <StatusBadge label="Tool Dispatch" tone="warning" size="compact" />
                              )}
                              {skill.always && (
                                <StatusBadge label="Always" tone="neutral" size="compact" />
                              )}
                              {skill.blockedByAllowlist && (
                                <StatusBadge label="Allowlist Blocked" tone="warning" size="compact" />
                              )}
                              {skill.installers.length > 0 && (
                                <StatusBadge label="Installable" tone="neutral" size="compact" />
                              )}
                              {(skill.security.critical > 0 ||
                                skill.security.warn > 0 ||
                                skill.security.status === "error") && (
                                <StatusBadge
                                  label={
                                    skill.security.status === "error"
                                      ? "Security Scan Error"
                                      : skill.security.critical > 0
                                      ? `Security ${skill.security.critical}C/${skill.security.warn}W`
                                      : `Security ${skill.security.warn}W`
                                  }
                                  tone={
                                    skill.security.status === "error" || skill.security.critical > 0
                                      ? "danger"
                                      : "warning"
                                  }
                                  size="compact"
                                />
                              )}
                              {skill.security.suppressed > 0 && (
                                <StatusBadge
                                  label={`Suppressed ${skill.security.suppressed}`}
                                  tone="neutral"
                                  size="compact"
                                />
                              )}
                            </div>
                            {skill.description && (
                              <p className="mt-1 text-xs text-description">{skill.description}</p>
                            )}
                          </div>
                          <div className="shrink-0">
                            <div className="flex flex-col items-end gap-2">
                              {canAttemptInstall(skill) && (
                                <WorkbenchActionButton
                                  variant="secondary"
                                  onClick={() => handleInstallSkill(skill)}
                                  disabled={installingSkillId === skill.id}
                                >
                                  {installingSkillId === skill.id ? (
                                    <Loader2 size={14} className="animate-spin" />
                                  ) : (
                                    <Download size={14} />
                                  )}
                                  Install
                                </WorkbenchActionButton>
                              )}
                              <WorkbenchActionButton
                                variant="secondary"
                                onClick={() => handleInspectSkill(skill)}
                                disabled={loadingSkillInfoId === skill.id}
                              >
                                {loadingSkillInfoId === skill.id ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <Sparkles size={14} />
                                )}
                                Inspect
                              </WorkbenchActionButton>
                              <Toggle
                                checked={skill.enabled}
                                onChange={(enabled) => handleToggleSkill(skill, enabled)}
                                label="Enabled"
                                description={updatingSkillId === skill.id ? "Saving..." : undefined}
                                disabled={updatingSkillId === skill.id}
                              />
                            </div>
                          </div>
                        </div>

                        {skill.instructionsPreview && (
                          <div className="mt-3 rounded border border-[var(--vscode-panel-border)] px-2 py-1.5 text-xs text-description">
                            {skill.instructionsPreview}
                          </div>
                        )}

                        <div className="mt-3 grid gap-2 text-xs text-description md:grid-cols-2">
                          <InfoRow label="ID" value={skill.id} />
                          <InfoRow label="Config Key" value={skill.skillKey} />
                          <InfoRow label="Slash" value={skill.slashCommandName ? `/${skill.slashCommandName}` : "—"} />
                          <InfoRow label="Path" value={skill.filePath} />
                          <InfoRow
                            label="Dispatch"
                            value={
                              skill.commandDispatch === "tool" && skill.commandTool
                                ? `tool:${skill.commandTool} (${skill.commandArgMode ?? "raw"})`
                                : "model"
                            }
                          />
                          <InfoRow
                            label="Installer"
                            value={
                              skill.installers.length > 0
                                ? skill.installers
                                    .map((installer) => installer.label ?? installer.id ?? installer.kind)
                                    .join(" | ")
                                : "—"
                            }
                          />
                          <InfoRow label="Primary Env" value={skill.primaryEnv ?? "—"} />
                          <InfoRow
                            label="Security"
                            value={
                              skill.security.status === "pending"
                                ? "pending"
                                : skill.security.status === "error"
                                  ? `error: ${skill.security.error ?? "scan failed"}`
                                  : `${skill.security.critical} critical / ${skill.security.warn} warn / ${skill.security.info} info`
                            }
                          />
                          <InfoRow label="Missing Requirements" value={formatMissingRequirements(skill)} />
                        </div>

                        {skill.gatingReasons.length > 0 && (
                          <InlineNotice tone="warning" size="sm" icon={<AlertTriangle size={12} />}>
                            {skill.gatingReasons.join(" | ")}
                          </InlineNotice>
                        )}

                        {skill.configChecks.length > 0 && (
                          <InlineNotice tone="info" size="sm">
                            {skill.configChecks
                              .map((check) => `${check.satisfied ? "ok" : "missing"}:${check.path}`)
                              .join(" | ")}
                          </InlineNotice>
                        )}

                        {skill.security.status === "error" && (
                          <InlineNotice tone="warning" size="sm">
                            Security scan failed: {skill.security.error ?? "Unknown error"}
                          </InlineNotice>
                        )}

                        {skill.security.findings.length > 0 && (
                          <InlineNotice tone={skill.security.critical > 0 ? "danger" : "warning"} size="sm">
                            {skill.security.findings
                              .slice(0, 3)
                              .map((finding) => `${finding.severity}:${finding.ruleId} ${finding.message}`)
                              .join(" | ")}
                          </InlineNotice>
                        )}

                        {skill.homepage && (
                          <a
                            href={skill.homepage}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex text-xs text-[var(--vscode-textLink-foreground)] hover:underline"
                          >
                            Open homepage
                          </a>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </Card>

      <Card title="Agent Controls">
        <InlineNotice tone="info" size="sm" icon={<Sparkles size={12} />}>
          Agent mode, built-in tools, and auto-approval now live in Settings {">"} Agent / MCP Runtime.
          Use this page for skills only.
        </InlineNotice>
      </Card>

      <GuardrailDialog
        open={Boolean(riskGuardrail)}
        title={riskGuardrail?.kind === "install" ? "High-Risk Skill Install" : "High-Risk Skill Import"}
        description="Security scan found critical issues in this skill. Continue only if you trust the source and understand the risk."
        confirmLabel={riskGuardrail?.kind === "install" ? "Install Anyway" : "Import Anyway"}
        details={riskGuardrail?.details ?? []}
        tone="danger"
        busy={Boolean(installingSkillId) || importingSkill}
        onCancel={() => setRiskGuardrail(null)}
        onConfirm={() => void handleConfirmRiskGuardrail()}
      />

      <GuardrailDialog
        open={Boolean(pendingSuppression)}
        title="Confirm Suppression"
        description="This suppression will hide matching findings from future diagnostics until you remove it."
        confirmLabel="Add Suppression"
        details={
          pendingSuppression
            ? [
                `scope: ${pendingSuppression.suppression.scope}`,
                pendingSuppression.suppression.ruleId
                  ? `rule: ${pendingSuppression.suppression.ruleId}`
                  : "",
                pendingSuppression.suppression.file
                  ? `file: ${pendingSuppression.suppression.file}`
                  : "",
                pendingSuppression.suppression.note
                  ? `note: ${pendingSuppression.suppression.note}`
                  : "",
                `affected findings: ${pendingSuppression.affectedFindings}`,
                `affected skills: ${pendingSuppression.affectedSkills.join(", ") || "none"}`,
                ...pendingSuppression.findingSamples.map((sample) => `sample: ${sample}`),
              ].filter(Boolean)
            : []
        }
        tone="warning"
        onCancel={() => setPendingSuppression(null)}
        onConfirm={() => void handleConfirmSuppression()}
      />
    </div>
  )
}

function SkillSourceList({ skillsState }: { skillsState: AgentSkillsState }) {
  const sourceRows = [
    ...skillsState.sources.workspaceDirs.map((path) => ({
      label: "Workspace",
      path,
      icon: <Wand2 size={12} />,
    })),
    ...skillsState.sources.extraDirs.map((path) => ({
      label: "Extra",
      path,
      icon: <Sparkles size={12} />,
    })),
    ...skillsState.sources.userDirs.map((path) => ({
      label: "User",
      path,
      icon: <Slash size={12} />,
    })),
    ...(skillsState.sources.bundledDir
      ? [
          {
            label: "Bundled",
            path: skillsState.sources.bundledDir,
            icon: <Sparkles size={12} />,
          },
        ]
      : []),
  ]

  return (
    <div className="flex flex-col gap-2">
      {sourceRows.length === 0 ? (
        <div className="rounded border border-dashed border-[var(--vscode-panel-border)] px-3 py-3 text-xs text-description">
          No skill source directories configured.
        </div>
      ) : (
        sourceRows.map((row) => (
          <div
            key={`${row.label}-${row.path}`}
            className="rounded border border-[var(--vscode-panel-border)] px-3 py-2"
          >
            <div className="flex items-center gap-2 text-xs font-medium">
              {row.icon}
              <span>{row.label}</span>
            </div>
            <div className="mt-1 break-all font-mono text-xs text-description">{row.path}</div>
          </div>
        ))
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="font-medium text-foreground">{label}</span>
      <div className="mt-1 break-all font-mono">{value}</div>
    </div>
  )
}

function getSkillStatus(skill: AgentSkillSummary): {
  label: string
  tone: "success" | "warning" | "danger" | "neutral"
} {
  if (!skill.enabled) {
    return { label: "Disabled", tone: "neutral" }
  }
  if (skill.effectiveEnabled) {
    return { label: "Ready", tone: "success" }
  }
  return { label: "Blocked", tone: "warning" }
}

function formatMissingRequirements(skill: AgentSkillSummary): string {
  const parts = [
    ...skill.missing.os.map((value) => `os:${value}`),
    ...skill.missing.bins.map((value) => `bin:${value}`),
    ...(skill.missing.anyBins.length > 0 ? [`anyBin:${skill.missing.anyBins.join(",")}`] : []),
    ...skill.missing.env.map((value) => `env:${value}`),
    ...skill.missing.config.map((value) => `config:${value}`),
  ]

  return parts.length > 0 ? parts.join(" | ") : "—"
}

function canAttemptInstall(skill: AgentSkillSummary): boolean {
  if (!skill.enabled || skill.effectiveEnabled || skill.blockedByAllowlist) {
    return false
  }
  if (skill.installers.length === 0) {
    return false
  }
  return skill.missing.bins.length > 0 || skill.missing.anyBins.length > 0
}

function matchesSkillView(skill: AgentSkillSummary, activeView: string): boolean {
  switch (activeView) {
    case "ready":
      return skill.effectiveEnabled
    case "missing":
      return skill.enabled && !skill.effectiveEnabled && !skill.blockedByAllowlist
    case "allowlist":
      return skill.blockedByAllowlist
    case "disabled":
      return !skill.enabled
    case "security":
      return skill.security.critical > 0 || skill.security.warn > 0 || skill.security.status === "error"
    default:
      return true
  }
}

function formatTopIssues(report: AgentSkillsDiagnosticReport): string {
  return report.topIssues.length > 0
    ? report.topIssues.map((issue) => `${issue.label} (${issue.count})`).join(" | ")
    : "No repeated blockers"
}

function buildCheckReportFromOverview(overview: AgentSkillsOverview): AgentSkillsCheckReport {
  const { state, diagnostics } = overview
  return {
    generatedAt: diagnostics.generatedAt,
    diagnostics,
    sections: {
      ready: state.skills.filter((skill) => diagnostics.buckets.ready.includes(skill.id)),
      missing: state.skills.filter((skill) => diagnostics.buckets.missing.includes(skill.id)),
      allowlistBlocked: state.skills.filter((skill) =>
        diagnostics.buckets.allowlistBlocked.includes(skill.id),
      ),
      disabled: state.skills.filter((skill) => diagnostics.buckets.disabled.includes(skill.id)),
      installableFixes: state.skills.filter((skill) =>
        diagnostics.buckets.installableFixes.includes(skill.id),
      ),
      securityFlagged: state.skills.filter((skill) =>
        diagnostics.buckets.securityFlagged.includes(skill.id),
      ),
    },
  }
}

function suppressionKeyForUi(suppression: AgentSkillSuppression): string {
  return `${suppression.scope}::${suppression.ruleId ?? ""}::${suppression.file ?? ""}`
}

function computeSuppressionImpact(
  skills: AgentSkillSummary[],
  suppression: AgentSkillSuppression,
): { findings: number; skills: string[]; samples: string[] } {
  let findings = 0
  const affectedSkills = new Set<string>()
  const samples: string[] = []

  for (const skill of skills) {
    const matches = skill.security.findings.filter((finding) => {
      if (suppression.scope === "rule") {
        return finding.ruleId === suppression.ruleId
      }
      if (suppression.scope === "file") {
        return finding.file === suppression.file
      }
      return finding.ruleId === suppression.ruleId && finding.file === suppression.file
    })
    if (matches.length > 0) {
      findings += matches.length
      affectedSkills.add(skill.id)
      for (const finding of matches) {
        if (samples.length >= 5) {
          break
        }
        samples.push(`${skill.id}: ${finding.severity}:${finding.ruleId} ${finding.message}`)
      }
    }
  }

  return {
    findings,
    skills: Array.from(affectedSkills).sort(),
    samples,
  }
}

function DiagnosticStat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: "success" | "warning" | "neutral"
}) {
  const toneClassName =
    tone === "success"
      ? "border-success/30 bg-[color-mix(in_srgb,var(--vscode-editor-background)_94%,green_6%)]"
      : tone === "warning"
        ? "border-[color-mix(in_srgb,var(--vscode-warningForeground)_24%,transparent)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_88%,yellow_12%)]"
        : "border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_95%,black_5%)]"

  return (
    <div className={`rounded border px-3 py-3 ${toneClassName}`}>
      <div className="text-[11px] uppercase tracking-[0.08em] text-description">{label}</div>
      <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
    </div>
  )
}
