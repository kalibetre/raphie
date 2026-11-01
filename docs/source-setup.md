# Run from source

Install Bun 1.4.4 (pinned in `.bun-version`) and ensure your OS credential store is available; see [credential storage](provider-credential-storage.md) for prerequisites.

```sh
git clone https://github.com/kalibetre/raphie.git
cd raphie
bun install --frozen-lockfile
bun run dev
```

In a second terminal, create the administrator interactively:

```sh
bun run raphie auth setup
```

Open http://127.0.0.1:4320 and sign in. The runtime listens on loopback port 4316. In Settings, connect a provider and choose a model. For a production web bundle, run `bun run build` followed by `bun run start`; use a process supervisor for automatic restarts.

Configuration uses Varlock and the root `.env.schema`, with optional private `.env` or `.env.local` values. Data lives in `.data/` by default. See [using Raphie](using-raphie.md), [authentication](authentication.md), and [contributing](../CONTRIBUTING.md) for details.
