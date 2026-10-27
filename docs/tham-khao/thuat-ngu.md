---
title: Thuật ngữ
description: Bảng thuật ngữ Kubernetes và cloud-native giải thích bằng tiếng Việt, kèm liên kết tới bài học tương ứng.
outline: false
---

# Thuật ngữ Kubernetes

Thuật ngữ được giữ nguyên tiếng Anh (như trong tài liệu, log và lệnh), kèm giải thích ngắn bằng tiếng Việt. Bấm vào tên bài để đọc chi tiết.

| Thuật ngữ | Giải thích | Bài học |
| --- | --- | --- |
| **Admission controller** | Bước kiểm tra/sửa request sau khi đã phân quyền, trước khi lưu vào etcd | [Admission & Policy](/nang-cao/admission-policy) |
| **Affinity / Anti-affinity** | Quy tắc đặt Pod gần hoặc xa node/Pod khác theo label | [Lập lịch](/trung-cap/scheduling) |
| **Annotation** | Cặp key/value mô tả thêm cho đối tượng, không dùng để chọn | [Labels & Namespace](/co-ban/labels-namespace) |
| **API server** (kube-apiserver) | Cổng giao tiếp duy nhất của cluster; mọi thành phần đều nói chuyện qua nó | [Kiến trúc](/co-ban/kien-truc) |
| **CNI** | Chuẩn plugin mạng cấp IP và kết nối Pod (Calico, Cilium, kindnet...) | [Mạng chuyên sâu](/nang-cao/networking) |
| **ConfigMap** | Đối tượng lưu cấu hình dạng key/value hoặc file | [ConfigMap & Secret](/co-ban/configmap-secret) |
| **Container runtime** | Phần mềm chạy container trên node (containerd, CRI-O) qua chuẩn CRI | [Container & Docker](/co-ban/container-va-docker) |
| **Context** | Cặp cluster + user (+ namespace) trong kubeconfig | [Cài đặt](/co-ban/cai-dat) |
| **Control plane** | "Bộ não" của cluster: API server, etcd, scheduler, controller-manager | [Kiến trúc](/co-ban/kien-truc) |
| **Controller** | Vòng lặp liên tục đưa trạng thái thực tế về khớp trạng thái mong muốn | [CRD & Operator](/nang-cao/crd-operator) |
| **CoreDNS** | DNS nội bộ của cluster, phân giải tên Service | [Service](/co-ban/service) |
| **CRD** (CustomResourceDefinition) | Định nghĩa loại tài nguyên mới để mở rộng Kubernetes API | [CRD & Operator](/nang-cao/crd-operator) |
| **CronJob** | Tạo Job theo lịch cron | [DaemonSet, Job & CronJob](/trung-cap/daemonset-job-cronjob) |
| **DaemonSet** | Chạy đúng một Pod trên mỗi node (hoặc nhóm node) | [DaemonSet, Job & CronJob](/trung-cap/daemonset-job-cronjob) |
| **Declarative** (khai báo) | Mô tả trạng thái mong muốn thay vì từng bước thực hiện | [Kubernetes là gì](/co-ban/kubernetes-la-gi) |
| **Deployment** | Quản lý ReplicaSet, hỗ trợ scale, rolling update, rollback | [Deployment](/co-ban/deployment) |
| **Drain / Cordon** | Đuổi Pod khỏi node để bảo trì / đánh dấu node không nhận Pod mới | [Vận hành cluster](/nang-cao/van-hanh-cluster) |
| **emptyDir** | Volume tạm, sống cùng vòng đời Pod | [Lưu trữ](/trung-cap/storage) |
| **EndpointSlice** | Danh sách IP:cổng của các Pod sẵn sàng phía sau Service | [Service](/co-ban/service) |
| **etcd** | Cơ sở dữ liệu key-value phân tán lưu toàn bộ trạng thái cluster | [Kiến trúc](/co-ban/kien-truc) |
| **Eviction** | Trục xuất Pod khỏi node (do thiếu tài nguyên hoặc khi drain) | [Tài nguyên](/trung-cap/resources) |
| **Finalizer** | "Lời hứa dọn dẹp" chặn việc xóa hẳn đối tượng cho tới khi controller xử lý xong | [CRD & Operator](/nang-cao/crd-operator) |
| **Gateway API** | Thế hệ API định tuyến traffic mới: GatewayClass, Gateway, HTTPRoute | [Ingress & Gateway API](/trung-cap/ingress-gateway) |
| **GitOps** | Git là nguồn sự thật; agent trong cluster tự đồng bộ theo Git | [GitOps](/nang-cao/gitops) |
| **Headless Service** | Service không có ClusterIP; DNS trả về thẳng IP các Pod | [Service](/co-ban/service) |
| **Helm chart** | Gói ứng dụng gồm template manifest và values | [Helm](/trung-cap/helm) |
| **HPA** | HorizontalPodAutoscaler — tự điều chỉnh số Pod theo metric | [Autoscaling](/trung-cap/autoscaling) |
| **Image** | Bản mẫu chỉ đọc gồm nhiều layer để tạo container | [Container & Docker](/co-ban/container-va-docker) |
| **Ingress** | Luật định tuyến HTTP vào cluster, cần Ingress controller | [Ingress & Gateway API](/trung-cap/ingress-gateway) |
| **Init container** | Container chạy và hoàn thành trước container chính | [Pod](/co-ban/pod) |
| **Job** | Chạy Pod tới khi đủ số lần hoàn thành | [DaemonSet, Job & CronJob](/trung-cap/daemonset-job-cronjob) |
| **kubeconfig** | File chứa thông tin kết nối cluster của kubectl | [Cài đặt](/co-ban/cai-dat) |
| **kubelet** | Agent trên mỗi node, chạy Pod và báo cáo trạng thái | [Kiến trúc](/co-ban/kien-truc) |
| **kube-proxy** | Lập trình luật mạng trên node để hiện thực Service | [Mạng chuyên sâu](/nang-cao/networking) |
| **Kustomize** | Quản lý cấu hình bằng base + overlay, tích hợp trong kubectl | [Kustomize](/trung-cap/kustomize) |
| **Label / Selector** | Nhãn key/value và bộ lọc theo nhãn — "keo dán" giữa các đối tượng | [Labels & Namespace](/co-ban/labels-namespace) |
| **LimitRange** | Đặt requests/limits mặc định và giới hạn cho container trong namespace | [Tài nguyên](/trung-cap/resources) |
| **Liveness / Readiness / Startup probe** | Kiểm tra sức khỏe: khởi động lại / nhận traffic / đã khởi động xong | [Probes](/trung-cap/probes) |
| **Manifest** | File (thường YAML) mô tả đối tượng Kubernetes | [kubectl](/co-ban/kubectl) |
| **Namespace** | Không gian chia cluster thành nhiều phần logic | [Labels & Namespace](/co-ban/labels-namespace) |
| **NetworkPolicy** | Tường lửa theo label cho luồng vào/ra của Pod | [NetworkPolicy](/nang-cao/network-policy) |
| **Node** | Máy (vật lý hoặc ảo) chạy Pod | [Kiến trúc](/co-ban/kien-truc) |
| **NodePort** | Loại Service mở một cổng (30000–32767) trên mọi node | [Service](/co-ban/service) |
| **OOMKilled** | Container bị kill do vượt giới hạn bộ nhớ (exit code 137) | [Tài nguyên](/trung-cap/resources) |
| **Operator** | CRD + controller tự động hóa vận hành một phần mềm | [CRD & Operator](/nang-cao/crd-operator) |
| **Owner reference** | Liên kết cha–con giữa đối tượng; xóa cha thì con bị xóa theo | [CRD & Operator](/nang-cao/crd-operator) |
| **PDB** (PodDisruptionBudget) | Giới hạn số Pod bị gián đoạn cùng lúc khi bảo trì | [Lập lịch](/trung-cap/scheduling) |
| **Pod** | Đơn vị triển khai nhỏ nhất: một hoặc nhiều container dùng chung mạng và volume | [Pod](/co-ban/pod) |
| **Pod Security Admission** | Áp mức privileged/baseline/restricted theo label namespace | [Bảo mật](/nang-cao/bao-mat) |
| **PV / PVC** | Ổ đĩa trong cluster / yêu cầu lưu trữ của ứng dụng | [Lưu trữ](/trung-cap/storage) |
| **QoS class** | Guaranteed / Burstable / BestEffort — thứ tự ưu tiên khi thiếu tài nguyên | [Tài nguyên](/trung-cap/resources) |
| **RBAC** | Phân quyền theo vai trò: Role, ClusterRole, RoleBinding... | [RBAC](/nang-cao/rbac) |
| **Reconcile** | Hành động đưa thực tế về khớp mong muốn trong một vòng lặp điều khiển | [Kubernetes là gì](/co-ban/kubernetes-la-gi) |
| **ReplicaSet** | Giữ đúng số bản sao Pod | [Deployment](/co-ban/deployment) |
| **Requests / Limits** | Tài nguyên đặt chỗ để xếp lịch / mức trần bị chặn | [Tài nguyên](/trung-cap/resources) |
| **ResourceQuota** | Giới hạn tổng tài nguyên và số đối tượng của namespace | [Tài nguyên](/trung-cap/resources) |
| **Rolling update** | Thay dần Pod cũ bằng Pod mới, không gián đoạn | [Deployment](/co-ban/deployment) |
| **Scheduler** | Thành phần chọn node cho Pod mới | [Kiến trúc](/co-ban/kien-truc) |
| **Secret** | Đối tượng lưu dữ liệu nhạy cảm (base64, nên mã hóa khi lưu trữ) | [ConfigMap & Secret](/co-ban/configmap-secret) |
| **securityContext** | Thiết lập bảo mật cho Pod/container: user, quyền, capabilities... | [Bảo mật](/nang-cao/bao-mat) |
| **Service** | Địa chỉ ổn định và cân bằng tải cho nhóm Pod | [Service](/co-ban/service) |
| **ServiceAccount** | Danh tính của ứng dụng khi gọi Kubernetes API | [RBAC](/nang-cao/rbac) |
| **Sidecar** | Container phụ chạy song song container chính trong Pod | [Pod](/co-ban/pod) |
| **StatefulSet** | Workload cho ứng dụng có trạng thái: tên, DNS, volume ổn định | [StatefulSet](/trung-cap/statefulset) |
| **StorageClass** | "Loại" lưu trữ và provisioner để cấp PV tự động | [Lưu trữ](/trung-cap/storage) |
| **Taint / Toleration** | Node đẩy Pod ra / Pod được phép chạy trên node có taint | [Lập lịch](/trung-cap/scheduling) |
| **Topology spread** | Rải đều Pod theo node/zone | [Lập lịch](/trung-cap/scheduling) |
| **VPA** | VerticalPodAutoscaler — đề xuất/điều chỉnh requests/limits | [Autoscaling](/trung-cap/autoscaling) |
| **Workload** | Ứng dụng chạy trên Kubernetes: Deployment, StatefulSet, DaemonSet, Job... | [DaemonSet, Job & CronJob](/trung-cap/daemonset-job-cronjob) |

## Từ viết tắt hay gặp

| Viết tắt | Đầy đủ | Nghĩa |
| --- | --- | --- |
| K8s | Kubernetes | 8 chữ cái giữa "K" và "s" |
| CNCF | Cloud Native Computing Foundation | Tổ chức quản lý Kubernetes và các dự án cloud-native |
| CRI / CNI / CSI | Container Runtime / Network / Storage Interface | Chuẩn plugin cho runtime, mạng, lưu trữ |
| OCI | Open Container Initiative | Chuẩn định dạng image và runtime |
| HA | High Availability | Sẵn sàng cao |
| RWO / RWX / RWOP | ReadWriteOnce / ReadWriteMany / ReadWriteOncePod | Access mode của volume |
| SLI / SLO | Service Level Indicator / Objective | Chỉ số / mục tiêu chất lượng dịch vụ |
| CEL | Common Expression Language | Ngôn ngữ biểu thức dùng trong policy, CRD validation |
| mTLS | Mutual TLS | TLS hai chiều, cả client và server đều xác thực |
