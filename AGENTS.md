# AGENTS.md

Đây là mã nguồn Sao Việt Nhật ERP (SVN), ERP in offset đa phân hệ, full-stack: backend Python FastAPI + SQLAlchemy, frontend React + Vite + TypeScript. Chi tiết vận hành ở `README.md`.

## Địa chỉ ứng dụng

Dev: frontend `http://localhost:5173`, backend cổng `8000`, Postgres `127.0.0.1:5433` (container `erp-svn-local-db-1`). Tên database đọc từ `DATABASE_URL` trong `backend/.env`, hiện là `svn_erp_trong`; cùng server còn database khác nên đừng suy từ tên. Production: <https://svn.superbai.io>.

## Giữ file này nhỏ

File này tối đa 32 KB. Nó chỉ chứa những luật agent phải theo trước khi mở bất cứ thứ gì khác, mỗi luật vài câu, cùng mục lục tới nơi có chi tiết. Chi tiết nằm ở `.agents/rules/<topic>.md`: thay đổi nào cần cập nhật tài liệu thì sửa đúng file luật đó, hoặc thêm file mới và thêm dòng vào mục lục dưới đây, không viết chi tiết vào đây. `CLAUDE.md` chỉ trỏ về file này. Giới hạn dung lượng và các link hiện kiểm bằng tay.

## Cách làm việc

Đang bàn thiết kế thì chỉ bàn và viết doc; không đụng code hay schema cho tới khi chủ dự án nói "làm đi". Commit hay push chỉ khi được yêu cầu. Không chạy quá 2 subagent cùng lúc; việc tự đọc, tự làm được thì không giao subagent.

## Kiến trúc

Backend phân tầng `routers → services → repositories → DB`. Logic nghiệp vụ nằm ở services, router chỉ điều phối, truy vấn DB chỉ nằm trong repositories, engine tính giá ở services.

Gửi và thông báo nội bộ là real-time: trình duyệt báo giá, duyệt hay từ chối, giao việc, nhắc hạn phải tới người nhận ngay, badge tự nhảy và có toast, không bắt refresh hay đổi màn. Ưu tiên đẩy bằng SSE (`backend/app/realtime.py`).

## Nhánh, commit và triển khai

Sửa thẳng trong thư mục chính ở nhánh `dev`, không tạo worktree hay nhánh tính năng. Nhiều phiên làm việc dùng chung thư mục này: chỉ `git add` đúng file mình sửa, không `git add -A`, không `git stash -u` cả cây, không dùng `--no-verify`. Commit viết tiếng Việt, giữ tiền tố `feat`/`fix`/`chore`/`docs`/`refactor`, không có `Co-Authored-By` hay dòng ghi công AI. Push `dev` tự deploy staging, push `main` tự deploy production. Push bằng tài khoản `thonglv111`. Chi tiết: [.agents/rules/git-and-deployment.md](.agents/rules/git-and-deployment.md).

## Xác minh

Không chạy `./init.ps1`, và không chạy cả bộ `python -m pytest` khi chưa hỏi; cấm theo tác động chứ không theo tên lệnh. Backend chạy `python -m pytest tests/<file liên quan> -q` từ `backend/`, frontend chạy `npx tsc --noEmit` từ `frontend/`; cả bộ test để CI chạy. Sửa route hay schema backend thì khởi động lại uvicorn.

Code xong một luồng nghiệp vụ có UI thì phải thao tác lại đúng luồng đó bằng chuột và bàn phím thật trên dev-browser trước khi báo xong, không dùng API hay curl thay bước nào; báo cáo liệt kê đã bấm gì, gõ gì, thấy gì ở từng bước. Việc thuần hiển thị thì typecheck và test là báo, không mở trình duyệt. Chi tiết: [.agents/rules/testing.md](.agents/rules/testing.md).

## Tài liệu PDF đi kèm code

Đây là luật cứng. Sửa logic hoặc UI mà tài liệu có mô tả thì sửa luôn tài liệu trong cùng lượt việc, chưa sửa doc thì chưa được báo xong; thay đổi không đụng tài liệu thì nói rõ một câu "không ảnh hưởng tài liệu" trong báo cáo. Bốn cuốn, cách biên dịch và kiểm liên kết: [.agents/rules/pdf-docs.md](.agents/rules/pdf-docs.md).

## Luật dễ phạm

- **Không có Alembic.** `create_all` chỉ tạo bảng, không ALTER; thêm hay đổi cột phải viết migration vào `backend/app/db_migrations.py`, dev cũng vậy vì dev là Postgres. Chi tiết: [.agents/rules/database-migrations.md](.agents/rules/database-migrations.md).
- **Mọi bảng và cột trong model phải có trong `docs/DB_SCHEMA.md`.** Guard test `test_schema_documented` và hook pre-commit chặn nếu thiếu. Chi tiết: [.agents/rules/database-migrations.md](.agents/rules/database-migrations.md).
- **`python` chạy trong `backend/` trỏ vào Postgres dev thật.** Chỉ pytest mới ép SQLite; không chép đoạn `drop_all` của fixture vào `python -c`. Chi tiết: [.agents/rules/database-migrations.md](.agents/rules/database-migrations.md).
- **`SEED_DEMO=false` nghĩa là seeder không ghi gì vào DB, không có ngoại lệ.** Đừng bật `true` trên DB dev đang có dữ liệu. Chi tiết: [.agents/rules/database-migrations.md](.agents/rules/database-migrations.md).
- **Tiền chỉ người có quyền mới xem được, và gác ở router.** Ẩn trên UI mà số còn trong JSON là lộ. Chi tiết: [.agents/rules/permissions-and-money.md](.agents/rules/permissions-and-money.md).
- **Tên người do server gán từ tài khoản.** Người báo, người làm, người duyệt không phải ô gõ tay. Chi tiết: [.agents/rules/permissions-and-money.md](.agents/rules/permissions-and-money.md).
- **Không tính ngầm, không dò theo tên.** Công thức nghiệp vụ đã có thì gọi lại; thiếu khai báo thì để trống cho người chọn. Chi tiết: [.agents/rules/permissions-and-money.md](.agents/rules/permissions-and-money.md).
- **"ui/ux lại" một màn thì chưa sửa code.** Đọc đủ code FE và BE, mở trang tham khảo thật, dựng 3 phương án HTML ở `docs/mockups/`. Chi tiết: [.agents/rules/ui.md](.agents/rules/ui.md).
- **Khoanh chỗ nào sửa chỗ đó.** "Gọn" là bớt thông tin trùng, không phải bóp khoảng trắng. Chi tiết: [.agents/rules/ui.md](.agents/rules/ui.md).

## Ngôn ngữ

Mọi chữ người dùng thấy trên UI là tiếng Việt dễ hiểu, kể cả màn kế hoạch và quản lý; ngoại lệ đã được chấp nhận là "Gantt". Commit và tài liệu viết tiếng Việt, thuật ngữ kỹ thuật và tên trong code giữ nguyên.

## Mục lục

| Đọc | Khi |
| --- | --- |
| [.agents/rules/git-and-deployment.md](.agents/rules/git-and-deployment.md) | Commit, push, gộp nhánh, sửa file hạ tầng hoặc `.github/workflows/`, chuyển code sang Hà Phương |
| [.agents/rules/testing.md](.agents/rules/testing.md) | Chọn cách xác minh, bật lại dev server, bấm thử trên dev-browser, báo cáo kết quả |
| [.agents/rules/database-migrations.md](.agents/rules/database-migrations.md) | Thêm hoặc đổi bảng và cột, viết migration, seed, soi hay xoá dữ liệu DB |
| [.agents/rules/permissions-and-money.md](.agents/rules/permissions-and-money.md) | Thêm màn hoặc quyền, trả số tiền ra API, viết công thức, thiết kế tính năng nghiệp vụ, ghi nhật ký |
| [.agents/rules/ui.md](.agents/rules/ui.md) | Làm hoặc sửa bất kỳ màn, bảng, form, ngăn, mockup nào |
| [.agents/rules/pdf-docs.md](.agents/rules/pdf-docs.md) | Sửa logic hoặc UI mà tài liệu có mô tả, sửa `.tex`, chụp lại ảnh |
| [docs/UI_DESIGN.md](docs/UI_DESIGN.md) | Quyết định thị giác và viết CSS: màu, chữ, bảng, bẫy cascade |
