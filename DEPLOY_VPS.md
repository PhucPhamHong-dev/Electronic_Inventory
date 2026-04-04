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

## 4) Ghi chú kỹ thuật

- Backend chạy nội bộ cổng `4100` trong network Docker.
- Frontend build static và serve bằng Nginx.
- Nginx proxy `/api/*` về backend nên FE không cần gọi trực tiếp cổng backend.
- Đã cấu hình fallback font Linux cho PDF (tránh lỗi font tiếng Việt trên VPS Linux).
