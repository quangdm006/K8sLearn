import type { Cluster } from './cluster'
import type { Deployment } from './types'

export interface Mission {
  id: string
  title: string
  /** Mô tả ngắn; hỗ trợ `code` */
  detail: string
  /** Lệnh gợi ý — bấm để chép vào terminal */
  hints: string[]
  check: (c: Cluster, now: number) => boolean
}

const dep = (c: Cluster, ns: string, name: string): Deployment | undefined => c.findDeployment(ns, name)

function readyPods(c: Cluster, d: Deployment, now: number): number {
  return c.podsOfDeployment(d).filter((p) => c.isPodReady(p, now)).length
}

export const MISSIONS: Mission[] = [
  {
    id: 'nodes',
    title: 'Khám phá cluster',
    detail: 'Xem danh sách node: cluster có mấy node, node nào là control plane?',
    hints: ['kubectl get nodes', 'kubectl get nodes -o wide'],
    check: (c) => !!c.state.flags['get-nodes'],
  },
  {
    id: 'first-pod',
    title: 'Pod đầu tiên',
    detail: 'Tạo Pod tên `nginx` chạy image `nginx:1.30` và chờ tới khi `Running`.',
    hints: ['kubectl run nginx --image=nginx:1.30', 'kubectl get pods'],
    check: (c, now) => {
      const p = c.findPod('default', 'nginx')
      return !!p && p.spec.containers[0].image.startsWith('nginx') && c.isPodReady(p, now)
    },
  },
  {
    id: 'deployment',
    title: 'Deployment',
    detail: 'Tạo Deployment `web` (image `nginx:1.30`, 3 replicas) và chờ đủ 3 Pod sẵn sàng.',
    hints: ['kubectl create deployment web --image=nginx:1.30 --replicas=3', 'kubectl get deploy,rs,pods'],
    check: (c, now) => {
      const d = dep(c, 'default', 'web')
      return !!d && d.replicas >= 3 && readyPods(c, d, now) >= 3
    },
  },
  {
    id: 'self-heal',
    title: 'Tự phục hồi',
    detail: 'Xóa một Pod của `web` rồi xem ngay danh sách Pod: ReplicaSet tạo Pod mới thay thế.',
    hints: ['kubectl get pods -l app=web', 'kubectl delete pod <tên-một-pod-web>', 'kubectl get pods -l app=web'],
    check: (c) => !!c.state.flags['self-heal:web'],
  },
  {
    id: 'scale',
    title: 'Scale',
    detail: 'Tăng `web` lên 5 replicas và chờ cả 5 Pod sẵn sàng.',
    hints: ['kubectl scale deployment web --replicas=5', 'kubectl get deploy web'],
    check: (c, now) => {
      const d = dep(c, 'default', 'web')
      return !!d && d.replicas === 5 && readyPods(c, d, now) === 5
    },
  },
  {
    id: 'expose',
    title: 'Service NodePort',
    detail: 'Tạo Service `web` kiểu NodePort ở cổng 80, kiểm tra Service đã có endpoint.',
    hints: [
      'kubectl expose deployment web --port=80 --type=NodePort',
      'kubectl get svc web',
      'kubectl get endpointslices -l kubernetes.io/service-name=web',
    ],
    check: (c, now) => {
      const s = c.findService('default', 'web')
      return !!s && s.type === 'NodePort' && s.ports.some((p) => p.port === 80) && c.serviceEndpoints(s, now).length > 0
    },
  },
  {
    id: 'curl',
    title: 'Gọi Service trong cluster',
    detail: 'Dùng một Pod tạm (hoặc Pod `nginx`) để gọi `http://web` qua DNS nội bộ.',
    hints: [
      'kubectl run tmp --rm -it --image=busybox:1.37 --restart=Never -- wget -qO- http://web',
      'kubectl exec nginx -- curl -s http://web',
    ],
    check: (c) => !!c.state.flags['curl-service'],
  },
  {
    id: 'rolling-update',
    title: 'Rolling update',
    detail: 'Cập nhật `web` lên `nginx:1.31` và theo dõi đến khi rollout hoàn tất.',
    hints: ['kubectl set image deployment/web nginx=nginx:1.31', 'kubectl rollout status deployment/web'],
    check: (c, now) => {
      const d = dep(c, 'default', 'web')
      return !!d && d.template.spec.containers.some((x) => x.image === 'nginx:1.31') && c.deploymentStatus(d, now).complete
    },
  },
  {
    id: 'rollback',
    title: 'Rollback',
    detail: 'Xem lịch sử triển khai rồi quay `web` về phiên bản trước.',
    hints: ['kubectl rollout history deployment/web', 'kubectl rollout undo deployment/web', 'kubectl rollout status deployment/web'],
    check: (c, now) => {
      const d = dep(c, 'default', 'web')
      return !!d && !!c.state.flags['rolled-back:web'] && c.deploymentStatus(d, now).complete
    },
  },
  {
    id: 'namespace',
    title: 'Namespace',
    detail: 'Tạo namespace `dev` và chạy Pod `redis` (image `redis:8`) trong đó.',
    hints: ['kubectl create namespace dev', 'kubectl run redis --image=redis:8 -n dev', 'kubectl get pods -n dev'],
    check: (c, now) =>
      c.namespaceExists('dev') &&
      c.state.pods.some((p) => p.meta.namespace === 'dev' && p.spec.containers[0].image.startsWith('redis') && c.isPodReady(p, now)),
  },
  {
    id: 'apply',
    title: 'Khai báo bằng YAML',
    detail: 'Xem tệp `config-demo.yaml`, apply nó rồi đọc log của Pod `config-demo` (giá trị lấy từ ConfigMap).',
    hints: ['cat config-demo.yaml', 'kubectl apply -f config-demo.yaml', 'kubectl logs config-demo'],
    check: (c, now) => {
      const p = c.findPod('default', 'config-demo')
      return !!p && c.isPodReady(p, now)
    },
  },
  {
    id: 'debug',
    title: 'Gỡ lỗi ứng dụng',
    detail: 'Apply `broken.yaml`, tìm 2 lỗi khiến Service `shop` không có endpoint, sửa tệp (tab Tệp YAML) rồi apply lại.',
    hints: [
      'kubectl apply -f broken.yaml',
      'kubectl get pods -l app=shop',
      'kubectl describe pod <tên-pod-shop>',
      'kubectl describe svc shop',
    ],
    check: (c, now) => {
      const d = dep(c, 'default', 'shop')
      const s = c.findService('default', 'shop')
      return !!d && !!s && readyPods(c, d, now) >= d.replicas && d.replicas > 0 && c.serviceEndpoints(s, now).length > 0
    },
  },
  {
    id: 'drain',
    title: 'Bảo trì node',
    detail: 'Drain `k8s-learn-worker` (bỏ qua DaemonSet), xem Pod chuyển sang node khác, rồi uncordon.',
    hints: [
      'kubectl get pods -o wide',
      'kubectl drain k8s-learn-worker --ignore-daemonsets --force',
      'kubectl get pods -o wide',
      'kubectl uncordon k8s-learn-worker',
    ],
    check: (c) =>
      !!c.state.flags['uncordoned-after-drain:k8s-learn-worker'] || !!c.state.flags['uncordoned-after-drain:k8s-learn-worker2'],
  },
  {
    id: 'top',
    title: 'Đo tài nguyên',
    detail: 'Thử `kubectl top pods` (sẽ lỗi!), cài metrics-server từ tệp `metrics-server.yaml`, chờ chạy rồi thử lại.',
    hints: ['kubectl top pods', 'kubectl apply -f metrics-server.yaml', 'kubectl get pods -n kube-system -l k8s-app=metrics-server', 'kubectl top pods'],
    check: (c) => !!c.state.flags['top'],
  },
]
