# infra

Deployment artifacts for the two target environments, plus the gateway config they share conceptually:

- [`nginx/`](./nginx/) — the `nginx.conf` used as the API gateway in the Compose stack (single ingress, path-based routing, CORS).
- [`compose/`](./compose/) — Docker Compose stack for local development. Daily-driver environment for the team.
- [`k8s/`](./k8s/) — Kubernetes manifests targeting k3d. Used for the final deployment demo, where horizontal scaling and pod-kill resilience are exercised. The gateway role there is filled by a native Ingress (k3d ships Traefik as its default ingress controller), not by the nginx container.

The Compose-to-Kubernetes transition — including how the *same* gateway role is implemented by different tools — is itself part of the project narrative. See [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §6.
