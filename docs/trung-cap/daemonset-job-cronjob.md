---
title: DaemonSet, Job & CronJob
description: Chạy một Pod trên mỗi node với DaemonSet, tác vụ chạy đến khi xong với Job và tác vụ định kỳ với CronJob.
quiz:
  - q: "Trường hợp nào phù hợp nhất với DaemonSet?"
    options:
      - "Web API cần 5 bản sao"
      - "Agent thu thập log/metrics cần chạy trên MỌI node"
      - "Database PostgreSQL"
      - "Tác vụ sao lưu chạy mỗi đêm"
    answer: 1
    explain: "DaemonSet đảm bảo mỗi node (hoặc mỗi node khớp điều kiện) có đúng một Pod. Node mới tham gia cluster tự động có Pod."
  - q: "Job có `completions: 6` và `parallelism: 2` chạy như thế nào?"
    options:
      - "Chạy 2 Pod, mỗi Pod 6 lần"
      - "Cần 6 Pod chạy thành công, tối đa 2 Pod chạy đồng thời"
      - "Chạy 6 Pod cùng lúc, thử lại 2 lần"
      - "Chạy 12 Pod"
    answer: 1
    explain: "completions = số lần hoàn thành cần đạt; parallelism = số Pod chạy song song tối đa. Job xong khi đủ 6 Pod Succeeded."
  - q: "Trong Job, `restartPolicy` nào là hợp lệ?"
    options:
      - "Always"
      - "OnFailure hoặc Never"
      - "Chỉ Always"
      - "Bất kỳ giá trị nào"
    answer: 1
    explain: "Job cần Pod kết thúc được, nên `Always` không được phép. `OnFailure`: khởi động lại container trong cùng Pod; `Never`: tạo Pod mới cho lần thử lại."
  - q: "CronJob sao lưu mất 90 phút nhưng chạy mỗi giờ. Muốn lần chạy mới bị BỎ QUA nếu lần trước chưa xong, cấu hình gì?"
    options:
      - "`concurrencyPolicy: Allow`"
      - "`concurrencyPolicy: Forbid`"
      - "`concurrencyPolicy: Replace`"
      - "`suspend: true`"
    answer: 1
    explain: "Forbid bỏ qua lần chạy mới khi lần cũ còn chạy. Replace thì hủy lần cũ để chạy lần mới. Allow (mặc định) cho chạy chồng lên nhau."
  - q: "Lệnh nào chạy thử ngay một CronJob tên `backup` mà không chờ lịch?"
    options:
      - "`kubectl run cronjob backup`"
      - "`kubectl create job backup-manual --from=cronjob/backup`"
      - "`kubectl trigger cronjob backup`"
      - "`kubectl rollout restart cronjob/backup`"
    answer: 1
    explain: "Lệnh tạo một Job từ template của CronJob — cách nhanh để kiểm tra cấu hình trước khi đến giờ chạy thật."
---

# DaemonSet, Job & CronJob

::: info Mục tiêu bài học
- Dùng **DaemonSet** để chạy agent trên mọi node (hoặc một nhóm node).
- Dùng **Job** cho tác vụ chạy đến khi hoàn thành: thử lại, song song, giới hạn thời gian.
- Dùng **CronJob** cho tác vụ định kỳ: lịch cron, múi giờ, chính sách chạy chồng.
- Biết chọn đúng loại workload cho từng bài toán.
:::

## 1. Bức tranh các loại workload

| Workload | Mục đích | Ví dụ |
| --- | --- | --- |
| Deployment | Dịch vụ không trạng thái, N bản sao | Web, API |
| StatefulSet | Dịch vụ có trạng thái | Database, Kafka |
| **DaemonSet** | **Một Pod trên mỗi node** | Agent log, giám sát, mạng, lưu trữ |
| **Job** | **Chạy đến khi xong** | Migration, xử lý lô, gửi email hàng loạt |
| **CronJob** | **Job theo lịch** | Backup đêm, báo cáo hằng ngày, dọn dẹp |

## 2. DaemonSet

DaemonSet đảm bảo mỗi node có đúng **một** Pod. Node mới tham gia → tự có Pod; node bị gỡ → Pod bị dọn. Bạn đã gặp DaemonSet: `kube-proxy` và `kindnet` trong `kube-system`.

```yaml
# node-agent.yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-agent
  namespace: kube-system
spec:
  selector:
    matchLabels:
      app: node-agent
  template:
    metadata:
      labels:
        app: node-agent
    spec:
      tolerations:                       # chạy cả trên node control plane
        - key: node-role.kubernetes.io/control-plane
          operator: Exists
          effect: NoSchedule
      containers:
        - name: agent
          image: busybox:1.37
          command: ["sh", "-c", "while true; do echo \"$(date) node=$NODE_NAME\"; sleep 30; done"]
          env:
            - name: NODE_NAME
              valueFrom:
                fieldRef:
                  fieldPath: spec.nodeName
          resources:
            requests: { cpu: 10m, memory: 16Mi }
            limits: { memory: 32Mi }
          volumeMounts:
            - name: varlog
              mountPath: /var/log/host
              readOnly: true
      volumes:
        - name: varlog
          hostPath:
            path: /var/log                # agent đọc log của node (trường hợp hiếm hoi hợp lý cho hostPath)
```

```bash
kubectl apply -f node-agent.yaml
kubectl get ds -n kube-system node-agent
kubectl get pods -n kube-system -l app=node-agent -o wide   # 3 Pod trên 3 node
```

- Không có toleration, Pod sẽ **không** chạy trên control plane (vì taint `node-role.kubernetes.io/control-plane:NoSchedule`).
- Chỉ chạy trên một nhóm node: thêm `nodeSelector` (ví dụ `gpu: "true"`).
- Cập nhật: `updateStrategy: RollingUpdate` (mặc định, có `maxUnavailable`) hoặc `OnDelete`.

Ví dụ thực tế: Fluent Bit / Vector (thu thập log), node-exporter (metrics phần cứng), Cilium/Calico (mạng), CSI node plugin (lưu trữ).

## 3. Job

**Job** tạo Pod và theo dõi đến khi đủ số lần **chạy thành công**. Pod lỗi thì thử lại theo giới hạn.

```yaml
# pi-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: pi
spec:
  backoffLimit: 4                  # thử lại tối đa 4 lần trước khi coi là Failed
  activeDeadlineSeconds: 300       # quá 5 phút thì dừng hẳn
  ttlSecondsAfterFinished: 3600    # tự xóa Job (và Pod) 1 giờ sau khi xong
  template:
    spec:
      restartPolicy: Never         # Job chỉ chấp nhận Never hoặc OnFailure
      containers:
        - name: pi
          image: perl:5.40
          command: ["perl", "-Mbignum=bpi", "-wle", "print bpi(2000)"]
```

```bash
kubectl apply -f pi-job.yaml
kubectl get jobs -w
kubectl logs job/pi | head -c 100
```

```text
NAME   STATUS     COMPLETIONS   DURATION   AGE
pi     Complete   1/1           12s        15s
```

### Song song và hàng đợi công việc

```yaml
spec:
  completions: 6         # cần 6 lần chạy thành công
  parallelism: 2         # tối đa 2 Pod cùng lúc
  completionMode: Indexed   # mỗi Pod nhận chỉ số 0..5 qua biến JOB_COMPLETION_INDEX
```

Với `Indexed`, mỗi Pod xử lý một phần dữ liệu (ví dụ phân vùng thứ `$JOB_COMPLETION_INDEX`) — đơn giản hóa xử lý lô song song.

### Kiểm soát việc thử lại

- `backoffLimit`: số lần thử lại (mặc định 6), thời gian chờ tăng dần giữa các lần.
- `restartPolicy: OnFailure`: khởi động lại container **trong cùng Pod**; `Never`: tạo **Pod mới** mỗi lần thử (giữ lại Pod lỗi để xem log).
- `podFailurePolicy`: quy tắc chi tiết, ví dụ mã thoát 42 = lỗi dữ liệu → dừng ngay, không thử lại vô ích.

::: tip Migration database bằng Job
Mẫu phổ biến: chạy Job migration trước khi cập nhật Deployment (thủ công, qua Helm hook hoặc qua bước trong pipeline CI/CD). Đảm bảo migration **idempotent** (chạy lại nhiều lần không sao) vì Job có thể thử lại.
:::

## 4. CronJob

CronJob tạo Job theo lịch dạng **cron**:

```text
┌───────────── phút (0–59)
│ ┌───────────── giờ (0–23)
│ │ ┌───────────── ngày trong tháng (1–31)
│ │ │ ┌───────────── tháng (1–12)
│ │ │ │ ┌───────────── thứ trong tuần (0–6, 0 = Chủ nhật)
│ │ │ │ │
* * * * *
```

| Lịch | Ý nghĩa |
| --- | --- |
| `*/5 * * * *` | Mỗi 5 phút |
| `0 2 * * *` | 2 giờ sáng mỗi ngày |
| `30 8 * * 1-5` | 8:30 sáng thứ Hai đến thứ Sáu |
| `0 0 1 * *` | 0 giờ ngày 1 hằng tháng |

```yaml
# report-cron.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: daily-report
spec:
  schedule: "0 7 * * *"
  timeZone: "Asia/Ho_Chi_Minh"      # mặc định theo múi giờ của kube-controller-manager (thường UTC)
  concurrencyPolicy: Forbid         # lần trước chưa xong thì bỏ qua lần này
  startingDeadlineSeconds: 600      # lỡ lịch quá 10 phút thì bỏ qua
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  jobTemplate:
    spec:
      backoffLimit: 2
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: report
              image: busybox:1.37
              command: ["sh", "-c", "echo \"Tao bao cao luc $(date)\""]
```

```bash
kubectl apply -f report-cron.yaml
kubectl get cronjob
kubectl create job report-test --from=cronjob/daily-report   # chạy thử ngay
kubectl logs job/report-test
kubectl patch cronjob daily-report -p '{"spec":{"suspend":true}}'   # tạm dừng lịch
```

| `concurrencyPolicy` | Hành vi khi lần trước còn chạy |
| --- | --- |
| `Allow` (mặc định) | Chạy chồng lên nhau |
| `Forbid` | Bỏ qua lần mới |
| `Replace` | Hủy lần cũ, chạy lần mới |

::: warning CronJob không đảm bảo “đúng một lần”
Trong vài tình huống (controller khởi động lại, lỡ lịch), một lần chạy có thể bị bỏ lỡ hoặc — hiếm hơn — chạy hai lần. Viết tác vụ **idempotent** và giám sát lần chạy thành công cuối cùng.
:::

## Thực hành

**Bài 1.** Tạo Job `countdown` dùng busybox in các số từ 10 về 1 (mỗi giây một số). Xem log khi đang chạy.

::: details Xem lời giải
```bash
kubectl create job countdown --image=busybox:1.37 -- sh -c 'for i in $(seq 10 -1 1); do echo $i; sleep 1; done'
kubectl logs -f job/countdown
```
:::

**Bài 2.** Tạo Job luôn thất bại (`exit 1`) với `backoffLimit: 2`, `restartPolicy: Never`. Đếm số Pod được tạo và đọc trạng thái Job.

::: details Xem lời giải
```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: always-fail
spec:
  backoffLimit: 2
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: fail
          image: busybox:1.37
          command: ["sh", "-c", "echo that bai; exit 1"]
```
```bash
kubectl get pods -l job-name=always-fail     # 3 Pod Error (1 lần đầu + 2 lần thử lại)
kubectl describe job always-fail | tail -n 5  # BackoffLimitExceeded
```
:::

**Bài 3.** Viết CronJob chạy mỗi phút, in ngày giờ theo múi giờ Việt Nam, giữ lại tối đa 2 Job thành công. Sau 3 phút, liệt kê các Job đã tạo.

::: details Xem lời giải
```bash
kubectl create cronjob tick --image=busybox:1.37 --schedule="*/1 * * * *" -- date
kubectl patch cronjob tick -p '{"spec":{"timeZone":"Asia/Ho_Chi_Minh","successfulJobsHistoryLimit":2}}'
kubectl get jobs          # tên Job có dạng tick-<thời điểm theo phút>
```
Chỉ còn 2 Job gần nhất; các Job cũ hơn tự bị dọn.
:::

## Lỗi thường gặp

- **Job dùng image web server** (nginx...) → không bao giờ kết thúc, Job chạy mãi.
- **Quên `ttlSecondsAfterFinished`** → hàng nghìn Job/Pod `Completed` tích tụ, làm chậm API server.
- **Lịch cron theo UTC** → báo cáo chạy lúc 14 giờ thay vì 7 giờ sáng. Đặt `timeZone`.
- **DaemonSet không chạy trên một số node** → node có taint mà Pod không có toleration, hoặc `nodeSelector` không khớp.

## Tóm tắt

- **DaemonSet**: một Pod mỗi node; dùng toleration/nodeSelector để chọn node.
- **Job**: chạy đến khi đủ `completions`; điều khiển bằng `parallelism`, `backoffLimit`, `activeDeadlineSeconds`, `ttlSecondsAfterFinished`.
- **CronJob**: Job theo lịch; nhớ `timeZone`, `concurrencyPolicy`, giới hạn lịch sử; tác vụ nên idempotent.

## Kiểm tra kiến thức

<Quiz />
