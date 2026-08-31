## Thank you for contributing to Workspai

Please make sure:

- [ ] The related issue is linked (if applicable)
- [ ] Repository validation passes locally (`npm run validate`)
- [ ] Documentation validation passes for doc changes (`npm --workspace workspai run validate:docs`)
- [ ] Contract validation passes for contract changes (`npm --workspace workspai run contracts:validate`)
- [ ] Documentation was updated when behavior changed
- [ ] Changes are focused and backward-compatible (or clearly documented)

Generate the file-aware validation plan with `corepack npm run contributor:plan`.

### What changed

Describe your change in 2-5 bullets.

### Why this change

Describe the motivation/problem being solved.

### Validation

List commands/tests you ran and their result.

### Checklist (maintainer-friendly)

- [ ] No unrelated refactors
- [ ] No sensitive data introduced
- [ ] Release notes/changelog updated (if needed)

See the [contribution guide](../packages/cli/CONTRIBUTING.md) for the complete
workflow.
