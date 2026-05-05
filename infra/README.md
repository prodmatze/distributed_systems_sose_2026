# infra

Deployment artifacts for the two target environments:

- [`compose/`](./compose/) — Docker Compose stack for local development. Daily-driver environment for the team.
- [`k8s/`](./k8s/) — Kubernetes manifests targeting k3d. Used for the final deployment demo, where horizontal scaling and pod-kill resilience are exercised.

The Compose-to-Kubernetes transition is itself part of the project narrative — see [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §6.
