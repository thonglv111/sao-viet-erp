# Phát hành lệnh tự lập yêu cầu xuất vật tư, Bàn tổ có trạng thái vật tư

Ngày 18/10/2026. Trạng thái: thiết kế, CHƯA code.

## 1. Mục đích

Hôm nay phát hành chỉ đẩy việc xuống tổ. Muốn có vật tư, tổ phải tự mở từng việc trên Bàn tổ và bấm
"Yêu cầu cấp vật tư". Trạng thái yêu cầu chỉ thấy khi mở ngăn chi tiết. Hệ quả là tổ quên xin, kho
không biết trước việc nào sắp cần gì, và nhìn lưới Bàn tổ không biết việc nào đã có hàng.

Chủ dự án muốn:

1. Bấm Phát hành thì mọi bước có vật tư được hệ thống tự lập yêu cầu xuất kho, gửi tới kho ngay.
2. Mỗi dòng trên Bàn tổ có trạng thái vật tư của chính bước đó.
3. Biết được vật tư đã **sẵn sàng**. Sẵn sàng nghĩa là kho đã ghi phiếu xuất đủ cho bước đó.
4. Bên kho lọc được yêu cầu theo lệnh sản xuất, theo tổ và theo vật tư.
5. Bỏ hẳn khâu "tổ Cắt chốt giấy sau phát hành". Lúc tính giá đặt giấy ở bước nào thì xưởng lĩnh
   giấy ở đúng bước đó.

## 2. Phụ thuộc

Làm SAU khi nhánh `refs/heads/giay-vat-tu-buoc` vào dev. Nhánh đó biến giấy thành vật tư của bước:
phiếu tính giá đặt giấy ở công đoạn nào thì dòng giấy (`hang_loai='giay'`) chảy xuống đúng bước đó
của lệnh, kèm số tờ. Thiết kế này dựa trên điều ấy: lúc phát hành, mỗi bước đã biết chắc mình cần
vật tư gì và bao nhiêu, giấy cũng vậy.

## 3. Không làm

- Không thêm bước duyệt yêu cầu. Yêu cầu kho hiện đã tự `approved`, giữ nguyên.
- Thiếu vật tư KHÔNG chặn phát hành và KHÔNG chặn tổ bấm Bắt đầu. Từ 01/10/2026 vật tư chỉ cảnh
  báo, luật đó giữ nguyên. Trạng thái vật tư trên Bàn tổ chỉ để nhìn và để lọc.
- Không đổi luật giữ chỗ vật tư (`vat_tu_giu_cho`). Nó vẫn bật tay ở Kế hoạch vật tư như hiện nay,
  và vẫn được tiêu khi kho ghi phiếu xuất.
- Không đổi luật cấp thiếu, cấp bổ sung, trả vật tư thừa của tổ.

## 4. Tự lập yêu cầu khi phát hành

### 4.1 Lúc nào

Trong CÙNG giao dịch phát hành (`XepLichLenhService.phat_hanh` → `san_xuat/release.py phat_hanh`),
ngay sau khi các công việc (`san_xuat_cong_viec`) của gói được tạo. Phát hành cả cụm thì lập cho
mọi công việc của mọi lệnh và bài ghép trong cụm.

Lập yêu cầu lỗi thì phát hành lỗi theo (rollback cả hai). Không có chuyện lệnh đã xuống xưởng mà
yêu cầu kho mất một nửa.

### 4.2 Lập cho bước nào

Mỗi công việc có định mức vật tư thì có MỘT lần đề nghị `lan_dau`. Lần đề nghị này đi đúng đường
tổ đang dùng khi tự bấm (`services/san_xuat/vat_tu_de_nghi.tao`): tạo `san_xuat_vat_tu_de_nghi`
kèm các dòng, và một `stock_requests` loại XUAT trạng thái `approved`.

Bỏ qua:

- bước thuê ngoài (không có vật tư);
- bước mà mọi dòng định mức có số lượng bằng 0 hoặc chưa tính được số. Bước có cả dòng có số lẫn
  dòng chưa có số thì chỉ đưa dòng có số; dòng thiếu số để tổ tự xin.

Giấy: với mỗi mã giấy, chỉ bước ĐẦU TIÊN theo thứ tự tuyến mang mã đó mới lấy từ kho. Các bước sau
mang cùng mã (ví dụ lệnh cũ có giấy ở cả Cắt tờ lẫn In) là nhận tay từ bước trước, không xin kho.
Giấy khác mã ở bước khác (ví dụ carton ở bước Bồi) là một món riêng, bước đó tự lấy.

### 4.3 Nội dung yêu cầu

- Số lượng: đúng nhu cầu kế hoạch của bước, lấy từ `KeHoachVatTuService.nhu_cau_cua_cong_viec(cv)`.
  Đây cũng là số ô "Yêu cầu cấp vật tư" đang điền sẵn cho tổ.
- Bộ phận yêu cầu: tổ giữ công việc (`cv.department_id`). Không lấy phòng ban của người bấm phát
  hành.
- Cần lúc: giờ bắt đầu dự kiến của bước theo lịch lúc phát hành.
- Người lập: người bấm phát hành. Tên lấy từ tài khoản, không gõ tay.
- Đánh dấu nguồn để phân biệt với yêu cầu tổ tự lập. UI ghi "Tự lập khi phát hành".
- Dòng kho mang `lsx_id` / `bai_ghep_id` như hiện nay.

Người bấm phát hành có quyền `xep_lich:approve` nhưng thường không có quyền thực hiện của tổ.
Đường tự lập là việc của hệ thống, KHÔNG đi qua cổng quyền tổ (`_gate(..., VIEC_KHO)`) của
`tao()`. Cổng đó vẫn giữ cho đường tổ tự bấm.

### 4.4 Báo tin

Sau khi commit, theo luật gửi nội bộ phải real-time:

- Kho: một tin gộp cho cả lượt phát hành (chấm đỏ thanh bên + toast "LSX26-0009: N yêu cầu xuất
  mới"), không phải N toast rời.
- Bàn tổ của từng tổ có yêu cầu: sự kiện để cột trạng thái vật tư tự đổi, không cần tải lại.

Dùng đường đã có (`thong_bao_man.bao`, `hub.gui`, `kem_ban_to`). Loại sự kiện mới thì khai ở
`frontend/src/lib/suKienNhom.ts`.

### 4.5 Sau phát hành

- **Tổ sửa đề nghị:** yêu cầu tự lập là một lần đề nghị bình thường. Kho chưa lập phiếu thì tổ vẫn
  "Sửa đề nghị" được. Kho lập phiếu rồi thì tổ "Yêu cầu bổ sung" như hiện nay.
- **Phát hành cập nhật** (đổi giờ hoặc máy của việc chưa bắt đầu): định mức vẫn đóng băng như luật
  hiện tại. Chỉ cập nhật "cần lúc" của các yêu cầu tự lập mà kho chưa xuất, theo giờ mới.
- **Thu hồi phát hành:** huỷ các yêu cầu tự lập mà kho chưa ghi phiếu xuất. Phiếu nháp kho đang soạn
  cho yêu cầu đó thì huỷ theo, và báo kho real-time. Nếu kho ĐÃ ghi phiếu xuất cho bất kỳ yêu cầu
  nào của gói thì CHẶN thu hồi: "Kho đã xuất vật tư cho <bước> của <lệnh>. Tổ trả lại kho trước
  rồi mới thu hồi." Lý do: thu hồi xoá công việc, mà đường trả vật tư của tổ bám vào công việc.

## 5. Trạng thái vật tư của từng bước

### 5.1 Các mức

Tính cho MỘT công việc, gộp mọi lần đề nghị của nó (lần đầu và các lần bổ sung):

| Mức | Khi nào |
|---|---|
| (trống) | Bước không có định mức vật tư |
| Chưa yêu cầu | Có định mức nhưng chưa có lần đề nghị nào (ví dụ lệnh phát hành trước ngày có tính năng này, hoặc mọi dòng thiếu số) |
| Chờ kho | Có yêu cầu còn mở, kho chưa lập phiếu |
| Kho đang soạn | Kho đã lập phiếu nháp, chưa ghi sổ |
| Cấp thiếu | Kho đã ghi phiếu nhưng thiếu so với yêu cầu, và chưa có lần bổ sung nào lấp đủ |
| Sẵn sàng | Mọi yêu cầu của bước đã được kho ghi phiếu xuất đủ |

Bước có nhiều lần đề nghị thì hiện mức của lần chưa xong sớm nhất theo thứ tự trên. Ví dụ lần đầu
đã Sẵn sàng, lần bổ sung đang Chờ kho thì bước hiện Chờ kho.

"Sẵn sàng" đo theo YÊU CẦU, không đo theo định mức. Kho xuất đủ số tổ xin là sẵn sàng.

### 5.2 Bàn tổ

- Lưới: thêm cột "Vật tư" hiện chip mức ở 5.1, màu theo bộ `--tt-*`. Rê chuột lên chip thấy từng
  món: tên, số xin, số đã xuất.
- Bộ lọc "Vướng" thêm mục "Chưa sẵn sàng vật tư", lọc ở máy chủ như các mục vướng khác.
- Ngăn chi tiết giữ phần "Cấp vật tư" như cũ. Lần đề nghị tự lập ghi rõ "Tự lập khi phát hành".
- Chip phải tự đổi khi kho lập phiếu, ghi sổ hoặc huỷ, không bắt tổ tải lại trang.

### 5.3 Kho

Màn hộp thư yêu cầu của kho (`KhoYeuCauPage`, API `/api/kho/de-nghi`) thêm ba bộ lọc, lọc ở máy
chủ:

- **Lệnh sản xuất:** yêu cầu có dòng thuộc lệnh đó, hoặc thuộc bài ghép chứa lệnh đó.
- **Tổ:** bộ phận yêu cầu. API đã có `bo_phan`; cần đưa ra UI dưới chữ "Tổ" và chỉ liệt kê các tổ.
- **Vật tư:** yêu cầu có ít nhất một dòng là mã hàng đó, giấy hoặc vật tư khác.

Ba bộ lọc kết hợp với nhau và với bộ lọc kỳ, trạng thái đang có.

## 6. Bỏ khâu tổ Cắt chốt giấy

Lúc tính giá, giấy đã được đặt vào đúng bước. Vì vậy bỏ trọn khâu tổ Cắt xác nhận giấy sau phát
hành:

- Bỏ khối "Chờ chốt giấy" trên Bàn tổ, các API `/chot-giay*`, tin `cho_chot_giay` gửi tổ Cắt lúc
  phát hành, và mục vướng `cho_chot_giay`.
- Bỏ cổng khoá bước In chờ tổ Cắt (`ly_do_cho_chot`, chỗ gọi ở `dau_vao.py`).
- Bỏ việc tự chép giấy từ In sang bước cắt đứng trước (`LsxService._chep_giay_sang_buoc_cat`). Đây
  là cùng một kiểu đoán. Từ nay giấy nằm ở bước mà phiếu tính giá hoặc người lập lệnh đặt.
- "Bước lấy giấy" mà Kế hoạch vật tư đang dùng (`chot_giay.buoc_lay_giay_bai_lo`) đổi sang đúng luật
  ở 4.2: theo từng mã giấy, bước đầu tiên mang mã đó. Hàm này phải chuyển ra khỏi `chot_giay.py`
  trước khi xoá file.
- Cắt thành phẩm (giai đoạn sau in) không liên quan, chạy như bước thường.

Lệnh đang chờ tổ Cắt chốt lúc triển khai: hết cổng chờ, bước In mở ngay, giấy giữ nguyên ở bước
đang mang nó. Lệnh tổ Cắt đã chèn bước cắt thì giữ nguyên bước đó.

## 7. Lệnh đã phát hành trước ngày triển khai

Không tự lập bù. Bước của các lệnh đó hiện "Chưa yêu cầu" (nếu có định mức mà chưa xin) và tổ xin tay
như cũ.

## 8. Phần để người làm tự quyết

- Tên cột, tên bảng, giá trị cờ nguồn "tự lập khi phát hành".
- Câu chữ toast và chú thích chip, miễn đúng luật viết UI của dự án (tiếng Việt, không mã thô,
  không nối bằng "·").
- Cách tính trạng thái 5.1 trong một truy vấn lô cho cả trang Bàn tổ, không truy vấn theo từng dòng.
- Có giữ cờ `departments.la_to_cat` và ô bật cờ ở màn Phòng ban hay không, sau khi soát chỗ nào
  khác còn dùng nó. Không còn ai dùng thì gỡ.
