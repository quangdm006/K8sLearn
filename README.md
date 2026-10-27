# K8s Learn — tự học Kubernetes bằng tiếng Việt

Website tự học Kubernetes từ cơ bản đến nâng cao, xây bằng [VitePress](https://vitepress.dev). Nội dung cập nhật theo **Kubernetes v1.37** (10/2026).

- **32 bài học** theo lộ trình: Cơ bản (10) → Trung cấp (10) → Nâng cao (11) → Dự án cuối khóa.
- Mỗi bài có mục tiêu, giải thích, sơ đồ (Mermaid), ví dụ YAML chạy được, bài tập có lời giải, lỗi thường gặp và **quiz** có giải thích.
- **Theo dõi tiến độ**: đánh dấu hoàn thành, dấu ✓ trên sidebar, điểm quiz tốt nhất — lưu trong `localStorage`, không cần đăng nhập.
- **kubectl Playground**: cluster kind 3 node **mô phỏng** chạy trong trình duyệt, 14 nhiệm vụ tự chấm (Pod, Deployment, rolling update, rollback, Service, DNS, drain node, gỡ lỗi...).
- **Dự án cuối khóa** có lời giải Kustomize đầy đủ trong `examples/capstone`.
- Trang tham khảo: kubectl cheat sheet, thuật ngữ, chứng chỉ & tài nguyên. Tìm kiếm toàn văn, gõ không dấu vẫn tìm được.

## Chạy trên máy

Yêu cầu Node.js 18+ (khuyến nghị 20 hoặc 22).

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # build ra docs/.vitepress/dist
npm run preview    # xem bản build: http://localhost:4173
```

## Cấu trúc

```text
docs/
├── index.md, gioi-thieu.md          Trang chủ, giới thiệu & lộ trình
├── co-ban/ trung-cap/ nang-cao/     Bài học (Markdown)
├── thuc-hanh/                       Dự án cuối khóa, kubectl Playground
├── tham-khao/                       Cheat sheet, thuật ngữ, chứng chỉ
├── public/logo.svg
└── .vitepress/
    ├── config.mts                   Cấu hình site, nav, sidebar (sinh từ curriculum.ts)
    ├── markdown.ts                  Plugin markdown: ```mermaid, checklist "- [ ]"
    └── theme/
        ├── curriculum.ts            DANH MỤC BÀI HỌC — nguồn dữ liệu duy nhất
        ├── composables/progress.ts  Lưu tiến độ & điểm quiz (localStorage)
        ├── components/              Quiz, Mermaid, Roadmap, LessonHeader, LessonComplete,
        │                            SidebarProgress, KubectlPlayground
        └── playground/              Bộ mô phỏng cluster: cluster.ts (controller, scheduler,
                                     vòng đời Pod), kubectl.ts (lệnh), podexec.ts (log, exec,
                                     HTTP), manifest.ts (YAML ↔ đối tượng), missions.ts, files.ts
examples/capstone/                   Lời giải dự án cuối khóa (Kustomize base + overlays)
deploy/                              nginx.conf + manifest để chạy site trên Kubernetes
```

## Thêm hoặc sửa bài học

1. Tạo `docs/<phần>/<slug>.md`, ví dụ `docs/nang-cao/service-mesh.md`.
2. Khai báo trong `docs/.vitepress/theme/curriculum.ts` (tiêu đề, thời lượng). Sidebar, số thứ tự bài, nút "Đánh dấu hoàn thành" và lộ trình tự cập nhật.
3. Thêm quiz vào frontmatter và đặt `<Quiz />` ở cuối bài:

```yaml
---
title: Service mesh
quiz:
  - q: "Câu hỏi (hỗ trợ `code` và **đậm**)?"
    options: ["Đáp án A", "Đáp án B", "Đáp án C"]
    answer: 1            # chỉ số đáp án đúng, bắt đầu từ 0
    explain: "Giải thích hiện ra sau khi chọn."
---
```

Cú pháp hữu ích trong bài:

- Sơ đồ: khối ` ```mermaid ` (người đọc có thể bấm "Phóng to").
- Hộp ghi chú: `::: tip`, `::: info`, `::: warning`, `::: danger`, `::: details Xem lời giải`.
- Nhiều tab: `::: code-group`; checklist: `- [ ] việc cần làm`.
- Nhúng tệp: `<<< @/../examples/capstone/base/redis.yaml`.
- Trong văn bản thường, `{{ }}` bị Vue hiểu là biểu thức — đặt template Helm trong khối code.

## Triển khai

**GitHub Pages:** đẩy repo lên GitHub, vào *Settings → Pages → Source: GitHub Actions*. Workflow `.github/workflows/deploy-pages.yml` tự build với `BASE_PATH=/<tên-repo>/`.

**Docker / Kubernetes** (chính là bài tập áp dụng khóa học):

```bash
docker build -t k8s-learn:1.0.0 .
docker run --rm -p 8080:8080 k8s-learn:1.0.0          # http://localhost:8080

# Trên cluster kind của khóa học
kind load docker-image k8s-learn:1.0.0 --name k8s-learn
kubectl apply -k deploy/k8s
kubectl -n k8s-learn port-forward svc/k8s-learn 8080:80
```

Nếu site chạy trong thư mục con (ví dụ `https://example.com/k8s/`), build với `BASE_PATH=/k8s/` (`docker build --build-arg BASE_PATH=/k8s/ ...`).

## Ghi chú

- Playground là bộ mô phỏng phục vụ học tập, không phải Kubernetes thật; các phần chưa mô phỏng (StatefulSet, Job, Ingress/Gateway, PV, HPA, RBAC, NetworkPolicy, Helm, Kustomize) được hướng dẫn thực hành trên cluster kind.
- Kubernetes® là thương hiệu đã đăng ký của The Linux Foundation. Logo của site là hình vẽ riêng, không phải logo chính thức.
