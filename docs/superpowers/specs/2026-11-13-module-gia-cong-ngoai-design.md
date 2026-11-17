# Module Thuê gia công (tách khỏi Lệnh sản xuất) — Thiết kế

**Ngày:** 13/11/2026 · **Trạng thái:** ĐÃ DUYỆT 13/11/2026 ("làm đi"); Q1–Q7 chốt theo cột Đề xuất (§11).
**Tên module:** **Thuê gia công** — khoá quyền `thue_gia_cong`, đường dẫn `/thue-gia-cong`, tiền tố bảng `tgc_`.
**Plan:** `docs/superpowers/plans/2026-11-13-thue-gia-cong.md`.
**Thay thế khi duyệt:** `2026-09-26-gia-cong-ngoai-design.md` và `2026-09-27-gia-cong-ngoai-bai-ghep-design.md`.
**Tham chiếu:** module Subcontracting của ERPNext v17 (`D:\jobs\erpnext`), đã chạy thử hai luồng ngày
13/11/2026 — hướng dẫn kèm ảnh ở `D:\jobs\erpnext\.local-dev\huong-dan-gia-cong\huong-dan-gia-cong.html`.

Một câu: **Lệnh sản xuất chỉ gắn cờ "thuê ngoài"; mọi việc đặt — giao — nhận — trả tiền nằm ở một module
riêng "Thuê gia công", theo đúng khung ERPNext nhưng bỏ phần hạch toán.**

---

## 1. Vì sao làm lại

Bản 26/09 nhét toàn bộ gia công vào lệnh (khối Gia công ngoài, nút Đã mang đi / Chốt). Khi rà lại có
các vấn đề:

| # | Vấn đề | Hậu quả |
|---|---|---|
| 1 | Không đơn giá (gỡ 07/10) | Kế toán trả theo hoá đơn nhà gia công, không gì đối chiếu; không có giá thành |
| 2 | Không biết hàng đang ở nhà gia công | Gửi 1.660 về 1.650: 10 tờ hụt không ghi ở đâu; giấy trọn gói xuất ra là mất dấu |
| 3 | Vật tư xưởng đưa kèm đi theo đề nghị xuất thường | Không đối chiếu được đưa bao nhiêu, dùng bao nhiêu |
| 4 | Chốt MỘT con số, MỘT lần | Hàng về từng đợt thì tổ sau phải chờ, hoặc tách lần gượng ép |
| 5 | Một lần gia công — một phiếu chi | Nhà gia công gom hoá đơn cuối tháng ⇒ kế toán lập hàng chục phiếu |
| 6 | Người kế hoạch mang đi + nhận về + gõ số + có thể cầm tiền | Một người giữ cả hàng, số và tiền; KCS "đạt" ghi giả |
| 7 | Lệnh gánh cả nghiệp vụ mua ngoài | Màn lệnh phình; không gộp được nhiều lệnh vào một chuyến / một đơn |

Giữ lại từ bản cũ (đúng, không đổi): gộp dải bước thuê ngoài liền nhau cùng nhà gia công · trọn gói thay
cho phát hành · ba nơi về (xưởng / kho / khách) · chia theo số con/tờ cho bài ghép · không 331.

## 2. ERPNext làm thế nào — và SVN lấy gì

ERPNext tách rõ hai tầng:

- **Tầng sản xuất chỉ có cờ.** Công đoạn trong BOM có ô `is_subcontracted`
  (`manufacturing/doctype/bom_operation`), sang Thẻ công việc thành `is_subcontracted`
  (`job_card.py:110`). Thẻ đó không có nút Bắt đầu, chỉ có nút "Tạo PO gia công"
  (`job_card.js:215`, `make_subcontracting_po`).
- **Tầng gia công là module riêng** (Sản xuất › Ký gửi): Đơn mua hàng tick gia công → Đơn hàng ký gửi
  (`subcontracting_order`, có `supplier_warehouse`, `schedule_date`, `per_received`) → phiếu kho
  "Send to Subcontractor" → Phiếu nhận ký gửi (`subcontracting_receipt_item`: `received_qty`, `qty`,
  `rejected_qty`, nhận nhiều phiếu) → Biên nhận + Hoá đơn tiền công.
- **Nối ngược:** Phiếu nhận gửi xong gọi `update_job_card()` (`subcontracting_receipt.py:283`) ⇒ thẻ công
  việc tự Hoàn thành.
- **Vật tư nhà gia công tự lo:** dòng BOM tick `sourced_by_supplier` ⇒ không vào bảng vật tư cấp
  (`test_bom.py:498-528`).

| ERPNext | SVN mới | Ghi chú |
|---|---|---|
| Cờ `is_subcontracted` trên công đoạn / thẻ công việc | Ô tick **Thuê ngoài** trên bước lệnh; nút **Thuê gia công trọn gói** trên lệnh | Lệnh không giữ gì khác |
| Đơn mua hàng (gia công) + Đơn hàng ký gửi | Gộp thành **Đơn gia công** | Một chứng từ thay hai |
| Subcontracting BOM + mặt hàng dịch vụ | Bỏ. Dòng đơn tự mang "việc" (tên công đoạn) + đơn giá | |
| Kho nhà gia công + phiếu "Send to Subcontractor" | **Phiếu giao gia công** + sổ **Hàng đang ở ngoài** (chỉ số lượng) | Không tạo kho thật — xem §6 |
| Phiếu nhận ký gửi (nhận nhiều lần, đạt/hỏng, tự trừ vật tư) | **Phiếu nhận gia công** (nhiều đợt, đạt/hỏng, nơi về) | Giữ nguyên ý |
| `update_job_card()` | Phiếu nhận đẩy về lệnh: bàn giao bước sau / nhập kho / giao khách; nhận đủ ⇒ bước xong | |
| Biên nhận + Hoá đơn mua + công nợ 331 | Bỏ. Phiếu nhận tự sinh **tiền công tạm tính**; Phiếu chi trả gộp nhiều phiếu nhận | Không bút toán |
| `sourced_by_supplier` trên dòng BOM | Ô tick **Nhà gia công tự lo** trên dòng vật tư của bước thuê ngoài | Định mức vẫn nằm ở lệnh — §4.7 |
| `schedule_date` của đơn | **Ngày hẹn về** trên đơn | Chỉ để theo dõi / nhắc tổ sau; KHÔNG đưa vào Xếp lịch (§7) |

## 3. Ranh giới hai module

**Lệnh sản xuất (Kế hoạch SX) — chỉ gắn cờ và hiển thị**

- Bước lệnh: ô tick **Thuê ngoài**. Tick thì ẩn Tổ/Máy, không chọn nhà gia công, không đơn giá.
  Bước vẫn **khai vật tư như bước thường**, mỗi dòng có thêm ô **Nhà gia công tự lo** (§4.7) — đây là
  định mức sản phẩm, thuộc lệnh, không phải chi tiết gia công.
- Lệnh chưa phát hành: nút **Thuê gia công trọn gói** thay cho Phát hành (giữ cơ chế gói một công việc
  không tổ của bản cũ để nhóm thành phẩm / giao hàng chạy nguyên đường).
- Sau phát hành: bước thuê ngoài hiện **trạng thái chỉ đọc** lấy từ module gia công —
  "Chưa đặt" · "Đã đặt GC-0007, hẹn 13/11" · "Đang ở Minh Phát 860/1.660" · "Xong 1.650 (hụt 10)" — kèm
  link sang đơn. Không nút ghi nào.

**Module Thuê gia công — toàn bộ nghiệp vụ**

Hàng chờ · Đơn gia công · Phiếu giao · Phiếu nhận · Hàng đang ở ngoài · Chờ trả tiền.

**Ba điểm nối (một chiều, không vòng)**

1. **Phát hành lệnh** → mỗi dải bước thuê ngoài (hoặc cả lệnh trọn gói) sinh một **Việc gia công** trong
   hàng chờ. Thu hồi gói / huỷ trọn gói ⇒ việc chưa đặt thì xoá, đã đặt thì chặn (huỷ đơn trước).
2. **Tổ bước trước bàn giao** sang công việc thuê ngoài → việc chuyển "Sẵn sàng giao", toast cho người
   phụ trách gia công. Bàn giao này do **Phiếu giao** nhận (thay nút Đã mang đi).
3. **Phiếu nhận gửi** → đẩy về sản xuất theo nơi về: bàn giao sang bước sau · đề nghị nhập kho thành
   phẩm · ghi giao thẳng khách. Dòng đơn **Hoàn tất** ⇒ công việc thuê ngoài trên lệnh = hoàn thành.

## 4. Chứng từ và khái niệm

### 4.1 Việc gia công (hàng chờ)
Một việc = một dải bước thuê ngoài liền nhau của MỘT lệnh (hoặc một bước chung của bài ghép), hoặc cả
lệnh trọn gói. Tự sinh, không ai tạo tay. Mang: lệnh/bài ghép, kiểu (một phần / trọn gói), tên việc
("Cán màng", "Bế + Dán", "Gia công trọn gói"), số lượng cần, đơn vị.

Khác bản cũ: luật gộp dải **không còn dựa vào nhà gia công** (lệnh không biết nhà gia công) — gộp theo
"liền nhau cùng tick Thuê ngoài". Muốn hai bước liền nhau đi hai nơi thì ở đơn tách hai dòng (xem câu hỏi
mở Q5).

### 4.2 Đơn gia công `GC-####`
- Đầu đơn: nhà gia công (NCC tích "Nhận gia công", giữ nguyên `suppliers.nhan_gia_cong`), ngày đặt,
  **ngày hẹn về**, ghi chú.
- Dòng đơn: một dòng = một việc gia công. Số lượng đặt (điền sẵn), **đơn giá** theo đơn vị nhận về.
- Một đơn gộp được **nhiều việc / nhiều lệnh** cùng nhà gia công.
- Trạng thái dẫn xuất: Nháp → Đã đặt → Đã giao (một phần / đủ) → Đã về một phần → Hoàn tất · Huỷ.

### 4.3 Phiếu giao gia công `GG-####`
- Gắn một đơn; nhiều đợt được.
- Dòng **bán thành phẩm** (tờ in…): số = số tổ bước trước đã bàn giao, điền sẵn, không gõ tay — giữ luật
  của bản cũ; dải đứng đầu lệnh thì gõ số. Lưu phiếu = xác nhận các bàn giao đó.
- Dòng **vật tư từ kho** (màng, keo…; giấy cho trọn gói): **điền sẵn** từ các dòng vật tư xưởng cấp của
  bước (§4.7), sửa được số. Lưu phiếu ⇒ một **đề nghị xuất kho** như hiện nay, mang `tgc_phieu_giao_id`;
  kho xuất bình thường. Phiếu giao hiện trạng thái kho của từng dòng.
- Bước không có dòng xưởng cấp (mọi dòng tick Nhà gia công tự lo) ⇒ phiếu giao chỉ có bán thành phẩm.

### 4.4 Phiếu nhận gia công `GN-####`
- Gắn một đơn; **nhiều đợt**. Mỗi dòng: dòng đơn, **số đạt**, **số hỏng**, **nơi về**.
- Nơi về: *xưởng* (dải còn bước sau) · *kho* (dải chứa bước cuối / trọn gói) · *khách* (giao thẳng, kèm
  ngày khách nhận — giữ luật bản cũ, chỉ khi dòng đơn đứng riêng một cụm bán, không cho bài ghép).
- Người nhận: **không phải người đã giao** (tổ bước sau, kho, hoặc người có quyền nhận gia công) — xem §8.
- Gửi phiếu ⇒ điểm nối 3. Bài ghép: số nhận (tờ ghép) chia theo số con/tờ như `_toa_san_luong` hiện có.
- Về kho: **không ghi KCS giả**. Đề nghị nhập kho mang `tgc_phieu_nhan_id`; kho tự kiểm khi lập phiếu nhập
  (câu hỏi mở Q4).

### 4.5 Hoàn tất dòng đơn và hao hụt
- Bấm **Hoàn tất** trên dòng đơn khi không chờ thêm hàng.
- Hao hụt = đã giao − đạt − hỏng (theo đơn vị quy đổi của dòng). Ghi trên dòng, hiện trên lệnh và màn
  Hàng đang ở ngoài. Không tự trừ tiền (câu hỏi mở Q3).
- Vật tư từ kho còn dư ở nhà gia công: Hoàn tất hỏi "đã trả về kho / nhà gia công dùng hết" — trả về thì
  lập đề nghị nhập trả kho như đường thường.

### 4.6 Tiền công
- Mỗi phiếu nhận sinh **tiền công tạm tính** = Σ (số đạt × đơn giá). Số hỏng không tính tiền.
- **Chờ trả tiền** = phiếu nhận chưa có phiếu chi còn hiệu lực.
- **Phiếu chi** nguồn "Thuê gia công" chọn **nhiều phiếu nhận cùng nhà gia công**; số tiền điền sẵn bằng
  tổng tạm tính, **sửa được** theo hoá đơn thật; lệch thì bắt ghi lý do.
- Giữ quyết định "không 331": không công nợ, không tuổi nợ, phiếu chi nguồn này vẫn loại khỏi báo cáo
  331. "Còn phải trả" chỉ là danh sách chờ trả.

### 4.7 Vật tư và bán thành phẩm của gia công một phần

Ví dụ In → Cán màng (thuê ngoài) → Bế:

```
                      ┌──────── đi ─────────┐            ┌──── về ─────┐
Bán thành phẩm: Tổ in ─ 1.660 tờ in ─▶ Minh Phát ─ 1.650 tờ đã cán ─▶ Tổ bế
                (không qua kho)        (đang giữ)   (không qua kho)
Vật tư kèm:     Kho ─ 66 m² màng ─────▶ Minh Phát ─ dùng hết / dư trả kho
                (đề nghị xuất kho)
```

**Bán thành phẩm (tờ in)** — giữ như hiện nay: đi thẳng từ bước trước sang nhà gia công, **không nhập
kho** (SVN không theo dõi tồn bán thành phẩm từ 17/09, mg 0308).
- Đi: tổ bước trước bàn giao → phiếu giao nhận đúng số bàn giao đó (§4.3).
- Về: phiếu nhận ghi đạt / hỏng → bàn giao thẳng cho tổ bước sau (§4.4).
- Ở giữa: sổ Hàng đang ở ngoài (§6) cho biết nhà gia công đang giữ bao nhiêu; Hoàn tất ra số hụt.

**Vật tư kèm** — bám ERPNext (định mức nằm ở BOM, dòng nào nhà gia công lo thì tick `sourced_by_supplier`):
- Bước thuê ngoài **khai vật tư như bước thường** (bung từ danh mục công đoạn + người lập lệnh sửa).
- Mỗi dòng có ô **Nhà gia công tự lo**, mặc định **tick** (giữ đúng mặc định bản cũ: nhà gia công lo, tiền
  nằm trong đơn giá).

| Dòng vật tư | Kế hoạch vật tư / giữ chỗ | Phiếu giao | Kho |
|---|---|---|---|
| Tick **Nhà gia công tự lo** | Không | Không có dòng | Không xuất |
| Bỏ tick (xưởng cấp) | Có, như bước thường | Điền sẵn dòng vật tư | Xuất theo đề nghị của phiếu giao |

- Vật tư xưởng cấp đã xuất nằm trong sổ Hàng đang ở ngoài cho tới khi **Hoàn tất** dòng đơn: chọn "nhà gia
  công dùng hết" hoặc "trả về kho" (số dư) → đề nghị nhập trả kho như đường thường.
- **Không tự trừ theo định mức** (ERPNext backflush theo số nhận): SVN chỉ đối chiếu đưa đi — trả về —
  dùng hết lúc Hoàn tất, đủ để biết đã đưa bao nhiêu cho lần nào.
- Đổi ý giữa chừng (đã giữ chỗ rồi tick lại "tự lo") ⇒ nhả giữ chỗ; đã xuất kho thì không cho đổi, dư thì
  trả kho lúc Hoàn tất.

**Trọn gói** giữ cơ chế giấy hiện nay: ô **Xưởng cấp giấy** + chọn khổ / số tờ (C1 06/10) → thành dòng
giấy trên phiếu giao; vật tư khác của lệnh do nhà gia công lo. Bước trên lệnh trọn gói không dùng ô tick
từng dòng.

## 5. Luồng thao tác

### 5.1 Một phần — In → Cán màng (ngoài) → Bế → Đóng gói

| # | Ai | Màn | Làm gì | Hệ ghi |
|---|---|---|---|---|
| 1 | Kế hoạch | Lệnh | Tick **Thuê ngoài** ở bước Cán màng. Phát hành. | Sinh việc "Cán màng LSX-0123 · 1.660 tờ" trong hàng chờ |
| 2 | Phụ trách GC | Hàng chờ | Tick việc này (+ việc cán màng của lệnh khác nếu cùng nơi) → **Tạo đơn**; chọn Minh Phát, đơn giá 600đ/tờ, hẹn 13/11 | Đơn GC-0007; lệnh hiện "Đã đặt GC-0007, hẹn 13/11" |
| 3 | Tổ in | Việc của tổ | Bàn giao 1.660 tờ sang Cán màng như thường | Việc chuyển "Sẵn sàng giao", toast phụ trách GC |
| 4 | Phụ trách GC | Đơn | **Giao hàng**: 1.660 tờ (điền sẵn) + 66 m² màng (đề nghị xuất kho) | Phiếu GG-0011; Hàng ở ngoài: Minh Phát 1.660 tờ |
| 5 | Tổ bế | Đơn (hoặc nút ở Việc của tổ) | **Nhận hàng** đợt 1: 800 đạt, 0 hỏng, về: Bế | Phiếu GN-0015; bàn giao 800 tờ sang Bế; tạm tính 480.000đ vào Chờ trả |
| 6 | Tổ bế | — | Làm Bế với 800 tờ | — |
| 7 | Tổ bế | Đơn | Nhận đợt 2: 850 đạt → **Hoàn tất** | Hụt 10 tờ; bước Cán màng trên lệnh = Xong 1.650 |
| 8 | Kế toán | Chờ trả tiền | Tick GN-0015, GN-0016 → **Lập phiếu chi** 990.000đ | Hai phiếu nhận rời Chờ trả |

### 5.2 Trọn gói — đặt in hộp ở nhà in khác

| # | Ai | Màn | Làm gì | Hệ ghi |
|---|---|---|---|---|
| 1 | Kế hoạch | Lệnh | **Thuê gia công trọn gói** thay cho Phát hành | Gói một công việc không tổ (như cũ); sinh việc "Trọn gói LSX-0130 · 5.000 hộp" |
| 2 | Phụ trách GC | Hàng chờ → Đơn | Tạo đơn: In Tân Phát, 1.200đ/hộp, hẹn 20/11 | GC-0008 |
| 3a | Phụ trách GC · Kho | Đơn | Xưởng cấp giấy: **Giao hàng** dòng giấy (chọn khổ + số tờ như C1 06/10) → đề nghị xuất → kho xuất | Hàng ở ngoài: Tân Phát 2.600 tờ Ivory 300 |
| 3b | — | — | Nhà gia công tự lo giấy: bỏ bước giao | Lệnh thôi đòi giấy, nhả giữ chỗ (như cũ) |
| 4 | Kho / người nhận | Đơn | Nhận từng đợt: về **kho** (đề nghị nhập thành phẩm) hoặc **khách** (ngày khách nhận) | "Giao được" / "đã giao" của đơn bán cộng như cũ |
| 5 | Phụ trách GC | Đơn | **Hoàn tất**; giấy dư trả kho nếu có | Lệnh xong |
| 6 | Kế toán | Chờ trả tiền | Lập phiếu chi | — |

### 5.3 Bài ghép (bước chung thuê ngoài)
Như 5.1, việc gia công gắn bài ghép thay vì lệnh. Phiếu nhận ghi số tờ ghép; hệ chia số con/tờ cho từng
lệnh (nhánh xưởng / điểm toả / về kho như bản 27/09). Không có nơi về *khách*.

## 6. Hàng đang ở ngoài — sổ số lượng, không phải kho

ERPNext theo dõi bằng **kho nhà gia công** thật (`supplier_warehouse`). SVN **không** làm kho thật vì:
tờ in (bán thành phẩm) không có tồn kho từ 17/09 (mg 0308), và kho SVN đi theo lô/vị trí — thêm kho ảo
sẽ kéo cả khoá sổ kỳ, kỳ tồn vào.

Thay vào đó là một **sổ tính ra** từ chứng từ của module:

```
Đang ở ngoài (theo nhà gia công × hàng) = Σ phiếu giao − Σ (đạt + hỏng) phiếu nhận − hao hụt đã hoàn tất − vật tư trả về
```

Vật tư từ kho: rời tồn kho khi kho xuất (như hiện nay), từ đó chỉ còn trong sổ này. Đủ để biết nhà gia
công đang giữ gì và hụt bao nhiêu, không đụng kế toán kho.

## 7. Xếp lịch — không đổi

Xếp lịch là nơi hẹn ngày/giờ **đẩy lệnh xuống xưởng** để các tổ chia việc; nó không tính thời lượng
từng bước. Vì vậy:

- **Trọn gói:** xưởng không làm gì ⇒ lệnh không vào Xếp lịch (như hiện nay).
- **Một phần:** lệnh vẫn được hẹn đẩy và đẩy như lệnh thường; bước có cờ Thuê ngoài không giao cho tổ
  nào, phần còn lại các tổ chia việc như cũ. Module gia công không ghi gì vào Xếp lịch.
- **Ngày hẹn về** trên đơn gia công chỉ để theo dõi: hiện trên bước thuê ngoài của lệnh và màn Việc của
  tổ bước sau ("hàng cán màng hẹn về 13/11").

## 8. Người và quyền

- Module mới `thue_gia_cong` (mục sidebar "Thuê gia công") trong ma trận quyền: Xem / Thao tác (đặt, giao) / **Nhận hàng** (bit riêng) /
  Huỷ.
- **Tách vai:** người lập phiếu giao của một đơn **không** được lập phiếu nhận của chính đơn đó (máy chủ
  chặn; chủ xưởng có thể tắt bằng cấu hình nếu xưởng nhỏ — Q2).
- Phiếu chi: kế toán (quyền phiếu chi sẵn có). Người nhận tiền mặc định là nhà gia công.
- Nhật ký `audit_logs` cho đặt / sửa đơn giá / giao / nhận / hoàn tất / huỷ.

## 9. Không làm

Công nợ 331, tuổi nợ, cọc · hạch toán, giá trị kho của hàng ở ngoài · kho nhà gia công thật · KCS trên
phần mềm cho hàng gia công · cảnh báo trễ hẹn · bảng giá gia công theo NCC (đơn giá gõ trên đơn, gợi ý
đơn giá lần trước cùng NCC + việc) · đổi cách báo giá tính bước thuê ngoài.

## 10. Phụ lục kỹ thuật (để ước lượng, chưa phải plan)

**Bảng mới**
- `tgc_viec`: `lsx_id` | `bai_ghep_id` (đúng một), `kieu`, `ten_viec`, `sl_can`, `don_vi`, `huy_luc`.
  Công việc của dải trỏ về qua `san_xuat_cong_viec.tgc_viec_id` (thay `gia_cong_ngoai_id`).
- `tgc_don` (+ `tgc_don_dong`: `tgc_viec_id` unique khi còn sống, `sl_dat`, `don_gia`, `don_vi`,
  `hoan_tat_luc`, `hao_hut`).
- `tgc_phieu_giao` (+ dòng: `tgc_don_dong_id`, `loai` = ban_thanh_pham | vat_tu, `so_luong`, `don_vi`,
  tham chiếu `stock_request_line` khi là vật tư).
- `tgc_phieu_nhan` (+ dòng: `tgc_don_dong_id`, `sl_dat`, `sl_hong`, `noi_ve`, `ngay_khach_nhan`).
- `tgc_phieu_chi_nhan` (phiếu chi ↔ nhiều `tgc_phieu_nhan`, `so_tien` phân bổ).

**Cột mới trên bảng cũ**
- `lsx_cong_doan_vat_tu.ncc_tu_lo` Boolean, `server_default=true` (§4.7).

**Sửa luồng vật tư** — hiện bước thuê ngoài bị bỏ qua khi bung vật tư:
`lsx_service._bung_lai_vat_tu` (docstring "THUÊ NGOÀI không bung") và `_bung_vat_tu_cong_doan`
(`if cd.loai_buoc == LB_THUE_NGOAI: continue`, quanh dòng 1811). Đổi thành: vẫn bung, dòng mang
`ncc_tu_lo=true`; `ke_hoach_vat_tu` và giữ chỗ chỉ đếm dòng `ncc_tu_lo=false`.

**Dùng lại** (đã có trong `services/gia_cong_ngoai/`): `ban_giao.ghi_xac_nhan` / `lap_ban_giao`
(nhận và đẩy bàn giao), `sx_kho.lap_yeu_cau_nhap_tp` (bỏ phần `ghi_kcs_ngoai_phan_mem`),
`giao_thang.ghi_giao_thang`, `_toa_san_luong`, `_ve_kho_tung_lenh`, cơ chế gói trọn gói trong
`tron_goi.py`, chọn khổ giấy C1.

**Gỡ:** bảng `gia_cong_ngoai` và các cột `gia_cong_ngoai_id` trên `stock_requests`, `delivery_trips`,
`payment_vouchers`, `san_xuat_cong_viec` · khối Gia công ngoài trên lệnh (`GiaCongNgoaiPanel.tsx`) · nút
Đã mang đi / Chốt / Mở lại · KCS tổng hợp "làm ngoài phần mềm".

**Dữ liệu cũ:** cần xác nhận DB thật đã có lần gia công chưa. Nếu có: mỗi lần cũ → một việc + một đơn
(đơn giá 0) + phiếu giao (`sl_gui`) + phiếu nhận (`sl_cuoi`, `noi_ve`); phiếu chi cũ nối sang phiếu nhận.

## 11. Quyết định đã chốt (13/11/2026)

Chủ dự án chấp nhận cột "Đề xuất" của bản bàn làm quyết định. Các mục dưới đây là luật, không còn là câu hỏi.

| # | Câu hỏi cũ | Quyết định |
|---|---|---|
| Q1 | Đưa lại **đơn giá** trên đơn gia công? (đảo quyết định 07/10) | **Có.** Dòng đơn có đơn giá theo đơn vị nhận về; phiếu nhận sinh tiền công tạm tính; phiếu chi đối chiếu với hoá đơn. Ngoại lệ 27/09 vẫn giữ: tiền gia công không gác `view_cost`. |
| Q2 | Ai nhận hàng; có chặn người giao tự nhận? | Tổ bước sau / kho / người có bit **Nhận hàng** nhận. Máy chủ **chặn** người đã lập phiếu giao của đơn tự lập phiếu nhận của chính đơn đó; chủ xưởng tắt được bằng một cờ cấu hình (xưởng nhỏ). |
| Q3 | Hàng hỏng / hụt có trừ tiền nhà gia công? | **Không tự trừ.** Hiện số hỏng / hụt cạnh tiền tạm tính để kế toán sửa tiền khi lập phiếu chi (lệch thì bắt ghi lý do). |
| Q4 | Hàng gia công về kho có qua KCS không? | **Không KCS phần mềm.** Đề nghị nhập kho thành phẩm mang `tgc_phieu_nhan_id`; kho đếm khi lập phiếu nhập. Bỏ hẳn bản KCS tổng hợp "làm ngoài phần mềm". |
| Q5 | Hai bước liền nhau thuê ngoài nhưng hai nơi làm? | **Một việc** (gộp theo "liền nhau cùng tick Thuê ngoài"). Muốn hai nơi thì ở Hàng chờ bấm **Tách theo bước** khi việc chưa vào đơn nào: việc dải tách thành mỗi bước một việc, rồi đặt hai đơn hai nhà gia công. |
| Q6 | Dòng vật tư của bước thuê ngoài mặc định "Nhà gia công tự lo" hay "Xưởng cấp"? | **Mặc định tự lo** (`ncc_tu_lo = true`); xưởng cấp thì bỏ tick từng dòng. |
| Q7 | Ai là "phụ trách gia công"? | **Vai Kế hoạch SX hiện tại**, cấp thêm quyền module `thue_gia_cong`. |
