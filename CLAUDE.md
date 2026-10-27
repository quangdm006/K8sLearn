# K8s Learn — tóm tắt dự án để phát triển tiếp

> Cập nhật lần cuối: 27/10/2026. File này gom những gì cần biết để phát triển tiếp: mục tiêu, cách chạy, kiến trúc, quy ước viết bài, cách kiểm tra, trạng thái và việc còn mở. Claude Code tự đọc file này mỗi khi mở dự án. Khi thay đổi kiến trúc, quy ước hoặc trạng thái, hãy cập nhật file này. [README.md](README.md) là bản giới thiệu ngắn cho người dùng.

## 1. Dự án là gì

- Website **tĩnh** tự học Kubernetes bằng **tiếng Việt**, từ cơ bản đến nâng cao, xây bằng VitePress. Không có backend, không đăng nhập: tiến độ học, điểm quiz và trạng thái playground lưu trong `localStorage` của trình duyệt.
- Người học: lập trình viên, DevOps người Việt chưa biết Kubernetes. Học xong đủ để chạy ứng dụng production và ôn thi CKA/CKAD.
- Nội dung bám theo **Kubernetes v1.37** (tháng 10/2026).
- Quy mô:
  - 32 bài (Cơ bản 10 · Trung cấp 10 · Nâng cao 11 · Dự án cuối khóa 1), ước tính 1.070 phút (~18 giờ).
  - 155 câu quiz trong 31 bài.
  - 46 sơ đồ Mermaid, 38 trang Markdown.
  - Một kubectl Playground mô phỏng với 14 nhiệm vụ tự chấm.
- Mã nguồn: https://github.com/quangdm006/K8sLearn, nhánh `main`.

## 2. Chạy và build

| Lệnh | Tác dụng |
| --- | --- |
| `npm install` | Cài thư viện. Cần Node ≥ 18 (máy dev dùng Node 20, Docker và CI dùng Node 22) |
| `npm run dev` | Server phát triển tại http://localhost:5173, tự tải lại khi sửa `.md`/`.vue` |
| `npm run build` | Build ra `docs/.vitepress/dist` (~40 giây). Build phải sạch: không lỗi, không cảnh báo |
| `npm run preview` | Xem bản build tại http://localhost:4173 |

- Nếu site nằm ở thư mục con (ví dụ `https://example.com/k8s/`), build với `BASE_PATH=/k8s/`.
- `npm run preview` chỉ quét thư mục `dist` lúc khởi động. Build lại thì phải chạy lại preview.
- Sửa `config.mts` khi dev server đang chạy đôi khi làm server thoát. Khi đó chạy lại `npm run dev`.
- Trên Windows, Git Bash tự đổi đối số dạng `/co-ban/pod` thành đường dẫn Windows. Đặt `MSYS_NO_PATHCONV=1` khi truyền đường dẫn URL cho script.

## 3. Triển khai

- **GitHub Pages**:
  - [deploy-pages.yml](.github/workflows/deploy-pages.yml) chạy mỗi lần push vào `main` và build với `BASE_PATH=/<tên-repo>/`.
  - Cần bật *Settings → Pages → Source: GitHub Actions*. Khi đó địa chỉ site là https://quangdm006.github.io/K8sLearn/.
- **Docker**:
  - [Dockerfile](Dockerfile) build hai bước: `node:22-alpine` build site, rồi `nginxinc/nginx-unprivileged:1.30-alpine` phục vụ ở cổng 8080.
  - Dockerfile phải copy cả `examples/`, vì trang dự án cuối khóa nhúng tệp từ đó.
  - [deploy/nginx.conf](deploy/nginx.conf) xử lý `cleanUrls` (`try_files $uri $uri.html`), đặt cache dài cho `/assets/` và mở endpoint `/healthz` cho probe.
- **Kubernetes**: [deploy/k8s/](deploy/k8s/) là bộ Kustomize gồm Namespace, Deployment, Service và PodDisruptionBudget trong namespace `k8s-learn`. Triển khai bằng `kubectl apply -k deploy/k8s`; lệnh đầy đủ có trong README.

## 4. Công nghệ

- **VitePress 1.6.4** (Vue 3.5, Vite 5): dùng theme mặc định, mở rộng bằng slot Layout và component riêng.
- **mermaid ^11.17.2**: cố ý **giữ ở bản 11** vì mermaid 12 đòi Node ≥ 22.12. Chỉ nâng khi máy dev, CI và Docker đều đạt yêu cầu đó, rồi kiểm tra lại toàn bộ sơ đồ.
- **js-yaml ^5.5**: playground dùng để đọc YAML khi chạy `kubectl apply` và để in `-o yaml`.
- Repo chưa có bộ test tự động (xem mục 9).

## 5. Cấu trúc thư mục

```text
docs/
├── index.md                     Trang chủ (hero + <Roadmap />)
├── gioi-thieu.md                Giới thiệu & lộ trình (<Roadmap />)
├── co-ban/ trung-cap/ nang-cao/ Bài học, mỗi bài một tệp .md
├── thuc-hanh/                   du-an-cuoi-khoa.md, playground.md
├── tham-khao/                   cheatsheet.md, thuat-ngu.md, chung-chi.md
├── public/logo.svg              Logo tự vẽ (không phải logo chính thức của Kubernetes)
└── .vitepress/
    ├── config.mts               Cấu hình: nav, sidebar, tìm kiếm, nhãn tiếng Việt
    ├── markdown.ts              Plugin markdown: ```mermaid, checklist "- [ ]"
    └── theme/
        ├── index.ts             Mở rộng theme mặc định, đăng ký component
        ├── style.css            Màu thương hiệu, dấu ✓ sidebar, bảng, checklist
        ├── curriculum.ts        DANH MỤC BÀI HỌC — nguồn dữ liệu duy nhất
        ├── composables/progress.ts
        ├── components/          LessonHeader, LessonComplete, SidebarProgress, Quiz,
        │                        Mermaid, Roadmap, KubectlPlayground
        └── playground/          Bộ mô phỏng cluster (mục 7)
examples/capstone/               Lời giải dự án cuối khóa: Kustomize base, overlays dev/prod,
                                 extras (Argo CD Application, ServiceMonitor)
deploy/                          nginx.conf + manifest để chạy chính site này trên Kubernetes
```

## 6. Kiến trúc site

### Danh mục bài: [curriculum.ts](docs/.vitepress/theme/curriculum.ts)

- `sections`: mỗi phần có `id` (trùng tên thư mục), `label`, `title`, `icon`, `summary` và `lessons` (`slug`, `title`, `minutes`). Thứ tự trong mảng chính là thứ tự bài.
- Mọi thứ sau đều sinh từ đây:
  - sidebar (`buildSidebar()` trong config.mts);
  - header bài, ví dụ "Phần 1 · Cơ bản · Bài 6/10 · khoảng 30 phút";
  - nút "Đánh dấu hoàn thành";
  - trang Lộ trình;
  - tổng số bài khi tính tiến độ.
- `findLesson(page.relativePath)` tìm bài của trang hiện tại. Trang không khai báo ở đây (trang chủ, tham khảo, playground) thì không có header và nút hoàn thành.
- Những chỗ khai báo cứng, phải sửa tay nếu đổi bài đầu của một phần:
  - `nav` trong config.mts;
  - `features` trong `docs/index.md`;
  - các nhóm "Bắt đầu", "Thực hành", "Tham khảo" của sidebar, cũng khai báo tay trong config.mts.

### Theme: [theme/index.ts](docs/.vitepress/theme/index.ts)

- Slot Layout: `doc-before` hiện LessonHeader, `doc-footer-before` hiện LessonComplete, `sidebar-nav-before` hiện SidebarProgress.
- Component toàn cục:
  - `<Quiz />`, `<Roadmap />`;
  - `<Mermaid />`, do plugin markdown sinh ra;
  - `<KubectlPlayground />`, tải bất đồng bộ: chỉ trang playground mới tải bộ mô phỏng và js-yaml.
- `setup()` gọi `initProgress` trong `onMounted`.

### Tiến độ: [progress.ts](docs/.vitepress/theme/composables/progress.ts)

- Khóa `localStorage`:
  - `k8s-learn:done:v1`: mảng link các bài đã xong.
  - `k8s-learn:quiz:v1`: map từ link bài sang `{score, total}`, chỉ giữ điểm cao nhất.
  - Playground dùng khóa riêng `k8s-learn:playground:v1`.
- **Quy tắc:** dữ liệu từ trình duyệt chỉ được đọc sau khi mount. Đọc lúc render sẽ làm HTML phía server và phía trình duyệt lệch nhau (lỗi hydration).
- Đồng bộ giữa các tab qua sự kiện `storage`. Trang Lộ trình có nút "Xóa tiến độ" (`resetAll`).
- SidebarProgress gắn thuộc tính `data-done` trực tiếp vào link sidebar (Vue không quản lý thuộc tính này), rồi CSS vẽ dấu ✓. Việc gắn chạy lại khi đổi trang hoặc khi tiến độ thay đổi.
- Nếu đổi định dạng dữ liệu đã lưu, nên đổi hậu tố khóa (ví dụ `:v2`) để bỏ qua dữ liệu cũ.

### Quiz: [Quiz.vue](docs/.vitepress/theme/components/Quiz.vue)

- Đọc `quiz` trong frontmatter: `q`, `options`, `answer` (chỉ số tính từ 0, theo thứ tự viết trong tệp) và `explain`.
- Thứ tự đáp án hiển thị được **xáo cố định**, theo hạt giống băm từ nội dung câu hỏi (FNV-1a + mulberry32):
  - Thứ tự giống nhau giữa server và trình duyệt, và giữa các lần tải trang.
  - Lý do xáo: khi viết, 76% đáp án đúng nằm ở vị trí B.
  - Sửa nội dung câu hỏi thì thứ tự đáp án đổi theo. Điều này không ảnh hưởng gì.
- `fmt()` escape HTML trước, rồi chỉ hỗ trợ `code` và **đậm**.
- Chỉ chấm điểm khi đã trả lời hết, và lưu điểm tốt nhất của mỗi bài.

### Markdown và sơ đồ

- [markdown.ts](docs/.vitepress/markdown.ts):
  - Khối ```mermaid được đổi thành `<Mermaid code="…">`, nội dung mã hóa bằng `encodeURIComponent`.
  - Plugin `taskLists` hiển thị checklist `- [ ]`.
- [Mermaid.vue](docs/.vitepress/theme/components/Mermaid.vue):
  - Import động `mermaid`, nên thư viện chỉ tải ở trang có sơ đồ.
  - Có hàng đợi render, vì mermaid không vẽ song song được.
  - Dùng theme `base` với bảng màu sáng/tối riêng, vẽ lại khi đổi giao diện, và đặt `securityLevel: 'strict'`.
  - Có nút "Phóng to" (Esc để đóng).
  - CSS `.vp-doc p` từng làm lệch nhãn trong SVG, nên component đã reset style này.

### Cấu hình: [config.mts](docs/.vitepress/config.mts)

- Tìm kiếm local (MiniSearch) dùng `processTerm` bỏ dấu tiếng Việt (chuẩn hóa NFD, xóa U+0300–U+036F, đổi `đ` thành `d`), nên gõ không dấu vẫn tìm được.
  - **Hàm này phải tự chứa:** không dùng biến hay import bên ngoài, vì VitePress chuyển nó thành chuỗi để chạy trên trình duyệt.
- `cleanUrls: true`, `lang: 'vi-VN'`; nhãn giao diện tiếng Việt cho hộp tip/info…, mục lục "Trong bài này", nút bài trước/sau và trang 404.
- `chunkSizeWarningLimit: 800`: các chunk lớn là của Mermaid, chỉ tải khi trang có sơ đồ.

## 7. kubectl Playground (bộ mô phỏng)

- Trang [playground.md](docs/thuc-hanh/playground.md) dùng `layout: page` và `sidebar: false`, bọc `<KubectlPlayground />` trong `<ClientOnly>`.
- Toàn bộ mô phỏng là TypeScript thuần trong [theme/playground/](docs/.vitepress/theme/playground/), không phụ thuộc Vue. Vì vậy có thể bundle để chạy và test trên Node.

**Cluster giả lập**, giống cluster kind của khóa học:
- Tên cluster `k8s-learn`, context `kind-k8s-learn`; server v1.37.0, kubectl v1.37.1.
- 3 node, mỗi node 8 CPU và 15,5 GiB RAM:
  - `k8s-learn-control-plane`, có taint `NoSchedule`;
  - `k8s-learn-worker`;
  - `k8s-learn-worker2`.
- NodePort 30080 và 30100 được "map" ra máy người học.
- Thành phần hệ thống giống cluster thật:
  - static Pod control plane (etcd, kube-apiserver, kube-controller-manager, kube-scheduler);
  - CoreDNS, kindnet, kube-proxy;
  - local-path-provisioner.
- Thời gian được rút ngắn:
  - tạo Pod mất ~2,5 giây, Terminating mất 2,5 giây;
  - CrashLoopBackOff chờ 5 giây, tăng dần tới 40 giây.

| Tệp | Vai trò |
| --- | --- |
| `types.ts` | Kiểu dữ liệu: `ClusterState` (nodes, namespaces, pods, replicasets, deployments, daemonsets, services, configmaps, secrets, events, `flags`, history) và `ExecResult` (các dòng in ra; `stream` cho lệnh chạy liên tục như `get -w`, `logs -f`) |
| `cluster.ts` | `class Cluster` và `createInitialState()`. Mỗi `tick()` chạy:<br>• controller: Deployment rolling update theo `maxSurge`/`maxUnavailable` và progress deadline; ReplicaSet nhận/thả Pod theo label; DaemonSet;<br>• scheduler: taint/toleration, nodeSelector, request CPU/RAM, cordon, thông báo `FailedScheduling`;<br>• vòng đời Pod: ContainerCreating, ErrImagePull/ImagePullBackOff, CreateContainerConfigError, CrashLoopBackOff, OOMKilled, Completed, Terminating; sinh events.<br>Tệp còn chứa hằng số phiên bản, thời gian và danh mục image biết trước |
| `kubectl.ts` | Phần kubectl:<br>• hàm `kubectl()` rẽ nhánh theo verb, mỗi lệnh là một hàm `cmdXxx`;<br>• định dạng bảng, `-o yaml/json/wide/name/jsonpath/custom-columns`, `--sort-by`, `-l`, `--field-selector`, `-w`;<br>• `describe`; `apply/create/delete -f` có kiểm tra trường.<br>Lớp shell (`runCommand` → `dispatch`):<br>• lệnh `ls`, `cat`, `vi`, `touch`, `rm`, `echo`, `curl`, `wget`, `history`, `jobs`, `kill`, `clear`, `reset`;<br>• pipe `grep/head/tail/wc/sort/base64`, chuyển hướng `>`/`>>`;<br>• `complete()` cho phím Tab, gợi ý khi gõ sai lệnh, nội dung `HELP` |
| `manifest.ts` | Chuyển đổi đối tượng ↔ manifest. Schema trường hợp lệ cho `apply` (báo lỗi trường lạ như kubectl thật). `API_VERSIONS`. `UNSUPPORTED_KINDS`: kind có thật nhưng chưa mô phỏng |
| `podexec.ts` | Log container (nginx, redis, podinfo, postgres…); `exec` trong Pod (env, nslookup, curl, wget, nc, ping, cat…); DNS nội bộ; HTTP qua Service, chọn endpoint ngẫu nhiên |
| `jsonpath.ts` | JSONPath rút gọn: `{.a.b}`, `[*]`, `[0]`, `range … end`, lọc `[?(@.x=="y")]` |
| `util.ts` | Hậu tố tên ngẫu nhiên kiểu Kubernetes, hash template của ReplicaSet, cột AGE, in bảng, label selector (`=`, `!=`, `in`, `notin`, có/không có key), phân tích image, base64, kiểm tra tên DNS |
| `files.ts` | Tệp mẫu trong tab "Tệp YAML":<br>• `pod.yaml`, `deployment.yaml`, `service.yaml`, `config-demo.yaml`, `metrics-server.yaml`;<br>• `broken.yaml`: cố ý có 2 lỗi;<br>• `postgres.yaml`: cố ý rơi vào CrashLoopBackOff |
| `missions.ts` | 14 nhiệm vụ. Hàm `check(cluster, now)` của từng nhiệm vụ chạy mỗi giây |
| `components/KubectlPlayground.vue` | Giao diện:<br>• terminal: ↑/↓ xem lịch sử, Tab, Ctrl+C dừng lệnh đang chạy, Ctrl+L;<br>• nút lệnh nhanh, tab Nhiệm vụ / Tệp YAML, nút "Đặt lại cluster";<br>• gọi `tick()` mỗi giây; lưu trạng thái vào `localStorage`, trễ 600 ms |

**14 nhiệm vụ**, theo thứ tự:
1. Khám phá node
2. Pod đầu tiên
3. Deployment
4. Tự phục hồi
5. Scale
6. Service NodePort
7. Gọi Service trong cluster
8. Rolling update
9. Rollback
10. Namespace
11. Apply YAML
12. Gỡ lỗi `broken.yaml`
13. Drain node
14. `kubectl top` (phải cài metrics-server)

**Cách mở rộng**
- *Thêm nhiệm vụ:* thêm phần tử vào `MISSIONS`.
  - Nếu điều kiện suy ra được từ trạng thái cluster, viết nó trong `check`.
  - Nếu điều kiện là "người học đã làm hành động X", đặt cờ `c.state.flags['…'] = true` trong lệnh tương ứng ở kubectl.ts.
  - Các cờ hiện có: `get-nodes`, `self-heal:<deployment>`, `curl-service`, `rolled-back:<deployment>`, `drained:<node>`, `uncordoned-after-drain:<node>`, `top`.
- *Thêm lệnh kubectl:*
  - Thêm `case` trong `kubectl()`, rồi viết hàm `cmdXxx(a, ctx, now)` trả về `ShellResult`.
  - Cờ viết tắt khai báo trong `SHORT`, cờ boolean trong `BOOLEAN`.
  - Cập nhật `HELP` và `complete()`.
- *Thêm loại tài nguyên cho `get`:*
  - Tạo `Res<T>` (cột bảng, manifest) rồi thêm vào `RESOURCES`.
  - Loại chỉ cần trả "No resources found" thì thêm vào `EMPTY_TYPES`.
  - Muốn `apply` được thì thêm schema trong manifest.ts và xử lý trong `applyDoc`.
- *Đổi cấu trúc `ClusterState`:* **tăng `SCHEMA`** trong cluster.ts. Component bỏ qua dữ liệu đã lưu có schema khác. Nếu không tăng, trạng thái cũ trong trình duyệt người học có thể làm hỏng playground.
- *Văn bản:* thông báo lỗi giữ nguyên tiếng Anh, giống hệt kubectl thật. Ghi chú riêng của playground viết tiếng Việt và mở đầu bằng `(playground)`.
- *Chưa mô phỏng:* StatefulSet, Job/CronJob, Ingress/Gateway API, PV/PVC, HPA, RBAC, NetworkPolicy, Helm, Kustomize, `kubectl edit/diff`. Các bài học hướng dẫn thực hành những phần này trên cluster kind.

## 8. Quy ước viết bài

**Thêm bài mới:** tạo `docs/<phần>/<slug>.md` (slug không dấu, nối bằng gạch ngang), rồi khai báo trong `curriculum.ts`.

**Khung một bài.** Mọi bài hiện có đều theo khung này:
1. Frontmatter: `title`, `description`, `quiz`.
2. Khối `::: info Mục tiêu bài học` liệt kê mục tiêu.
3. Các mục nội dung đánh số `## 1. …`, `## 2. …`. Giải thích "vì sao" trước "làm thế nào".
4. `## Thực hành`: **Bài 1.**, **Bài 2.**…, mỗi bài kèm `::: details Xem lời giải`.
5. `## Lỗi thường gặp`, rồi `## Tóm tắt`, rồi `## Kiểm tra kiến thức` kèm `<Quiz />`.

**Quiz:**
- 4–6 câu mỗi bài; mọi chuỗi đặt trong dấu nháy kép.
- `answer` là chỉ số tính từ 0, theo thứ tự trong tệp.
- Câu nào cũng có `explain`. Được dùng `code` và **đậm**.

**Văn phong:**
- Tiếng Việt có dấu, xưng "bạn".
- Thuật ngữ Kubernetes giữ tiếng Anh (Pod, Deployment, Service…) và được giải thích ở lần đầu xuất hiện. Danh sách đầy đủ ở trang Thuật ngữ.

**Ví dụ và lệnh:**
- Mọi lệnh giả định cluster kind `k8s-learn` từ bài Cài đặt: 1 control-plane và 2 worker. Hai NodePort được map ra `localhost`: 30080 cho bài Service, 30100 cho bài Ingress & Gateway API.
- Image luôn ghi tag cụ thể, không dùng `latest`. Bảng phiên bản ở mục 10.
- Image `ngnix:1.30` trong bài Troubleshooting và trong `broken.yaml` là **lỗi cố ý** cho bài tập. Đừng sửa.

**Bẫy kỹ thuật:**
- `{{ }}` trong văn bản thường bị Vue hiểu là biểu thức. Đặt template Helm/Go trong khối code.
- Link nội bộ dùng đường dẫn tuyệt đối, không có đuôi `.md`, ví dụ `/co-ban/pod#...`.
- Anchor được sinh từ tiêu đề tiếng Việt. Đổi tiêu đề thì phải kiểm tra lại các link có `#`.
- Nhúng tệp bằng `<<< @/../examples/capstone/...`, như ở trang dự án cuối khóa.
- Sơ đồ quá rộng sẽ bị thu nhỏ, khó đọc. Ưu tiên chiều dọc (`flowchart TB`) và nhãn ngắn.
- Cú pháp có sẵn: hộp ghi chú `::: tip | info | warning | danger | details`; nhiều tab `::: code-group`; checklist `- [ ]`.

## 9. Kiểm tra chất lượng

**Quy trình sau mỗi thay đổi:**
1. Chạy `npm run build`. Kết quả phải sạch: không lỗi, không cảnh báo.
2. Chạy `npm run preview` rồi mở các trang đã sửa. Với bài có sơ đồ, xem ở cả giao diện sáng và tối.
3. Kiểm tra thêm theo loại thay đổi:
   - Đổi tiêu đề: kiểm tra các link có `#anchor`.
   - Đổi quiz: kiểm tra chỉ số `answer`.
   - Đổi playground: chạy lại các nhiệm vụ liên quan.

**Các kiểm tra đã chạy (10/2026).** Script nằm ngoài repo, ở thư mục tạm, nên sẽ mất. Nếu cần chạy lại, hãy viết lại chúng vào `scripts/`.
- **Từng trang (38):** mở bằng Chrome headless (puppeteer-core). Không có lỗi console hay hydration, 46/46 sơ đồ vẽ xong.
- **Tương tác:**
  - Đánh dấu hoàn thành cập nhật header, dấu ✓ sidebar và thanh tiến độ, và giữ nguyên khi chuyển trang.
  - Lộ trình hiện nút "Học tiếp"; quiz lưu điểm.
  - Tìm "trien khai" ra kết quả "triển khai".
- **Quiz và link:** 155 câu quiz hợp lệ. Mọi link nội bộ có `#anchor` trỏ đúng id trong bản build. Trang không tồn tại trả về 404.
- **YAML:**
  - 142 khối YAML (khối ```yaml trong bài và tệp trong `examples/`) đều parse được bằng js-yaml và không có trường lạ.
  - Cách kiểm tra trường: schema của playground, cộng schema tự viết cho StatefulSet, Job, CronJob, Ingress, NetworkPolicy…
  - **Chưa** đối chiếu với schema chính thức bằng kubeconform, vì môi trường làm việc khi đó không cho tải công cụ ngoài.
- **Playground:**
  - Bundle `playground/*.ts` bằng esbuild để chạy trên Node, giả lập thời gian bằng `Date.now` và `cluster.tick`.
  - Kịch bản tự động đạt 14/14 nhiệm vụ; các luồng lỗi được so với thông báo của kubectl thật.
  - Giao diện đã kiểm tra trên desktop, mobile và dark mode.

## 10. Phiên bản mà nội dung dựa vào (đối chiếu 10/2026)

| Thành phần | Phiên bản | Xuất hiện ở |
| --- | --- | --- |
| Kubernetes | v1.37 (server v1.37.0, kubectl v1.37.1) | Khắp các bài; `SERVER_VERSION`, `CLIENT_VERSION` trong playground/cluster.ts |
| kind | v0.33.0, node image `kindest/node:v1.37.0` | co-ban/cai-dat |
| Helm | 4 (phát hành 11/2025); chart podinfo 6.15.0 | trung-cap/helm |
| Envoy Gateway | v1.9.2 | trung-cap/ingress-gateway |
| cert-manager | v1.21.3 | nang-cao/crd-operator |
| Trivy | 0.76.1 | nang-cao/bao-mat |
| Argo CD | Manifest nhánh `stable`, cài bằng `--server-side` | nang-cao/gitops |
| Gói kubeadm | Repo `pkgs.k8s.io/core:/stable:/v1.37` | nang-cao/van-hanh-cluster |
| metrics-server | v0.9.0 | playground (`metrics-server.yaml`) |
| Image hệ thống của playground | etcd 3.6.4-0, CoreDNS v1.12.3, kustomize v5.7.1 | playground/cluster.ts |
| Image trong ví dụ | `nginx:1.30` (rolling update lên `1.31`), `busybox:1.37`, `redis:8`, `postgres:18`, `ghcr.io/stefanprodan/podinfo:6.15.0`, `nicolaka/netshoot:v0.16`, `traefik/whoami:v1.11`, `curlimages/curl:8.23.0` | Nhiều bài, playground |

Các nhận định trong nội dung cần kiểm tra lại khi cập nhật:
- ingress-nginx đã ngừng phát triển (chỉ bảo trì tới 3/2026), nên bài Ingress lấy Gateway API làm hướng chính.
- kube-proxy: `nftables` GA từ v1.33. `ipvs` deprecated từ v1.35 và dự kiến tắt mặc định ở v1.40.
- Kyverno chuyển sang các loại policy dựa trên CEL (`ValidatingPolicy`…); `ClusterPolicy` đã deprecated.

**Khi lên phiên bản Kubernetes mới** (khoảng 3 bản mỗi năm):
1. Tìm các chỗ ghi phiên bản: `grep -rn --exclude-dir=dist --exclude-dir=cache "1\.37" docs examples deploy README.md`.
2. Cập nhật kind và node image trong bài Cài đặt, cùng các hằng số phiên bản trong playground/cluster.ts.
3. Đọc blog phát hành "Kubernetes v1.xx" và CHANGELOG để tìm tính năng mới GA, API bị gỡ, mặc định thay đổi. Sửa các bài liên quan và bảng ở trên.
4. Chạy lại lab trên cluster thật, rồi build và kiểm tra theo mục 9.

## 11. Trạng thái và việc còn mở (27/10/2026)

**Đã xong:**
- Nội dung: 32 bài kèm quiz, dự án cuối khóa có lời giải Kustomize, 3 trang tham khảo.
- Tính năng: playground 14 nhiệm vụ, theo dõi tiến độ, tìm kiếm không dấu, giao diện tối và mobile.
- Triển khai: tệp cho GitHub Pages, Docker và Kubernetes. Commit đầu tiên đã có trên `main` và đã đẩy lên GitHub.

**Việc nên làm tiếp**, theo thứ tự ưu tiên:
1. **Chạy thử toàn bộ lab trên cluster kind thật.** Các lệnh mới chỉ được đối chiếu với tài liệu chính thức, chưa chạy thật, vì lúc viết Docker Desktop không chạy.
2. Nhờ người am hiểu Kubernetes duyệt nội dung trước khi dùng để đào tạo chính thức.
3. Đưa các script kiểm tra ở mục 9 vào repo và chạy trong CI. Thêm kubeconform nếu môi trường cho phép.
4. Bật GitHub Pages (nếu chưa bật) và kiểm tra lần deploy đầu.
5. Ý tưởng mở rộng:
   - Mô phỏng thêm Job/CronJob, StatefulSet + PVC, HPA và NetworkPolicy trong playground.
   - Thêm bộ đề luyện thi CKA/CKAD.
   - Làm bản tiếng Anh bằng tính năng `locales` của VitePress.
