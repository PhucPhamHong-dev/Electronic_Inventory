# Deploy VPS (Docker + Nginx, không dùng cổng 3000/3001)

## 1) Chuẩn bị

1. Cài Docker + Docker Compose trên VPS.
2. Upload toàn bộ thư mục dự án lên VPS.
3. Tạo file `.env` ở thư mục gốc từ mẫu:

```bash
cp .env.vps.example .env
```

4. Mở file `.env` và chỉnh cổng public nếu cần:

```env
WMS_HTTP_PORT=8088
```

5. Kiểm tra file `BE/.env` có đủ biến production:
- `DATABASE_URL`
- `DIRECT_URL` (nếu dùng)
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `LOG_LEVEL`

## 2) Chạy một lệnh

```bash
docker compose -f docker-compose.vps.yml up -d --build
```

Sau khi chạy xong:
- FE + API chạy qua Nginx tại: `http://<IP_VPS>:8088`
- Swagger: `http://<IP_VPS>:8088/api/docs`

## 3) Quản trị nhanh

```bash
# Xem log realtime
docker compose -f docker-compose.vps.yml logs -f

# Restart
docker compose -f docker-compose.vps.yml restart

# Stop
docker compose -f docker-compose.vps.yml down
```

## 4) CI/CD tự động bằng GitHub Actions

Workflow đã có sẵn tại:

```text
.github/workflows/ci-cd.yml
```

Khi push lên nhánh `main`, GitHub Actions sẽ:

1. Build backend
2. Build frontend
3. SSH vào VPS
4. Chạy script deploy:

```bash
./deploy.sh
```

Script này sẽ:

```bash
git fetch origin main
git checkout main
git pull --ff-only origin main
docker compose -f docker-compose.vps.yml up -d --build be fe
```

### Secrets cần thêm trên GitHub

Vào:

```text
Repo -> Settings -> Secrets and variables -> Actions
```

Tạo các secret sau:

```text
SSH_HOST=14.225.222.172
SSH_PORT=22
SSH_USER=root
SSH_PRIVATE_KEY=<private key dùng để SSH vào VPS>
```

### Gợi ý tạo SSH key riêng cho CI/CD

Chạy trên máy của bạn:

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_actions_deploy
```

Thêm public key lên VPS:

```bash
mkdir -p ~/.ssh
cat ~/.ssh/github_actions_deploy.pub >> ~/.ssh/authorized_keys
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

Sau đó:

- copy nội dung file private key `~/.ssh/github_actions_deploy`
- dán vào secret `SSH_PRIVATE_KEY`

## 5) Ghi chú kỹ thuậtt

- Backend chạy nội bộ cổng `4100` trong network Docker.
- Frontend build static và serve bằng Nginx.
- Nginx proxy `/api/*` về backend nên FE không cần gọi trực tiếp cổng backend.
- Đã cấu hình fallback font Linux cho PDF (tránh lỗi font tiếng Việt trên VPS Linux).
