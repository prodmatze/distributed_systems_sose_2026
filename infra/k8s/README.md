# k8s

Kubernetes manifests for the deployment demo. Target cluster: k3d (chosen over minikube for smaller footprint and faster iteration).

**Planned topology** (see [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §6.2):

- `traefik` Ingress — routes `/api/*`, `/ws`, `/`.
- `api-service` Deployment — 2 replicas.
- `chat-service` Deployment — 3 replicas. Target of the "kill a node" demo.
- `postgres` StatefulSet — 1 replica + PVC.
- `redis` StatefulSet — 1 replica + PVC.
- `frontend` Deployment — 1 replica.
- Liveness and readiness probes on every backend Deployment.

A `NOTES.md` will document the demo commands (`kubectl scale`, `kubectl delete pod`, etc.).

Manifests land in a later ticket. No configuration yet.
