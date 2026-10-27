---
title: kubectl cheat sheet
description: Tổng hợp lệnh kubectl, Helm, Kustomize hay dùng nhất và bộ khung YAML cho các tài nguyên phổ biến.
outline: [2, 2]
---

# kubectl cheat sheet

Trang tra cứu nhanh. Mẹo: `Ctrl+F` (hoặc ô **Tìm kiếm** — gõ không dấu cũng được) để tìm lệnh.

## Thiết lập nhanh

```bash
alias k=kubectl
export do="--dry-run=client -o yaml"        # k create deploy web --image=nginx $do
export now="--force --grace-period=0"       # k delete pod x $now  (chỉ dùng khi luyện tập!)
source <(kubectl completion bash)           # zsh: source <(kubectl completion zsh)
complete -o default -F __start_kubectl k
```

## Context & cấu hình

| Lệnh | Ý nghĩa |
| --- | --- |
| `kubectl config get-contexts` | Liệt kê context |
| `kubectl config current-context` | Context đang dùng |
| `kubectl config use-context <ctx>` | Chuyển context |
| `kubectl config set-context --current --namespace=<ns>` | Đổi namespace mặc định |
| `kubectl auth whoami` | Tôi là ai với API server |
| `kubectl cluster-info` | Địa chỉ API server, CoreDNS |
| `kubectl version` | Phiên bản client và server |
| `kubectl api-resources` | Mọi loại tài nguyên (tên tắt, group, namespaced) |
| `kubectl explain deploy.spec.strategy` | Tài liệu của một trường |

## Xem thông tin

| Lệnh | Ý nghĩa |
| --- | --- |
| `kubectl get pods -o wide` | Pod kèm IP, node |
| `kubectl get pods -A` | Mọi namespace |
| `kubectl get pods -l app=web --show-labels` | Lọc và hiện label |
| `kubectl get pods -w` | Theo dõi thay đổi |
| `kubectl get deploy,svc,ingress` | Nhiều loại cùng lúc |
| `kubectl get all -n <ns>` | Workload phổ biến trong namespace |
| `kubectl describe pod <pod>` | Chi tiết + Events |
| `kubectl get pod <pod> -o yaml` | Toàn bộ đối tượng |
| `kubectl get events --sort-by=.lastTimestamp` | Sự kiện gần đây |
| `kubectl top nodes` / `kubectl top pods -A --sort-by=memory` | CPU/RAM (cần metrics-server) |
| `kubectl get endpointslices -l kubernetes.io/service-name=<svc>` | Pod phía sau Service |

## Tạo & cập nhật

| Lệnh | Ý nghĩa |
| --- | --- |
| `kubectl apply -f <file-hoặc-thư-mục>` | Tạo/cập nhật theo khai báo |
| `kubectl apply -k <thư-mục>` | Áp dụng Kustomize |
| `kubectl diff -f <file>` | Xem trước thay đổi |
| `kubectl run nginx --image=nginx:1.30` | Tạo Pod |
| `kubectl create deployment web --image=nginx:1.30 --replicas=3` | Tạo Deployment |
| `kubectl expose deployment web --port=80 --target-port=8080` | Tạo Service |
| `kubectl create configmap cfg --from-literal=K=V --from-file=app.conf` | Tạo ConfigMap |
| `kubectl create secret generic s --from-literal=password=abc` | Tạo Secret |
| `kubectl create job once --image=busybox:1.37 -- echo hi` | Tạo Job |
| `kubectl create cronjob tick --image=busybox:1.37 --schedule="*/5 * * * *" -- date` | Tạo CronJob |
| `kubectl create namespace dev` | Tạo namespace |
| `kubectl edit deploy web` | Sửa trực tiếp (chữa cháy) |
| `kubectl patch deploy web -p '{"spec":{"replicas":5}}'` | Vá một phần |
| `kubectl label pod <pod> env=dev` / `env-` | Thêm / xóa label |
| `kubectl annotate deploy web kubernetes.io/change-cause="..."` | Thêm annotation |

## Sinh YAML nhanh

```bash
kubectl run nginx --image=nginx:1.30 --port=80 --dry-run=client -o yaml > pod.yaml
kubectl create deployment web --image=nginx:1.30 --replicas=3 --dry-run=client -o yaml > deploy.yaml
kubectl create service clusterip web --tcp=80:8080 --dry-run=client -o yaml > svc.yaml
kubectl create ingress web --rule="shop.local/*=web:80" --dry-run=client -o yaml > ingress.yaml
kubectl create configmap cfg --from-env-file=app.env --dry-run=client -o yaml > cm.yaml
kubectl create secret generic db --from-literal=password=abc --dry-run=client -o yaml > secret.yaml
kubectl create job pi --image=perl:5.40 --dry-run=client -o yaml -- perl -Mbignum=bpi -wle 'print bpi(100)'
kubectl create role pod-reader --verb=get,list,watch --resource=pods --dry-run=client -o yaml
kubectl create pdb web --selector=app=web --min-available=2 --dry-run=client -o yaml
```

## Scale & triển khai

| Lệnh | Ý nghĩa |
| --- | --- |
| `kubectl scale deploy web --replicas=5` | Đổi số replicas |
| `kubectl autoscale deploy web --cpu=70% --min=2 --max=10` | Tạo HPA |
| `kubectl set image deploy/web nginx=nginx:1.31` | Đổi image |
| `kubectl set env deploy/web LOG_LEVEL=debug` | Đổi biến môi trường |
| `kubectl set resources deploy/web --requests=cpu=200m,memory=256Mi` | Đổi requests/limits |
| `kubectl rollout status deploy/web` | Theo dõi rollout |
| `kubectl rollout history deploy/web` | Lịch sử revision |
| `kubectl rollout undo deploy/web --to-revision=2` | Rollback |
| `kubectl rollout restart deploy/web` | Thay mới toàn bộ Pod |
| `kubectl rollout pause` / `resume deploy/web` | Tạm dừng / tiếp tục |

## Gỡ lỗi & truy cập

| Lệnh | Ý nghĩa |
| --- | --- |
| `kubectl logs <pod> -f --tail=100` | Theo dõi log |
| `kubectl logs <pod> -c <container> --previous` | Log lần chạy trước (sau crash) |
| `kubectl logs -l app=web --prefix --since=10m` | Log nhiều Pod theo label |
| `kubectl exec -it <pod> -- sh` | Shell trong container |
| `kubectl debug -it <pod> --image=nicolaka/netshoot:v0.16 --target=<container>` | Gắn container gỡ lỗi |
| `kubectl debug <pod> -it --copy-to=<pod>-debug --container=<c> -- sh` | Bản sao Pod với lệnh khác |
| `kubectl debug node/<node> -it --image=ubuntu:24.04` | Vào node (file system ở /host) |
| `kubectl run tmp --rm -it --image=busybox:1.37 --restart=Never -- sh` | Pod tạm để thử mạng |
| `kubectl port-forward svc/web 8080:80` | Mở cổng từ máy bạn |
| `kubectl cp <pod>:/path/file ./file` | Sao chép file |
| `kubectl get --raw='/readyz?verbose'` | Sức khỏe API server |

## Node & bảo trì

| Lệnh | Ý nghĩa |
| --- | --- |
| `kubectl get nodes -o wide` | Danh sách node |
| `kubectl describe node <node>` | Conditions, taints, tài nguyên đã cấp |
| `kubectl cordon <node>` / `uncordon <node>` | Ngừng / cho phép xếp Pod |
| `kubectl drain <node> --ignore-daemonsets --delete-emptydir-data` | Đuổi Pod để bảo trì |
| `kubectl taint nodes <node> key=value:NoSchedule` | Thêm taint (thêm `-` ở cuối để gỡ) |
| `kubectl label node <node> disktype=ssd` | Gắn label cho node |

## RBAC

| Lệnh | Ý nghĩa |
| --- | --- |
| `kubectl auth can-i create pods -n dev` | Tôi có quyền không? |
| `kubectl auth can-i --list -n dev --as=system:serviceaccount:dev:ci` | Mọi quyền của một danh tính |
| `kubectl create sa ci -n dev` | Tạo ServiceAccount |
| `kubectl create rolebinding ci-edit --clusterrole=edit --serviceaccount=dev:ci -n dev` | Gán quyền |
| `kubectl create token ci -n dev --duration=1h` | Token ngắn hạn |

## Định dạng output

```bash
kubectl get pods -o name
kubectl get pods -o jsonpath='{.items[*].metadata.name}'
kubectl get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.podIP}{"\n"}{end}'
kubectl get pods -o custom-columns=NAME:.metadata.name,NODE:.spec.nodeName,STATUS:.status.phase
kubectl get pods --sort-by=.metadata.creationTimestamp
kubectl get pods --field-selector=status.phase!=Running -A
kubectl get secret db -o jsonpath='{.data.password}' | base64 -d
```

## Helm

| Lệnh | Ý nghĩa |
| --- | --- |
| `helm repo add <tên> <url>` / `helm repo update` | Thêm / cập nhật repo |
| `helm search repo <từ khóa>` | Tìm chart |
| `helm show values <chart>` | Giá trị cấu hình được |
| `helm upgrade --install <rel> <chart> -n <ns> --create-namespace -f values.yaml` | Cài hoặc nâng cấp |
| `helm list -A` | Mọi release |
| `helm history <rel>` / `helm rollback <rel> <rev>` | Lịch sử / quay lại |
| `helm get values <rel>` / `helm get manifest <rel>` | Giá trị / manifest đã áp dụng |
| `helm template <rel> <chart> -f values.yaml` | Render cục bộ |
| `helm uninstall <rel> -n <ns>` | Gỡ |

## Kustomize

| Lệnh | Ý nghĩa |
| --- | --- |
| `kubectl kustomize overlays/prod` | Xem kết quả render |
| `kubectl apply -k overlays/prod` | Áp dụng |
| `kubectl diff -k overlays/prod` | Xem trước thay đổi |
| `kustomize edit set image app=registry/app:1.2.3` | Đổi tag image (dùng trong CI) |

## Khung YAML thường dùng

::: code-group

```yaml [Deployment]
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 3
  selector:
    matchLabels: { app: web }
  template:
    metadata:
      labels: { app: web }
    spec:
      containers:
        - name: web
          image: nginx:1.30
          ports: [{ containerPort: 80 }]
          resources:
            requests: { cpu: 100m, memory: 128Mi }
            limits: { memory: 256Mi }
          readinessProbe:
            httpGet: { path: /, port: 80 }
```

```yaml [Service]
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  type: ClusterIP
  selector: { app: web }
  ports:
    - port: 80
      targetPort: 80
```

```yaml [HTTPRoute]
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: web
spec:
  parentRefs: [{ name: eg }]
  hostnames: ["web.example.com"]
  rules:
    - backendRefs: [{ name: web, port: 80 }]
```

```yaml [PVC]
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: data
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 5Gi
```

```yaml [CronJob]
apiVersion: batch/v1
kind: CronJob
metadata:
  name: backup
spec:
  schedule: "0 2 * * *"
  timeZone: "Asia/Ho_Chi_Minh"
  concurrencyPolicy: Forbid
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: backup
              image: busybox:1.37
              command: ["sh", "-c", "echo backup $(date)"]
```

```yaml [HPA]
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: web
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: web }
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource: { name: cpu, target: { type: Utilization, averageUtilization: 70 } }
```

```yaml [NetworkPolicy]
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: web-from-gateway
spec:
  podSelector:
    matchLabels: { app: web }
  policyTypes: ["Ingress"]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: envoy-gateway-system
      ports:
        - { protocol: TCP, port: 80 }
```

:::

## Trạng thái Pod — tra nhanh

| Trạng thái | Xem gì trước |
| --- | --- |
| `Pending` | `describe pod` → FailedScheduling (tài nguyên, taint, affinity, PVC) |
| `ImagePullBackOff` | Tên/tag image, quyền registry |
| `CrashLoopBackOff` | `logs --previous`, Last State, Exit Code |
| `CreateContainerConfigError` | ConfigMap/Secret được tham chiếu |
| `OOMKilled` (137) | `limits.memory` |
| `Running` nhưng `0/1` | readinessProbe |

Chi tiết: [Xử lý sự cố](/nang-cao/troubleshooting).
