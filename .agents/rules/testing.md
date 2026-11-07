# Xác minh

Đọc file này trước khi chọn cách xác minh, bật lại dev server, bấm thử trên dev-browser hoặc báo cáo kết quả.

## Lệnh

`./init.ps1` bị chủ dự án chặn từ 31/07/2026, kể cả khi gọi gián tiếp. Cả bộ `python -m pytest` không kèm đường dẫn file nặng tương đương nên cũng phải hỏi trước, kể cả khi chạy nền.

- Backend: `python -m pytest tests/<file liên quan> -q` từ `backend/`.
- Frontend: `npx tsc --noEmit` từ `frontend/`.

Báo trung thực phần nào đã chạy, phần nào chưa. Cả bộ test chạy nền lâu nên kết quả xanh không chứng minh cho code đã đổi sau lúc nó bắt đầu; nếu lỡ chạy thì nói rõ nó tính tới thay đổi nào.

## Luồng nghiệp vụ phải bấm thật

Code xong một luồng nghiệp vụ có lưu, gửi hoặc tính, kể cả chỉ sửa một khâu trong luồng nhiều bước, thì thao tác lại đúng luồng đó bằng chuột và bàn phím thật trên dev-browser trước khi báo xong. Không dùng API hay curl thay bất kỳ bước nào, kể cả để dựng dữ liệu cho bước không phải trọng tâm. Buộc phải dùng API ở một đoạn thì tự nói rõ lúc báo cáo. Báo cáo liệt kê cụ thể đã bấm gì, gõ gì, thấy gì ở từng bước, không nói chung "đã test UI".

Việc chỉ sửa hiển thị (bỏ phần tử, CSS, bố cục) thì typecheck và test là báo, không tự mở trình duyệt. Mockup HTML trong `docs/mockups/` vẫn được chụp lại để xem.

Chạy tối đa 5 dev-browser cùng lúc; trước đợt mới thì dừng các instance cũ.

## Dev server

Sửa route hay schema backend thì khởi động lại uvicorn. Trên máy này tiến trình bật từ phiên agent sẽ chết khi hết phiên; muốn sống qua phiên thì bật qua WMI để nó nằm ngoài cây tiến trình:

```powershell
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine =
  "cmd.exe /c cd /d D:\jobs\SVN\backend && python -m uvicorn app.main:app --host localhost --port 8000 > `"<scratchpad>\be.log`" 2>&1" }
```

Backend treo sau reload với log dừng ở `Waiting for connections to close` là do luồng SSE giữ kết nối; `restart-be.ps1` chạy uvicorn với `--timeout-graceful-shutdown 1` để cắt nhưng bật bằng `Start-Process`, nên tiến trình của nó cũng chết khi hết phiên agent. Lỗi `CancelledError` từ `listen_for_disconnect` sau reload là SSE bị cắt có chủ đích, không phải bug.

Backend chết lúc khởi động vì `Connection refused` thì lấy cổng thật bằng `docker ps --format '{{.Ports}}'` rồi đối chiếu `backend/.env`, đừng đoán.

CSS biến mất mà file nguồn vẫn đủ thì hỏi thẳng dev server: `curl -s http://localhost:5173/src/pages/<file>.css | grep -o 'const __vite__css = ".\{0,60\}'`. Kết quả rỗng nghĩa là vite giữ bản transform rỗng; đổi mtime file bằng `(Get-Item $f).LastWriteTime = Get-Date` để ép transform lại.
