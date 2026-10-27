---
layout: home
title: Tự học Kubernetes
titleTemplate: K8s Learn — tự học Kubernetes bằng tiếng Việt

hero:
  name: K8s Learn
  text: Tự học Kubernetes từ con số 0 đến production
  tagline: 32 bài học tiếng Việt theo lộ trình, ví dụ YAML chạy được, bài tập có lời giải, quiz sau mỗi bài và một cluster mô phỏng ngay trong trình duyệt.
  image:
    src: /logo.svg
    alt: K8s Learn
  actions:
    - theme: brand
      text: Bắt đầu học →
      link: /gioi-thieu
    - theme: alt
      text: Thử kubectl Playground
      link: /thuc-hanh/playground

features:
  - icon: 🧱
    title: Phần 1 · Cơ bản
    details: Container, kiến trúc cluster, kubectl, Pod, Deployment, Service, ConfigMap & Secret — đủ để chạy ứng dụng đầu tiên.
    link: /co-ban/container-va-docker
    linkText: Vào học
  - icon: ⚙️
    title: Phần 2 · Trung cấp
    details: Probes, tài nguyên, lưu trữ, StatefulSet, Job, Ingress & Gateway API, lập lịch, autoscaling, Helm và Kustomize.
    link: /trung-cap/probes
    linkText: Vào học
  - icon: 🛡️
    title: Phần 3 · Nâng cao
    details: RBAC, bảo mật, NetworkPolicy, mạng chuyên sâu, observability, xử lý sự cố, Operator, GitOps và vận hành cluster.
    link: /nang-cao/rbac
    linkText: Vào học
  - icon: 🧪
    title: kubectl Playground
    details: Cluster 3 node mô phỏng chạy ngay trên trình duyệt — tạo Pod, scale, rolling update, rollback, drain node… không cần cài gì.
    link: /thuc-hanh/playground
    linkText: Mở playground
  - icon: ✅
    title: Quiz & theo dõi tiến độ
    details: Mỗi bài có câu hỏi kèm giải thích. Tiến độ và điểm quiz được lưu ngay trên trình duyệt của bạn.
  - icon: 🚀
    title: Dự án cuối khóa
    details: Tự tay triển khai ứng dụng nhiều tầng với probes, HPA, NetworkPolicy, Gateway API, Kustomize và GitOps.
    link: /thuc-hanh/du-an-cuoi-khoa
    linkText: Xem đề bài
---

## Lộ trình học

Mỗi phần xây dựng trên phần trước. Học theo thứ tự, làm phần **Thực hành** trong từng bài và đánh dấu hoàn thành để theo dõi tiến độ.

<Roadmap />

## Học thế nào cho hiệu quả?

1. **Đọc hiểu khái niệm** — mỗi bài bắt đầu bằng "vì sao" trước khi đến "làm thế nào".
2. **Gõ lại lệnh, đừng copy-paste cả khối** — tay nhớ lâu hơn mắt.
3. **Phá rồi sửa** — cố ý làm sai (xóa Pod, đổi image sai...) để quan sát Kubernetes phản ứng ra sao.
4. **Làm quiz** — nếu sai, đọc lại phần giải thích rồi làm lại.
5. **Làm dự án cuối khóa** — đây là lúc mọi mảnh ghép khớp vào nhau.
