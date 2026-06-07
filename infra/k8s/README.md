# k8s

Kubernetes manifests for the deployment demo. Target cluster: k3d (chosen over minikube for smaller footprint and faster iteration).

**Planned topology** (see [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §6.2):

- **Ingress** — routes `/auth/*`, `/api/*`, `/ws`, `/`. The Compose stack's nginx gateway is replaced here by a native Ingress resource; k3d ships **Traefik as its default ingress controller**, so the Ingress is satisfied without installing anything. (The "gateway" is a role filled by an explicit nginx container in Compose and by a platform Ingress in Kubernetes.)
- `auth-service` Deployment — 2 replicas.
- `api-service` Deployment — 2 replicas.
- `chat-service` Deployment — 3 replicas. Target of the "kill a node" demo.
- `postgres` StatefulSet — 1 replica + PVC.
- `redis` StatefulSet — 1 replica + PVC.
- `frontend` Deployment — 1 replica.
- A `migrate` Job (or initContainer) — the Kubernetes equivalent of the Compose one-shot `migrate` service; runs `alembic upgrade head` before app pods start.
- Liveness and readiness probes on every backend Deployment.

A `NOTES.md` will document the demo commands (`kubectl scale`, `kubectl delete pod`, etc.).

Manifests land in a later ticket. No configuration yet.
