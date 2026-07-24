# wspai

`wspai` is the short npm command for the complete Workspai CLI. It delegates to
the canonical [`workspai`](https://www.npmjs.com/package/workspai) package, so
both commands expose the same Workspace Intelligence features and contracts.

```bash
npx wspai --help
npx wspai create workspace my-workspace --profile enterprise --yes
cd my-workspace
npx wspai workspace intelligence run --for-agent codex --json
```

## Which package should I use?

- Use `workspai` in documentation, automation, CI, and long-lived scripts. It is
  the canonical package and command name.
- Use `wspai` when you prefer a shorter interactive command.

Installing the alias also installs the exact matching `workspai` version. The
alias does not maintain a separate runtime, configuration format, artifact
layout, or command surface.

```bash
npm install -g wspai@0.48.0
wspai --version
```

The canonical package remains available directly:

```bash
npm install -g workspai@0.48.0
workspai --help
```

Workspace state and generated evidence use the canonical `.workspai`
directory regardless of which command spelling you choose.

## Documentation

- [Workspai CLI overview](https://github.com/chistiq/workspai/blob/main/packages/cli/README.md)
- [Task-oriented documentation](https://github.com/chistiq/workspai/blob/main/packages/cli/docs/README.md)
- [Command reference](https://github.com/chistiq/workspai/blob/main/packages/cli/docs/commands-reference.md)
- [Workspace Intelligence contracts](https://github.com/chistiq/workspai/tree/main/packages/cli/contracts)

Issues and contributions belong in the
[Workspai repository](https://github.com/chistiq/workspai/issues).
