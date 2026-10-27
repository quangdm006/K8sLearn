---
title: Checklist cho production
description: Tổng hợp những gì một ứng dụng và một cluster cần trước khi phục vụ người dùng thật — độ tin cậy, bảo mật, observability, vận hành, chi phí — kèm manifest mẫu "production-ready".
quiz:
  - q: "Deployment production chỉ có 1 replica. Rủi ro lớn nhất là gì?"
    options:
      - "Tốn tài nguyên"
      - "Mỗi lần node bảo trì, Pod bị đuổi hoặc crash là dịch vụ gián đoạn"
      - "Không xem được log"
      - "Không dùng được Service"
    answer: 1
    explain: "Tối thiểu 2–3 replicas, rải trên nhiều node/zone (topology spread) và có PDB thì bảo trì hay sự cố một node mới không gây gián đoạn."
  - q: "Cách nào giúp giảm chi phí cluster hiệu quả nhất trong thực tế?"
    options:
      - "Đặt requests thật cao cho chắc"
      - "Đặt requests sát mức dùng thực tế, dùng autoscaling (Pod và node), tắt môi trường không dùng ngoài giờ, cân nhắc node spot cho workload chịu được gián đoạn"
      - "Bỏ hết limits"
      - "Gộp mọi thứ vào một Pod"
    answer: 1
    explain: "Requests quyết định số node cần có. Phần lớn lãng phí đến từ requests đặt quá cao so với mức dùng thật."
  - q: "Vì sao cần diễn tập khôi phục (restore drill) thay vì chỉ cấu hình backup?"
    options:
      - "Vì backup tự động xóa sau 7 ngày"
      - "Vì backup chưa từng khôi phục thử thì không thể biết có dùng được không — và mất bao lâu"
      - "Vì Kubernetes yêu cầu"
      - "Để tăng tốc backup"
    answer: 1
    explain: "Nhiều sự cố cho thấy backup thiếu dữ liệu, sai quyền hoặc quy trình khôi phục chưa ai biết làm. Diễn tập định kỳ đo được RTO/RPO thực tế."
  - q: "Điều nào là phản mẫu (anti-pattern) trên Kubernetes?"
    options:
      - "Dùng GitOps để triển khai"
      - "Sửa tay tài nguyên production bằng `kubectl edit` và không cập nhật lại Git"
      - "Đặt readinessProbe"
      - "Dùng namespace cho từng team"
    answer: 1
    explain: "Thay đổi không nằm trong Git sẽ bị ghi đè hoặc tạo lệch cấu hình khó truy vết. Mọi thay đổi lâu dài phải qua Git/pipeline."
---

# Checklist cho production

::: info Mục tiêu bài học
- Tổng hợp mọi kiến thức đã học thành **checklist** áp dụng được ngay.
- Có một **manifest mẫu "production-ready"** để làm khung cho ứng dụng của bạn.
- Nhận diện **phản mẫu** thường gặp và các hướng tối ưu **chi phí**.
:::

## 1. Ứng dụng (workload)

**Độ tin cậy**

- [ ] **≥ 2 replicas** (dịch vụ quan trọng ≥ 3), rải theo node/zone bằng **topologySpreadConstraints**.
- [ ] **readinessProbe** cho mọi dịch vụ nhận traffic; **startupProbe** cho ứng dụng khởi động chậm; liveness chỉ khi thật sự cần.
- [ ] **requests** sát thực tế, **memory limit** hợp lý; cấu hình heap/runtime theo giới hạn container.
- [ ] **PodDisruptionBudget** cho mọi dịch vụ nhiều replicas.
- [ ] **Graceful shutdown**: xử lý SIGTERM, `preStop` nếu cần, `terminationGracePeriodSeconds` đủ lớn.
- [ ] **Rolling update an toàn**: `maxUnavailable: 0` (hoặc nhỏ), `minReadySeconds`, `progressDeadlineSeconds`.
- [ ] **HPA** (hoặc KEDA) với min/max hợp lý; đã thử tải.
- [ ] **Image tag bất biến** (phiên bản/commit SHA, tốt nhất là digest) — không dùng `latest`.

**Bảo mật**

- [ ] `runAsNonRoot`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, `seccompProfile: RuntimeDefault`, `readOnlyRootFilesystem` khi được.
- [ ] ServiceAccount riêng, quyền tối thiểu; `automountServiceAccountToken: false` nếu không gọi API.
- [ ] Secret lấy từ kho bí mật (External Secrets...) — không nằm trong Git dạng thô.
- [ ] Image được quét lỗ hổng trong CI, từ registry tin cậy, có chữ ký.
- [ ] NetworkPolicy: chỉ mở đúng các luồng cần thiết.

**Observability**

- [ ] Log JSON ra stdout, có trace/request ID.
- [ ] Metric RED (rate, errors, duration) và **SLO** cho dịch vụ.
- [ ] Cảnh báo theo triệu chứng, có **runbook**.
- [ ] Tracing qua OpenTelemetry cho hệ thống nhiều dịch vụ.

## 2. Manifest mẫu "production-ready"

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop-api
  labels:
    app.kubernetes.io/name: shop-api
    app.kubernetes.io/part-of: shop
    team: backend
spec:
  replicas: 3
  revisionHistoryLimit: 5
  progressDeadlineSeconds: 300
  minReadySeconds: 5
  strategy:
    type: RollingUpdate
    rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }
  selector:
    matchLabels:
      app.kubernetes.io/name: shop-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: shop-api
        app.kubernetes.io/part-of: shop
    spec:
      serviceAccountName: shop-api
      automountServiceAccountToken: false
      terminationGracePeriodSeconds: 40
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        fsGroup: 10001
        seccompProfile: { type: RuntimeDefault }
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels: { app.kubernetes.io/name: shop-api }
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels: { app.kubernetes.io/name: shop-api }
      containers:
        - name: api
          image: ghcr.io/my-org/shop-api@sha256:3f2c9a1b...   # ghim theo digest
          ports:
            - { name: http, containerPort: 8080 }
          envFrom:
            - configMapRef: { name: shop-api-config }
          env:
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef: { name: shop-api-db, key: password }
          resources:
            requests: { cpu: 200m, memory: 256Mi }
            limits: { memory: 512Mi }
          startupProbe:
            httpGet: { path: /healthz, port: http }
            periodSeconds: 3
            failureThreshold: 40
          readinessProbe:
            httpGet: { path: /readyz, port: http }
            periodSeconds: 5
          livenessProbe:
            httpGet: { path: /healthz, port: http }
            periodSeconds: 10
            timeoutSeconds: 3
          lifecycle:
            preStop:
              sleep: { seconds: 5 }
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
          volumeMounts:
            - { name: tmp, mountPath: /tmp }
      volumes:
        - name: tmp
          emptyDir: { sizeLimit: 256Mi }
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: shop-api
spec:
  maxUnavailable: 1
  selector:
    matchLabels: { app.kubernetes.io/name: shop-api }
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: shop-api
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: shop-api }
  minReplicas: 3
  maxReplicas: 15
  metrics:
    - type: Resource
      resource: { name: cpu, target: { type: Utilization, averageUtilization: 65 } }
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
```

Kèm theo: Service, HTTPRoute (hoặc Ingress), NetworkPolicy, ServiceMonitor, PrometheusRule — tất cả quản lý bằng Kustomize/Helm trong Git và triển khai qua GitOps.

## 3. Cluster và nền tảng

**Kiến trúc**

- [ ] Control plane HA (managed hoặc 3 node), etcd được sao lưu ra ngoài cluster.
- [ ] Worker trải trên **nhiều zone**; tách **node pool** theo loại workload (chung, bộ nhớ lớn, GPU, spot).
- [ ] Cluster autoscaler/Karpenter; dư địa tài nguyên cho rolling update và sự cố một zone.
- [ ] Môi trường **production tách cluster** với dev/staging (hoặc ít nhất tách node pool + chính sách chặt).

**Bảo mật nền tảng**

- [ ] API server không phơi Internet (hoặc giới hạn IP), đăng nhập qua SSO/OIDC, RBAC tối thiểu, audit log bật.
- [ ] Pod Security Admission (baseline/restricted) theo namespace; policy engine (VAP/Kyverno) cho quy định công ty.
- [ ] NetworkPolicy default-deny cho namespace ứng dụng.
- [ ] Mã hóa Secret khi lưu trữ (KMS); cert-manager quản lý chứng chỉ.
- [ ] Quét định kỳ: CIS benchmark (kube-bench), lỗ hổng image đang chạy.

**Vận hành**

- [ ] Mọi thứ trong Git (GitOps), kể cả add-on của cluster.
- [ ] Lịch nâng cấp Kubernetes và add-on định kỳ; theo dõi API deprecated.
- [ ] Backup (etcd/Velero) + **diễn tập khôi phục** định kỳ; xác định **RTO/RPO**.
- [ ] Observability nền tảng: metric cluster, log tập trung, cảnh báo node/control plane, theo dõi hạn chứng chỉ.
- [ ] Quy trình xử lý sự cố (on-call, runbook, post-mortem không đổ lỗi).

**Đa người dùng (multi-tenancy)**

- [ ] Mỗi team/ứng dụng một namespace, có **ResourceQuota** + **LimitRange**.
- [ ] RBAC theo nhóm (team-a chỉ `edit` trong namespace của mình).
- [ ] Gắn nhãn chi phí (`team`, `cost-center`) để phân bổ chi phí.

## 4. Tối ưu chi phí

| Kỹ thuật | Tác dụng |
| --- | --- |
| Đặt requests theo đo đạc (VPA ở chế độ khuyến nghị, Goldilocks) | Giảm "đặt chỗ" thừa — nguồn lãng phí lớn nhất |
| HPA + scale node tự động | Chỉ trả tiền cho lúc cần |
| **Spot/preemptible node** cho workload chịu được gián đoạn | Rẻ hơn đáng kể so với on-demand |
| Scale về 0 môi trường dev/staging ngoài giờ (KEDA cron, kube-downscaler) | Tiết kiệm phần lớn chi phí môi trường phụ |
| Gom node (Karpenter consolidation) | Bớt node gần trống |
| Đo chi phí theo namespace/team (OpenCost) | Minh bạch, tạo động lực tối ưu |

## 5. Phản mẫu cần tránh

- ❌ Dùng `latest` hoặc tag bị ghi đè cho production.
- ❌ Không đặt requests; hoặc requests = limits rất cao "cho chắc".
- ❌ `kubectl edit` / `kubectl apply` tay lên production không qua Git.
- ❌ Một namespace `default` chứa mọi thứ.
- ❌ Lưu dữ liệu quan trọng trên `emptyDir`/`hostPath`.
- ❌ Liveness probe kiểm tra database → restart hàng loạt khi database chập chờn.
- ❌ Cấp `cluster-admin` cho CI/CD hoặc ứng dụng.
- ❌ Không bao giờ nâng cấp cluster "vì đang chạy ổn".
- ❌ Backup nhưng chưa từng thử khôi phục.

## 6. Sau khóa học: đi tiếp đâu?

- **Service mesh** (Istio ambient, Linkerd, Cilium) cho mTLS và quản lý traffic nâng cao.
- **Multi-cluster**: Argo CD ApplicationSet, Cluster API, Gateway API đa cluster, Karmada.
- **Platform engineering**: xây "nền tảng nội bộ" (Backstage, Crossplane) để các team tự phục vụ.
- **Workload AI/ML**: GPU, Dynamic Resource Allocation (GA từ v1.34), Kueue cho hàng đợi Job.
- **Chứng chỉ**: KCNA, CKAD, CKA, CKS — xem [trang Chứng chỉ & tài nguyên](/tham-khao/chung-chi).

## Thực hành

**Bài tập lớn:** lấy một ứng dụng thật của bạn (hoặc podinfo) và chấm điểm theo checklist mục 1. Với mỗi mục chưa đạt, ghi lại cách khắc phục. Sau đó làm [Dự án cuối khóa](/thuc-hanh/du-an-cuoi-khoa) — nơi bạn áp dụng gần như toàn bộ checklist này.

## Tóm tắt

- Workload production: nhiều replicas rải đều, probes, requests/limits, PDB, graceful shutdown, image bất biến, securityContext chặt, quan sát được.
- Nền tảng: HA, nhiều zone, GitOps, nâng cấp định kỳ, backup có diễn tập, bảo mật nhiều lớp, multi-tenancy có quota.
- Chi phí: requests đúng, autoscaling, spot, tắt môi trường phụ ngoài giờ, đo chi phí theo team.

## Kiểm tra kiến thức

<Quiz />
