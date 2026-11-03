# Tắt phân hệ theo bản cài — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Biến `PHAN_HE_TAT=luong,khoan,hoa_hong,giao_hang` tắt lương, tiền khoán, hoa hồng, giao hàng
+ xe; đơn bán có "Xuất hàng" đi qua kho bằng chuyến ẩn.

**Architecture:** Một module `app/phan_he.py` đọc cấu hình. Cổng quyền ở `AuthorizationService` lọc
bỏ module của phân hệ tắt; `/api/auth/permissions` trả thêm `phan_he_tat` để giao diện ẩn phần nằm
trong màn khác. Xuất hàng = `tao_yeu_cau` + `len_ke_hoach` (người bấm đứng tên chuyến, không xe), kho
ghi sổ đủ ⇒ chuyến tự `thanh_cong`.

**Tech Stack:** FastAPI, SQLAlchemy, React + TS.

**Spec:** `docs/prd-tat-phan-he-theo-ban-cai.md`

## Global Constraints

- Rỗng = bật hết; SVN không đổi hành vi. Không xoá bảng, migration, import chéo.
- Không đụng hunk của phiên khác trong `catalog_registry.py`, `bien_cong_thuc.py`, `lsx_service.py`,
  `ho_so.py`, `schemas/lsx.py`, `khuon_be*`, `phieu_tinh_gia.py`, `PhieuTinhGiaDetailView.tsx`;
  `client.ts` chỉ stage hunk của mình (`git apply --cached`).
- Verify: pytest nhắm file + `npx tsc --noEmit`. Không chạy `./init.ps1` hay pytest cả bộ.

## Review Focus

- Admin cũng mất quyền module tắt (không có lối tắt quyền admin).
- Kho huỷ phiếu xuất của chuyến ẩn ⇒ yêu cầu + chuyến huỷ, hàng hết "đang giữ".
- Người bấm Xuất hàng chưa gắn hồ sơ nhân viên ⇒ báo lỗi rõ, không 500.
- Xuất vượt "còn phải giao" / vượt tồn ⇒ lỗi như yêu cầu giao.
- `PHAN_HE_TAT` rỗng ⇒ mọi test hiện có của giao hàng, lương vẫn xanh.

---

### Task 1: Cấu hình + cổng quyền + phát xuống FE

**Files:** Create `backend/app/phan_he.py`; Modify `config.py`, `services/rbac_service.py`,
`routers/auth.py`, `schemas/auth.py`; Test `backend/tests/test_phan_he_tat.py`.

**Interfaces — Produces:**
- `phan_he_tat() -> frozenset[str]`, `tat(ten: str) -> bool` trong `app/phan_he.py`.
- `MODULE_CUA_PHAN_HE = {"luong": {"luong"}, "giao_hang": {"giao_hang", "dm_xe"}}`;
  `module_bi_tat(module_key) -> bool`.
- `PermissionsOut.phan_he_tat: list[str]`.

- [x] Test: monkeypatch env ⇒ admin gọi `/api/luong/...`, `/api/giao-hang/requests`, `/api/xe` nhận
  403; `/api/auth/permissions` không có `luong`, `giao_hang`, `dm_xe` và có `phan_he_tat`; `nhan_su`
  trả `can_view_salary=False`. Env rỗng ⇒ như cũ.
- [x] Code: `Settings.phan_he_tat: str = ""`; lọc ở `_permissions_for`, `_permission`; `can()` trả
  False cho `view_salary`/`edit_salary` khi tắt `luong`; `capabilities` ghi đè hai cờ đó.
- [x] Chạy test, commit.

### Task 2: Xuất hàng ở đơn bán (backend)

**Files:** Modify `services/delivery_service.py` (`xuat_hang`, `sau_ghi_so_xuat`, `sau_kho_huy_xuat`),
`services/delivery_notify.py`, `routers/orders.py`; Test `backend/tests/test_xuat_hang_don_ban.py`.

**Interfaces — Produces:** `POST /api/giao-hang/xuat-hang` body
`{order_id, ngay_can_giao: date, lines: [{order_line_id, qty}], ghi_chu?: str}` gác
`don_hang_ban:update`, chỉ chạy khi tắt giao hàng, trả
`{request_code, phieu_kho}`. `DeliveryService.xuat_hang(*, order_id, ngay_can_giao, lines, actor,
scope, ghi_chu=None) -> dict`.

- [x] Test (env tắt giao_hang): xuất 100/1000 ⇒ có đề nghị XUẤT kho TP gắn chuyến; kho lập + ghi sổ ⇒
  `da_giao_theo_dong` = 100, chuyến `thanh_cong`; huỷ phiếu nháp ⇒ chuyến + yêu cầu `da_huy`; user
  không có hồ sơ NV ⇒ 400; vượt còn phải giao ⇒ 400.
- [x] Code: `xuat_hang` gọi `tao_yeu_cau` rồi `len_ke_hoach(employee_id=<NV của actor>,
  vehicle_id=None, luot_xe_id=None, bao=False, ghi_chu_phan_cong="Xuất hàng tại đơn bán")`.
  `sau_ghi_so_xuat`/`sau_kho_huy_xuat` rẽ nhánh khi `tat("giao_hang")`. `delivery_notify` không báo tài
  xế khi tắt.
- [x] Chạy test + `tests/test_delivery*.py` (env rỗng), commit.

### Task 3: Hoa hồng + khoán ở backend

**Files:** Modify `services/order_service.py` (`_chup_hoa_hong`), `services/accounting_service.py`
(chặn phiếu thu theo kỳ lương), `services/san_xuat/board.py` (bỏ trường tiền khoán khi tắt),
`services/cong_doan_service.py` (bỏ kiểm công thức khoán khi tắt). Test thêm vào
`test_phan_he_tat.py`.

- [x] Test: tắt `hoa_hong` ⇒ chốt đơn không chụp `bac_hoa_hong`; tắt `khoan` ⇒ lưu công đoạn không có
  khoán vẫn qua.
- [x] Code + chạy test + commit.

### Task 4: Giao diện

**Files:** Modify `auth/permissions.tsx` (`usePhanHeTat(): (ten) => boolean`), `api/client.ts`
(`myAccess` thêm `phan_he_tat`, `api.donHang.xuatHang`), `components/MobileTabBar.tsx`,
`pages/rebuildCatalogConfigs.tsx` (tab Khoán, cột CT khoán), `ThsxExecPanels.tsx`,
`BaoDungMayModal.tsx`, `DepartmentsPage.tsx` (tỷ lệ thử việc, Tổ máy in, Bộ phận Giao hàng),
`EmployeeDetailPanel.tsx` + `EmployeeWizard.tsx` (lương, hoa hồng), `HoSoCuaToiPage.tsx`,
`FormulaField.tsx` (chip khoán), `giao-hang/tien-do-don/TienDoDon.tsx` (form Xuất hàng),
`ke-toan/phieu-chi/shared/list-constants.ts`, `DonHangBanPage.tsx` (nhãn "Lần xuất").

- [x] Code từng màn; `npx tsc --noEmit` sạch.
- [x] Bấm thử với env tắt: đơn bán > Xuất hàng; kho lập phiếu, ghi sổ; đơn hiện đã giao; thanh bên
  không còn Lương, Giao hàng, Xe giao hàng; Công đoạn không còn tab Khoán. Env rỗng: SVN như cũ.
- [x] Commit (+ PDF tài liệu: không ảnh hưởng, SVN bật hết).
