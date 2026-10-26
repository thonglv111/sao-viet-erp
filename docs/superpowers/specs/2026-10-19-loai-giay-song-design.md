# Phân loại Giấy / Sóng cho mã giấy — thiết kế

Ngày: 19/10/2026. Trạng thái: chờ chủ dự án duyệt, CHƯA code.

## Vì sao

Hộp bồi (couche in xong bồi lên sóng E) cần hai mã ở danh mục Giấy. Hiện máy không biết mã nào là
giấy in, mã nào là sóng: `giay_nguyen` không có cột phân loại, giấy chính bị ĐOÁN theo thứ tự bước
(`giay_chinh` ở `backend/app/services/ptg_giay_buoc.py:38`), còn các màn sau (quy cách lệnh, thẻ quy
cách bàn tổ, KCS, phiếu công nghệ) đành kể chung mọi giấy vào một ô và bỏ ô Định lượng
(afb1f43e, f65210ba, d9c535c5). Tính giá cũng cho chọn bao nhiêu giấy tuỳ thích.

## Mục tiêu

1. Mỗi mã ở danh mục Giấy thuộc đúng một loại: **Giấy** hoặc **Sóng**.
2. Một sản phẩm trong Tính giá có **tối đa 1 mã Giấy** và **tối đa 1 mã Sóng**.
3. Các màn sau hiện tách: ô **Giấy** (một tên, kèm Định lượng của giấy đó) và ô **Sóng** (chỉ khi có).

## Không làm

- Loại thứ ba (decal, bìa bồi…). Chủ dự án chốt 19/10: hiện chỉ cần Giấy hoặc Sóng. Hai giá trị
  cố định, không thành danh mục động — luật tính giá bám trực tiếp vào nó.
- Không đổi cách tính tiền, bình bài, lượng giấy theo đầu vào bước, kế hoạch vật tư, kho, mua hàng.
  Sóng vẫn là một dòng giấy ở bước như hôm nay, tiền tính theo công thức của mã.
- Không viết đoạn tự sửa dữ liệu phiếu cũ (dự án chưa có người dùng thật).

## Thiết kế

### 1. Dữ liệu

- Cột mới `giay_nguyen.loai` `String(8)` NOT NULL, `server_default 'giay'`, giá trị `giay` | `song`.
  Migration mới (số kế tiếp sau `0425`), ghi `docs/DB_SCHEMA.md` mục `giay_nguyen` cùng lúc.
- Mọi mã cũ thành `giay`. Trên DB dev, mã SONG-E phải sửa tay sang Sóng qua màn danh mục.
- `GiayIn` / `GiayRow` (`backend/app/schemas/vat_lieu_kho.py`) thêm `loai: Literal["giay","song"]`
  — đi đủ dict → schema → type frontend (bẫy Pydantic nuốt field im lặng).
- Lịch sử giá (`giay_gia_version`) chụp toàn bản ghi: thêm `loai` vào ảnh chụp nếu bảng đó mirror
  từng cột (người làm kiểm và quyết, ghi vào DB_SCHEMA nếu thêm).

### 2. Danh mục Giấy (`CFG_GIAY`, `frontend/src/pages/rebuildCatalogConfigs.tsx`)

- Form: ô **Loại** đứng đầu khối Thông số, hai lựa chọn Giấy / Sóng kiểu nút chia đôi, mặc định Giấy.
- Danh sách: cột Loại (chữ thường, chip nhạt) và bộ lọc theo loại ở thanh lọc sẵn có.
- Excel nhập/xuất danh mục Giấy: thêm cột Loại; ô trống = Giấy, giá trị lạ = lỗi dòng.
- Đổi loại một mã đã dùng ở phiếu: cho đổi (không khoá). Phiếu đang vi phạm trần sẽ bị chặn ở lần
  lưu kế tiếp — đúng như phiếu cũ (mục 5).

### 3. Tính giá

**Luật (máy chủ chặn, đây là nguồn sự thật):** khi lưu phiếu, với MỖI sản phẩm, gom các mã giấy
KHÁC NHAU ở mọi bước (`phieu_buoc_vat_tu.hang_loai = 'giay'`), tra `loai`:
- quá 1 mã loại Giấy ⇒ 422 "Sản phẩm «tên» đang có 2 giấy: A, B. Mỗi sản phẩm chỉ một giấy."
- quá 1 mã loại Sóng ⇒ 422 tương tự cho sóng.
- Cùng một mã lặp ở nhiều bước vẫn tính là MỘT mã (cắt cuộn rồi In cùng mã — luật lượng giấy 18/10).
- Đặt kiểm ở tầng service, một hàm dùng chung cho mọi đường GHI chuỗi bước: tạo/sửa phiếu
  (`routers/phieu_tinh_gia.py` → `chuan_hoa_giay`) và lưu lệnh sản xuất nháp (người lập lệnh tự
  thêm/đổi dòng giấy ở bước, kể cả lệnh `khong_co_ptg` — `LsxBuocVatTuIn`, `backend/app/schemas/lsx.py`).
- Đường ĐỌC không chặn: nạp cấu hình sản phẩm tái bản (`san_pham_tai_ban_service.lay_chi_tiet`)
  vẫn nạp được cấu hình cũ có 2 giấy để người dùng mở ra sửa; lần lưu phiếu sau mới chặn.

**Thiếu giấy (lựa chọn của tôi, chủ dự án có thể đảo):** KHÔNG chặn. Sản phẩm không in
(`co_in=False`), dòng "đóng cuốn" của sách, thuê ngoài trọn gói đều hợp lệ mà không có giấy. Luật chỉ
là TRẦN: tối đa 1 Giấy + 1 Sóng.

**Giấy chính:** `giay_chinh` thôi đoán theo thứ tự bước — giấy chính = mã loại Giấy của sản phẩm.
Sản phẩm chỉ có Sóng (in thẳng lên tấm sóng) ⇒ giấy chính = mã Sóng, để bình bài/khổ/định lượng vẫn
có số (lựa chọn của tôi; tránh tính giá thiếu im lặng). Không có cả hai ⇒ None như hôm nay.
`phieu_thanh_phan.giay_id` vẫn là cột dẫn xuất; bình bài, khổ, định lượng tiếp tục đọc từ đó.

**Màn nhập (`frontend/src/pages/BuocVatTu.tsx`):**
- Ô "+ Thêm vật tư" tách hai nhóm "Giấy" và "Sóng" (rồi tới vật tư khác như hiện nay).
- Khi sản phẩm đã có một mã Giấy ở BẤT KỲ bước nào: các mã Giấy KHÁC hiện mờ, không chọn được,
  dòng phụ "Sản phẩm đã có giấy COUCHE 150GSM"; riêng mã đang dùng vẫn chọn được ở bước khác. Sóng
  tương tự. Muốn đổi giấy: xoá dòng giấy cũ rồi chọn mã mới.
- `BuocVatTu` hiện chỉ biết một bước ⇒ cha (`PhieuTinhGiaDetailView.tsx`, chỗ render ~3625) truyền
  xuống tập mã giấy/sóng đang dùng của cả sản phẩm.

### 4. Hiển thị ở các màn sau

Một hình dạng dữ liệu chung thay danh sách tên giấy: **`giay`** (tên một mã, string) + **`song`**
(tên một mã hoặc vắng). Định lượng luôn là của giấy, không bao giờ của sóng.

- Hàm repo thay `LsxRepository.ten_giay_cac_buoc` (`backend/app/repositories/lsx_repo.py:63`): trả
  `(giay, song)` bằng cách join dòng giấy của các bước lệnh với `giay_nguyen.loai` theo `vat_tu_id`.
  Tương tự `xep_lich_lenh_repo.giay_cac_buoc` (:273). Lệnh cũ (lập trước luật) hoặc mã bị đổi loại
  sau khi lập mà ra 2 mã cùng loại: KHÔNG lỗi, nối tên các mã cùng loại xuống dòng và bỏ Định lượng
  — đúng như cách hiển thị hiện nay; chỉ là ca hiếm.
- **Quy cách lệnh — LSX detail, khối "Giấy & tờ in"** (hình 3, `LsxDetailView.tsx` ~1428):
  ô GIẤY (một tên) · ô ĐỊNH LƯỢNG (luôn hiện lại) · ô SÓNG (chỉ khi có) · rồi Cách in, khổ… như cũ.
  `giayVaVatTuQuyCach` (`lsxVatTu.ts:185`) trả tách giấy / sóng; cả hai vẫn bị loại khỏi "Vật tư khác".
- **Thẻ quy cách bàn tổ** (hình 4, `ThsxQuyCach.tsx` + ảnh chụp lúc phát hành
  `services/san_xuat/snapshot.py` `the_quy_cach`): thêm dòng **Sóng** ngay sau Định lượng, vắng thì
  ẩn; `giay` trở về string một tên, `dinh_luong` luôn có. Lệnh đã phát hành giữ ảnh chụp cũ — muốn
  thấy kiểu mới phải thu hồi + phát hành lại. Mặt hiển thị vẫn đọc được `giay` dạng mảng cũ (in
  từng dòng) để lệnh cũ không vỡ.
- **KCS tab Quy cách** (hình 5, `kcs/KcsDoiChieu.tsx`): dùng chung `dongQuyCach` nên tự có dòng Sóng.
- **Phiếu công nghệ in** (`services/lenh_sx/phieu_cong_nghe.py` ~403): ô Giấy một tên + Định lượng
  của giấy; thêm ô Sóng khi có.
- **Xếp lịch** (`XlNgan.tsx:551`): chip giấy trước, chip sóng sau.
- **Diễn giải báo giá** (`services/quotation_service.py` ~152): "Giấy …, sóng …" thay kể danh sách.
- **Sản lượng tờ** (`services/san_xuat/san_luong_to.py`, type `SxSlQuyCach.giay`): đổi theo hình
  dạng mới.

### 5. Dữ liệu cũ

- Phiếu tính giá đang có 2 mã loại Giấy: mở xem bình thường; lưu lại ⇒ bị chặn với thông báo mục 3.
- Dữ liệu mẫu hộp 2 giấy trên DB dev (PTG-2026-0020 → BG26-0015 → DH013 → LSX26-0023): sau khi sửa
  SONG-E thành Sóng thì hợp lệ; LSX26-0023 phải thu hồi + phát hành lại mới ra thẻ quy cách mới.

## Kiểm thử

- Backend: lưu phiếu 1 giấy + 1 sóng ⇒ được; 2 giấy ⇒ 422; 2 sóng ⇒ 422; cùng mã giấy ở 2 bước ⇒
  được; giấy chính = mã loại Giấy dù sóng đứng ở bước trước In; chỉ sóng ⇒ giấy chính = sóng; lưu
  lệnh nháp 2 giấy ⇒ 422; nạp cấu hình tái bản cũ 2 giấy vẫn được. Cập nhật `test_giay_vat_tu_buoc.py`
  (giay_chinh), test snapshot quy cách, test phiếu công nghệ.
- Frontend: `ThsxQuyCach.test.ts`, `lsxVatTu.test.ts`, `ThsxDanhSach.test.tsx` đổi fixture "GIẤY
  SÓNG E 300GSM" sang dạng giấy + sóng.
- Bấm thử trọn luồng trên dev-browser: sửa SONG-E thành Sóng ở danh mục → Tính giá hộp bồi chọn
  couche + sóng, thử chọn giấy thứ hai thấy bị mờ → báo giá → đơn → lệnh → phát hành → xem quy
  cách lệnh, thẻ bàn tổ, KCS tab Quy cách, phiếu công nghệ: thấy Giấy + Định lượng + Sóng tách ô.

## Để người làm quyết

Tên hiển thị chip/cột, vị trí chính xác ô Loại trong form, câu chữ thông báo lỗi (giữ ý như trên),
cách join `loai` trong repo.
