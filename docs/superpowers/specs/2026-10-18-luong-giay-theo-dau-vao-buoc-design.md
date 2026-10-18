# Lượng giấy theo đầu vào của bước + khoá ĐVT tờ/kg — thiết kế & kế hoạch (18/10/2026)

Nối tiếp `docs/superpowers/plans/2026-10-18-giay-la-vat-tu-cua-buoc.md` (giấy chọn ở "+ Thêm vật tư" của
mọi công đoạn). User chốt qua hội thoại 18/10/2026, nói "làm đi".

## Luật đã chốt

**Lượng** của một dòng giấy ở bước (con số hiện ở dòng giấy, đi xuống lệnh, kho xin theo nó) suy từ
ĐƠN VỊ ĐẦU VÀO của chính công đoạn. Máy tính, không ai sửa tay.

| Đầu vào của công đoạn | Lượng | Khổ hiện cạnh tên giấy |
|---|---|---|
| tờ in (`TRAM_TO`) | SL vào, đếm **tờ** | khổ tờ in |
| tờ nguyên (`TRAM_TO_NGUYEN`) | SL vào, đếm **tờ** | khổ nguyên |
| con / cái / tay | **kg** = định lượng × khổ của cái/con × SL vào (tay = tờ gấp ⇒ khổ in) | khổ chi tiết (tay: khổ in) |
| "—" (bỏ trống, vd cắt từ cuộn) | **kg** = định lượng × khổ tờ RA × SL ra; SL ra lấy từ chuỗi bù hao ngược = SL vào của bước kế tiếp nhận đúng thứ bước này nhả ra | không hiện |

**Tiền** giấy GIỮ công thức giá của danh mục Giấy (`cong_thuc_gia`), engine chạy như cũ. Lượng và tiền
tách nhau. Riêng bước ra kg (công thức giá cần `to_nguyen`/`dai_nguyen`/`rong_nguyen` mà bước đó
không có tờ nguyên), ba biến ấy nhận số và khổ của chính bước — công thức kg chuẩn ra đúng
kg × đơn giá.

**Kho**: dòng giấy ra tờ xin kho bằng tờ đúng khổ; ra kg xin kho bằng kg, thiếu thì yêu cầu mua bằng kg.
Không quy tờ ↔ kg giữa hai dòng tồn (luật 10/10 "tồn tách mã + khổ + ĐVT" giữ nguyên). Lệnh đã có
đường này (`_dong_giay_cho_ma` → `quy_ve_goc`), chỉ đổi số/đơn vị đầu vào.

**Khoá ĐVT**
- Danh mục Giấy: mọi mã giấy phải có nhóm **tờ** và nhóm **kg** trong ĐVT khai. Thiếu thì máy chủ tự
  thêm (`to` / `kg`); chip tờ, kg không có nút ×. Mã đang có ĐVT cùng nhóm (vd ram ∈ nhóm tờ) thì nhóm
  đó coi như đã có — luật cũ "không hai đơn vị cùng nhóm" vẫn đứng.
- Đơn vị & quy đổi: hai dòng `to`, `kg` không xoá, không ngừng dùng, không đổi mã. Quy đổi của chúng
  vẫn sửa được. DB trắng thiếu hai mã này thì KHÔNG tự tạo (`SEED_DEMO=false` ⇒ không ghi gì).

## Kế hoạch

1. **Lõi lượng giấy** `kho_giay.luong_giay_buoc(...)` thuần (không DB): nhận trạm vào/ra, SL vào/ra,
   quy cách (mm), gsm ⇒ `{so_luong, don_vi: to|kg, kho_rong, kho_dai, hien_kho, ly_do}`.
   `dong_giay_theo_dau_vao` thành vỏ tra trạm rồi gọi lõi (thêm `don_vi_ra`). Test lõi bốn nhánh.
2. **Engine phiếu** `_dong_giay_buoc` dùng lõi cho lượng + khổ; tiền giữ công thức giá, bơm biến theo
   bước khi ra kg. Bước "—" tìm SL ra ở bước kế tiếp. Dòng NVL trả `dinh_muc_kho` để hiện. Test.
3. **Lệnh** `_dong_bo_dong_giay` truyền `don_vi_ra` + SL ra suy từ bước kế tiếp cho bước "—". Test.
4. **Danh mục Giấy** `_kiem_don_vi_them` (kind `giay`): bù nhóm tờ/kg; migration `0421` bù cho mã cũ;
   FE `ODonViNhieu` khoá chip tờ/kg. Test.
5. **Đơn vị & quy đổi** `DonViDoService`: chặn xoá / ngừng / đổi mã của `to`, `kg`; FE ẩn nút xoá/ngừng
   hai dòng đó. Test.
6. **FE phiếu** `BuocVatTu`: dòng giấy hiện khổ (trừ bước "—") + lượng theo đơn vị engine trả. Vitest.
7. Bấm thử trên DB sao chép: phiếu (In ra tờ, Cắt cuộn ra kg, bước cái ra kg), lệnh, danh mục Giấy,
   Đơn vị.
