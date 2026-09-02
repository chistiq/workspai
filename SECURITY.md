# Security Policy

## Supported Versions

Workspai is currently in the `0.x` release phase. Security fixes are provided
for the latest patch of the latest published minor line.

| Version                         | Supported |
| ------------------------------- | --------- |
| Latest `0.72.x` patch           | Yes       |
| Earlier `0.x` minor and patches | No        |

Upgrade to the latest published version before reporting a problem that may
already be fixed. The current version is available from the
[npm package](https://www.npmjs.com/package/workspai) and the
[release history](packages/cli/CHANGELOG.md).

## Report a Vulnerability Privately

Do not open a public issue, discussion, or pull request for a suspected
vulnerability. Use one of these private channels:

- [Open a private GitHub security advisory](https://github.com/chistiq/workspai/security/advisories/new) (preferred).
- Email [security@workspai.dev](mailto:security@workspai.dev).

Include the affected version, environment, impact, reproduction steps or a
minimal proof of concept, and any suggested remediation. Remove secrets and
personal data from the report.

We aim to acknowledge reports within two business days, provide an initial
assessment within seven calendar days, and send an update at least every seven
days while remediation is active. Resolution and disclosure timing depend on
severity, exploitability, and release coordination. We will tell you if a
report is accepted, requires more information, or is out of scope.

## Coordinated Disclosure and Safe Research

Please allow us reasonable time to investigate and publish a fix before public
disclosure. When testing, act in good faith, use accounts and data you own or
are authorized to access, avoid privacy violations and service disruption, and
stop if testing could damage data or systems.

We will not pursue action against good-faith research that follows this policy.
This policy does not authorize testing of third-party services or data.

## Security Expectations for Users

- Install official releases and keep Workspai and generated dependencies up to
  date.
- Review generated source and configuration before deployment.
- Treat executable configuration as code and use `--trust-config` only after
  reviewing the referenced JavaScript configuration.
- Use `--allow-private-network` only for an explicitly trusted remote archive.
- Protect workspace evidence, reports, credentials, and CI artifacts according
  to their data sensitivity.

Workspai uses dependency auditing, static analysis, dependency review, SBOM
generation, automated dependency updates, and release validation as defense in
depth. Passing these controls is not a guarantee that a release is free of
vulnerabilities.
