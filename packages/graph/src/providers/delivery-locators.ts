import { basenameOf } from './provider-support.js';

const COMPOSE = /(?:^|\/)(?:docker-)?compose(?:\.[^/]+)?\.ya?ml$/iu;
const OPENAPI_NAME = /^(?:openapi|swagger|asyncapi)(?:\.[^.]+)?\.(?:json|ya?ml)$/iu;
const OPENAPI_PATH = /(?:^|\/)(?:openapi|swagger|asyncapi)(?:\/|$)/iu;
const GRAPHQL = /\.(?:graphql|gql)$/iu;
const PYTHON_MANIFEST = /(?:^|\/)pyproject\.toml$/iu;
const PACKAGE_JSON = /(?:^|\/)package\.json$/iu;
const ADR_PATH = /(?:^|\/)(?:adr|adrs|decisions)\/.+\.md$/iu;
const ADR_NAME = /(?:^|\/)ADR[-_0-9].+\.md$/iu;
const LOCK_YAML =
  /(?:^|\/)(?:pnpm-lock|pnpm-workspace|yarn\.lock|composer\.lock|.*\.lock)\.ya?ml$/iu;
const IAC_DOCKER = /^Dockerfile(?:\..+)?$/iu;
const IAC_TERRAFORM = /\.tf$/iu;
const IAC_HELM = /^Chart\.ya?ml$/iu;

export function isComposeLocator(locator: string): boolean {
  return COMPOSE.test(locator);
}

export function isOpenApiLocator(locator: string): boolean {
  const name = basenameOf(locator);
  return (
    OPENAPI_NAME.test(name) || (OPENAPI_PATH.test(locator) && /\.(?:json|ya?ml)$/iu.test(name))
  );
}

export function isGraphqlLocator(locator: string): boolean {
  return GRAPHQL.test(locator);
}

export function isPythonProjectManifestLocator(locator: string): boolean {
  return PYTHON_MANIFEST.test(locator);
}

export function isPackageJsonLocator(locator: string): boolean {
  return PACKAGE_JSON.test(locator);
}

export function isArchitectureDecisionLocator(locator: string): boolean {
  return ADR_PATH.test(locator) || ADR_NAME.test(locator);
}

export function isCiWorkflowLocator(locator: string): boolean {
  const name = basenameOf(locator);
  return (
    /(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$/iu.test(locator) ||
    /(?:^|\/)\.circleci\/[^/]+\.ya?ml$/iu.test(locator) ||
    /(?:^|\/)\.buildkite\/[^/]+\.ya?ml$/iu.test(locator) ||
    /(?:^|\/)\.tekton\/[^/]+\.ya?ml$/iu.test(locator) ||
    /(?:^|\/)prow\/[^/]+\.(?:sh|py)$/iu.test(locator) ||
    /^(?:\.gitlab-ci\.ya?ml|azure-pipelines\.ya?ml|Jenkinsfile|bitbucket-pipelines\.ya?ml|\.woodpecker\.ya?ml|\.drone\.ya?ml|\.travis\.ya?ml|appveyor\.ya?ml|circle\.yml)$/iu.test(
      name
    )
  );
}

export function isInfrastructureLocator(locator: string): boolean {
  const name = basenameOf(locator);
  if (/(?:^|\/)\.devcontainer(?:\/|$)/iu.test(locator)) return false;
  return IAC_DOCKER.test(name) || IAC_TERRAFORM.test(name) || IAC_HELM.test(name);
}

export function isKubernetesLocator(locator: string): boolean {
  if (!/\.ya?ml$/iu.test(locator)) return false;
  if (isComposeLocator(locator) || isCiWorkflowLocator(locator) || LOCK_YAML.test(locator)) {
    return false;
  }
  return !isOpenApiLocator(locator) && !isInfrastructureLocator(locator);
}
