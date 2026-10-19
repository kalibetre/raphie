# Research: running many agents cheaply

Experiment from 2026-10-17 on whether 100+ agents can run on a Kubernetes cluster that today gives each agent a dedicated pod. Read in this order:

| File | What it is |
|------|------------|
| `EXPERIMENT-REPORT.md` | Start here. Why, results, findings, design direction, next steps. |
| `VM-ACTIVITY-LOG.md` | Chronological log of every run, failure and cleanup. |
| `poc/` | The runnable proof of concept (Eve agent, mock model, fleet simulator, VM/Docker tests). See `poc/README.md`. |
| `results/` | Raw output files from the runs (no secrets). |
| `docs/host-inspection.txt` | Dev host inspection (CPU, RAM, KVM) taken before testing. |

The repo root is free for the real agent.
