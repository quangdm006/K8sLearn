import type { FileMap } from './types'

/** Các tệp có sẵn trong "thư mục làm việc" của playground. */
export const DEFAULT_FILES: FileMap = {
  'pod.yaml': `apiVersion: v1
kind: Pod
metadata:
  name: hello
  labels:
    app: hello
spec:
  containers:
    - name: nginx
      image: nginx:1.30
      ports:
        - containerPort: 80
`,

  'deployment.yaml': `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  labels:
    app: web
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: nginx
          image: nginx:1.30
          ports:
            - containerPort: 80
`,

  'service.yaml': `# Service NodePort: trên cluster kind của khóa học, cổng 30080 được map ra
# máy của bạn — thử "curl localhost:30080" sau khi apply.
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  type: NodePort
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 80
      nodePort: 30080
`,

  'config-demo.yaml': `apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  APP_MODE: production
  LOG_LEVEL: info
---
apiVersion: v1
kind: Pod
metadata:
  name: config-demo
spec:
  containers:
    - name: app
      image: busybox:1.37
      command: ["sh", "-c", "echo Che do: $APP_MODE, muc log: $LOG_LEVEL; sleep 3600"]
      envFrom:
        - configMapRef:
            name: app-config
`,

  'broken.yaml': `# Ứng dụng "shop" đang hỏng: Service không có endpoint nào.
# Nhiệm vụ: tìm và sửa 2 lỗi, rồi chạy lại: kubectl apply -f broken.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop
spec:
  replicas: 2
  selector:
    matchLabels:
      app: shop
  template:
    metadata:
      labels:
        app: shop
    spec:
      containers:
        - name: web
          image: ngnix:1.30
          ports:
            - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: shop
spec:
  selector:
    app: shopp
  ports:
    - port: 80
      targetPort: 80
`,

  'postgres.yaml': `# Pod này sẽ rơi vào CrashLoopBackOff. Dùng "kubectl logs db" để tìm nguyên nhân.
# Gợi ý: Pod không sửa được biến môi trường khi đang chạy — phải xóa và tạo lại.
apiVersion: v1
kind: Pod
metadata:
  name: db
  labels:
    app: db
spec:
  containers:
    - name: postgres
      image: postgres:18
      ports:
        - containerPort: 5432
`,

  'metrics-server.yaml': `# Bản rút gọn để playground bật được "kubectl top".
# Cài thật trên cluster kind: xem bài "Quản lý tài nguyên CPU & RAM".
apiVersion: apps/v1
kind: Deployment
metadata:
  name: metrics-server
  namespace: kube-system
  labels:
    k8s-app: metrics-server
spec:
  selector:
    matchLabels:
      k8s-app: metrics-server
  template:
    metadata:
      labels:
        k8s-app: metrics-server
    spec:
      containers:
        - name: metrics-server
          image: registry.k8s.io/metrics-server/metrics-server:v0.9.0
          args:
            - --kubelet-insecure-tls
          ports:
            - containerPort: 10250
              name: https
`,
}
