---
title: Cài đặt môi trường thực hành
description: Cài kubectl, tạo cluster Kubernetes nhiều node trên máy cá nhân bằng kind (Windows, macOS, Linux) và các công cụ hỗ trợ.
quiz:
  - q: "kind chạy các node Kubernetes dưới dạng gì?"
    options:
      - "Máy ảo VirtualBox"
      - "Container Docker — mỗi node là một container"
      - "Tiến trình chạy trực tiếp trên Windows"
      - "Máy chủ trên cloud"
    answer: 1
    explain: "kind = Kubernetes IN Docker. Mỗi node là một container chứa sẵn kubelet, containerd... nên tạo/xóa cluster chỉ mất vài chục giây."
  - q: "kubectl biết phải kết nối tới cluster nào dựa vào đâu?"
    options:
      - "Biến môi trường CLUSTER_NAME"
      - "File kubeconfig (mặc định `~/.kube/config`) và context hiện tại"
      - "kubectl tự dò tìm cluster trong mạng LAN"
      - "File /etc/hosts"
    answer: 1
    explain: "kubeconfig chứa danh sách cluster, user (chứng chỉ/token) và context (cặp cluster + user + namespace). `kubectl config use-context` chọn context đang dùng."
  - q: "Bạn build image `hello-k8s:v1` trên máy rồi tạo Pod trên kind thì gặp `ErrImagePull`. Cách khắc phục nhanh nhất?"
    options:
      - "Cài lại kind"
      - "Đổi tên image thành `hello-k8s:latest`"
      - "Chạy `kind load docker-image hello-k8s:v1 --name k8s-learn` để nạp image vào các node"
      - "Khởi động lại Docker"
    answer: 2
    explain: "Node kind có containerd riêng, không thấy image trong Docker của máy bạn. `kind load` sao chép image vào từng node. Đổi sang `latest` còn tệ hơn vì pull policy mặc định của `latest` là Always."
  - q: "Trên Windows/macOS, vì sao cần `extraPortMappings` để truy cập NodePort của cluster kind từ trình duyệt?"
    options:
      - "Vì NodePort chỉ hoạt động trên Linux"
      - "Vì node kind là container nằm trong máy ảo của Docker Desktop, IP của nó không truy cập trực tiếp được từ máy bạn"
      - "Vì Windows chặn mọi cổng trên 30000"
      - "Vì kind không hỗ trợ Service"
    answer: 1
    explain: "`extraPortMappings` publish cổng của container node ra localhost, giống `docker run -p`. Trên Linux bạn có thể gọi thẳng IP node trong mạng Docker."
  - q: "Lệnh nào chỉ kiểm tra phiên bản kubectl mà không cần kết nối cluster?"
    options:
      - "`kubectl version --client`"
      - "`kubectl get version`"
      - "`kubectl cluster-info`"
      - "`kubectl --version-only`"
    answer: 0
    explain: "`kubectl version` (không có `--client`) sẽ hỏi thêm phiên bản API server và báo lỗi nếu chưa có cluster."
---

# Cài đặt môi trường thực hành

::: info Mục tiêu bài học
- Cài **kubectl** — công cụ dòng lệnh để làm việc với mọi cluster.
- Tạo cluster **3 node** trên máy cá nhân bằng **kind**, sẵn sàng cho toàn bộ khóa học.
- Hiểu **kubeconfig** và **context**.
- Biết các lựa chọn khác (minikube, k3d, Docker Desktop, môi trường online) và công cụ giúp làm việc nhanh hơn.
:::

## 1. Chọn công cụ nào?

| Công cụ | Ưu điểm | Nhược điểm | Phù hợp |
| --- | --- | --- | --- |
| **kind** | Nhẹ, tạo cluster nhiều node trong ~1 phút, giống Kubernetes chuẩn | Cần Docker; truy cập cổng phải map trước | **Khuyến nghị cho khóa học** |
| **minikube** | Nhiều addon bật sẵn bằng 1 lệnh, hỗ trợ nhiều driver | Nặng hơn kind một chút | Người mới, cần addon nhanh |
| **k3d** | Chạy k3s (bản rút gọn), có sẵn Traefik và metrics-server | k3s khác upstream ở vài chi tiết | Máy yếu |
| **Docker Desktop** | Bật Kubernetes bằng một cú click | Ít tùy biến | Thử nhanh |
| **Killercoda** (online) | Không cài gì, chạy trên trình duyệt | Phiên làm việc giới hạn thời gian | Máy công ty bị khóa |

Toàn bộ khóa học dùng **kind** làm chuẩn; mọi lệnh đều chạy được trên các công cụ khác với chút điều chỉnh.

**Yêu cầu máy:** 4 CPU, 8 GB RAM, 20 GB ổ trống (tối thiểu 2 CPU / 4 GB nếu chỉ chạy cluster 1 node).

## 2. Cài Docker

- **Windows / macOS:** cài [Docker Desktop](https://www.docker.com/products/docker-desktop/). Trên Windows, chọn backend **WSL 2**.
- **Linux:** cài Docker Engine theo [hướng dẫn chính thức](https://docs.docker.com/engine/install/) và thêm user vào nhóm `docker`.

Kiểm tra: `docker run --rm hello-world`.

::: tip Windows: cấp đủ RAM cho WSL 2
Tạo file `%UserProfile%\.wslconfig` với nội dung dưới đây rồi chạy `wsl --shutdown` và mở lại Docker Desktop:

```ini
[wsl2]
memory=8GB
processors=4
```
:::

## 3. Cài kubectl

::: code-group

```powershell [Windows]
winget install -e --id Kubernetes.kubectl
# hoặc: choco install kubernetes-cli   |   scoop install kubectl
```

```bash [macOS]
brew install kubectl
```

```bash [Linux]
curl -LO "https://dl.k8s.io/release/$(curl -Ls https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
```

:::

Kiểm tra (mở terminal mới sau khi cài):

```bash
kubectl version --client
# Client Version: v1.37.1
# Kustomize Version: v5.x.x
```

::: warning Lệch phiên bản kubectl và cluster
kubectl được hỗ trợ chính thức khi lệch **tối đa 1 bản minor** so với API server (ví dụ kubectl v1.37 dùng tốt với cluster v1.36–v1.38). Docker Desktop cũng tự cài một bản kubectl — nếu gõ `kubectl` thấy phiên bản lạ, hãy kiểm tra `PATH`.
:::

## 4. Cài kind

::: code-group

```powershell [Windows]
winget install -e --id Kubernetes.kind
```

```bash [macOS]
brew install kind
```

```bash [Linux]
[ $(uname -m) = x86_64 ] && curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.33.0/kind-linux-amd64
[ $(uname -m) = aarch64 ] && curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.33.0/kind-linux-arm64
chmod +x ./kind && sudo mv ./kind /usr/local/bin/kind
```

:::

## 5. Tạo cluster 3 node cho khóa học

Tạo file `kind-config.yaml`:

```yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: k8s-learn
nodes:
  - role: control-plane
    extraPortMappings:
      # Bài Service: truy cập NodePort 30080 qua http://localhost:30080
      - containerPort: 30080
        hostPort: 30080
      # Bài Ingress & Gateway API: http://localhost:30100
      - containerPort: 30100
        hostPort: 30100
  - role: worker
  - role: worker
```

Tạo cluster:

```bash
kind create cluster --config kind-config.yaml
```

```text
Creating cluster "k8s-learn" ...
 ✓ Ensuring node image (kindest/node:v1.37.0) 🖼
 ✓ Preparing nodes 📦 📦 📦
 ✓ Writing configuration 📜
 ✓ Starting control-plane 🕹️
 ✓ Installing CNI 🔌
 ✓ Installing StorageClass 💾
 ✓ Joining worker nodes 🚜
Set kubectl context to "kind-k8s-learn"
```

Kiểm tra:

```bash
kubectl cluster-info
kubectl get nodes
```

```text
NAME                      STATUS   ROLES           AGE   VERSION
k8s-learn-control-plane   Ready    control-plane   75s   v1.37.0
k8s-learn-worker          Ready    <none>          58s   v1.37.0
k8s-learn-worker2         Ready    <none>          58s   v1.37.0
```

🎉 Bạn đã có một cluster Kubernetes thật với 1 control plane và 2 worker.

::: info Mỗi node là một container
Chạy `docker ps` — bạn sẽ thấy 3 container `k8s-learn-control-plane`, `k8s-learn-worker`, `k8s-learn-worker2`. Muốn tạm dừng để giải phóng RAM: `docker stop` các container này; chạy lại bằng `docker start`.
:::

## 6. kubeconfig và context

kind tự ghi thông tin kết nối vào **kubeconfig** (`~/.kube/config`, trên Windows là `%USERPROFILE%\.kube\config`). File này gồm ba phần:

```yaml
clusters:   # địa chỉ API server + chứng chỉ CA
  - name: kind-k8s-learn
users:      # thông tin xác thực (chứng chỉ client, token...)
  - name: kind-k8s-learn
contexts:   # ghép cluster + user (+ namespace mặc định)
  - name: kind-k8s-learn
    context: { cluster: kind-k8s-learn, user: kind-k8s-learn }
current-context: kind-k8s-learn
```

Các lệnh hay dùng:

```bash
kubectl config get-contexts              # liệt kê context, dấu * là context hiện tại
kubectl config current-context
kubectl config use-context kind-k8s-learn
kubectl config set-context --current --namespace=dev   # đổi namespace mặc định
```

::: danger Luôn biết mình đang ở cluster nào
Khi đi làm, kubeconfig của bạn có thể chứa cả cluster **production**. Rất nhiều sự cố bắt nguồn từ việc chạy lệnh xóa nhầm context. Hãy hiển thị context trên prompt (kube-ps1, starship) hoặc dùng `kubectx` để chuyển đổi có chủ đích.
:::

## 7. Đưa image tự build vào kind

Node kind có containerd riêng nên **không thấy image trong Docker** của máy bạn. Với image `hello-k8s:v1` từ [bài 1](/co-ban/container-va-docker):

```bash
kind load docker-image hello-k8s:v1 --name k8s-learn
kubectl run hello --image=hello-k8s:v1 --port=8080
kubectl get pods
```

Ở môi trường thật, bạn sẽ đẩy image lên registry (Docker Hub, GHCR, Harbor...) thay vì nạp tay.

## 8. Công cụ giúp làm việc nhanh hơn

**Tự động hoàn thành lệnh và alias `k`:**

::: code-group

```bash [bash]
echo 'source <(kubectl completion bash)' >> ~/.bashrc
echo 'alias k=kubectl' >> ~/.bashrc
echo 'complete -o default -F __start_kubectl k' >> ~/.bashrc
```

```bash [zsh]
echo 'source <(kubectl completion zsh)' >> ~/.zshrc
echo 'alias k=kubectl' >> ~/.zshrc
```

```powershell [PowerShell]
kubectl completion powershell >> $PROFILE
Add-Content $PROFILE 'Set-Alias -Name k -Value kubectl'
Add-Content $PROFILE 'Register-ArgumentCompleter -CommandName k -ScriptBlock $__kubectlCompleterBlock'
```

:::

**Công cụ nên có:**

- [k9s](https://k9scli.io/) — giao diện terminal để duyệt và thao tác cluster rất nhanh.
- [kubectx & kubens](https://github.com/ahmetb/kubectx) — chuyển context/namespace bằng một lệnh.
- [Helm](https://helm.sh/) — trình quản lý gói (cài ở Phần 2).
- [krew](https://krew.sigs.k8s.io/) — trình quản lý plugin cho kubectl.
- **VS Code** + extension *Kubernetes* và *YAML* (của Red Hat) — gợi ý và kiểm tra cú pháp manifest.

## 9. Các lựa chọn khác

::: code-group

```bash [minikube]
minikube start --nodes 3
minikube addons enable metrics-server
minikube service <ten-service> --url      # lấy URL truy cập Service
```

```bash [k3d]
k3d cluster create k8s-learn --agents 2 -p "30080:30080@server:0"
# k3s có sẵn Traefik (ingress), local-path (storage) và metrics-server
```

```text [Docker Desktop]
Settings → Kubernetes → Enable Kubernetes → Apply & restart
Có thể chọn cluster 1 node hoặc nhiều node (dựa trên kind).
```

:::

**Không cài được gì?** Dùng [Killercoda](https://killercoda.com/playgrounds) (Kubernetes thật trên trình duyệt, miễn phí) hoặc [kubectl Playground](/thuc-hanh/playground) của trang này để luyện lệnh cơ bản.

## 10. Dọn dẹp

```bash
kind get clusters
kind delete cluster --name k8s-learn
```

Tạo lại chỉ mất khoảng một phút — đừng ngại xóa cluster khi lỡ làm hỏng.

## Lỗi thường gặp

| Triệu chứng | Nguyên nhân & cách xử lý |
| --- | --- |
| `Cannot connect to the Docker daemon` | Docker Desktop chưa chạy, hoặc user Linux chưa thuộc nhóm `docker` |
| `The connection to the server localhost:8080 was refused` | kubectl không có kubeconfig/context. Kiểm tra `kubectl config get-contexts` |
| `bind: address already in use` khi tạo cluster | Cổng 30080/30100 đã bị chiếm. Đổi `hostPort` trong file cấu hình |
| Pod hệ thống `Pending`, node `NotReady` | Thiếu RAM/CPU cho Docker. Tăng giới hạn trong Docker Desktop / `.wslconfig` |
| Không kéo được image (mạng công ty) | Cấu hình proxy trong Docker Desktop; với kind, đặt `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` trước khi `kind create cluster` — kind sẽ truyền chúng vào node |

## Tóm tắt

- `kubectl` là công cụ làm việc với mọi cluster; nên lệch tối đa 1 bản minor so với cluster.
- `kind` tạo cluster nhiều node trong Docker — mỗi node là một container.
- kubeconfig chứa cluster, user, context; luôn kiểm tra context trước khi chạy lệnh nguy hiểm.
- Image build ở máy cần `kind load docker-image` hoặc đẩy lên registry.

## Kiểm tra kiến thức

<Quiz />
