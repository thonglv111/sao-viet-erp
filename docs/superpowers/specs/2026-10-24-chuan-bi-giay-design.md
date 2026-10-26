# Khâu chuẩn bị giấy tự dựng khi lập lệnh — thiết kế

Chốt với chủ dự án 24/10/2026. Sơ đồ luồng: `.archify/workflow-chuan-bi-giay-20261024-111132/chuan-bi-giay.html`.

## 1. Vấn đề

Sale tính giá chỉ khai In + các bước sau in (luật 08/09/2026), và hôm nay phải chọn giấy NGAY TRONG một bước
(`phieu_buoc_vat_tu.hang_loai='giay'`, mg 0419). Nhưng giấy thật được lấy kho ở đâu thì sale không biết:
có cuộn thì phải Cắt giấy cuộn trước, có tờ khổ lớn thì phải Tề, có sẵn tờ đúng khổ thì In lấy thẳng.
Khâu "trước in" đó hôm nay không ai dựng, nên Kế hoạch vật tư so tồn theo tờ khổ in trong khi kho
đang giữ cuộn tính kg.

## 2. Luồng mới (một câu mỗi màn)

- **Phiếu tính giá**: sale chọn Giấy và (nếu có) Sóng MỘT lần cho sản phẩm, cạnh khổ nguyên. Chuỗi bước
  chỉ còn In + sau in, không bước nào mang giấy/sóng.
- **Lập lệnh**: máy xem tồn, chọn NGUỒN giấy, tự chèn khâu chuẩn bị giấy trước In và tự gắn giấy/sóng vào
  bước đầu của khâu đó kèm số lượng. Người kế hoạch đổi nguồn được.
- **Kế hoạch vật tư**: không đổi cách làm — cân đối theo bước đầu (đã có), giờ bước đầu là bước chuẩn bị.
- **Kho**: chỉ xuất giấy/sóng cho bước đầu của khâu chuẩn bị. In và Bồi nhận tờ từ bước trước.

## 3. Bảy công đoạn hệ thống (khoá)

Theo khuôn `KHO-TP` (dòng DB có mã cố định). Máy nhận ra bằng MÃ, không dò tên.

| Mã | Tên | Nhóm | Vào → Ra |
|---|---|---|---|
| `CGC` | Cắt giấy cuộn | prepress | to_nguyen → to_nguyen |
| `TGI` | Tề giấy in | prepress | to_nguyen → to |
| `TS` | Tề sóng | prepress | to → to |
| `BCT3LEB` | Bồi carton 2, 3 lớp E,B | finishing | to → to |
| `BCT5LBEC` | Bồi carton 4,5 lớp BE, BC | finishing | to → to |
| `BTĐ` | Bồi Duplex với Krap TĐ | finishing | to → to |
| `BBTĐ` | Bồi Duplex với Krap bán TĐ | finishing | to → to |

- KHOÁ: mã, tên, nhóm, đơn vị vào/ra; không xoá, không ngừng dùng.
- SỬA ĐƯỢC: tổ, máy, năng suất, bù hao, đơn giá khoán, công thức giá, vật tư định mức, ghi chú.
- Migration tạo dòng còn thiếu (prod trắng) và ép lại các ô khoá của dòng đã có.
- Bốn mã bồi là "bước nhận sóng". Bồi kiểu mới sau này = thêm mã vào hằng trong code.
- Cột chết `lsx_cong_doan.chen_boi_to_cat`, `lsx.giay_chot_*` (tính năng tổ cắt chốt giấy đã gỡ) KHÔNG
  dùng lại.

## 4. Phiếu tính giá: giấy và sóng cấp sản phẩm

- `phieu_thanh_phan.giay_id` = giấy loại `giay`; cột MỚI `phieu_thanh_phan.song_id` = giấy loại `song`.
  Chọn sai loại ⇒ 422.
- Vật tư của bước không nhận `hang_loai='giay'` nữa (422). Ô "Thêm vật tư" của bước bỏ nhóm Giấy/Sóng.
- Có sóng mà chuỗi không có bước bồi hệ thống ⇒ 422 "Sản phẩm có sóng nhưng chuỗi chưa có bước bồi."
- Định lượng lấy từ danh mục giấy (`giay_nguyen.gsm`), phiếu KHÔNG ghi định lượng.
- Tiền giấy: dòng cấp sản phẩm của engine (nhánh đã có, `thanh_phan_engine` ~1256) — luôn chạy.
- Tiền sóng: dòng cấp sản phẩm mới. Số tờ sóng = SL vào của bước bồi hệ thống ĐẦU TIÊN trong chuỗi. Khổ
  sóng = khổ in. Giá theo đơn vị giá của sóng: tờ ⇒ `don_gia × so_to`; kg ⇒ `gsm/1000 × dài_in(m) ×
  rộng_in(m) × don_gia × so_to`.
- Dữ liệu cũ: migration đưa các dòng giấy của bước lên `giay_id`/`song_id` theo loại rồi xoá dòng bước
  (luật trần 1 Giấy + 1 Sóng của 19/10 bảo đảm không mất gì). Cấu hình tái bản cũ đổi lúc nạp.

## 5. Quy đổi tờ ↔ kg

- `kg = số tờ × rộng(mm)/1000 × dài(mm)/1000 × gsm/1000`, gsm của danh mục giấy.
- Số tờ là số gốc của lô giấy tờ; kg chỉ là số suy ra.
- Nhập kho giấy có đủ hai cạnh khổ mà dòng tính kg ⇒ quy ra tờ, LÀM TRÒN XUỐNG, lô lưu `to`.
- Cuộn (khổ `(rộng, 0)`) lưu `kg`, không có số tờ trong kho.
- Lô giấy tờ đang lưu kg (DB dev) ⇒ migration quy sang tờ cùng luật.

## 6. Kho và mua hàng hiển thị

- Tồn giấy tờ: cột số tờ + cột "Quy kg" + cột "Định lượng". Cuộn: số kg, cột "Quy kg" trống.
- Yêu cầu mua, đơn mua, phiếu nhập/đợt giao: cột "Định lượng" CHỈ ĐỌC (đọc từ danh mục) và cột "Khổ"
  riêng — không nhét vào tên hàng.

## 7. Lập lệnh: chọn nguồn và dựng khâu

- Cột MỚI `lsx.nguon_giay` ∈ `to_in | to_nguyen | cuon | mua` (NULL = lệnh cũ / không giấy).
- Đầu vào: giấy của sản phẩm, khổ in, khổ nguyên, số tờ in cần (SL vào bước In sau tính ngược),
  số tờ in/tờ nguyên (`so_manh_xa` đã tính từ lúc tính giá).
- Máy thử theo thứ tự, gặp cái đầu tiên ĐỦ theo tồn tự do (`GiuChoService.ton_tu_do`):
  1. `to_in`: tờ khổ in ≥ số tờ in cần ⇒ không thêm bước.
  2. `to_nguyen`: tờ khổ nguyên ≥ số tờ nguyên cần ⇒ thêm `TGI`.
  3. `cuon`: cuộn rộng ≥ một cạnh khổ nguyên, phần dư ≤ `CUON_DU_TOI_DA_MM = 30`, đủ kg ⇒ thêm `CGC` + `TGI`.
     Nhiều cuộn hợp ⇒ cuộn rộng nhỏ nhất.
  4. `mua`: không nguồn nào đủ ⇒ như `to_nguyen` (thêm `TGI`); Kế hoạch vật tư báo thiếu tờ khổ nguyên.
- Khổ nguyên = khổ in (một tờ nguyên ra một tờ in) ⇒ bỏ `TGI` (`to_nguyen`/`mua` thành không thêm bước;
  `cuon` chỉ còn `CGC`).
- Có sóng ⇒ thêm `TS`, nối thẳng vào bước bồi hệ thống đầu tiên (cạnh phụ thuộc `TS → Bồi`), chạy song song
  nhánh giấy. `TS` đứng ngay trước bước bồi trong thứ tự (24/10 e2e: để đầu thứ tự thì dải tên đọc thành
  sóng chảy vào nhánh giấy) và KHÔNG nối vào bước nào khác.
- Tính ngược số: nhánh giấy là dòng giấy như cũ. `TS` tính riêng: ra = SL vào của bước bồi; vào = ra + hao
  của `TS`.
- Giấy/sóng gắn vào bước đầu, số lượng:
  - `TGI` ⇒ tờ nguyên vào, khổ nguyên, đơn vị tờ.
  - `CGC` ⇒ kg = tờ nguyên vào × rộng cuộn × cạnh còn lại × gsm, khổ `(rộng cuộn, 0)`, đơn vị kg.
  - Không bước chuẩn bị ⇒ In mang giấy: tờ in vào, khổ in.
  - `TS` ⇒ sóng: tờ vào, khổ in.
- Luật cũ "bước vào con/cái/tay ⇒ kg theo khổ chi tiết" (18/10) BỎ: giấy chỉ còn ở khâu chuẩn bị/In.
- Đổi nguồn: `PUT /api/lsx/{id}/nguon-giay {nguon}` — cùng cổng chặn với sửa routing (đang giữ chỗ, đã lập
  kế hoạch, đơn huỷ). Gỡ các bước `CGC`/`TGI` hiện có rồi dựng lại; không đụng bước khác.
- Lệnh đã tạo trước bản này giữ nguyên, không dựng lại.

## 8. Bài ghép

- Lệnh vào bài ghép ⇒ gỡ `CGC`/`TGI` của riêng lệnh; giữ `TS` (bồi vẫn theo từng lệnh).
- Bài có `bai_ghep.nguon_giay` riêng, chọn cùng luật §7 trên giấy + khổ nguyên + tờ nguyên cần của bài.
  Khâu chuẩn bị là bước CHUNG của bài, đứng trước bước In chung. Giấy gắn vào bước chung đầu
  (`buoc_lay_giay_bai_lo` đã chọn bước chung đầu có giấy).
- Lệnh rời bài ⇒ dựng lại khâu chuẩn bị riêng cho lệnh theo §7.

## 9. Không đổi

Kế hoạch vật tư (bước đầu, khoá tồn `mã + khổ + đơn vị gốc`), giữ chỗ, tự lập yêu cầu xuất khi phát hành,
cổng Bắt đầu: logic giữ nguyên. Hệ quả mong đợi: In/Bồi chỉ còn chờ mực/keo; Kế hoạch vật tư thấy kg
cuộn hoặc tờ khổ nguyên.

## 10. Ngoài phạm vi

Một lệnh lấy nhiều nguồn; sóng từ cuộn; khổ sóng khác khổ in; giá vốn thực tế theo nguồn; dựng lại lệnh cũ.
