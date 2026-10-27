---
title: Làm quen với kubectl
description: Cú pháp kubectl, cách làm việc mệnh lệnh và khai báo, YAML cấp tốc, đọc thông tin, sinh manifest và các mẹo output.
quiz:
  - q: "Lệnh nào sinh ra YAML của một Deployment mà KHÔNG tạo gì trên cluster?"
    options:
      - "`kubectl create deployment web --image=nginx:1.30 --dry-run=client -o yaml`"
      - "`kubectl get deployment web -o yaml`"
      - "`kubectl apply -f web.yaml --preview`"
      - "`kubectl explain deployment`"
    answer: 0
    explain: "`--dry-run=client -o yaml` chỉ in ra đối tượng sẽ được tạo. Đây là cách nhanh nhất để có bộ khung YAML đúng cú pháp rồi chỉnh tiếp."
  - q: "Đối tượng `web` đã tồn tại. Chạy `kubectl create -f web.yaml` và `kubectl apply -f web.yaml` khác nhau thế nào?"
    options:
      - "Giống hệt nhau"
      - "`create` báo lỗi AlreadyExists; `apply` cập nhật đối tượng theo file"
      - "`create` ghi đè; `apply` báo lỗi"
      - "Cả hai đều xóa rồi tạo lại đối tượng"
    answer: 1
    explain: "`create` là mệnh lệnh “hãy tạo mới”. `apply` là khai báo “hãy làm cho cluster khớp file này” — tạo nếu chưa có, cập nhật nếu đã có."
  - q: "Container trong Pod `api` vừa crash và khởi động lại. Xem log của lần chạy TRƯỚC bằng lệnh nào?"
    options:
      - "`kubectl logs api --previous`"
      - "`kubectl logs api --all`"
      - "`kubectl describe api --logs`"
      - "`kubectl get logs api -1`"
    answer: 0
    explain: "`--previous` (hoặc `-p`) lấy log của container đã chết — thường chứa lý do crash. Không có cờ này, bạn chỉ thấy log của container mới khởi động."
  - q: "Đoạn YAML nào sau đây gây lỗi cú pháp?"
    options:
      - "Dùng 2 dấu cách để thụt lề"
      - "Dùng ký tự Tab để thụt lề"
      - "Đặt chú thích sau dấu #"
      - "Dùng `---` để ngăn cách nhiều tài liệu trong một file"
    answer: 1
    explain: "YAML cấm Tab khi thụt lề. Hãy cấu hình editor tự đổi Tab thành dấu cách — lỗi này cực kỳ phổ biến với người mới."
  - q: "`kubectl explain deployment.spec.strategy` dùng để làm gì?"
    options:
      - "Giải thích vì sao Deployment bị lỗi"
      - "Xem tài liệu của trường `spec.strategy` (kiểu dữ liệu, ý nghĩa) lấy trực tiếp từ API server"
      - "Đổi chiến lược triển khai"
      - "In ra sự kiện của Deployment"
    answer: 1
    explain: "`explain` là “từ điển” tích hợp sẵn và luôn đúng với phiên bản cluster bạn đang dùng. Thêm `--recursive` để xem toàn bộ cây trường."
---

# Làm quen với kubectl

::: info Mục tiêu bài học
- Nắm cú pháp chung của kubectl và tên viết tắt của các loại tài nguyên.
- Phân biệt cách làm **mệnh lệnh** (imperative) và **khai báo** (declarative).
- Đọc/viết YAML tự tin với phần **YAML cấp tốc**.
- Thành thạo nhóm lệnh xem thông tin, thao tác, gỡ lỗi và định dạng output.
:::

## 1. Cú pháp chung

```text
kubectl  <lệnh>   <loại tài nguyên>  <tên>   <cờ>
kubectl  get      pods               nginx   -n default -o wide
```

| Thành phần | Ví dụ |
| --- | --- |
| Lệnh | `get`, `describe`, `create`, `apply`, `delete`, `logs`, `exec`... |
| Loại tài nguyên | `pods` = `pod` = `po`, `deployments` = `deploy`, `services` = `svc`, `namespaces` = `ns`, `nodes` = `no`, `configmaps` = `cm` |
| Cờ phổ biến | `-n <namespace>`, `-A` (mọi namespace), `-o <định dạng>`, `-l <label selector>`, `-f <file>` |

Xem toàn bộ loại tài nguyên mà cluster hỗ trợ (kèm tên viết tắt, API group, có thuộc namespace hay không):

```bash
kubectl api-resources
```

## 2. Ba cách làm việc

| Cách | Ví dụ | Khi nào dùng |
| --- | --- | --- |
| **Lệnh mệnh lệnh** | `kubectl create deployment web --image=nginx:1.30` | Thử nhanh, học, xử lý tình huống |
| **Mệnh lệnh với file** | `kubectl create -f web.yaml`, `kubectl replace -f web.yaml` | Ít dùng |
| **Khai báo** | `kubectl apply -f web.yaml` (hoặc cả thư mục `-f k8s/`) | **Công việc thật**: file nằm trong Git, review được, lặp lại được |

Quy trình thực tế thường kết hợp cả hai: dùng lệnh mệnh lệnh **sinh khung YAML**, chỉnh sửa, lưu vào Git rồi `apply`:

```bash
kubectl create deployment web --image=nginx:1.30 --replicas=3 \
  --dry-run=client -o yaml > web.yaml

kubectl apply -f web.yaml       # tạo mới
# ... sửa replicas: 5 trong web.yaml ...
kubectl diff -f web.yaml        # xem trước thay đổi
kubectl apply -f web.yaml       # cập nhật
```

::: tip Ghi nhớ `--dry-run=client -o yaml`
Đây là mẹo quan trọng nhất cho cả công việc lẫn kỳ thi CKA/CKAD: không ai phải nhớ thuộc lòng YAML. Các lệnh `kubectl run`, `create deployment|service|configmap|secret|job|cronjob|role...` đều sinh được khung YAML.
:::

## 3. YAML cấp tốc {#yaml-cap-toc}

Mọi manifest Kubernetes đều là YAML. Chỉ cần nắm vài quy tắc:

```yaml
# Chú thích bắt đầu bằng dấu #
name: web                  # key: value  (bắt buộc có dấu cách sau dấu :)
replicas: 3                # số
enabled: true              # boolean
version: "1.10"            # chuỗi — nên đặt trong nháy khi trông giống số

labels:                    # map (đối tượng) lồng nhau: thụt lề bằng DẤU CÁCH
  app: web
  tier: frontend

ports:                     # list: mỗi phần tử bắt đầu bằng "- "
  - 80
  - 443

containers:                # list các map — cấu trúc gặp nhiều nhất
  - name: nginx
    image: nginx:1.30
  - name: sidecar
    image: busybox:1.37

script: |                  # chuỗi nhiều dòng, giữ nguyên xuống dòng
  echo "xin chào"
  sleep 10
---
# "---" ngăn cách nhiều tài liệu (nhiều đối tượng) trong cùng một file
```

::: warning Ba cái bẫy kinh điển
1. **Tab** để thụt lề → lỗi. Luôn dùng dấu cách (thường là 2).
2. Giá trị trông giống số/boolean bị hiểu sai: `version: 1.10` thành số `1.1`; `"yes"`, `"on"` trong một số parser cũ thành `true`. Biến môi trường **bắt buộc** là chuỗi: `value: "8080"`.
3. Thụt lề lệch một dấu cách là đổi cấu trúc. Dùng editor có YAML extension để thấy lỗi ngay.
:::

Mọi đối tượng Kubernetes có chung bộ khung bốn phần:

```yaml
apiVersion: apps/v1        # nhóm API + phiên bản
kind: Deployment           # loại đối tượng
metadata:                  # định danh: tên, namespace, labels, annotations
  name: web
  namespace: default
spec:                      # TRẠNG THÁI MONG MUỐN — bạn viết
  replicas: 3
# status:                  # TRẠNG THÁI THỰC TẾ — hệ thống tự ghi, bạn không viết
```

## 4. Xem thông tin

```bash
kubectl get pods                         # liệt kê Pod trong namespace hiện tại
kubectl get pods -A                      # mọi namespace
kubectl get pods -o wide                 # thêm IP, node
kubectl get pods --show-labels           # hiện labels
kubectl get pods -l app=web              # lọc theo label
kubectl get pods -w                      # theo dõi thay đổi liên tục (Ctrl+C để thoát)
kubectl get deploy,svc,pods              # nhiều loại cùng lúc
kubectl get all                          # các workload phổ biến + service

kubectl describe pod <tên>               # chi tiết + EVENTS — lệnh gỡ lỗi số 1
kubectl get pod <tên> -o yaml            # toàn bộ đối tượng (cả status)

kubectl logs <pod>                       # log container
kubectl logs <pod> -f --tail=50          # theo dõi, chỉ lấy 50 dòng cuối
kubectl logs <pod> -c <container>        # Pod nhiều container
kubectl logs <pod> --previous            # log của lần chạy trước (sau khi crash)
kubectl logs -l app=web --prefix         # log của mọi Pod có label app=web

kubectl get events --sort-by=.lastTimestamp   # sự kiện gần đây trong namespace
```

## 5. Thao tác

```bash
kubectl apply -f web.yaml                # tạo/cập nhật theo file (khai báo)
kubectl delete -f web.yaml               # xóa những gì file mô tả
kubectl delete pod <tên>                 # xóa theo tên

kubectl scale deployment web --replicas=5
kubectl set image deployment/web nginx=nginx:1.31
kubectl rollout status deployment/web
kubectl rollout undo deployment/web

kubectl label pod <tên> env=dev          # thêm label
kubectl label pod <tên> env-             # xóa label
kubectl edit deployment web              # sửa trực tiếp trên cluster (mở editor)
```

::: warning Cẩn thận với `kubectl edit`
`edit` sửa thẳng trên cluster, file YAML trong Git không biết gì → lần `apply` sau có thể ghi đè ngược lại. Hãy coi `edit` là công cụ chữa cháy; thay đổi lâu dài phải đi qua file.
:::

## 6. Gỡ lỗi và truy cập

```bash
# Chạy lệnh trong container
kubectl exec <pod> -- ls /usr/share/nginx/html
kubectl exec -it <pod> -- sh                     # mở shell tương tác

# Pod tạm thời để thử mạng/DNS, tự xóa khi thoát
kubectl run tmp --rm -it --image=busybox:1.37 --restart=Never -- sh

# Mở cổng từ máy bạn vào Pod/Service (không cần Service NodePort)
kubectl port-forward pod/<pod> 8080:80
kubectl port-forward svc/web 8080:80             # rồi mở http://localhost:8080

# Sao chép file
kubectl cp <pod>:/etc/nginx/nginx.conf ./nginx.conf
```

## 7. Tự tra cứu với `kubectl explain`

Không nhớ một trường viết thế nào? Hỏi thẳng API server:

```bash
kubectl explain pod.spec.containers
kubectl explain deployment.spec.strategy.rollingUpdate
kubectl explain pod.spec --recursive | less     # toàn bộ cây trường
```

```text
GROUP:      apps
KIND:       Deployment
VERSION:    v1

FIELD: rollingUpdate <RollingUpdateDeployment>

DESCRIPTION:
    Rolling update config params. Present only if DeploymentStrategyType =
    RollingUpdate.

FIELDS:
  maxSurge      <IntOrString>
  maxUnavailable        <IntOrString>
```

## 8. Định dạng output nâng cao

```bash
# Chỉ lấy tên
kubectl get pods -o name

# Cột tùy chọn
kubectl get pods -o custom-columns=NAME:.metadata.name,NODE:.spec.nodeName,IP:.status.podIP

# JSONPath: lấy đúng trường cần
kubectl get pods -o jsonpath='{.items[*].metadata.name}'
kubectl get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.phase}{"\n"}{end}'
kubectl get nodes -o jsonpath='{.items[*].status.addresses[?(@.type=="InternalIP")].address}'

# Sắp xếp
kubectl get pods --sort-by=.metadata.creationTimestamp
kubectl get pods -A --sort-by='.status.containerStatuses[0].restartCount'
```

Các lệnh này đặc biệt hữu ích khi viết script hoặc làm bài thi.

## 9. Mẹo tiết kiệm thời gian

- Đặt **namespace mặc định** cho context: `kubectl config set-context --current --namespace=dev`.
- Dùng **alias** `k=kubectl` và biến `export do="--dry-run=client -o yaml"` → `k create deploy web --image=nginx $do`.
- `kubectl get pods -o wide -w` trong một cửa sổ terminal riêng khi đang thao tác — bạn sẽ *thấy* Kubernetes làm việc.
- Các bản kubectl gần đây hỗ trợ file tùy chọn cá nhân `~/.kube/kuberc` (beta) để khai báo alias và giá trị mặc định cho lệnh, tách khỏi kubeconfig.

## Thực hành

Dùng cluster kind (hoặc [Playground](/thuc-hanh/playground)):

1. Liệt kê toàn bộ Pod của mọi namespace, kèm node đang chạy.
2. Sinh file `web.yaml` cho Deployment `web` (image `nginx:1.30`, 2 replicas) bằng `--dry-run`, rồi `apply`.
3. Sửa file thành 4 replicas, xem trước bằng `kubectl diff`, rồi `apply`.
4. In ra danh sách IP của các Pod `app=web`, mỗi IP một dòng.
5. Dọn dẹp bằng một lệnh dựa trên file.

::: details Xem lời giải
```bash
# 1
kubectl get pods -A -o wide

# 2
kubectl create deployment web --image=nginx:1.30 --replicas=2 --dry-run=client -o yaml > web.yaml
kubectl apply -f web.yaml

# 3 (sửa replicas: 4 trong web.yaml)
kubectl diff -f web.yaml
kubectl apply -f web.yaml

# 4
kubectl get pods -l app=web -o jsonpath='{range .items[*]}{.status.podIP}{"\n"}{end}'

# 5
kubectl delete -f web.yaml
```
:::

## Lỗi thường gặp

- **Quên `-n`** → "No resources found" dù tài nguyên có tồn tại. Kiểm tra namespace hiện tại: `kubectl config view --minify | grep namespace`.
- **`error: the server doesn't have a resource type "deploymnet"`** → gõ sai tên loại tài nguyên.
- **`Error from server (AlreadyExists)`** khi dùng `create` → dùng `apply` cho quy trình khai báo.
- **`error converting YAML to JSON: yaml: line 12: did not find expected key`** → lỗi thụt lề hoặc Tab quanh dòng 12.
- **`strict decoding error: unknown field "spec.containers[0].imagee"`** → gõ sai tên trường; kubectl kiểm tra chặt chẽ và chỉ đúng chỗ sai.

## Tóm tắt

- Cú pháp: `kubectl <lệnh> <loại> <tên> <cờ>`; dùng tên viết tắt (`po`, `deploy`, `svc`...).
- Làm việc thật theo kiểu **khai báo** với `kubectl apply -f`; dùng lệnh mệnh lệnh + `--dry-run=client -o yaml` để sinh khung.
- Bộ lệnh gỡ lỗi cốt lõi: `get`, `describe`, `logs` (`--previous`), `exec`, `port-forward`, `get events`.
- `kubectl explain` là tài liệu tích hợp, luôn đúng với phiên bản cluster.

## Kiểm tra kiến thức

<Quiz />
