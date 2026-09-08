## Agent framework version admission

This automated pull request proposes versions discovered from the official package registries.

The versions are candidates, not admitted releases. Merge remains blocked until the complete Workspai agent-framework conformance matrix passes on Linux, macOS, and Windows for every supported runtime.

The matrix verifies contracts, detection, managed-file safety, bounded Workspai context, dependency resolution, compilation, a credentialless agent lifecycle, failure isolation, and deterministic rendering.

No model-provider credential is used, and this pull request never merges automatically.
