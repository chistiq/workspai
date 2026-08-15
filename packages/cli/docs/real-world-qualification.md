# Real-world qualification

Workspai's deterministic unit, contract, integration, and adversarial suites
remain the release gates. Real-world qualification complements them by running
the installed CLI against explicitly selected, linked reference repositories
without installing dependencies or executing project lifecycle commands.

## Isolated and cumulative layouts

Use one isolated workspace per repository when diagnosing detection, adoption,
Doctor, model, graph, context, contract, and readiness behavior:

```bash
REFERENCE_ROOT=/path/to/reference-repositories
QUALIFICATION_ROOT=/path/to/qualification-output
npm run test:real-world -- \
  --reference-root "$REFERENCE_ROOT" \
  --run-root "$QUALIFICATION_ROOT" \
  --projects vscode,grpc,deno \
  --report "$QUALIFICATION_ROOT/isolated.json"
```

Use `--shared-workspace` to adopt the repositories cumulatively into one fresh
workspace. Every addition reruns the canonical chain, so transition and scale
failures are observable rather than hidden behind the final state:

```bash
REFERENCE_ROOT=/path/to/reference-repositories
QUALIFICATION_ROOT=/path/to/qualification-output
npm run test:real-world -- \
  --reference-root "$REFERENCE_ROOT" \
  --run-root "$QUALIFICATION_ROOT" \
  --shared-workspace enterprise-polyglot \
  --projects vscode,grpc,deno,copilot-sdk \
  --report "$QUALIFICATION_ROOT/shared.json"
```

After the shared workspace qualifies, exercise bounded queries, full graph
exports, diff/impact/verify/trace, agent dry runs, portable archives, snapshots,
and destructive-operation dry runs:

```bash
QUALIFICATION_ROOT=/path/to/qualification-output
npm run test:real-world:enterprise -- \
  --workspace "$QUALIFICATION_ROOT/enterprise-polyglot" \
  --report "$QUALIFICATION_ROOT/enterprise-command-surface.json"
```

## Safety and interpretation

- Reference repositories are linked; source is never moved or copied.
- `--reference-root` is mandatory. The harness has no developer-machine default.
- Qualification reports are publication-safe by construction: project names are
  anonymized, absolute paths and command arguments are omitted, and raw command
  output is never retained. Report writing fails closed if a local path or a
  forbidden raw-output field reaches the payload.
- Enterprise command artifacts (graphs, archives, exports, and snapshots) are
  operational test material and remain local-only. Publish only the sanitized
  qualification JSON report, never its adjacent artifact directory.
- Dependency installation, project build/test/start/init, infrastructure
  mutation, publication, and model network calls are not permitted.
- Agent customization and destructive project operations are dry-run only.
- Exit codes `1` and `2` may be valid domain outcomes when their documented JSON
  contracts parse successfully; unexpected process, timeout, buffer, or schema
  failures fail qualification.
- A real repository warning remains evidence, not a CLI defect. Fix the CLI only
  when detection, classification, contract, portability, or command semantics
  are wrong.
- Full graphs belong in `--output` artifacts. Agents and IDEs consume bounded
  `search`, `entities`, `evidence`, and `path` results.

These suites are explicit and opt-in because they require local reference
repositories. They do not replace cross-platform CI fixtures or release gates.
