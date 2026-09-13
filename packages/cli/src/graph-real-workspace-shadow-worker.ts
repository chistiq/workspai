/**
 * Isolated G8 real-workspace observation worker.
 * Repository and CI source execution only: forked as TypeScript with `--import tsx`.
 * Not a published CLI runtime entry. `src` is unpublished, this file has no tsup
 * bundle, and installed users must not need `tsx` to run the CLI.
 */
import { qualifyGraphRealWorkspaceObservation } from './graph-real-workspace-shadow.js';

type IsolatedQualifyMessage = {
  readonly type: 'qualify';
  readonly hang?: boolean;
  readonly sentinelRoot: string;
  readonly payload: Parameters<typeof qualifyGraphRealWorkspaceObservation>[0];
};

function send(message: unknown): void {
  if (typeof process.send !== 'function') {
    process.exitCode = 4;
    return;
  }
  process.send(message);
}

process.on('message', (message: IsolatedQualifyMessage) => {
  void (async () => {
    try {
      if (!message || message.type !== 'qualify' || typeof message.sentinelRoot !== 'string') {
        send({ type: 'error' });
        return;
      }
      process.chdir(message.sentinelRoot);
      if (message.hang) {
        await new Promise(() => undefined);
        return;
      }
      const observation = await qualifyGraphRealWorkspaceObservation(message.payload);
      send({
        type: 'ok',
        observation: {
          id: observation.id,
          kind: observation.kind,
          projectId: observation.projectId,
          status: observation.status,
          ...(observation.reason ? { reason: observation.reason } : {}),
          ...(observation.packageExecution
            ? { packageExecution: observation.packageExecution }
            : {}),
          ...(observation.comparison ? { comparison: observation.comparison } : {}),
        },
        cwd: process.cwd(),
      });
    } catch {
      send({ type: 'error' });
    }
  })();
});
