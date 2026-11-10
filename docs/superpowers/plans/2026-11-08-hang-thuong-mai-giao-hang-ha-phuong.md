# Hàng thương mại và Giao hàng Hà Phương: kế hoạch thực thi

> Thực thi native trong phiên này (chủ dự án nói "lên kế hoạch rồi làm đi"). Bước dùng checkbox.

**Mục tiêu:** In Hà Phương bán hàng thương mại (mua về bán, không qua sản xuất) và ghi nhận phương thức
giao ở mỗi lần xuất hàng. Sao Việt Nhật không thấy gì.

**Kiến trúc:** Hai phân hệ mới `thuong_mai`, `giao_hang_hp`, mặc định tắt, bật bằng env `PHAN_HE_BAT`
gộp vào `phan_he_tat()`. Đơn thương mại ở chung `orders` với `source_type='thuong_mai'`, xuất hàng qua
bản ghi riêng `luot_xuat_thuong_mai` nối yêu cầu kho bằng tham chiếu mềm. Phương thức giao ghi ở bảng
`phuong_thuc_giao_hp`, nối mềm tới yêu cầu kho (đơn sản xuất) hoặc lượt xuất (đơn thương mại).

**Tech:** FastAPI + SQLAlchemy (routers → services → repositories), React + Vite + TS.

**Spec:** `docs/design-hang-thuong-mai-ha-phuong.md`, `docs/design-giao-hang-ha-phuong.md`.

## Ràng buộc chung

- Tắt cả hai phân hệ (mặc định) thì SVN y nguyên. Code chung chỉ rẽ nhánh theo cờ phân hệ hoặc
  `source_type == 'thuong_mai'`.
- Không sửa `delivery_service.py`, `routers/delivery.py`, `models/delivery.py`, `dm_xe`, khoán km. Được
  import hàm từ đó.
- Migration nối vào `MIGRATIONS` ở `backend/app/db_migrations.py`, số `0460` trở lên (phiên khác đang
  giữ 0456, 0457). Mọi bảng và cột mới ghi `docs/DB_SCHEMA.md`. Không seed.
- Tiền (giá bán, đơn giá, thành tiền, giá vốn, tiền cước) gác ở router theo luật xem tiền hiện có.
- Người lập, người chọn phương thức lấy từ tài khoản ở máy chủ.
- Chữ trên UI tiếng Việt. Không cột "Loại đơn", không nút "Đề nghị mua", không báo cáo mới ngoài bộ lọc
  nguồn đơn ở Báo cáo kinh doanh.
- Chỉ `git add` đúng file mình sửa; phiên khác đang sửa `db_migrations.py`, `models/order.py`,
  `routers/orders.py`, `api/client.ts`, `AppShell.tsx`, `PermissionMatrix.tsx`, `DB_SCHEMA.md`. Không
  commit khi chưa được bảo.

## Điểm rà kỹ

1. Đơn TM lọt vào Kế hoạch / Lệnh SX / Theo dõi đơn qua một truy vấn quên lọc: test trên các repo đọc
   `san_xuat_released_at` và danh sách lệnh.
2. Huỷ yêu cầu kho sau khi lượt đã "đã xuất" (ghi sổ một phần rồi huỷ phần còn lại): lượt giữ "đã xuất".
3. Hoá đơn đơn TM gửi `delivery_trip_id` của chuyến (hoặc lượt chưa xuất): máy chủ từ chối.
4. Đơn TM có dòng không phải hàng thương mại (gửi id vật tư thường): máy chủ từ chối.
5. Người không có quyền xem tiền đọc danh sách hàng thương mại hoặc phương thức giao: không có số tiền
   trong JSON.

---

### Task 1: Cờ `PHAN_HE_BAT`

**Files:** `backend/app/config.py`, `backend/app/phan_he.py`, `frontend/src/auth/permissions.tsx`,
test `backend/tests/test_phan_he_ha_phuong.py`.

- Produces: `THUONG_MAI = "thuong_mai"`, `GIAO_HANG_HP = "giao_hang_hp"`,
  `CHI_BAT_KHI_KHAI = frozenset({THUONG_MAI, GIAO_HANG_HP})`, `Settings.phan_he_bat: str = ""`.
  `phan_he_tat()` = `PHAN_HE_TAT ∪ (CHI_BAT_KHI_KHAI − PHAN_HE_BAT)`.
  `MODULE_CUA_PHAN_HE[THUONG_MAI] = {"hang_thuong_mai"}`, `[GIAO_HANG_HP] = {"xe_giao_hang"}`.
  FE `PhanHe` thêm `"thuong_mai" | "giao_hang_hp"`.
- [ ] Test: mặc định `tat("thuong_mai")` và `tat("giao_hang_hp")` là True, `module_bi_tat("hang_thuong_mai")`
  True; đặt `phan_he_bat="thuong_mai,giao_hang_hp"` thì cả hai False; `PHAN_HE_TAT` cũ không đổi.
- [ ] Làm, chạy test.

### Task 2: Danh mục Hàng thương mại

**Files:** model `VatTuInAn` (`la_hang_thuong_mai` Boolean, `gia_ban_theo_dvt` JSON `{dvt: int}`),
migration `0460_hang_thuong_mai`, repo/service/router mới `hang_thuong_mai` theo khuôn màn Vật tư khác,
lọc `la_hang_thuong_mai=false` ở repo Vật tư khác và Thành phẩm, module quyền `hang_thuong_mai` (đăng ký
module, ma trận, thanh bên). FE màn danh mục mới, ô chọn mặt hàng ở đơn mua / kho thấy hàng thương mại.

- Interfaces: `GET/POST/PUT /api/hang-thuong-mai`, item `{id, ma, ten, don_vi_gia, don_vi_them,
  gia_ban_theo_dvt?, ghi_chu, active}`; `gia_ban_theo_dvt` chỉ trả khi `view_cost`.
- [ ] Test: tạo mặt hàng TM không hiện ở danh sách Vật tư khác; không quyền xem tiền thì JSON không có
  `gia_ban_theo_dvt`; phân hệ tắt thì 403.

### Task 3: Đơn thương mại

**Files:** `models/order.py` (`SOURCE_THUONG_MAI`, `OrderLine.hang_thuong_mai_id`), migration
`0461_don_thuong_mai`, `order_repo._next_order_no(prefix)`, service mới
`services/thuong_mai/don_thuong_mai.py`, router mới `routers/thuong_mai.py`, rẽ nhánh trong
`order_service.confirm` / `_confirm_gate` / `update`, lọc `source_type != 'thuong_mai'` ở mọi repo đọc
đơn cho Kế hoạch / Lệnh SX / Theo dõi.

- Interfaces: `POST /api/thuong-mai/don {customer_id, deposit_pct?, deposit_amount?, ghi_chu?,
  lines:[{hang_id, dvt, qty, don_gia, vat_pct}]}`; `PUT /api/thuong-mai/don/{id}` (nháp); chốt dùng
  `POST /api/orders/{id}/confirm` sẵn có.
- [ ] Test: mã `TM001`, `TM002` riêng dãy `DH`; dòng không phải hàng TM bị 400; chốt không cần PO,
  ngày giao, không gọi `khai_cho_don`, `san_xuat_released_at` vẫn NULL; phân hệ tắt thì 404/403; đơn
  TM không hiện ở hàng chờ kế hoạch.

### Task 4: Lượt xuất thương mại

**Files:** model `luot_xuat_thuong_mai`, `luot_xuat_thuong_mai_dong`, `StockRequest.luot_xuat_tm_id`,
migration `0462_luot_xuat_thuong_mai`, service `services/thuong_mai/luot_xuat.py`, móc
`services/thuong_mai/moc_kho.py` (`kho_ghi_so_luot_xuat`, `kho_huy_luot_xuat`, tự nuốt lỗi), gọi một
dòng trong `routers/kho_voucher.py` và `routers/kho_request.py` cạnh móc giao hàng.

- Interfaces: `POST /api/thuong-mai/don/{id}/xuat {kho_id, lines:[{order_line_id, qty}], ghi_so?:bool,
  phuong_thuc?}`; `GET /api/thuong-mai/don/{id}/luot-xuat`. Ghi sổ đủ ⇒ `da_xuat`, chụp
  `cost_snapshot` từ lô thực xuất (Σ sl × `don_gia_nhap`). Huỷ yêu cầu khi chưa ghi sổ ⇒ `huy`.
  `ghi_so=true` chỉ khi người bấm có quyền ghi sổ kho đó ⇒ lập và ghi sổ phiếu luôn.
- [ ] Test: tạo lượt sinh yêu cầu XUAT kho đúng `kho_id` mang `luot_xuat_tm_id`; ghi sổ chuyển
  `da_xuat` và có giá vốn; huỷ yêu cầu chuyển `huy`; xuất vượt SL còn lại bị 400.

### Task 5: Hoá đơn, đã giao, báo cáo

**Files:** `SalesInvoice.luot_xuat_tm_id`, migration `0463`, `accounting_service._luot_giao_ghi_hoa_don`
và `create_sales_invoice` rẽ nhánh TM (adapter lượt xuất cho `gia_tri_luot_giao`), repo
`issued_invoice_amount_by_luot_tm`, `order_repo.da_giao_theo_dong_nhieu` cộng lượt xuất TM,
`bao_cao_kinh_doanh.lap_bao_cao(nguon=[...])` lọc `san_xuat` / `thuong_mai`.

- [ ] Test: hoá đơn đơn TM gắn lượt `da_xuat`, gửi lượt `cho_xuat` bị 400; đơn sản xuất đi đường cũ
  (test cũ vẫn xanh); báo cáo lọc `nguon=thuong_mai` chỉ ra đơn TM, mặc định ra hết.

### Task 6: Giao diện thương mại

**Files:** `DonHangBanPage.tsx` (nút "Tạo đơn thương mại" khi bật, ngăn chi tiết đơn TM), file mới
`pages/thuong-mai/*` (form đơn, form xuất, khối lượt xuất), `api/client.ts`, màn danh mục, bộ lọc Nguồn
đơn ở Báo cáo kinh doanh, hoá đơn chọn lượt xuất.

- [ ] `npx tsc --noEmit` sạch; bấm thử luồng: khai mặt hàng → nhập kho Cửa hàng → tạo đơn TM → chốt →
  xuất (ghi sổ luôn) → hoá đơn → phiếu thu.

### Task 7: Danh mục Xe giao hàng, cờ đơn vị vận chuyển, chip bộ phận giao hàng

**Files:** model `xe_giao_hang`, `Supplier.la_don_vi_van_chuyen`, migration `0464_giao_hang_hp`, router
`routers/xe_giao_hang.py`, module quyền `xe_giao_hang`, FE màn danh mục xe, ô cờ ở NCC, hiện lại chip
`la_giao_hang` khi bật `giao_hang_hp`.

- [ ] Test: CRUD xe khi bật, 403 khi tắt; cờ NCC lưu được.

### Task 8: Phương thức giao lúc xuất hàng

**Files:** model `phuong_thuc_giao_hp`, migration (chung 0464), service
`services/giao_hang_hp/phuong_thuc.py`, router `routers/giao_hang_hp.py`:
`POST /api/giao-hang-hp/xuat-hang` = `XuatHangIn` + `phuong_thuc` → gọi `DeliveryService.xuat_hang`
(import `get_service`, `_bao_kho` từ `routers/delivery.py`) rồi ghi phương thức nối `stock_request_id`;
đơn TM ghi qua Task 4 với `luot_xuat_tm_id`. SSE báo người giao. Hàng chờ chi cước theo đơn vị vận
chuyển ở Phiếu chi. Đơn bán trả `giao_hang_hp` (lần gần nhất) cho cột và danh sách các lần cho ngăn.

- Interfaces: `phuong_thuc = {loai: "khong_giao"|"noi_bo"|"dich_vu", nguoi_giao_id?, xe_id?,
  don_vi_vc_id?, tien_cuoc?, ma_van_don?}`; thiếu `loai` ⇒ 400.
- [ ] Test: thiếu phương thức 400; nội bộ bắt người giao thuộc bộ phận `la_giao_hang`; dịch vụ bắt NCC
  có cờ; tiền cước không có trong JSON khi không quyền xem tiền; tắt phân hệ ⇒ 404.

### Task 9: Giao diện giao hàng HP

**Files:** form Xuất hàng (`TienDoDon.tsx` `FormYeuCau`, chỉ thêm khối chọn phương thức khi bật và đổi
API gọi), component mới `pages/giao-hang-hp/ChonPhuongThucGiao.tsx`, cột Giao hàng ở Đơn hàng bán,
cột phương thức ở bảng lần xuất, hàng chờ chi cước ở Phiếu chi.

- [ ] `npx tsc --noEmit`; bấm thử xuất hàng đơn sản xuất với ba phương thức.

### Task 10: Tài liệu Hà Phương

- [ ] Thêm chương "Hàng thương mại" và mục "Giao hàng" vào bộ tài liệu Hà Phương; biên dịch XeLaTeX.
