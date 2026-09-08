# Security Policy

The canonical Workspai security policy defines supported versions, private
reporting channels, response expectations, coordinated disclosure, and safe
research guidance:

[Read the canonical security policy](https://github.com/chistiq/workspai/security/policy)

Do not report a suspected vulnerability through a public issue, discussion, or
pull request. Use a
[private GitHub security advisory](https://github.com/chistiq/workspai/security/advisories/new)
or email [security@workspai.dev](mailto:security@workspai.dev).

## CLI Security Practices

When using Workspai:

1. Keep Workspai and generated dependencies updated.
2. Review generated source and configuration before deployment.
3. Install official releases from the npm registry.
4. Run the ecosystem-appropriate audit tools on generated projects.
5. Treat executable configuration as code. Prefer `workspai.config.json`; use
   `--trust-config` after reviewing JavaScript configuration.
6. Keep remote archives public-network-only. Private and loopback archive
   URLs are rejected unless `--allow-private-network` is explicitly supplied.
7. Keep mirror targets constrained. Artifact targets are restricted to the managed
   mirror directory and are committed only after integrity/policy verification.
