# Database và migration

Đọc file này trước khi thêm hoặc đổi bảng và cột, viết migration, đụng seed, soi hay xoá dữ liệu DB.

## Ba môi trường

Cùng một tầng SQLAlchemy nhưng ba nơi khác nhau:

- Dev: Postgres local, đọc `DATABASE_URL` trong `backend/.env`. Dòng `sqlite:///./dev.db` đang bị comment, `backend/dev.db` không phải DB đang chạy.
- Production: PostgreSQL 16 trên VPS.
- Test: `sqlite:///:memory:`, ép ở `backend/tests/conftest.py` trước mọi import `app.*`. Fixture `db` chạy `drop_all` và `create_all` mỗi test; nhờ dòng ép đó nó không đụng DB thật.

Lệnh `python -c` hay `python script.py` chạy trong `backend/` đọc `backend/.env` nên trỏ vào Postgres dev thật. Cần soi hàm với dữ liệu thì viết file test tạm trong `backend/tests/`, chạy `pytest -s` rồi xoá. Ngày 11/08/2026 một đoạn `drop_all` chép từ fixture đã chạy lên DB dev và chỉ thoát nhờ lỗi FK.

Trước khi sửa hay xoá dữ liệu theo ảnh chụp, đọc `DATABASE_URL` và đếm thử vài con số trên ảnh để chắc đúng DB.

## Seed

`SEED_DEMO=false` nghĩa là lúc khởi động seeder không ghi gì vào DB, không có ngoại lệ "danh mục nền". Mọi hàm seed ghi dữ liệu nằm trong cổng `seed_demo`. DB trắng lấy admin bằng `python -m app.khoi_tao_admin`. Bộ test dựng nền qua `seed_du_lieu(demo=False)`; test thiếu dữ liệu thì sửa fixture, không nới seeder. Lý do: phòng ban người dùng xoá trên production từng mọc lại sau mỗi deploy.

`SEED_DEMO=true` ghi dữ liệu demo mỗi lần uvicorn khởi động: dựng lại tổ đã xoá, kéo người sang tổ khác, đẻ hồ sơ trùng tên. Đang tắt từ 08/09/2026; chỉ bật khi trỏ vào DB trắng.

## Viết migration

Không có Alembic, `create_all` chỉ tạo bảng và không ALTER. Migration thêm bằng cách nối `(id, fn)` vào `MIGRATIONS` trong `backend/app/db_migrations.py`; id đã áp dụng được ghi ở `schema_migrations`, không sửa id đã có. Muốn làm lại DB dev từ đầu thì phải drop và create database, mất hết dữ liệu.

- Cột Boolean: `server_default` là `false`/`true`, không phải `"0"`/`"1"`. Chuỗi chạy trên SQLite nhưng vỡ khi Postgres `create_all` trên DB trắng.
- Thêm bảng hay cột thì cập nhật `docs/DB_SCHEMA.md` cùng lúc.
- Backfill không dùng `db.query(Model)`: ORM kéo mọi cột của model hiện tại, kể cả cột do migration sau mới thêm, nên vỡ trên DB production ở trạng thái trung gian mà dev và CI không tái hiện được. Dùng `text()` nêu đích danh cột. `update(Model.__table__)` cũng kéo cột `onupdate` vào SET nên nên tránh.
- Đọc `_existing_columns` hay `get_table_names` trước lệnh ghi đầu tiên. `inspect(db.get_bind())` trả kết nối về pool làm rollback; trên SQLite `:memory:` các UPDATE chưa commit bị xoá trong khi DDL sau đó vẫn commit.
- Nới hoặc đổi unique trên Postgres: `DROP CONSTRAINT IF EXISTS x` và `DROP INDEX IF EXISTS x` rồi mới ADD, vì DB nâng cấp dần có thể mang index còn DB trắng mang constraint. Job CI trên Postgres trắng không bắt được lỗi này.

## Xoá sạch dữ liệu

Luôn `pg_dump` trước. "Khoá" của các dòng hệ thống là danh sách trong code, dòng do migration tạo một lần nên `TRUNCATE` làm mất hẳn. Phải chừa hoặc chép lại ngay sau:

- `cong_doan` có `ma` thuộc `CD_HE_THONG`.
- `kho_hang` mã `MA_KHO_THANH_PHAM`, rồi khởi động lại backend.
- `don_vi_do` theo `DON_VI_KHOA` ở frontend.
- `nhom_may` theo `NHOM_MAY_KHOA` và `NHOM_MAY_MAC_DINH`.

Mục thu chi cố định (`MUC_CO_DINH`) là dòng ảo, không nằm trong DB. Xong thì `python -m app.khoi_tao_admin`. Kiểm lại các tên này trong code trước khi dựa vào.
