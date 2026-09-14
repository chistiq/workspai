## Agent framework version admission

Use this template when a human opens a pin-update pull request after reviewing
weekly discovery output. The scheduled discovery workflow is report-only: it
does not commit, open a pull request, regenerate Create contracts, or admit a
baseline.

The versions in this pull request are candidates, not admitted releases. Merge
remains blocked until the complete Workspai agent-framework conformance matrix
passes on Linux, macOS, and Windows for every supported runtime.

The matrix verifies contracts, detection, managed-file safety, bounded Workspai
context, dependency resolution, compilation, a credentialless agent lifecycle,
failure isolation, and deterministic rendering.

No model-provider credential is used, and this pull request never merges
automatically.
