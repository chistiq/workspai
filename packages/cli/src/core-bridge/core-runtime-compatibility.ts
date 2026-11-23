import coreModuleCatalog from '../ai/core-module-catalog.v1.json';

export const RAPIDKIT_CORE_VERSION = coreModuleCatalog.coreVersion;
export const RAPIDKIT_CORE_PACKAGE = `rapidkit-core==${RAPIDKIT_CORE_VERSION}`;
export function coreInstallTarget(): string {
  return process.env.RAPIDKIT_CORE_PYTHON_PACKAGE?.trim() || RAPIDKIT_CORE_PACKAGE;
}
export const RAPIDKIT_CORE_REQUIRES_PYTHON = coreModuleCatalog.requiresPython;
export const RAPIDKIT_CORE_MINIMUM_PYTHON = coreModuleCatalog.minimumPython;
export const RAPIDKIT_CORE_MINIMUM_PYTHON_MINOR = Number(
  RAPIDKIT_CORE_MINIMUM_PYTHON.split('.')[1]
);
