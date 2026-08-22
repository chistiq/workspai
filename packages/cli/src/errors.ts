/**
 * Custom error classes for rapidkit
 */

function pythonInstallationGuidance(requiredVersion: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return (
      `Install Python ${requiredVersion}+ with Windows Package Manager:\n` +
      `  winget install --exact --id Python.Python.${requiredVersion}\n\n` +
      `Or use the official installer and enable "Add Python to PATH":\n` +
      `  https://www.python.org/downloads/windows/`
    );
  }
  if (platform === 'darwin') {
    return (
      `Install Python ${requiredVersion}+ with Homebrew:\n` +
      `  brew install python@${requiredVersion}\n\n` +
      `Official installers:\n` +
      `  https://www.python.org/downloads/macos/`
    );
  }
  return (
    `Install Python and its environment tooling for your Linux distribution:\n` +
    `  Debian/Ubuntu: sudo apt update && sudo apt install python3 python3-venv python3-pip\n` +
    `  Fedora/RHEL:   sudo dnf install python3 python3-pip\n` +
    `  Arch:          sudo pacman -S python python-pip\n` +
    `  Alpine:        sudo apk add python3 py3-pip py3-virtualenv\n\n` +
    `Official installers:\n` +
    `  https://www.python.org/downloads/`
  );
}

function poetryInstallationGuidance(platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return (
      `Option 1 - install Poetry with pipx:\n` +
      `  py -m pip install --user pipx\n` +
      `  py -m pipx ensurepath\n` +
      `  py -m pipx install poetry\n\n` +
      `Option 2 - use the official Poetry installer in PowerShell:\n` +
      `  (Invoke-WebRequest -Uri https://install.python-poetry.org -UseBasicParsing).Content | py -\n\n` +
      `Official installation guide:\n` +
      `  https://python-poetry.org/docs/#installation`
    );
  }
  if (platform === 'darwin') {
    return (
      `Option 1 - install Poetry with Homebrew:\n` +
      `  brew install poetry\n\n` +
      `Option 2 - install Poetry with pipx:\n` +
      `  brew install pipx\n` +
      `  pipx ensurepath\n` +
      `  pipx install poetry\n\n` +
      `Official installation guide:\n` +
      `  https://python-poetry.org/docs/#installation`
    );
  }
  return (
    `Option 1 - install Poetry with pipx:\n` +
    `  Debian/Ubuntu: sudo apt update && sudo apt install pipx\n` +
    `  Fedora/RHEL:   sudo dnf install pipx\n` +
    `  Arch:          sudo pacman -S python-pipx\n` +
    `  Alpine:        sudo apk add pipx\n` +
    `  Then run:      pipx ensurepath\n` +
    `  pipx install poetry\n\n` +
    `Option 2 - use the official Poetry installer:\n` +
    `  curl -sSL https://install.python-poetry.org | python3 -\n\n` +
    `Official installation guide:\n` +
    `  https://python-poetry.org/docs/#installation`
  );
}

function pipxInstallationGuidance(platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return (
      `Install pipx:\n` +
      `  py -m pip install --user pipx\n` +
      `  py -m pipx ensurepath\n\n` +
      `Official installation guide:\n` +
      `  https://pipx.pypa.io/stable/installation/`
    );
  }
  if (platform === 'darwin') {
    return (
      `Install pipx with Homebrew:\n` +
      `  brew install pipx\n` +
      `  pipx ensurepath\n\n` +
      `Official installation guide:\n` +
      `  https://pipx.pypa.io/stable/installation/`
    );
  }
  return (
    `Install pipx for your Linux distribution:\n` +
    `  Debian/Ubuntu: sudo apt update && sudo apt install pipx\n` +
    `  Fedora/RHEL:   sudo dnf install pipx\n` +
    `  Arch:          sudo pacman -S python-pipx\n` +
    `  Alpine:        sudo apk add pipx\n` +
    `  Then run:      pipx ensurepath\n\n` +
    `Official installation guide:\n` +
    `  https://pipx.pypa.io/stable/installation/`
  );
}

function venvInstallationGuidance(packageName: string, platform: NodeJS.Platform): string {
  const requestedVersion = packageName.match(/(\d+\.\d+)/)?.[1] || '3.13';
  if (platform === 'win32') {
    return (
      `Repair or reinstall Python and ensure pip is selected:\n` +
      `  winget install --exact --id Python.Python.${requestedVersion}\n\n` +
      `Then verify:\n` +
      `  py -m venv --help`
    );
  }
  if (platform === 'darwin') {
    return (
      `Reinstall the Homebrew Python runtime:\n` +
      `  brew reinstall python\n\n` +
      `Then verify:\n` +
      `  python3 -m venv --help`
    );
  }
  return (
    `Install virtual-environment support for your Linux distribution:\n` +
    `  Debian/Ubuntu: sudo apt update && sudo apt install ${packageName}\n` +
    `  Fedora/RHEL:   sudo dnf install python3 python3-pip\n` +
    `  Arch:          sudo pacman -S python python-pip\n` +
    `  Alpine:        sudo apk add python3 py3-pip py3-virtualenv\n\n` +
    `Then verify:\n` +
    `  python3 -m venv --help`
  );
}

export class RapidKitError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: string
  ) {
    super(message);
    this.name = 'RapidKitError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class PythonNotFoundError extends RapidKitError {
  constructor(
    requiredVersion: string,
    foundVersion?: string,
    platform: NodeJS.Platform = process.platform
  ) {
    const message = foundVersion
      ? `Python ${requiredVersion}+ required, found ${foundVersion}`
      : `Python ${requiredVersion}+ not found`;
    super(message, 'PYTHON_NOT_FOUND', pythonInstallationGuidance(requiredVersion, platform));
  }
}

export class PoetryNotFoundError extends RapidKitError {
  constructor(platform: NodeJS.Platform = process.platform) {
    super('Poetry is not installed', 'POETRY_NOT_FOUND', poetryInstallationGuidance(platform));
  }
}

export class PipxNotFoundError extends RapidKitError {
  constructor(platform: NodeJS.Platform = process.platform) {
    super('pipx is not installed', 'PIPX_NOT_FOUND', pipxInstallationGuidance(platform));
  }
}

export class DirectoryExistsError extends RapidKitError {
  constructor(dirName: string) {
    super(
      `Directory "${dirName}" already exists`,
      'DIRECTORY_EXISTS',
      'Please choose a different name or remove the existing directory'
    );
  }
}

export class InvalidProjectNameError extends RapidKitError {
  constructor(name: string, reason: string) {
    super(`Invalid project name: "${name}"`, 'INVALID_PROJECT_NAME', reason);
  }
}

export class InstallationError extends RapidKitError {
  constructor(step: string, originalError: Error) {
    const message = `Installation failed at: ${step}`;
    const details = `${originalError.message}\n\nTroubleshooting:\n- Check your internet connection\n- Verify Python/Poetry installation\n- Try running with --debug flag for more details`;
    super(message, 'INSTALLATION_ERROR', details);
  }
}

export class PythonVenvUnavailableError extends RapidKitError {
  constructor(
    packageName: string,
    workspaceName: string,
    platform: NodeJS.Platform = process.platform
  ) {
    super(
      'Python virtual environment support is not installed',
      'PYTHON_VENV_UNAVAILABLE',
      `${venvInstallationGuidance(packageName, platform)}\n\n` +
        `Or create the workspace without the optional Python engine:\n` +
        `  npx workspai create workspace ${workspaceName} --skip-python-engine`
    );
  }
}

export class PythonPipUnavailableError extends RapidKitError {
  constructor(platform: NodeJS.Platform = process.platform) {
    super(
      'Python package installation support is not available',
      'PYTHON_PIP_UNAVAILABLE',
      `pipx cannot be installed through the selected Python because pip is unavailable.\n\n` +
        pipxInstallationGuidance(platform) +
        `\n\nAlternatively, restore pip and retry:\n` +
        (platform === 'win32'
          ? `  py -m ensurepip --upgrade`
          : platform === 'darwin'
            ? `  brew reinstall python`
            : `  Debian/Ubuntu: sudo apt install python3-pip\n` +
              `  Fedora/RHEL:   sudo dnf install python3-pip\n` +
              `  Arch:          sudo pacman -S python-pip\n` +
              `  Alpine:        sudo apk add py3-pip`)
    );
  }
}

export class RapidKitNotAvailableError extends RapidKitError {
  constructor() {
    super(
      'RapidKit Python package is not yet available on PyPI',
      'RAPIDKIT_NOT_AVAILABLE',
      'Available options:\n  1. Install Python 3.10+ and retry the same command\n  2. Use the core workflow: npx workspai create workspace <name>\n  3. Offline fallback (limited): npx workspai create project fastapi.standard <name> --output .\n\nLegacy: set RAPIDKIT_SHOW_LEGACY=1 to reveal template-mode flags in help.'
    );
  }
}

export class NetworkError extends RapidKitError {
  constructor(operation: string, originalError?: Error) {
    super(
      `Network error during ${operation}`,
      'NETWORK_ERROR',
      `Failed to complete network operation.\n${originalError?.message || ''}\n\nPlease check:\n- Internet connection\n- Firewall settings\n- Proxy configuration`
    );
  }
}

export class FileSystemError extends RapidKitError {
  constructor(operation: string, path: string, originalError?: Error) {
    super(
      `File system error: ${operation}`,
      'FILESYSTEM_ERROR',
      `Failed to ${operation} at: ${path}\n${originalError?.message || ''}\n\nPlease check:\n- File/directory permissions\n- Available disk space\n- Path validity`
    );
  }
}
