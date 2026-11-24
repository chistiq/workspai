## Agent framework version admission

Review the weekly discovery artifacts `report.json` and `proposed.json`.
The discovery workflow publishes evidence for review.

1. Commit the reviewed proposal as `packages/cli/releases/AGENT_FRAMEWORK_CANDIDATES_v<CLI-version>.json`
   and merge it into `main`. Record the Microsoft Python floor as `minimumPython`
   if the selected SDK changed its requirement.
2. Select `main` and `full` in the Agent Framework Adapter Matrix, or wait for
   the weekly run on Mondays at 08:43 UTC. The matrix uses the selected run's
   commit and proposal in each of the Linux, macOS, and Windows jobs.
3. After all lanes and the bundled kit-selection checks pass, download
   `release-admission.patch` from `agent-framework-admission-candidate-<SHA>`.
   Verify that the run's SHA is the commit being qualified. From the repository
   root, run `git apply --check /path/to/release-admission.patch`, then apply and
   commit the patch to record both the qualified baseline and its receipt.

The workflow uses read-only repository permissions and runs without
model-provider credentials.
