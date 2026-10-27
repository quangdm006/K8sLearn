# Dự án cuối khóa — lời giải tham khảo

Đề bài và hướng dẫn chi tiết: trang **Dự án cuối khóa** của website (`docs/thuc-hanh/du-an-cuoi-khoa.md`).

```
base/        Toàn bộ tài nguyên: namespace (Pod Security restricted, quota), Redis, backend, frontend,
             NetworkPolicy, Gateway + HTTPRoute
overlays/
  dev/       1 backend, lời chào [DEV], PDB backend nới lỏng
  prod/      3 replicas, HPA tối thiểu 3, PDB minAvailable 2
extras/      ServiceMonitor (kube-prometheus-stack) và Argo CD Application
```

Yêu cầu trước: cluster kind của khóa học, metrics-server (bài Tài nguyên) và Envoy Gateway với GatewayClass `eg`
(bài Ingress & Gateway API).

```bash
kubectl kustomize examples/capstone/overlays/dev     # xem trước
kubectl apply -k examples/capstone/overlays/dev
kubectl get all,pvc,gateway,httproute -n capstone
```
