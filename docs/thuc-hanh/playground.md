---
title: kubectl Playground
description: Luyện kubectl trên một cluster Kubernetes mô phỏng ngay trong trình duyệt — tạo Pod, Deployment, Service, rolling update, rollback, drain node... không cần cài đặt.
layout: page
sidebar: false
---

<ClientOnly>
  <KubectlPlayground />
</ClientOnly>

<div class="vp-doc kp-notes">

## Playground mô phỏng những gì?

Đây là một **bộ mô phỏng** viết bằng JavaScript, không phải Kubernetes thật — nhưng hành vi và thông báo lỗi được làm giống kubectl nhất có thể để bạn luyện phản xạ:

- **Pod**: vòng đời `Pending → ContainerCreating → Running`, `CrashLoopBackOff` (có đếm số lần khởi động lại), `ImagePullBackOff`, `CreateContainerConfigError`, `OOMKilled`, `Completed`; log thực tế của nginx, redis, podinfo, postgres...
- **Deployment / ReplicaSet**: scale, tự phục hồi, rolling update theo `maxSurge`/`maxUnavailable`, rollout bị kẹt, `rollout history | undo | restart`.
- **Service & DNS**: ClusterIP, NodePort (cổng 30080 "map" ra máy bạn), LoadBalancer `<pending>`, EndpointSlice, cân bằng tải ngẫu nhiên, `nslookup`, `curl`, `wget` từ trong Pod.
- **ConfigMap, Secret, Namespace, DaemonSet**, lập lịch theo taint/nodeSelector/requests, `cordon`, `drain`, `taint`, `top` (sau khi cài metrics-server).
- **`kubectl apply -f`** với kiểm tra YAML thật: sai cú pháp, gõ sai tên trường, `selector` không khớp label, kiểu dữ liệu sai...

**Chưa mô phỏng** (hãy thực hành trên cluster kind theo bài học): StatefulSet, Job/CronJob, Ingress/Gateway API, PersistentVolume, HPA, RBAC, NetworkPolicy, Helm, Kustomize. Thời gian trong playground được **rút ngắn** (Pod khởi động khoảng 2–3 giây). Cluster, tệp và tiến độ nhiệm vụ được lưu trong trình duyệt của bạn.

Học lý thuyết đi kèm: [Làm quen với kubectl](/co-ban/kubectl) · [Pod](/co-ban/pod) · [Deployment](/co-ban/deployment) · [Service](/co-ban/service) · [Xử lý sự cố](/nang-cao/troubleshooting).

</div>
