import { defineSandbox } from 'eve/sandbox';
import { JustBashSandbox } from 'eve/sandbox/just-bash';

// No VM: pure-JS shell + virtual FS per session. Shared templates are baked into the prepared FS.
export const environment = JustBashSandbox.environment({
  autoInstall: false,
  prepare: async sandbox => {
    for (const name of ['report', 'digest', 'followup']) {
      await sandbox.writeTextFile({ path: `templates/${name}.md`, content: `# ${name}\n\n` + 'Template body line.\n'.repeat(60) });
    }
  },
});

export default defineSandbox(() => environment.open());
