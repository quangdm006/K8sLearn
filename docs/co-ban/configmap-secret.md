---
title: ConfigMap & Secret
description: Tách cấu hình và thông tin nhạy cảm ra khỏi image bằng ConfigMap và Secret; nạp dưới dạng biến môi trường hoặc file; bảo vệ Secret đúng cách.
quiz:
  - q: "Giá trị trong trường `data` của một Secret được lưu ở dạng nào?"
    options:
      - "Mã hóa AES-256 bằng khóa của cluster"
      - "Mã hóa base64 — chỉ là cách biểu diễn, ai đọc được Secret đều giải mã được"
      - "Băm SHA-256, không thể khôi phục"
      - "Văn bản thuần, không biến đổi gì"
    answer: 1
    explain: "base64 là encoding, không phải encryption. Bảo vệ Secret bằng RBAC, mã hóa etcd khi lưu trữ (encryption at rest) và không đưa Secret thô vào Git."
  - q: "Bạn sửa một ConfigMap đang được nạp vào container dưới dạng biến môi trường. Container đang chạy nhận giá trị mới khi nào?"
    options:
      - "Ngay lập tức"
      - "Sau khoảng 1 phút"
      - "Không bao giờ, cho đến khi container được khởi động lại (ví dụ `kubectl rollout restart`)"
      - "Khi Service được tạo lại"
    answer: 2
    explain: "Biến môi trường được “chụp” lúc container khởi động. File mount từ ConfigMap thì được kubelet cập nhật dần (trừ khi dùng subPath)."
  - q: "Pod tham chiếu tới key `DB_HOST` trong ConfigMap `app-config` nhưng ConfigMap chưa tồn tại. Pod sẽ ở trạng thái nào?"
    options:
      - "Running với biến rỗng"
      - "`CreateContainerConfigError`"
      - "`ImagePullBackOff`"
      - "`Completed`"
    answer: 1
    explain: "kubelet không tạo được container vì thiếu cấu hình bắt buộc. Có thể đánh dấu `optional: true` nếu biến đó không bắt buộc."
  - q: "File được mount từ ConfigMap bằng `subPath` có điểm gì cần lưu ý?"
    options:
      - "Không đọc được"
      - "Không được cập nhật khi ConfigMap thay đổi"
      - "Chỉ hoạt động với Secret"
      - "Bị xóa khi Pod khởi động lại"
    answer: 1
    explain: "subPath tiện để đặt một file vào thư mục có sẵn mà không che các file khác, nhưng đánh đổi là không nhận cập nhật tự động."
  - q: "Cách nào phù hợp để lưu cấu hình Secret trong Git một cách an toàn?"
    options:
      - "Commit Secret YAML với giá trị base64"
      - "Dùng Sealed Secrets/SOPS (mã hóa trước khi commit) hoặc External Secrets Operator (đồng bộ từ kho bí mật như Vault)"
      - "Đổi `kind: Secret` thành `kind: ConfigMap`"
      - "Đặt repo ở chế độ private là đủ"
    answer: 1
    explain: "Base64 trong Git = mật khẩu dạng rõ. Hoặc mã hóa trước khi commit, hoặc chỉ commit “tham chiếu” và để operator lấy giá trị thật từ kho bí mật."
---

# ConfigMap & Secret

::: info Mục tiêu bài học
- Tách cấu hình khỏi image theo nguyên tắc **12-factor app**.
- Tạo **ConfigMap** và **Secret** bằng lệnh và YAML.
- Nạp cấu hình vào container dưới dạng **biến môi trường** và **file**.
- Hiểu cách cập nhật cấu hình và các thực hành **bảo mật Secret**.
:::

## 1. Vì sao phải tách cấu hình?

Một image nên chạy được ở **mọi môi trường** (dev, staging, production); thứ thay đổi là cấu hình: địa chỉ database, mức log, feature flag, mật khẩu... Nhúng cấu hình vào image nghĩa là mỗi môi trường một image — khó quản lý và dễ lộ bí mật.

Kubernetes cung cấp hai đối tượng:

| | ConfigMap | Secret |
| --- | --- | --- |
| Dùng cho | Cấu hình thông thường | Mật khẩu, token, khóa, chứng chỉ |
| Lưu trữ | Văn bản thuần | Base64 (+ mã hóa etcd nếu được bật) |
| Giới hạn kích thước | 1 MiB | 1 MiB |
| Cách dùng | Biến môi trường hoặc file | Biến môi trường hoặc file (khuyến nghị file) |

## 2. ConfigMap

### Tạo ConfigMap

```bash
# Từ giá trị trực tiếp
kubectl create configmap app-config \
  --from-literal=APP_MODE=production \
  --from-literal=LOG_LEVEL=info

# Từ file (tên file thành key, nội dung file thành value)
kubectl create configmap nginx-conf --from-file=default.conf

# Từ file .env (mỗi dòng KEY=VALUE thành một key)
kubectl create configmap app-env --from-env-file=app.env
```

Hoặc khai báo bằng YAML:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  APP_MODE: "production"
  LOG_LEVEL: "info"
  app.properties: |            # một key có thể chứa cả một file
    cache.ttl=300
    feature.newCheckout=true
```

### Nạp vào container

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: config-demo
spec:
  containers:
    - name: app
      image: busybox:1.37
      command: ["sh", "-c", "echo mode=$APP_MODE level=$LOG_LEVEL; cat /etc/app/app.properties; sleep 3600"]
      env:
        - name: APP_MODE                 # lấy từng key
          valueFrom:
            configMapKeyRef:
              name: app-config
              key: APP_MODE
        - name: LOG_LEVEL
          valueFrom:
            configMapKeyRef:
              name: app-config
              key: LOG_LEVEL
              optional: true             # thiếu key cũng không sao
      volumeMounts:
        - name: config
          mountPath: /etc/app            # mỗi key thành một file trong thư mục này
          readOnly: true
  volumes:
    - name: config
      configMap:
        name: app-config
        items:                           # chỉ lấy những key cần làm file
          - key: app.properties
            path: app.properties
```

```bash
kubectl apply -f config-demo.yaml
kubectl logs config-demo
# mode=production level=info
# cache.ttl=300
# feature.newCheckout=true
```

Muốn nạp **toàn bộ** key thành biến môi trường thì dùng `envFrom`:

```yaml
      envFrom:
        - configMapRef:
            name: app-env
          prefix: APP_          # tùy chọn: thêm tiền tố cho mọi biến
```

::: tip Tách ConfigMap theo mục đích
Nên để ConfigMap cho biến môi trường (key dạng `UPPER_CASE`) và ConfigMap chứa file cấu hình (`nginx.conf`, `app.yaml`) riêng — dễ đọc và tránh nạp nhầm cả nội dung file thành biến môi trường.
:::

### Ví dụ thực tế: cấu hình nginx bằng ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: nginx-conf
data:
  default.conf: |
    server {
      listen 80;
      location / {
        return 200 "Xin chao tu ConfigMap!\n";
      }
      location /healthz {
        return 200 "ok\n";
      }
    }
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-custom
spec:
  replicas: 2
  selector:
    matchLabels: { app: nginx-custom }
  template:
    metadata:
      labels: { app: nginx-custom }
    spec:
      containers:
        - name: nginx
          image: nginx:1.30
          volumeMounts:
            - name: conf
              mountPath: /etc/nginx/conf.d     # thay thế thư mục cấu hình mặc định
      volumes:
        - name: conf
          configMap:
            name: nginx-conf
```

```bash
kubectl apply -f nginx-custom.yaml
kubectl port-forward deploy/nginx-custom 8080:80
curl http://localhost:8080          # Xin chao tu ConfigMap!
```

## 3. Secret

### Tạo Secret

```bash
kubectl create secret generic db-credentials \
  --from-literal=DB_USER=shop \
  --from-literal=DB_PASSWORD='S3cr3t!2026'
```

Bằng YAML, dùng `stringData` để viết giá trị thường (Kubernetes tự chuyển sang base64):

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials
type: Opaque
stringData:
  DB_USER: shop
  DB_PASSWORD: "S3cr3t!2026"
```

Xem lại sẽ thấy giá trị ở dạng base64 trong `data`:

```bash
kubectl get secret db-credentials -o yaml
kubectl get secret db-credentials -o jsonpath='{.data.DB_PASSWORD}' | base64 -d
```

::: code-group

```bash [Linux/macOS/Git Bash]
kubectl get secret db-credentials -o jsonpath='{.data.DB_PASSWORD}' | base64 -d
```

```powershell [PowerShell]
$b64 = kubectl get secret db-credentials -o jsonpath='{.data.DB_PASSWORD}'
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
```

:::

::: danger Base64 không phải mã hóa
Bất kỳ ai có quyền `get secret` (hoặc đọc được etcd, file backup etcd) đều đọc được mật khẩu. Hãy xem mục 5 để bảo vệ Secret đúng cách.
:::

Các loại Secret thường gặp:

| `type` | Dùng cho | Tạo bằng |
| --- | --- | --- |
| `Opaque` | Dữ liệu tùy ý | `kubectl create secret generic` |
| `kubernetes.io/tls` | Chứng chỉ + khóa TLS | `kubectl create secret tls web-tls --cert=tls.crt --key=tls.key` |
| `kubernetes.io/dockerconfigjson` | Đăng nhập registry private | `kubectl create secret docker-registry` |
| `kubernetes.io/basic-auth` | Username/password | YAML |

### Dùng Secret trong Pod

Giống ConfigMap, chỉ đổi `configMapKeyRef` → `secretKeyRef`, `configMap` → `secret`:

```yaml
spec:
  containers:
    - name: api
      image: nginx:1.30
      env:
        - name: DB_USER
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: DB_USER
      volumeMounts:
        - name: db-secret
          mountPath: /run/secrets/db     # file /run/secrets/db/DB_PASSWORD
          readOnly: true
  volumes:
    - name: db-secret
      secret:
        secretName: db-credentials
        defaultMode: 0400                # chỉ chủ sở hữu được đọc
```

::: tip Ưu tiên mount Secret thành file
Biến môi trường dễ bị lộ: in ra log khi gỡ lỗi, lọt vào crash report, bị tiến trình con kế thừa. File trong volume (lưu trên tmpfs — RAM của node) an toàn hơn và còn được cập nhật khi Secret đổi.
:::

### Kéo image từ registry private

```bash
kubectl create secret docker-registry regcred \
  --docker-server=ghcr.io \
  --docker-username=<user> \
  --docker-password=<personal-access-token>
```

```yaml
spec:
  imagePullSecrets:
    - name: regcred
  containers:
    - name: app
      image: ghcr.io/my-org/private-app:1.0.0
```

Có thể gắn `imagePullSecrets` vào **ServiceAccount** để mọi Pod dùng ServiceAccount đó tự có quyền kéo image.

## 4. Cập nhật cấu hình

| Cách nạp | Khi ConfigMap/Secret thay đổi |
| --- | --- |
| Biến môi trường (`env`, `envFrom`) | **Không đổi** cho tới khi container khởi động lại |
| Volume (mount thư mục) | File được kubelet cập nhật sau một khoảng ngắn (thường dưới 1–2 phút); ứng dụng phải tự đọc lại |
| Volume với `subPath` | **Không bao giờ** được cập nhật |

Cách phổ biến để áp dụng cấu hình mới: `kubectl rollout restart deployment/<tên>`. Các công cụ ở Phần 2 làm việc này tự động:

- **Kustomize** `configMapGenerator` thêm hậu tố hash vào tên ConfigMap → nội dung đổi là tên đổi → Deployment tự rollout.
- **Helm** thường thêm annotation `checksum/config` vào Pod template với cùng mục đích.

Với cấu hình không bao giờ đổi, đặt `immutable: true` để tránh sửa nhầm và giảm tải cho API server:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config-v3
immutable: true
data:
  APP_MODE: production
```

## 5. Bảo vệ Secret trong thực tế

1. **Mã hóa etcd khi lưu trữ** (encryption at rest) với `EncryptionConfiguration`, tốt nhất qua **KMS**. Nhiều dịch vụ managed bật sẵn hoặc cho phép bật bằng một tùy chọn.
2. **RBAC tối thiểu**: rất ít người/ứng dụng cần quyền `get`/`list` Secret. Lưu ý: ai tạo được Pod trong namespace thì cũng có thể mount và đọc Secret của namespace đó.
3. **Không commit Secret thô vào Git.** Chọn một trong các cách:
   - **Sealed Secrets** — mã hóa Secret bằng khóa công khai của cluster, commit bản mã hóa an toàn.
   - **SOPS** — mã hóa file YAML bằng age/KMS, giải mã lúc deploy.
   - **External Secrets Operator** — đồng bộ từ Vault, AWS Secrets Manager, GCP Secret Manager, Azure Key Vault... vào Secret của Kubernetes.
   - **Secrets Store CSI Driver** — mount bí mật thẳng từ kho bí mật vào Pod dưới dạng file.
4. **Xoay vòng (rotate)** mật khẩu, token định kỳ và khi có người rời dự án.

## Thực hành

**Bài 1.** Tạo ConfigMap `shop-config` với `CURRENCY=VND`, `PAGE_SIZE=20`, và Secret `shop-secret` với `API_KEY=abc123`. Tạo Pod busybox in ra cả ba biến khi khởi động (dùng `envFrom` cho cả hai).

::: details Xem lời giải
```bash
kubectl create configmap shop-config --from-literal=CURRENCY=VND --from-literal=PAGE_SIZE=20
kubectl create secret generic shop-secret --from-literal=API_KEY=abc123
```
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: shop-env
spec:
  restartPolicy: Never
  containers:
    - name: app
      image: busybox:1.37
      command: ["sh", "-c", "echo $CURRENCY $PAGE_SIZE $API_KEY"]
      envFrom:
        - configMapRef:
            name: shop-config
        - secretRef:
            name: shop-secret
```
```bash
kubectl apply -f shop-env.yaml && sleep 5 && kubectl logs shop-env
# VND 20 abc123
```
:::

**Bài 2.** Với Deployment `nginx-custom` ở mục 2, sửa ConfigMap để trả về câu chào mới. Kiểm tra: nginx có tự áp dụng không? Làm thế nào để áp dụng?

::: details Xem lời giải
File trong container được cập nhật sau khoảng một phút (kiểm tra bằng `kubectl exec deploy/nginx-custom -- cat /etc/nginx/conf.d/default.conf`), **nhưng nginx không tự đọc lại cấu hình** nên vẫn trả lời câu cũ. Cách xử lý:
```bash
kubectl rollout restart deployment/nginx-custom
```
Hoặc gửi tín hiệu reload cho nginx trong từng Pod: `kubectl exec <pod> -- nginx -s reload`. Bài học: file được cập nhật **không có nghĩa** ứng dụng dùng cấu hình mới.
:::

**Bài 3.** Tạo Pod tham chiếu ConfigMap `khong-ton-tai` qua `configMapKeyRef`. Quan sát trạng thái, đọc Events, sau đó tạo ConfigMap và xem Pod tự hồi phục.

::: details Xem lời giải
```bash
kubectl get pod <pod>        # STATUS: CreateContainerConfigError
kubectl describe pod <pod>   # Events: Error: configmap "khong-ton-tai" not found
kubectl create configmap khong-ton-tai --from-literal=<key>=<value>
kubectl get pod <pod> -w     # kubelet thử lại và Pod chuyển sang Running
```
:::

## Lỗi thường gặp

- **Mật khẩu có ký tự xuống dòng thừa** khi tự mã hóa: dùng `echo -n 'pass' | base64` (có `-n`), hoặc dùng `stringData` / `kubectl create secret` để khỏi tự mã hóa.
- **Mount ConfigMap vào thư mục có sẵn** (như `/etc/nginx`) làm **mất** các file gốc trong thư mục đó → mount vào thư mục con, hoặc dùng `subPath` cho từng file (chấp nhận không tự cập nhật).
- **ConfigMap/Secret khác namespace với Pod** → Pod chỉ tham chiếu được đối tượng trong **cùng namespace**.
- **Kỳ vọng ứng dụng tự nạp cấu hình mới** → phần lớn ứng dụng chỉ đọc cấu hình lúc khởi động.

## Tóm tắt

- ConfigMap cho cấu hình thường, Secret cho dữ liệu nhạy cảm; cả hai giới hạn 1 MiB và chỉ dùng được trong cùng namespace.
- Nạp bằng `env`/`envFrom` (cố định khi khởi động) hoặc volume (file, tự cập nhật trừ `subPath`).
- Secret chỉ là base64 — cần RBAC, mã hóa etcd và công cụ như Sealed Secrets / External Secrets.
- Áp dụng cấu hình mới bằng `kubectl rollout restart` hoặc tên ConfigMap có hash (Kustomize/Helm).

## Kiểm tra kiến thức

<Quiz />
