# Git và triển khai

Đọc file này trước khi commit, push, gộp nhánh, sửa file hạ tầng hoặc chuyển code sang Hà Phương.

## Nơi sửa và commit

Sửa trực tiếp trong `D:\jobs\SVN` ở nhánh `dev` và commit lên `dev`; chủ dự án xem kết quả trên bản dev nên không tạo worktree hay nhánh tính năng rồi xin merge. Chưa push nếu chưa được bảo.

Commit viết tiếng Việt, thuật ngữ kỹ thuật có thể giữ tiếng Anh; giữ tiền tố `feat`/`fix`/`chore`/`docs`/`refactor`. Không có trailer `Co-Authored-By` hay dòng "Generated with".

`.githooks/pre-commit` (bật qua `core.hooksPath`) chạy guard `test_schema_documented` khi commit đụng `backend/app/models/` hoặc `docs/DB_SCHEMA.md`. Hook đọc working tree chứ không đọc phần đã staged, nên stash một vài file có thể làm hook báo `ImportError` dù bản staged nhất quán. Đừng lách bằng `--no-verify`.

## Nhiều phiên cùng một thư mục

Nhiều phiên Claude và Codex cùng trỏ `D:\jobs\SVN`; index và working tree là tài nguyên dùng chung.

- Chỉ `git add` đúng file mình sửa. File mình cần sửa mà đang có việc dở của phiên khác thì báo chủ dự án trước.
- Không `git stash -u` cả cây. Thấy việc đang dở biến mất thì xem `git stash list` trước tiên, rồi mới tới reflog và `git fsck --lost-found`; `stash -u` để lại dấu vết `reset: moving to HEAD` y như `git clean`.
- Muốn merge vào `dev` thì làm thư mục chính sạch rồi `git merge` bình thường, không dời ref bằng `git update-ref`. Kiểm fast-forward bằng exit code.
- Trước khi kết luận "mất việc" hay "lệch code", tính tới khả năng phiên khác vừa sửa.

## Commit gộp phải đọc file hạ tầng

Khi được bảo commit tất cả, đọc nguyên diff của `docker-compose.yml`, `.github/**`, `nginx.conf`, `.env*`, `Dockerfile`, kể cả khi không thuộc việc của mình. Dòng trông như vá tay tạm (bỏ ràng buộc loopback, hardcode cổng, tắt healthcheck, nới CORS) thì hỏi hoặc trả về nguyên trạng. Ngày 23/09/2026 một bản vá tay như vậy lọt vào `dev`: deploy gãy và Postgres production bị mở ra Internet, không test nào bắt được.

## Tài khoản GitHub

Push bằng `thonglv111`, không push dưới `thong6502`. Chạy `gh auth status` trước; tài khoản đang bật khác thì `gh auth switch --user thonglv111`. Lệnh `gh api repos/<owner>/...` lấy chủ repo hiện tại từ `gh repo view --json nameWithOwner`, đừng ghi cứng.

## CI và deploy

Trước push không tự chạy cả bộ test ở máy. Commit, push, rồi theo dõi bằng `gh run watch` hoặc `gh run view`; đỏ thì sửa.

Theo `.github/workflows/deploy.yml`: push `dev` deploy staging, push `main` deploy production, cùng một VPS. `build-test.yml` có ba job là Frontend, Backend và Migration trên Postgres trắng. Job migration chỉ thử DB trắng nên không bắt được lỗi của DB đã có dữ liệu hoặc đang ở trạng thái trung gian.

Bước deploy chạy `docker compose build`, rồi `docker compose run --rm -T backend python -m app.migrate`, rồi mới thay container. Migration lỗi thì deploy dừng và app cũ vẫn phục vụ. Sau khi thay container mà backend không healthy thì deploy báo đỏ nhưng không rollback image.

## Chuyển sang Hà Phương

In Hà Phương (`D:\jobs\HAPHUONG`) dùng chung code, nhận qua remote `svn` = `D:/jobs/SVN`. Push SVN `dev` chưa coi là xong khi Hà Phương chưa có. Sau mỗi lần push:

```bash
cd /d/jobs/HAPHUONG && git fetch svn && git merge-tree --write-tree dev svn/dev
```

Không xung đột thì `git merge --no-edit svn/dev`. Commit có sửa `.tex` của SVN thì chép đoạn tương ứng sang `docs/huong-dan-ha-phuong/` cùng lượt và chụp ảnh trên bản dev của Hà Phương. Tài liệu Hà Phương là bộ riêng, không dùng chung nguồn `.tex` với SVN. Đọc hướng dẫn của Hà Phương trong repo đó trước khi sửa bên ấy.
