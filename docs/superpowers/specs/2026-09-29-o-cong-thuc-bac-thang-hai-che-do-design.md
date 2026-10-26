# Ô công thức: bậc thang + hai chế độ xem — Thiết kế

**Ngày:** 29/09/2026 · **Trạng thái:** đã làm 29/09/2026 (logic bậc thang: `frontend/src/pages/danh-muc/congThucBacThang.ts`)
**Phạm vi:** `frontend/src/pages/danh-muc/fields/FormulaField.tsx` (dùng ở 5 chỗ: `CatalogDrawer`,
`KhoanCongDoan`, `MayCuaCongDoan` ×2 — giờ chạy + giá, `VatTuCongDoan`), `FormulaPopover.tsx`,
ô "Cách tính giá"/"Cách đo giờ chạy" trong `MayCuaCongDoan.tsx`.

Một câu: **công thức vẫn là MỘT chuỗi IF lồng kiểu Excel, lưu y như cũ — chỉ đổi cách VẼ (bậc
thang thẳng cột, bớt nhiễu) và thêm chế độ Dạng chữ để copy/paste/sửa tự do.**

## 1. Hiện trạng (quan sát trên Công đoạn "Bài in 1 màu hoặc 2 màu", công thức giá riêng của máy)

- **Không copy được.** Mọi `mousedown` trên chip và nền ô đều `preventDefault` (để giữ con trỏ) ⇒
  trình duyệt không bôi đen được. Có bôi được thì chữ ra là NHÃN ("SL vào của công đoạn ×"), không
  phải mã `sl_vao`.
- **Paste chạy nửa vời.** Chuỗi dán vào ô gõ một dòng: kết thúc bằng `)`/toán tử thì tách chip
  ngay; kết thúc bằng số/biến thì nằm chữ thô tới khi Enter/rời ô.
- **Khó đọc.** Mỗi `(` `)` `,` `+` `×` là một ô màu ngang hàng với biến. Chuỗi 3 bậc `if(c1, v1,
  if(c2, v2, if(c3, v3, v4)))` thụt thêm một nấc mỗi bậc, bị bóp sang phải, cao kín màn hình.
- Số không nhóm nghìn (`700000`, `100000`) trong khi bảng máy ngay trên ghi `5.000`.
- Nút xoá trên chip biến là "×", trùng hình phép nhân "×" đứng sát bên.
- Bảng biến nằm cuối popup — công thức dài thì trôi khỏi màn, bấm chèn xong phải cuộn lên tìm
  con trỏ. Gõ tìm biến chỉ nhận MÃ, không nhận tên tiếng Việt.
- Không có hoàn tác: bấm nhầm "×" trên chip là mất.
- Popup ghi "Công thức giá" — không nói máy nào; dòng máy đang sửa bị popup che. Popup cuộn lồng
  trong drawer cũng cuộn; dấu `)` cuối bị cắt.
- ✕ trên popup = BỎ SỬA (trả về lúc mở) — trái với nghĩa "đóng" quen thuộc.
- Ô "Cách tính giá" trong bảng máy in mã thô bị cắt (`if ( sl_vao <= 3000 , 700000 + so_mau_pha…`);
  máy dùng công thức chung chỉ hiện "—". *(Chủ chốt giữ nguyên — §8.)*

## 2. Bất biến — không được phá

1. **Chuỗi lưu không đổi định dạng:** token nối nhau bằng một dấu cách (`if ( sl_vao <= 3000 , … )`).
   Engine máy chủ, dữ liệu cũ, lịch sử công thức không biết có thay đổi này.
2. **IF giữ nguyên ngữ nghĩa Excel** `if(điều kiện, nếu đúng, nếu sai)`, lồng tự do. Không tách
   thành bảng bậc, không thêm cột/trường mới, không có "kiểu công thức bậc" riêng.
3. **Mọi token vẫn là token:** `if`, `(`, `,`, `)` vẫn có mặt, bấm vào vẫn đặt con trỏ, Backspace
   vẫn xoá như hiện nay. Con trỏ vẫn là một chỉ số trên mảng token phẳng.
4. Không đụng schema/DB ⇒ không migration, không sửa `DB_SCHEMA.md`.

## 3. Chế độ Trực quan (mặc định)

### 3.1 Bậc thang — sửa `tinhDong`

Ví dụ hiển thị:

```
if (  [SL vào] <= 3 000 ,                                           điều kiện 1
      700 000 + [Số màu pha] × 400 000 + [Số bản kẽm] × 100 000 ,   nếu đúng
if (  [SL vào] <= 10 000 ,                                          điều kiện 2
      700 000 + ([SL vào] − 3 000) × (200 + [Số màu pha] × 200)
              + [Số màu pha] × 400 000 + [Số bản kẽm] × 100 000 ,
if (  [SL vào] <= 20 000 ,                                          điều kiện 3
      … 170 … ,
      … 150 …                                                       còn lại
)))
```

Luật:

- **Làm phẳng chuỗi else-if:** khi tham số THỨ BA của một `if` là trọn một `if(...)` (không có gì
  khác đi kèm trong tham số đó), `if` con vẽ CÙNG CẤP với `if` cha, không thụt thêm.
- Mọi trường hợp khác giữ cách thụt hiện nay: `if` ở vế "nếu đúng", `if` giữa phép tính
  (`700000 + if(...)`), `if`/`max`/`min` lồng trong `max`/`min`.
- Điều kiện và giá trị mỗi thứ một dòng (như hiện nay đã xuống dòng ở `,`). Dòng giá trị dài tự
  gãy, phần gãy **thụt treo** dưới chính nó để không lẫn sang dòng điều kiện kế tiếp.
- Các `)` đóng của cả chuỗi gom về MỘT dòng cuối.
- Cả chuỗi chung một vạch màu bên trái (một cấp). Dòng điều kiện nhấn nhẹ (nền/chữ đậm hơn) để mắt
  quét dọc cột ngưỡng 3.000 / 10.000 / 20.000.

### 3.2 Bớt nhiễu

- **Chỉ BIẾN là chip.** Số, toán tử, ngoặc số học hiện như chữ thường; `if` và `(` `,` `)` của hàm
  in nhạt hơn. Vẫn là phần tử bấm được (bất biến 3).
- **Số nhóm nghìn bằng khoảng trắng hẹp** (`700 000`), chỉ để nhìn. KHÔNG dùng dấu chấm: cú pháp
  lấy `.` làm dấu thập phân và `,` làm dấu ngăn tham số — hiện `700.000` thì người ta gõ lại đúng
  thế và máy hiểu là 700.
- Nút xoá chip biến chỉ hiện khi rê chuột vào chip (hoặc đổi biểu tượng), không trùng hình "×".
- Con trỏ đứng cạnh một ngoặc ⇒ ngoặc cùng cặp sáng lên (như Excel tô cặp ngoặc).
- **Cột nhãn mờ bên phải** ("điều kiện 1", "nếu đúng", "còn lại") — không phải token, không lưu,
  không chọn được. Chủ chốt GIỮ (29/09).

### 3.3 Soạn

- **Gõ tìm biến bằng tên tiếng Việt** ("màu", "kẽm") → danh sách gợi ý, chọn thì chèn chip. Vẫn nhận
  gõ mã như cũ.
- **Hoàn tác / làm lại** (Ctrl+Z / Ctrl+Y) trên chuỗi công thức trong phiên popup.

### 3.4 Thao tác theo bậc (chỉ khi có chuỗi else-if)

Bậc k = các token `if ( c_k , v_k ,` cộng dấu `)` khớp với `if` đó. Mọi thao tác là phép biến đổi
trên mảng token, kết quả luôn là IF lồng hợp lệ:

- **Chọn bậc:** bấm nhãn/đầu dòng điều kiện của bậc ⇒ bôi `c_k` + `v_k`. Ctrl+C chép, Delete = Xoá bậc.
- **Nhân đôi bậc:** chèn bản sao `if ( c_k , v_k ,` ngay dưới bậc k, thêm một `)` vào dòng đóng.
  Người khai sửa số ngay trên bản sao. Không có "thêm bậc trống" (ô trống = công thức sai cú pháp).
- **Xoá bậc:** bỏ `if ( c_k , v_k ,` và dấu `)` khớp. Vế "còn lại" không xoá riêng được.

## 4. Chế độ Dạng chữ

- Ô văn bản nhiều dòng, chữ đều nét. In chuỗi bằng MÃ, viết gọn kiểu Excel (`if(sl_vao <= 3000, …)`,
  không cách thừa quanh ngoặc/phẩy), xuống dòng theo đúng hình bậc thang ở §3.1.
- Copy / paste / bôi đen / Ctrl+Z là của trình duyệt.
- Rời ô / chuyển chế độ / đóng popup ⇒ tách token rồi nối lại đúng định dạng lưu (bất biến 1).
  Xuống dòng, khoảng trắng tuỳ ý đều bỏ qua.
- **Không nuốt ký tự lạ im lặng.** `catToken` hiện chỉ khớp ký tự nó biết — dán `≤`, `×`, `;` là
  mất không dấu vết. Dạng chữ phải báo "ký tự không đọc được: `≤`" và chỉ vị trí.
- Hai thói quen của Excel tiếng Việt khi dán — dấu `;` ngăn tham số và hàm viết hoa `IF`/`MAX`/…
  — CHỈ BÁO LỖI, không tự chuẩn hoá (chủ chốt 29/09). Câu báo nói rõ cách sửa: "dùng dấu phẩy `,`
  thay `;`", "viết thường: `if`".
- Gõ vài chữ tên tiếng Việt ⇒ gợi ý biến, chọn thì chèn MÃ. Bảng biến bấm vào cũng chèn mã tại con
  trỏ của ô chữ.
- Dưới ô: dòng **"Biến đang dùng"** (`sl_vao` = SL vào của công đoạn · `so_mau_pha` = Số màu pha · …)
  vì ô chữ không rê chuột xem nghĩa từng chữ được.

## 5. Chuyển chế độ

- Nút hai nấc **"Trực quan | Dạng chữ"** cạnh "Cú pháp". Nhớ lựa chọn cuối theo trình duyệt
  (localStorage, bọc try/catch); mặc định Trực quan.
- Chuyển KHÔNG đổi dữ liệu. Kiểm lỗi dùng chung một bộ cho cả hai chế độ.
- Công thức đang sai vẫn cho chuyển sang Trực quan: mã lạ thành chip đỏ (như nay), thiếu/thừa ngoặc
  báo lỗi, bậc thang vẽ tới đâu hay tới đó. Chặn thì người khai kẹt ở Dạng chữ không biết sai đâu.
- Lỗi phải chỉ vào đúng chỗ (tô đỏ chip / vị trí trong ô chữ), không chỉ một dòng dưới đáy.
- Bổ sung kiểm: `if` phải đủ 3 tham số, `max`/`min` ≥ 2 — hiện chỉ kiểm ngoặc và tên biến.

## 6. Copy / paste

- **Dạng chữ:** tự nhiên (§4).
- **Trực quan:** nút **"Sao chép"** cạnh "Cú pháp" (chép cả công thức ra chuỗi mã); chọn bậc rồi
  Ctrl+C (§3.4); **Ctrl+V** tách chuỗi thành chip chèn ngay tại con trỏ. Không làm Shift+mũi tên
  bôi từng chip.
- Chuỗi chép ra luôn là chuỗi MÃ — dán được sang máy khác, sang ô khác, gửi qua Zalo.

## 7. Popup & bảng máy (`FormulaPopover`, `MayCuaCongDoan`)

- **Tiêu đề ghi rõ máy:** "Công thức giá riêng — IN-01 · Máy in 2 màu Mitsubishi 72×102" (tương tự
  cho giờ chạy).
- **Popup trống có lối vào:** thay vì chỉ "Bỏ trống = dùng công thức chung", có nút **"Lấy công thức
  chung làm gốc"** và **"Chép từ máy…"** (danh sách máy cùng công đoạn đã có công thức riêng).
- **Giữa màn hình, nền mờ:** hộp không neo vào ô nữa mà nổi giữa màn (rộng tối đa 1040px, cao
  tối đa 86vh, chỉ ruột cuộn, chân "Huỷ/Xong" đứng yên); xung quanh phủ lớp tối + làm mờ; bỏ viền
  cam bên trái. Bấm nền mờ = chốt (như "Xong"), chỉ tính khi nhấn-nhả đều trên nền để cú nhả chuột
  không rơi xuống drawer bên dưới.
- **Nút ✕:** đổi thành nút chữ **"Huỷ"** cạnh "Xong" (giữ nguyên hành vi bỏ sửa, Esc vẫn = Huỷ,
  bấm ra ngoài vẫn = chốt). ✕ ở góc bỏ đi để không ai bấm nhầm tưởng là "đóng".
## 8. Đã chốt (29/09/2026)

1. Cột nhãn mờ bên phải: GIỮ.
2. `;` và hàm viết hoa khi dán: CHỈ BÁO LỖI, không tự chuẩn hoá.
3. Ô "Cách tính giá" / "Cách đo giờ chạy" trong bảng máy: GIỮ NHƯ HIỆN NAY — không làm nhãn tóm tắt.

## 9. Ngoài phạm vi

- Ô thử số / xem trước kết quả với số mẫu — chủ đã nói không cần.
- Tự rút gọn hay viết lại công thức cho người khai.
- Ghi nhận lệch nhỏ (không sửa trong đợt này): `formulaTokens.HAM_TOAN` có `abs` nhưng
  `FormulaField.MATH_FUNCS` không có ⇒ gõ `abs` bị báo "không được hỗ trợ" dù engine chạy được.

## 10. Kiểm chứng khi làm

- Test đơn vị cho `tinhDong` mới: chuỗi else-if 1/3/5 bậc; `if` ở vế đúng; `if` giữa phép tính;
  `if` trong `max`; công thức thiếu ngoặc — không vỡ, không mất token.
- Test khứ hồi: chuỗi đã lưu → Dạng chữ → sửa khoảng trắng/xuống dòng → lưu ⇒ chuỗi y hệt ban đầu.
- Test thao tác bậc: nhân đôi / xoá bậc đầu, giữa, cuối ⇒ ngoặc cân, số tham số đúng.
- Thao tác lại bằng chuột/bàn phím thật trên dev-browser: mở Công đoạn → máy → ô Cách tính giá, đọc
  bậc thang, chuyển Dạng chữ, copy sang máy khác và paste, nhân đôi/xoá bậc, Huỷ/Xong, Lưu thay đổi,
  mở lại kiểm chuỗi đã lưu.

## 11. Cập nhật 22/10/2026 — phương án C (tách phần + bảng Khi | Lấy + phần chung P)

Chủ chọn C trong `docs/mockups/o-cong-thuc-de-doc-3-phuong-an.html` (hình 1 công thức khoán, hình 2
giá riêng máy IN-02). Bất biến mục trên giữ nguyên: chuỗi lưu không đổi dạng, mọi token vẫn bấm được,
con trỏ vẫn là một chỉ số trên dãy phẳng, Dạng chữ không đổi.

- Công thức từ 15 token, cắt được ở + − × ÷ ngoài cùng thành ≥ 2 phần (`congThucTachPhan.tachPhan`)
  ⇒ dòng khung "Kết quả = ( A + B ) × C" (ngoặc và dấu nối là token thật), mỗi phần một khối có chữ.
  Bấm chữ = đặt con trỏ vào đầu phần đó.
- Chuỗi if đủ bộ, chữ `if` đứng đầu dòng ⇒ bảng Khi | Lấy | bậc k (thay cột nhãn mờ "điều kiện k /
  nếu đúng / còn lại" của mục 8.1 — chỉ trong bảng; dòng không kẻ bảng được vẫn giữ nhãn mờ).
- Các vế lấy (mỗi vế một dòng) có số hạng giống nhau ở MỌI bậc (`150000 × kẽm` ≡ `kẽm × 150000`)
  ⇒ dòng P "phần chung, có ở mọi bậc"; bậc nào không giữ con trỏ thì hiện "P + phần riêng", bậc đang
  sửa bung đủ token, phần chung in mờ. "Sửa phần chung" là ô chữ một dòng: Enter viết lại mọi bậc
  thành `P mới + phần riêng` (thứ tự số hạng đổi, tổng không đổi).
