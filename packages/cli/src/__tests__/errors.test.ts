import { describe, it, expect } from 'vitest';
import {
  RapidKitError,
  PythonNotFoundError,
  PoetryNotFoundError,
  PipxNotFoundError,
  DirectoryExistsError,
  InvalidProjectNameError,
  InstallationError,
  PythonPipUnavailableError,
  PythonVenvUnavailableError,
  RapidKitNotAvailableError,
  NetworkError,
  FileSystemError,
} from '../errors.js';

describe('Error classes', () => {
  describe('RapidKitError', () => {
    it('should create RapidKitError with code and details', () => {
      const error = new RapidKitError('Test error', 'TEST_ERROR', 'Some details');
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.details).toBe('Some details');
      expect(error.name).toBe('RapidKitError');
      expect(error.stack).toBeDefined();
    });

    it('should create error without details', () => {
      const error = new RapidKitError('Test', 'CODE');
      expect(error.details).toBeUndefined();
    });

    it('should be instanceof Error', () => {
      const error = new RapidKitError('Test', 'CODE');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(RapidKitError);
    });
  });

  describe('PythonNotFoundError', () => {
    it('should create PythonNotFoundError with version', () => {
      const error = new PythonNotFoundError('3.10');
      expect(error.message).toContain('Python 3.10+');
      expect(error.code).toBe('PYTHON_NOT_FOUND');
      expect(error.details).toContain('python.org');
    });

    it('should create PythonNotFoundError with found version', () => {
      const error = new PythonNotFoundError('3.10', '3.9');
      expect(error.message).toContain('required');
      expect(error.message).toContain('found 3.9');
      expect(error.code).toBe('PYTHON_NOT_FOUND');
    });

    it('should be instance of RapidKitError', () => {
      const error = new PythonNotFoundError('3.10');
      expect(error).toBeInstanceOf(RapidKitError);
    });
  });

  describe('PoetryNotFoundError', () => {
    it('should create PoetryNotFoundError', () => {
      const error = new PoetryNotFoundError();
      expect(error.message).toContain('Poetry');
      expect(error.code).toBe('POETRY_NOT_FOUND');
      expect(error.details).toContain('python-poetry.org');
    });

    it('should have installation instructions', () => {
      const error = new PoetryNotFoundError();
      expect(error.details).toContain('https://');
    });

    it('provides Poetry-first platform installation paths', () => {
      expect(new PoetryNotFoundError('linux').details).toContain('pipx install poetry');
      expect(new PoetryNotFoundError('linux').details).toContain(
        'https://install.python-poetry.org'
      );
      expect(new PoetryNotFoundError('darwin').details).toContain('brew install poetry');
      expect(new PoetryNotFoundError('win32').details).toContain('py -m pipx install poetry');
    });
  });

  describe('PipxNotFoundError', () => {
    it('should create PipxNotFoundError', () => {
      const error = new PipxNotFoundError();
      expect(error.message).toContain('pipx');
      expect(error.code).toBe('PIPX_NOT_FOUND');
    });

    it('should have installation URL', () => {
      const error = new PipxNotFoundError();
      expect(error.details).toContain('pipx.pypa.io/stable/installation');
    });

    it('provides platform-specific installation commands', () => {
      expect(new PipxNotFoundError('linux').details).toContain('sudo apt install pipx');
      expect(new PipxNotFoundError('darwin').details).toContain('brew install pipx');
      expect(new PipxNotFoundError('win32').details).toContain('py -m pip install --user pipx');
    });
  });

  describe('DirectoryExistsError', () => {
    it('should create DirectoryExistsError', () => {
      const error = new DirectoryExistsError('my-project');
      expect(error.message).toContain('my-project');
      expect(error.code).toBe('DIRECTORY_EXISTS');
    });

    it('should include helpful details', () => {
      const error = new DirectoryExistsError('test');
      expect(error.details).toContain('different name');
    });
  });

  describe('InvalidProjectNameError', () => {
    it('should create InvalidProjectNameError', () => {
      const error = new InvalidProjectNameError('My-Project', 'Must be lowercase');
      expect(error.message).toContain('My-Project');
      expect(error.code).toBe('INVALID_PROJECT_NAME');
      expect(error.details).toBe('Must be lowercase');
    });

    it('should handle various invalid reasons', () => {
      const error = new InvalidProjectNameError('123test', 'Cannot start with number');
      expect(error.details).toBe('Cannot start with number');
    });
  });

  describe('InstallationError', () => {
    it('should create InstallationError', () => {
      const originalError = new Error('Connection timeout');
      const error = new InstallationError('Installing dependencies', originalError);
      expect(error.message).toContain('Installing dependencies');
      expect(error.code).toBe('INSTALLATION_ERROR');
      expect(error.details).toContain('Connection timeout');
      expect(error.details).toContain('Troubleshooting');
    });

    it('should include troubleshooting steps', () => {
      const error = new InstallationError('Test', new Error('Failed'));
      expect(error.details).toContain('internet connection');
      expect(error.details).toContain('--debug');
    });
  });

  describe('PythonVenvUnavailableError', () => {
    it('provides deterministic Linux recovery without generic network advice', () => {
      const error = new PythonVenvUnavailableError('python3.13-venv', 'my-workspace', 'linux');

      expect(error.code).toBe('PYTHON_VENV_UNAVAILABLE');
      expect(error.message).toContain('virtual environment support');
      expect(error.details).toContain('sudo apt install python3.13-venv');
      expect(error.details).toContain('--skip-python-engine');
      expect(error.details).not.toContain('internet connection');
    });

    it.each([
      ['linux', 'sudo apt install python3.13-venv', 'python3 -m venv --help'],
      ['darwin', 'brew reinstall python', 'python3 -m venv --help'],
      ['win32', 'winget install --exact --id Python.Python.3.13', 'py -m venv --help'],
    ] satisfies Array<[NodeJS.Platform, string, string]>)(
      'provides %s-specific recovery commands',
      (platform, installCommand, verifyCommand) => {
        const error = new PythonVenvUnavailableError('python3.13-venv', 'workspace', platform);

        expect(error.details).toContain(installCommand);
        expect(error.details).toContain(verifyCommand);
        expect(error.details).toContain('--skip-python-engine');
        expect(error.details).not.toContain('internet connection');
      }
    );
  });

  describe('PythonPipUnavailableError', () => {
    it.each([
      ['linux', 'sudo apt install pipx', 'sudo apt install python3-pip'],
      ['darwin', 'brew install pipx', 'brew reinstall python'],
      ['win32', 'py -m pip install --user pipx', 'py -m ensurepip --upgrade'],
    ] satisfies Array<[NodeJS.Platform, string, string]>)(
      'explains how to restore pip and install pipx on %s',
      (platform, pipxCommand, pipRecoveryCommand) => {
        const error = new PythonPipUnavailableError(platform);

        expect(error.code).toBe('PYTHON_PIP_UNAVAILABLE');
        expect(error.details).toContain(pipxCommand);
        expect(error.details).toContain(pipRecoveryCommand);
        expect(error.details).toContain('https://pipx.pypa.io/stable/installation/');
        expect(error.details).not.toContain('internet connection');
      }
    );
  });

  describe('RapidKitNotAvailableError', () => {
    it('should create RapidKitNotAvailableError', () => {
      const error = new RapidKitNotAvailableError();
      expect(error.message).toContain('not yet available');
      expect(error.code).toBe('RAPIDKIT_NOT_AVAILABLE');
      expect(error.details).toContain('create project');
    });

    it('should suggest alternatives', () => {
      const error = new RapidKitNotAvailableError();
      expect(error.details).toContain('Python 3.10+');
      expect(error.details).toContain('RAPIDKIT_SHOW_LEGACY');
    });
  });

  describe('NetworkError', () => {
    it('should create NetworkError with operation', () => {
      const error = new NetworkError('fetching package');
      expect(error.message).toContain('Network error');
      expect(error.message).toContain('fetching package');
      expect(error.code).toBe('NETWORK_ERROR');
    });

    it('should include original error message', () => {
      const original = new Error('ETIMEDOUT');
      const error = new NetworkError('download', original);
      expect(error.details).toContain('ETIMEDOUT');
    });

    it('should have troubleshooting checklist', () => {
      const error = new NetworkError('test');
      expect(error.details).toContain('Internet connection');
      expect(error.details).toContain('Firewall');
      expect(error.details).toContain('Proxy');
    });
  });

  describe('FileSystemError', () => {
    it('should create FileSystemError with operation and path', () => {
      const error = new FileSystemError('write', '/path/to/file');
      expect(error.message).toContain('write');
      expect(error.code).toBe('FILESYSTEM_ERROR');
      expect(error.details).toContain('/path/to/file');
    });

    it('should include original error', () => {
      const original = new Error('EACCES: permission denied');
      const error = new FileSystemError('read', '/file', original);
      expect(error.details).toContain('EACCES');
    });

    it('should have helpful checklist', () => {
      const error = new FileSystemError('delete', '/file');
      expect(error.details).toContain('permissions');
      expect(error.details).toContain('disk space');
      expect(error.details).toContain('Path validity');
    });
  });

  describe('Error hierarchy', () => {
    it('all errors should extend RapidKitError', () => {
      const errors = [
        new PythonNotFoundError('3.11'),
        new PoetryNotFoundError(),
        new PipxNotFoundError(),
        new DirectoryExistsError('test'),
        new InvalidProjectNameError('test', 'reason'),
        new InstallationError('step', new Error('error')),
        new PythonPipUnavailableError(),
        new PythonVenvUnavailableError('python3-venv', 'workspace'),
        new RapidKitNotAvailableError(),
        new NetworkError('op'),
        new FileSystemError('op', '/path'),
      ];

      errors.forEach((error) => {
        expect(error).toBeInstanceOf(RapidKitError);
        expect(error).toBeInstanceOf(Error);
      });
    });

    it('all errors should have unique error codes', () => {
      const errors = [
        new PythonNotFoundError('3.11'),
        new PoetryNotFoundError(),
        new PipxNotFoundError(),
        new DirectoryExistsError('test'),
        new InvalidProjectNameError('test', 'reason'),
        new InstallationError('step', new Error('error')),
        new RapidKitNotAvailableError(),
        new NetworkError('op'),
        new FileSystemError('op', '/path'),
      ];

      const codes = errors.map((e) => e.code);
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(codes.length);
    });

    it('all errors should have stack traces', () => {
      const errors = [
        new PythonNotFoundError('3.11'),
        new PoetryNotFoundError(),
        new NetworkError('op'),
      ];

      errors.forEach((error) => {
        expect(error.stack).toBeDefined();
        expect(error.stack).toContain('RapidKitError');
      });
    });
  });
});
