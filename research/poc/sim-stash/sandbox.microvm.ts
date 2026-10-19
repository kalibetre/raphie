import { defineSandbox } from 'eve/sandbox';
import { MicrosandboxSandbox } from 'eve/sandbox/microsandbox';

export const environment = MicrosandboxSandbox.image('docker.io/library/node:24-bookworm-slim', {
  cpus: 1,
  memoryMiB: 512,
  setup: { autoInstall: false },
});

export default defineSandbox(() => environment.open({ networkPolicy: 'deny-all' }));
