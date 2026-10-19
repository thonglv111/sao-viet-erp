# Triển khai (CI/CD → VPS bằng Docker Compose)

Kiến trúc chạy trên VPS:

```
Internet ─▶ caddy (:80/:443, auto-HTTPS) ─▶ web (nginx) ──/api──▶ backend (uvicorn :8000, N worker) ──▶ db (Postgres)
                                             └ phục vụ frontend build (Vite → dist)                  ├─▶ redis (SSE pub/sub + khoá)
                                                                                                     └─▶ minio (kho tệp)
backup (hằng ngày) ─▶ pg_dump + rclone MinIO ─▶ volume `backups` (+ đích ngoài VPS)
```

Caddy tự xin & gia hạn chứng chỉ Let's Encrypt cho `SITE_DOMAIN`, tự chuyển http → https.

Mỗi lần push lên `main` (production) hoặc `dev` (staging), workflow [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml):
1. **CI gate** — build frontend (`tsc + vite`) và chạy `pytest` (SQLite in-memory). Gãy ⇒ dừng, KHÔNG deploy.
2. **Deploy** — SSH vào VPS, giữ khoá deploy chung của VPS (staging và prod không chạy chồng nhau):
   `git reset --hard origin/<nhánh>` → kiểm `.env` → `docker compose build` → migrate bằng container
   tạm → `docker compose up -d --build` → chờ backend `healthy` → kiểm `/api/health` qua nginx → dọn
   image cũ của đúng project đó.

Chỉ có MỘT file compose: `docker-compose.yml` (bản `docker-compose.prod.yml` đã bỏ). Lệnh nào trong
tài liệu này còn `-f docker-compose.prod.yml` thì bỏ phần `-f …` đi.

---

## 1. Biến & bí mật trên GitHub (Settings → Secrets and variables → Actions)

**Variables** (đã tạo):

| Tên | Ví dụ | Ý nghĩa |
| --- | --- | --- |
| `VPS_HOST` | `103.245.237.54` | IP/host VPS |
| `VPS_USER` | `deploy` | user SSH triển khai |
| `VPS_PORT` | `22` | cổng SSH |
| `APP_DIR` | `/var/www/erp-svn` | thư mục chứa repo trên VPS |

**Secrets** (đã tạo):

| Tên | Ý nghĩa |
| --- | --- |
| `VPS_SSH_KEY` | **private key** để Actions SSH vào VPS. Public key tương ứng phải nằm trong `~deploy/.ssh/authorized_keys` trên VPS. |

---

## 2. Chuẩn bị VPS (làm 1 lần)

```bash
# a) Cài Docker + Compose plugin (Ubuntu)
curl -fsSL https://get.docker.com | sh

# b) Cho user deploy chạy docker không cần sudo
sudo usermod -aG docker deploy      # đăng xuất/đăng nhập lại để có hiệu lực

# c) Cho phép GitHub Actions SSH vào: dán public key (cặp với VPS_SSH_KEY) vào authorized_keys
sudo -u deploy mkdir -p /home/deploy/.ssh
echo "ssh-ed25519 AAAA...public-key-cua-VPS_SSH_KEY... actions" \
  | sudo -u deploy tee -a /home/deploy/.ssh/authorized_keys
sudo -u deploy chmod 600 /home/deploy/.ssh/authorized_keys
```

### Clone repo (private) vào APP_DIR

Repo private ⇒ VPS cần quyền đọc. Dùng **Deploy key (read-only)**:

```bash
# Trên VPS, tạo key cho việc git pull (KHÁC với VPS_SSH_KEY ở trên)
sudo -u deploy ssh-keygen -t ed25519 -f /home/deploy/.ssh/id_ed25519 -N ""
cat /home/deploy/.ssh/id_ed25519.pub
```
Copy nội dung `.pub` → GitHub repo **Settings → Deploy keys → Add deploy key** (KHÔNG cần quyền ghi).

```bash
sudo mkdir -p /var/www && sudo chown deploy:deploy /var/www
sudo -u deploy git clone git@github.com:thonglv111/sao-viet-erp.git /var/www/erp-svn
```

### DNS & tường lửa (cho HTTPS)

- Trỏ bản ghi **A** của subdomain (vd `erp.saovietnhat.vn`) → IP VPS `103.245.237.54`. Chờ DNS phân giải đúng **trước khi** chạy Caddy (Let's Encrypt cần điều này).
- Mở cổng **80** và **443**:

```bash
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
```

### Tạo file `.env` production

```bash
cd /var/www/erp-svn
cp .env.example .env    # rồi làm theo khối "TRIỂN KHAI THẬT" cuối file
nano .env   # điền POSTGRES_PASSWORD, JWT_SECRET (openssl rand -hex 32), SEED_ADMIN_PASSWORD,
            # SITE_DOMAIN=subdomain, CORS_ORIGINS=https://subdomain
```

### Chạy lần đầu (kiểm tra)

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f backend    # đợi "Application startup complete"
# DB trắng: tạo tài khoản quản trị — chạy tay MỘT lần (SEED_DEMO=false ⇒ khởi động KHÔNG seed gì)
docker compose -f docker-compose.prod.yml run --rm backend python -m app.khoi_tao_admin
```
Mở `http://<VPS_HOST>` → đăng nhập bằng `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`.

`SEED_DEMO=false` nghĩa là backend **không ghi bất kỳ dữ liệu nào** lúc khởi động — không phòng ban,
vai, máy, công đoạn, đơn vị… Phòng/danh mục người dùng xoá sẽ KHÔNG mọc lại sau deploy. Lệnh
`khoi_tao_admin` chỉ dựng phòng "Ban giám đốc" + vai "Giám đốc" + tài khoản quản trị; phần còn lại
người dùng tự khai (hoặc chạy có chủ đích `python -m app.import_danh_muc_prod`).

---

## 3. Vận hành

- **Deploy tự động**: push lên `main` (prod) / `dev` (staging). Xem tiến trình ở tab **Actions**.
- **Deploy tay**: Actions → *Deploy* → *Run workflow*.
- **Log**: `docker compose logs -f backend` (log tự xoay vòng — mục 6).
- **Sao lưu**: tự động hằng ngày bằng service `backup` — mục 7. Sao lưu tay ngay trước việc rủi ro
  (migration xoá cột…): `docker compose exec backup sao-luu.sh ngay`.
- **Dữ liệu Postgres** nằm ở volume `pgdata` — deploy KHÔNG xóa dữ liệu.
- **Tệp người dùng** (ảnh, CCCD, hợp đồng, đính kèm phiếu kho/LSX/kế toán…) nằm ở MinIO, volume
  `miniodata`; người dùng đọc qua `/api/files` của backend. Volume `uploads`/thư mục `/app/static`
  cũ đã bỏ.

## 4. Lưu ý
- `git reset --hard origin/main` **ghi đè mọi thay đổi local** trên VPS (trừ file gitignore như `.env`). Đừng sửa code trực tiếp trên server.
- Guard bảo mật: `APP_ENV=production` bắt buộc `JWT_SECRET` ≥ 32 ký tự, khác default — nếu không backend sẽ từ chối khởi động.
- TLS: Caddy (profile `caddy`) tự xin/gia hạn chứng chỉ Let's Encrypt cho `SITE_DOMAIN`, và gánh
  luôn tên miền staging (`STG_DOMAIN`) — xem `Caddyfile`. Đổi domain thì đổi cả `CORS_ORIGINS`.
- Migration **xoá cột** (`DROP COLUMN`) làm mất dữ liệu cột đó, không lấy lại được: **backup DB
  trước khi deploy** nếu prod đã có dữ liệu. Hiện có: mg `0340_go_cot_thue_ngoai_cu` gỡ 13 cột thuê
  ngoài cũ của `lsx_cong_doan` (sổ giao–nhận cũ) — prod đã có lệnh thì phải backup trước.

---

## 5. Tự co giãn theo máy (backend + Postgres)

Không cần chỉnh số nào khi đổi VPS to/nhỏ — cả hai tự đọc giới hạn CPU/RAM của CONTAINER (cgroup) lúc
khởi động:

- **Backend** (`python -m app.serve`, `backend/app/tai_nguyen.py`): chạy migrate + seed MỘT lần rồi
  bật N worker uvicorn. N = 2 × CPU, không vượt RAM/350MB và không quá 8; không có Redis thì luôn 1
  (SSE in-process). Pool kết nối DB mỗi worker = (`PG_MAX_CONNECTIONS` − 20 dự phòng) / N, trần 30.
  Dòng `may: … CPU, … MB RAM -> N worker, moi worker pool …` trong `docker compose logs backend` cho
  biết số đã chọn.
- **Postgres** (`deploy/postgres/tu-chinh.sh`, chạy làm entrypoint của `db`): `shared_buffers` 25% RAM
  (trần 8GB), `effective_cache_size` 65%, `maintenance_work_mem` RAM/16 (trần 1GB), `work_mem` =
  25% RAM / `max_connections` (4–64MB), `max_connections` = `PG_MAX_CONNECTIONS`, ghi log câu SQL
  chậm hơn `PG_LOG_CHAM_MS`. Dòng `[tu-chinh] …` đầu `docker compose logs db` in các số đã dùng; kiểm
  lại: `docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "show shared_buffers"`.

Chốt tay (đặt trong `.env`, rồi `docker compose up -d`):

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `WEB_CONCURRENCY` | `0` (tự tính) | số worker backend |
| `PG_MAX_CONNECTIONS` | `200` | `max_connections` của Postgres = ngân sách kết nối backend chia cho các worker. MỘT biến cho cả hai service. |
| `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` | `0` / `-1` (tự chia) | pool mỗi worker |
| `DB_POOL_TIMEOUT` | `10` | chờ lấy kết nối tối đa N giây |
| `DB_STATEMENT_TIMEOUT_MS` | `120000` | Postgres huỷ câu SQL chạy quá N ms |
| `MAX_REQUEST_DONG_THOI` / `CHO_HANG_DOI_GIAY` | `0` / `30` | request chạy cùng lúc mỗi worker; xếp hàng quá N giây ⇒ 503 |
| `WORKER_PING_GIAY` | `30` | uvicorn giết worker không trả ping trong N giây (uvicorn mặc định 5: máy bão hoà CPU là giết oan worker đang bận, sập dây chuyền) |
| `KHO_TEP_QUA_NGINX` | `true` | `/api/files` chỉ kiểm quyền, nginx (`location /_kho_tep/`) kéo byte thẳng từ MinIO. `false` = Python tự bơm: 100 người cùng mở ảnh là hết suất xử lý, trả 503 |
| `DON_TEP_MO_COI` | `true` | mỗi ngày xoá object MinIO không còn dòng DB nào trỏ tới (cũ hơn 7 ngày, tối đa 500/lượt; sắp xoá > 20% tổng số ⇒ không xoá, log cảnh báo). Bản đã xoá lấy lại ở `minio-cu` (`deploy/backup/khoi-phuc.md`) |
| `PG_LOG_CHAM_MS` | `1000` | log câu SQL chậm (-1 = tắt) |

Prod và staging chung VPS thì cả hai cùng tự tính theo RAM của CẢ máy: nên chốt staging thấp
(vd `WEB_CONCURRENCY=2`, `PG_MAX_CONNECTIONS=60`) để nó không giành RAM của prod.

Deploy ít gián đoạn: nginx phân giải `backend` lại mỗi 10s (không giữ IP cũ khi container backend được
tạo lại); backend chưa lên thì `/api/*` trả 503 JSON tiếng Việt kèm `Retry-After`; Caddy giữ request
tối đa 20s khi `web` đang khởi động lại thay vì trả 502 ngay.

## 6. Log xoay vòng

Mọi service dùng log driver `json-file` giới hạn 5 tệp × 20MB (neo `x-logging` trong
`docker-compose.yml`) — log không thể lấp đầy đĩa. Cấu hình log chỉ áp khi container được TẠO
LẠI; vì cấu hình của mọi service đều đổi, lần deploy ĐẦU TIÊN mang thay đổi này compose tự tạo lại cả
db, redis, minio, caddy (Postgres/MinIO/Caddy khởi động lại vài giây) — nên deploy lần đó lúc vắng
người, và sao lưu tay trước.
Kiểm: `docker inspect <container> --format '{{json .HostConfig.LogConfig}}'`.

Nginx (`web`) ghi log truy cập kèm thời gian xử lý `rt=` (giây) — lọc request chậm:
`docker compose logs web | grep -E 'rt=[0-9]{2,}\.'`. Postgres ghi câu SQL chậm hơn `PG_LOG_CHAM_MS`:
`docker compose logs db | grep duration`.

## 7. Sao lưu & khôi phục

Service `backup` (profile `backup`): mỗi ngày lúc `BACKUP_GIO` (02:00 giờ VN) `pg_dump` Postgres +
`rclone sync` MinIO vào volume `backups`, giữ `BACKUP_GIU_NGAY` (14) ngày, đẩy lên `BACKUP_RCLONE_DICH`
nếu có. Hướng dẫn đầy đủ — bật, đọc kết quả, khôi phục Postgres/MinIO, cấu hình đích ngoài VPS
(S3/Backblaze/Google Drive): [`deploy/backup/khoi-phuc.md`](../deploy/backup/khoi-phuc.md).

Bật lần đầu trên VPS:

```bash
# .env: COMPOSE_PROFILES=db,redis,minio,backend,web,caddy,backup   + BACKUP_RCLONE_DICH=...
# .env.backup: RCLONE_CONFIG_DICH_* (thông tin đăng nhập đích ngoài)
docker compose up -d --build backup
docker compose exec backup sao-luu.sh ngay           # chạy thử, phải ra "Kết quả: OK"
```

**Volume `backups` nằm cùng ổ đĩa với dữ liệu gốc** — không đặt `BACKUP_RCLONE_DICH` thì hỏng đĩa/mất
VPS là mất cả bản sao. `docker compose ps backup` báo `unhealthy` khi lượt gần nhất lỗi hoặc quá 26
giờ chưa chạy; nên có người nhìn trạng thái này, và một dịch vụ theo dõi uptime bên ngoài gọi
`https://<SITE_DOMAIN>/api/health` (trả 503 khi DB chết) để báo khi sập.

## 8. Image MinIO

`minio/minio` và `minio/mc` bị gỡ khỏi Docker Hub ngày 11/09/2026; `quay.io/minio/minio` chặn kéo
ẩn danh từ 24/09/2026; dl.min.io không còn phát binary. Từ 19/10/2026 `docker-compose.yml` mặc định
dùng **`pgsty/silo:RELEASE.2026-09-16T00-00-00Z`** — fork cộng đồng của chính mã MinIO do Pigsty duy
trì (tên cũ `pgsty/minio`, đổi thành Silo từ 06/08/2026), kéo ẩn danh từ Docker Hub, có tag theo bản.

Vì sao chọn bản này: cùng định dạng `/data` (`.minio.sys`) nên volume `miniodata` dùng tiếp, không
chuyển dữ liệu; giữ biến `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`, API S3, đường `/minio/health/live`,
console :9001; chạy bằng root nên không phải `chown` volume; có `curl` cho healthcheck và `mcli`
(thay `mc`). Đã chạy thật trên máy dev 19/10/2026: `minio/minio` RELEASE.2025-09-07 ghi một tệp vào
volume, dừng, Silo mở đúng volume đó đọc lại được tệp và ghi thêm được tệp mới.

Lần deploy đầu sau khi đổi: compose kéo image mới và dựng lại container `minio` (kho tệp gián đoạn
vài giây, dữ liệu giữ nguyên trong volume). Nên chạy sao lưu (mục 7) trước lần đó.

Nguồn dự phòng nếu Silo cũng mất — đặt `MINIO_IMAGE=` trong `.env`:
- `cgr.dev/chainguard/minio:latest` — bản miễn phí chỉ có `latest`; chạy bằng uid 65532 (phải
  `chown -R 65532:65532` volume trước) và KHÔNG có `curl`, phải đổi healthcheck.
- Tự build từ mã nguồn MinIO (repo vẫn còn trên GitHub) rồi `docker save`/`docker load` lên VPS.
