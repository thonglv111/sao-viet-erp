# Gộp 8 công đoạn in thành một "Bài in" — giá khoán theo tổ × bậc màu

Trạng thái: ĐÃ CODE 22/10/2026 (mg 0433, chưa commit), DB dev đã gộp 8 mã về id 17 "Bài in".
Câu 1 ĐÃ CHỐT 22/10: số màu = số kẽm như Tính giá (AB 4/4 ra 8). Hai câu còn lại chạy theo GIẢ ĐỊNH: 3 màu
có pha → bậc "3–4 màu có pha", metaline nhân 3 cả với Pantone. Chủ trả lời khác thì sửa bậc trong
danh mục, không phải sửa code.

## Vì sao gộp

Danh mục dev đang có 8 công đoạn in, khác nhau DUY NHẤT ở số màu:
IN-12, IN-12P, IN-12P-UV, IN-34, IN-4P, IN-5, IN-6, IN-7.

Đối chiếu trên DB dev 22/10, cả 8 trùng nhau ở mọi chỗ khác:

- Nhóm `print`, ghi theo tờ, vào/ra tờ.
- Cùng công thức khoán (riêng IN-12P/IN-12P-UV không có hệ số UV).
- Cùng phát sinh: Thay kẽm 100.000 đ/bản kẽm; Xuống bài theo tổ 187.500 / 150.000 / 90.000 /
  125.000 / 125.000 (cùng một tổ thì mã nào cũng một giá).
- Cùng công thức giờ máy `sl_vao`.

Hệ quả của việc tách 8 mã:

- Người lập phiếu tính giá / lệnh phải TỰ chọn đúng mã theo số màu. Chọn nhầm (lệnh 5 màu gắn
  IN-34) là thợ ăn sai giá, không gì chặn.
- Lệnh đổi quy cách in (thêm Pantone) thì mã in không tự đổi theo.
- Danh mục phình 8 dòng, phát sinh và máy khai lặp 8 lần.

Số màu đã có sẵn trong quy cách lệnh. Máy tự chọn được bậc, người khỏi chọn.

## Trước và sau

Trước: 8 công đoạn, mỗi cái một bảng giá theo tổ.

Sau: 1 công đoạn "Bài in" với:

- MỘT bảng giá hai chiều: dòng = bậc màu, cột = tổ.
- Công thức khoán, tuỳ chọn và phát sinh khai MỘT lần.
- Bậc chọn TỰ ĐỘNG lúc ghi sản lượng, từ quy cách in của lệnh cộng tuỳ chọn Mực UV.

Bảng giá sau gộp: số trong ô là giá cố định / đơn giá mỗi tờ vượt 3.000. Số chép nguyên từ 8 mã
hiện tại, không đổi đồng nào.

| Bậc | Điều kiện | Tổ 2 màu (11) | Tổ 4 màu (12) | Tổ 5 màu (13) | Tổ 6 màu (14) | Tổ 7 màu (15) |
|---|---|---|---|---|---|---|
| 1–2 màu thường | 1–2 màu, không pha | 150.000 / 30 | 250.000 / 30 | 144.000 / 20 | 200.000 / 20 | 200.000 / 20 |
| 1–2 màu Pantone | 1–2 màu, có pha, không UV | 225.000 / 30 | | | | |
| 1–2 màu Pantone UV | 1–2 màu, có pha, có UV — giá đã gồm UV | 450.000 / 40 | | | | |
| 3–4 màu thường | 3–4 màu, không pha | | 300.000 / 40 | 180.000 / 30 | 250.000 / 27 | 250.000 / 30 |
| 3–4 màu có pha | 3–4 màu, có pha | | 350.000 / 45 | 210.000 / 30 | 275.000 / 29,7 | 275.000 / 35 |
| 5 màu | 5 màu | | 550.000 / 70 | 240.000 / 35 | 375.000 / 40 | 375.000 / 40 |
| 6 màu | 6 màu | | 600.000 / 80 | | 500.000 / 50 | 500.000 / 50 |
| 7 màu | 7 màu | | | | 650.000 / 65 | 650.000 / 65 |

Ô trống nghĩa là tổ đó chưa có giá cho bậc đó. Ghi vào thì báo "thiếu giá", y như hiện nay khi tổ
không có trong bảng giá theo tổ.

## Luật chọn bậc

### Số màu đếm thế nào

"Số màu" để chọn bậc = chip `so_mau` bên Tính giá, tức SỐ KẼM MỘT TAY (chủ chốt 22/10/2026: giống
tính giá để sau có sai thì sửa một chỗ). Cùng hàm `dem_mau_cong_thuc`:

- 1 mặt: số mực mặt A.
- Tự trở / trở nhíp: `|A ∪ B|`.
- AB: `|A| + |B|` — AB 4/4 ra 8, không khớp bậc nào tới khi khai bậc cho AB.

(Bản đầu dùng `dau_muc_can`, số mực một lượt máy, AB 4/4 ra 4 — đã bỏ.)

"Có pha" = có ít nhất một mực không thuộc CMYK, tức `so_mau_pha > 0`.

Giả định về vecni: sale nhập vecni như một mực trong tập mực của quy cách, nên nó tự được đếm vào
cả số màu lẫn màu pha. Điều này khớp với tên mã cũ ("4 CMYK + 1 pha hoặc vecni").

### Khai bậc trong danh mục

Mỗi bậc khai bằng ô chọn, không bắt gõ công thức. Lý do: engine công thức chỉ cho một phép so mỗi
lần, không có `and`/`or`, nên điều kiện bậc viết thành công thức sẽ lồng `if` rất khó đọc.

Mỗi bậc gồm:

- Tên bậc.
- Màu từ … đến ….
- Màu pha: có / không / không xét.
- Mực UV: có / không / không xét.
- Ô tick "Giá đã gồm UV".

Bậc xét theo thứ tự từ trên xuống, bậc khớp đầu tiên thắng. Không bậc nào khớp (ví dụ 8 màu) thì
báo "thiếu giá" kèm câu "lệnh 8 màu, chưa có bậc nào khớp".

### Công thức khoán

Công thức giữ nguyên dáng. `gia_co_dinh` và `don_gia_khoan` lấy từ ô (tổ, bậc). Thêm một chip
`gia_gom_uv`: bằng 1 khi bậc đang dùng tick "Giá đã gồm UV". Chip này để bậc Pantone UV không bị
nhân đôi thêm lần nữa:

```
((1 - chay_tiep) * gia_co_dinh + max(0, sl_ghi * (1 + tu_tro) - (1 - chay_tiep) * 3000) * don_gia_khoan)
  * if(metaline > 0, 3, if(muc_uv > 0, if(gia_gom_uv > 0, 1, 2), 1))
```

Tuỳ chọn khi ghi vẫn là ba ô: Chạy tiếp, Mực UV, Mực UV cán metaline.

### Công đoạn không bật "chia bậc"

Mọi công đoạn khác giữ y như hiện tại. "Chia bậc" là công tắc trên từng công đoạn. Tắt thì bảng giá
theo tổ vẫn một chiều như cũ, không đụng gì.

## Lúc ghi sản lượng

- Hộp ghi hiện một dòng "Bậc giá" bằng lời, ví dụ "3–4 màu có pha — lệnh 4 màu, 1 pha", cạnh giá
  cố định và đơn giá như bây giờ.
- Tick hay bỏ Mực UV có thể đổi bậc (Pantone ↔ Pantone UV), nên giá trên hộp phải đổi NGAY theo
  tick, không chờ lưu. Máy chủ trả sẵn giá cho cả hai trạng thái UV để hộp tự chọn.
- Ảnh chụp lần ghi thêm TÊN bậc, bên cạnh giá và công thức đã chụp (mg 0431). Nhờ vậy lịch sử và
  băng "Danh mục đã đổi" nói được "lần này tính theo bậc 3–4 màu có pha".
- "Cập nhật theo danh mục": tính lại bậc từ quy cách hiện tại của lệnh, rồi lấy giá ô mới.
- Khoán theo kỳ (`khoan_ky`) không đổi, vì nó đọc ảnh chụp.

## Chỗ code phải đụng

Liệt kê để ước lượng; thứ tự và chi tiết để plan chốt.

- Model + migration (`db_migrations.py`, `docs/DB_SCHEMA.md`):
  - `cong_doan_khoan` thêm cột JSON `bac_gia` (danh sách bậc, có thứ tự).
  - Mỗi dòng `gia_theo_to` thêm khoá `bac`. Dòng không có `bac` là dòng của công đoạn không chia bậc.
  - `san_xuat_batch` thêm cột chụp tên bậc.
- `viec_khoan.gia_cua_to(khoan, department_id)` nhận thêm `bac`. Thêm một hàm chọn bậc từ quy cách
  lệnh + tuỳ chọn, dùng `so_mau` (số kẽm) và `so_mau_pha` của `ngu_canh_lenh`.
- `viec_khoan.chuan_hoa_khi_ghi`, `danh_muc_doi`, `cap_nhat_theo_danh_muc`: đi qua hàm chọn bậc.
- `board.py`, khối `khoan` của hộp ghi: trả bậc + giá theo hai trạng thái UV. Bên frontend, hộp
  ghi đổi giá theo tick.
- `bien_cong_thuc`: thêm chip `gia_gom_uv` vào danh sách chip khoán.
- Bài ghép: ngữ cảnh lấy màu từ `muc_gop` (`bien_so_mau*`), đã đếm sẵn số kẽm.
- Màn Công đoạn, tab khoán: bảng giá đổi từ một chiều (tổ) sang lưới bậc × tổ, cộng phần khai bậc.
  Đây là UI mới, nên theo lệ phải tham khảo + 3 phương án HTML, chủ chọn rồi mới code.
- Bên tính giá không đổi: tính giá nhận bước in qua `nhom == "print"`, không theo mã. Plan phải dò
  lại để chắc.

## Chuyển dữ liệu

- **Dev (svn_erp_trong):**
  - Giữ IN-12 (id 17), đổi tên thành "Bài in", nạp bảng bậc + giá ở trên.
  - Gộp máy và tổ của 7 mã kia vào: 5 máy, 5 tổ. Công thức giờ đều là `sl_vao`, không xung đột.
  - Phát sinh giữ một bộ.
  - Xoá 7 mã còn lại. Khoá ngoại hiện chỉ có `cong_doan_khoan`, `cong_doan_may`, `cong_doan_to` trỏ
    tới chúng.
  - Plan vẫn phải dò các chỗ trỏ bằng MÃ hoặc id nằm trong JSON: tuyến PTG, `lsx_cong_doan`, bài
    ghép, ảnh chụp. Trên dev chỉ còn dữ liệu thử (LSX26-0002), có thể xoá.
  - Sao lưu trước khi đụng, như các lần dọn trước.
- **Prod:** DB trắng, chưa nhập danh mục công đoạn ⇒ không có gì để chuyển. Lúc nhập danh mục lên
  prod thì nhập luôn dạng đã gộp.

## Ngoài phạm vi

- Xếp lịch không chặn kéo việc 7 màu vào máy 2 màu. Chủ đã chốt 09/08: kiểm khả năng máy chỉ theo
  khổ. Sai tổ thì lúc ghi báo "thiếu giá", thế là đủ.
- Dùng "bậc" cho thứ khác ngoài màu (ví dụ dán ≤60 / ≥61 theo khổ). Khung bậc chừa được, nhưng đợt
  này chỉ có màu.
- Giá in bên tính giá / báo giá.

## Câu hỏi cho chủ

1. ~~AB đếm bậc thế nào?~~ ĐÃ CHỐT 22/10: số màu = số kẽm như Tính giá, AB 4/4 ra 8.
2. **3 màu có pha** (2 CMYK + 1 Pantone) có ăn bậc "3–4 màu có pha" (giá IN-4P) không? Hay ăn
   "3–4 màu thường"?
3. **Metaline trên Pantone:** hiện IN-12P không cho chọn metaline. Sau gộp, tuỳ chọn là chung, nên
   Pantone + metaline sẽ ra ×3 trên giá Pantone thường. Giữ vậy, hay cấm metaline ở bậc Pantone?
