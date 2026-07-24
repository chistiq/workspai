# RapidKit v0.37.0 Release Notes

**Release Date:** June 17, 2026

## Overview

This is a comprehensive feature release that introduces CLI observability infrastructure, governance artifacts, workspace management utilities, and enhanced UI components. It provides the foundation for enterprise-grade workspace management with structured logging, contract-based governance, and improved user interaction patterns.

## Major Features

### 🎯 CLI Observability Infrastructure

**New Module:** `src/observability/`

- **`cli-log-event.ts`** — Standardized log event capture and structured logging.
- **`cli-log-format.ts`** — Consistent CLI output formatting across all commands.
- **`cli-progress.ts`** — Progress indicators and status updates for long-running operations.
- **`cli-run-context.ts`** — Runtime context tracking for observability and debugging.
- **Schema Contract:** `contracts/cli-log-event.v1.json` for validated log event structure.

Benefits:
- Structured, machine-readable CLI events for observability platforms.
- Consistent formatting and status reporting across all commands.
- Better debugging and traceability for CI/CD pipelines.

### 🎨 CLI UI Components

**New Module:** `src/cli-ui/`

- **`brand.ts`** — Centralized brand and version information.
- **`kit-picker-choices.ts`** — Enhanced kit selection UI with improved visual choices.
- **`messages.ts`** — Centralized CLI messages, prompts, and help text.
- **`prompts.ts`** — Interactive prompt utilities and helpers.
- **`spinner.ts`** — Loading spinners and progress indicators.
- **`theme.ts`** — Color schemes and formatting themes.

Benefits:
- Consistent UX across all interactive prompts.
- Centralized brand and messaging management.
- Improved visual feedback for long operations.

### 🏛️ Workspace Governance & Registry

**New Utilities:** `src/utils/`

- **`workspace-registry-summary.ts`** — Registry project enumeration and summarization.
- **`governance-report-metadata.ts`** — Governance artifact metadata extraction and formatting.
- **`managed-agent-markers.ts`** — Managed agent identification and lifecycle tracking.

**New Contracts:**
- `contracts/workspace-registry.v1.json` — Registry structure and validation schema.
- `contracts/release-readiness.v1.json` — Release readiness criteria and gates.
- `contracts/analyze-last-run.v1.json` — Analyze command evidence schema.
- `contracts/doctor-project-evidence.v1.json` — Project health evidence structure.
- `contracts/doctor-workspace-evidence.v1.json` — Workspace health evidence structure.
- `contracts/workspace-run-last.v1.json` — Workspace run execution evidence schema.

Benefits:
- Standardized governance artifact structures across all commands.
- Machine-readable evidence for dashboard and CI/CD tools.
- Managed agent lifecycle tracking and synchronization.

### 🤖 Workspace Agent Synchronization

**New Commands & Utilities:**

- **`src/workspace-agent-sync.ts`** — Workspace synchronization with managed agents.
- **`src/utils/workspace-create-location.ts`** — Intelligent workspace creation location resolver.
- **`src/utils/workspace-onboarding.ts`** — Workspace onboarding workflow utilities.
- **`src/utils/workspace-run-evidence.ts`** — Workspace run evidence collection and reporting.

Benefits:
- Seamless synchronization between CLI and managed agents.
- Intelligent workspace placement based on context.
- Enhanced workspace onboarding experience.
- Comprehensive evidence collection for workspace runs.

### 📚 Documentation & Examples

**New Documentation:**

- **`docs/contracts/ARTIFACT_CATALOG.md`** — Complete catalog of all contract schemas with descriptions.
- **`docs/examples/ci-agent-grounding.yml`** — Real-world CI/CD examples for agent integration.
- **Enhanced `docs/ci-workflows.md`** — Added agent integration workflows.
- **Enhanced `docs/commands-reference.md`** — Updated with new commands and flags.
- **Enhanced `docs/contracts/README.md`** — References to artifact catalog and examples.

### ✅ Comprehensive Test Coverage

**New Test Files:**

- `src/__tests__/cli-observability.test.ts` — CLI logging and observability infrastructure.
- `src/__tests__/cli-prompts.test.ts` — Interactive prompt functionality.
- `src/__tests__/contracts/governance-artifact-schemas.test.ts` — Governance schema validation.
- `src/__tests__/contracts/release-readiness-schema.test.ts` — Release readiness contract validation.
- `src/__tests__/governance-report-metadata.test.ts` — Governance metadata extraction.
- `src/__tests__/kit-picker-choices.test.ts` — Kit picker UI component tests.
- `src/__tests__/workspace-agent-sync.test.ts` — Agent synchronization functionality.
- `src/__tests__/workspace-create-location.test.ts` — Location resolution logic.
- `src/__tests__/workspace-create-registry.integration.test.ts` — Registry creation integration.
- `src/__tests__/workspace-registry-summary.test.ts` — Registry summarization.
- `src/__tests__/workspace-run-evidence.test.ts` — Evidence collection and reporting.

## Enhancements

### Command Improvements

- **`rapidkit ai`** — Enhanced type safety and module selection logic.
- **`rapidkit config`** — Added governance and lifecycle support.
- **`rapidkit create`** — Improved with location awareness and registry integration.
- **`rapidkit doctor`** — Comprehensive workspace and project evidence collection.
- **`rapidkit analyze`** — Enhanced readiness checks and governance signals.
- **`rapidkit readiness`** — Improved release-readiness evaluation.
- **`rapidkit autopilot release`** — Governance-aware release candidate evaluation.
- **`rapidkit workspace`** — Enhanced context, intelligence, run, and verify subcommands.
- **`rapidkit pipeline`** — Updated with governance gates.

### Infrastructure Improvements

- Better structured logging throughout the CLI.
- Consistent UI/UX with brand and theme management.
- Improved workspace intelligence with governance signals.
- Enhanced registry integration across all workspace operations.

## Code Quality

### TypeScript

- ✅ Zero TypeScript compilation errors
- ✅ Improved type safety with proper type assertions
- ✅ Enhanced type inference across modules

### Testing

- ✅ Full test suite passes
- ✅ 11 new test files added
- ✅ Enhanced coverage for new features
- ✅ Contract schema validation tests

### Quality Checks

- ✅ `npm run typecheck` — Zero errors
- ✅ `npm run lint` — All checks pass
- ✅ `npm run format:check` — Code formatting verified
- ✅ `npm run test` — Full suite passes
- ✅ `npm run size-check` — Bundle size within limits
- ✅ `npm run quality` — Complete pipeline passes

## Breaking Changes

⚠️ **None** — This is a backward-compatible feature release.

## Migration Guide

No migration steps required. This is a drop-in upgrade from v0.36.0.

**If you're using workspace registry features:**
- Registry summarization is now available via `workspace-registry-summary.ts`
- Agent sync can be triggered with new `workspace-agent-sync` command
- Release readiness is evaluated using new governance contracts

## Upgrade

```bash
npm install -g rapidkit@0.37.0
```

Or within a project:

```bash
npm install --save-dev rapidkit@0.37.0
```

## Compatibility

- **Node.js:** 18.x, 20.x, 22.x
- **Package Managers:** npm 9+, yarn 3+, pnpm 8+
- **Operating Systems:** Linux, macOS, Windows

## Known Issues

None at this time.

## Support & Feedback

- 📖 [RapidKit Documentation](https://github.com/chistiq/rapidkit-npm)
- 🐛 [GitHub Issues](https://github.com/chistiq/rapidkit-npm/issues)
- 💬 [RapidKit Community](https://github.com/chistiq/rapidkit-npm/discussions)
- 🎯 [Feature Requests](https://github.com/chistiq/rapidkit-npm/issues/new?labels=enhancement)

## Contributors

This release includes contributions from the RapidKit core team and community feedback.

## What's Next

Upcoming releases will focus on:
- Enhanced dashboard integration with governance artifacts
- Extended managed agent capabilities
- Performance optimizations for large workspaces
- Additional frontend framework support

