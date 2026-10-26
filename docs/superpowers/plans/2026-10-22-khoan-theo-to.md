# Khoán theo tổ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Màn Lương → tab "Khoán theo tổ": chọn kỳ + tổ, thấy quỹ tổ, chia cho từng người, sổ sản lượng từng lần ghi (hover ra công thức/thế số và cách chia), ngày dừng máy, người của tổ làm ở tổ khác.

**Architecture:** `KhoanKyService.tinh(..., so=True)` trả thêm bản ghi THEO LẦN GHI (đã áp luật ngày, đã trích tổ trưởng) — engine là nguồn số duy nhất, màn mới không tính lại. Service mới `khoan_theo_to.py` lọc theo tổ, ghép nhãn lệnh/khách/quy cách và đọc phân bổ bù lỗ từ dòng lương của kỳ. Route `GET /api/luong/khoan-theo-to`, tab FE mới đọc một payload.

**Tech Stack:** FastAPI + SQLAlchemy, React + TS, pytest, vitest.

**Spec:** mockup đã duyệt `docs/mockups/khoan-theo-to-a-chi-tiet.html` + memory "khoan-theo-to-phuong-an-a" (chốt 22/10/2026).

## Global Constraints

- Không in chữ "lương ca máy" ra UI: mức tháng = "Lương bù lỗ", ÷ công = "Phân bổ lương bù lỗ".
- Lương khoán = sản lượng + dừng máy + tổ trưởng + ở tổ khác — KHÔNG gồm tăng ca khoán; cột Tăng ca khoán vẫn đứng giữa Dừng máy và Ở tổ khác, quỹ tổ vẫn gồm nó.
- % cạnh tên ở sổ tính trên TỔNG tiền lần ghi: người + tổ trưởng = 100%.
- Tổ trưởng chia/thưởng hiện ở MỌI lần ghi của tổ (kể cả khi tổ trưởng không được tick); bảng Chia cho người chỉ cộng.
- Không chữ đậm, không nối mẩu dữ liệu bằng "·" hay dấu phẩy; mỗi thông tin nói một lần.
- Tiền chỉ người có ô `luong:view_payroll_table` + phạm vi nhân sự bao trọn người trên màn (gác ở máy chủ).
- Không sửa `payroll_service.py` (phiên `luong-sx-tang-ca-khoan` đang giữ). Không đổi schema DB.

## Review Focus

- Kỳ không có lần ghi nào của tổ → màn trống có câu nói rõ, không vỡ.
- Ngày tổ in làm CN/lễ (hệ số 0) → dòng vẫn hiện, tiền gạch, không cộng quỹ.
- Kỳ chưa tạo bảng lương → Phân bổ bù lỗ / Lương chính để "—", các cột khoán vẫn đủ.
- Người tổ khác được tick trong lần ghi của tổ → có tên kèm tổ, không bị tính lương chính ở tổ này.
- Phạm vi "Của tôi"/"Phòng" không bao trọn người của tổ → 403, không lộ tiền.

---

### Task 1: Engine trả bản ghi theo lần ghi

**Files:** Modify `backend/app/services/khoan_ky.py`; Test `backend/tests/test_khoan_theo_to.py`

**Interfaces — Produces:** `KhoanKyService.tinh(year, month, muc, *, so: bool = False)`; khi `so=True` kết quả có thêm `"so": {"lan_ghi": [...], "dung_may": [...], "ngay": [...], "to_truong": [...]}`:
- lan_ghi: `batch_id, ngay, to_id, cong_viec_id, lsx_id, bai_ghep_id, cong_doan, bac, tuy_chon, phat_sinh[{ten,so_luong,don_vi,don_gia,tien}], so_luong, don_vi, tien_chinh, tien (gốc), he_so, ghi_chu, cong_thuc ("chữ = thế số = kết quả"), nguoi{emp: tiền cuối}, to_truong[{dep_id, emp, che_do, ty_le, tien}]`
- dung_may: `ngay, to_id, ly_do, sua_chua, ghi_chu, tien, nguoi{emp: tiền}`
- ngay: `to_id, ngay, quy, chi_tieu, tang_ca, nguoi{emp: tiền}`
- to_truong: `dep_id, emp, che_do, ty_le, quy, tien`

- [ ] Test: hai lần ghi của tổ có tổ trưởng ăn chia 5%, tổ trưởng không tick ở lần 2 → mỗi lần ghi có `to_truong[0].tien == 5% × tien`, Σ nguoi + tổ trưởng chia == tien; tổng nguoi theo emp khớp `khoan` cũ.
- [ ] Code: tách `_ngu_canh` khỏi `_tien_chinh`; `dien_giai(ct, ctx, ten)`; ghi bản ghi trong vòng lặp; trích tổ trưởng theo batch trước khi nhân `(1 − tỷ lệ)`.
- [ ] `pytest backend/tests/test_khoan_theo_to.py backend/tests/test_khoan_ky.py backend/tests/test_khoan_dot_2_tinh.py -q` xanh.

### Task 2: Service + route Khoán theo tổ

**Files:** Create `backend/app/services/khoan_theo_to.py`; Modify `backend/app/repositories/khoan_ky_repo.py`, `backend/app/routers/payroll.py`, `backend/app/schemas/payroll.py`; Test `backend/tests/test_khoan_theo_to.py`

**Interfaces — Produces:** `xem_khoan_theo_to(db, payroll_svc, year, month, to_id | None, duoc_xem: set[int] | None) -> dict`; `GET /api/luong/khoan-theo-to?year&month&to_id` → `KhoanTheoToOut` (cac_to, to, to_truong, quy, nguoi, doi_chieu, so, khac, dung_may, ngay, canh_bao).

- Người của tổ = nhân viên `department_id == to_id` có tiền trong kỳ hoặc có dòng lương kỳ đó; người tổ khác có tiền từ tổ này hiện kèm tên tổ, không tính lương chính.
- Phân bổ bù lỗ + thử việc lấy ở dòng lương kỳ (`bu_lo_theo_cong`, `is_probation`); không có dòng ⇒ None.
- Lương chính = thử việc ? phân bổ : max(lương khoán, phân bổ).
- [ ] Test API: tổ có 2 người, tổ trưởng chia 5% → `quy.tong`, `nguoi[].luong_khoan` không gồm tăng ca, `so[].nguoi` đủ; phạm vi thiếu người → 403.
- [ ] `pytest backend/tests/test_khoan_theo_to.py -q` xanh.

### Task 3: Tab FE "Khoán theo tổ"

**Files:** Modify `frontend/src/api/client.ts`, `frontend/src/pages/nhan-su-luong/luong/LuongPage.tsx`, `.../shared/types.ts`; Create `.../tabs/KhoanTheoToTab.tsx`, `.../tabs/khoan-theo-to.css`, `.../tabs/KhoanTheoToTab.test.tsx`

- Tab sau "Bảng lương tháng", cùng ô `view_payroll_table`. Chọn kỳ (tháng/năm) + tổ.
- Khối: tóm tắt quỹ + dải tổ trưởng → Chia cho người (ô bên được trả tô xanh, dòng đối chiếu) → Sổ sản lượng theo ngày, gộp ô theo lệnh → Hỏng máy → Người của tổ làm ở tổ khác (cùng khuôn sổ).
- Hover tiền lần ghi = `CongThucTip`; hover % = `HoverTip` (Còn lại → Cách chia → Phần người → Tiền).
- [ ] vitest: render payload mẫu → có cột "Phân bổ lương bù lỗ", không có chữ "lương ca máy", dòng "Tổ trưởng chia 5%" trong sổ.
- [ ] `npx vitest run src/pages/nhan-su-luong/luong/tabs/KhoanTheoToTab.test.tsx` + `npx tsc --noEmit` xanh.
- [ ] Mở màn trên dev-browser, chọn kỳ 10/2026 + một tổ có lần ghi, rê vào tiền và %.
