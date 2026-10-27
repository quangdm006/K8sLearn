# Bước 1: build site tĩnh bằng VitePress
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY docs ./docs
# Trang "Dự án cuối khóa" nhúng trực tiếp các tệp trong examples/
COPY examples ./examples
ARG BASE_PATH=/
ENV BASE_PATH=${BASE_PATH}
RUN npm run build

# Bước 2: phục vụ bằng nginx chạy non-root (cổng 8080)
FROM nginxinc/nginx-unprivileged:1.30-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/docs/.vitepress/dist /usr/share/nginx/html
EXPOSE 8080
