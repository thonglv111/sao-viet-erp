# Kế hoạch test hàng thương mại và giao hàng của In Hà Phương

Lập ngày 12/11/2026. Đối chiếu với `design-hang-thuong-mai-ha-phuong.md` và `design-giao-hang-ha-phuong.md`.
Mục tiêu: đi hết một vòng tiền và hàng (mua về, nhập kho Cửa hàng, bán, xuất, giao, hoá đơn, thu tiền,
trả nhà cung cấp, trả cước), soát quyền và tiền, rồi chứng minh bản Sao Việt Nhật không bị ảnh hưởng.

## 1. Môi trường

| | Hà Phương (bật) | Sao Việt Nhật (tắt) |
|---|---|---|
| Frontend | `http://localhost:5174` (thư mục `D:\jobs\HAPHUONG`) | `http://localhost:5173` |
| Backend | cổng 8100, `PHAN_HE_BAT=thuong_mai,giao_hang_hp` | cổng 8000, không khai `PHAN_HE_BAT` |
| Database | `hp_erp_local` (container `erp-hp-local-db-1`, cổng 5533) | `svn_erp_trong` |

Code sửa ở SVN rồi gộp sang Hà Phương, nên trước khi test phải chắc Hà Phương đã nhận bản mới nhất của
`svn/dev`. Mỗi lần sửa route hay schema thì khởi động lại backend 8100.

Trước đợt test, sao lưu `hp_erp_local` (`pg_dump`) để chạy lại từ đầu được.

## 2. Chuẩn bị dữ liệu và tài khoản

Đã có trên dev Hà Phương (12/11/2026): kho "Cửa hàng" KHO-0001, 12 mặt hàng thương mại có giá và tồn.
Mực Epson 003 chỉ còn 3 chai, dùng cho ca thiếu tồn. Băng keo đang khai nhầm đơn vị "cuốn".

Còn phải khai trước khi test:

- Khách "Khách lẻ" và hai khách có tên, có số điện thoại, có mã số thuế.
- Một bộ phận có cờ giao hàng, hai nhân viên trong đó.
- Xe giao hàng: 3 xe, 2 xe có người phụ trách, 1 xe ngưng dùng. Dev Hà Phương chưa có xe nào; 6 xe tạo
  hôm 09/11 nằm ở DB của Sao Việt Nhật.
- Hai nhà cung cấp có cờ "Đơn vị vận chuyển", một nhà cung cấp hàng thương mại thường.
- Tài khoản ngân hàng cho phiếu thu chuyển khoản.

Mỗi vai một tài khoản, quyền cấp qua ma trận quyền:

| Tài khoản | Quyền chính | Dùng để soát |
|---|---|---|
| Bán hàng đủ quyền | Đơn hàng bán; "Chọn hàng thương mại, thấy giá bán"; "Xuất kho ngay khi bán"; Phiếu thu tạo; kho Cửa hàng ghi sổ | Luồng quầy trọn gói |
| Bán hàng thiếu quyền | Đơn hàng bán; Hàng thương mại chỉ Xem, không Xem giá; không phiếu thu; không ghi sổ kho | Ẩn Khách trả ngay, dưới Kho xuất ghi "Yêu cầu xuất sẽ gửi tới người giữ kho", đơn giá không tự điền, JSON không có giá |
| Thủ kho cửa hàng | kho Cửa hàng; Yêu cầu nhập xuất tiếp nhận và lập phiếu | Nhận yêu cầu xuất, ghi sổ, huỷ |
| Kế toán | Phiếu thu, Phiếu chi, hoá đơn bán, công nợ | Hoá đơn theo lượt xuất, hàng chờ chi cước |
| Kế hoạch SX | Lệnh sản xuất, Kế hoạch vật tư, Xếp lịch | Không thấy đơn thương mại ở đâu cả |
| Nhân viên giao | thuộc bộ phận giao hàng | Nhận thông báo giao |

## 3. Cách chạy

Chỉ test trên giao diện: thao tác bằng chuột và bàn phím thật trên trình duyệt, không thay bước nào bằng API
hay script. Mỗi ca ghi lại đã bấm gì, gõ gì, thấy gì. Ca có tiền thì soát thêm ở tab Mạng (Network) của
trình duyệt rằng JSON không có số tiền khi người xem thiếu quyền. Ca cần hai người (gửi kho, báo người giao)
thì mở hai cửa sổ với hai tài khoản, một cửa sổ thường và một cửa sổ InPrivate.

## 4. Các ca test

### A. Bật tắt theo bản cài

| Mã | Ca | Mong đợi |
|---|---|---|
| A1 | Sao Việt Nhật mở Đơn hàng bán, thanh bên, ma trận quyền, Phòng ban, Nhà cung cấp, hộp Xuất hàng | Không có chữ, cột, mục lọc, nút nào của thương mại hay giao hàng HP; cột PO khách vẫn hiện |
| A2 | Sao Việt Nhật gõ thẳng đường dẫn màn mới lên thanh địa chỉ (`?man=hang-thuong-mai`, `?man=xe-giao-hang`) | Không mở được màn, không lộ dữ liệu |
| A3 | Sao Việt Nhật xuất hàng đơn sản xuất, ghi hoá đơn theo chuyến | Y như trước, không đòi chọn cách giao |

### B. Danh mục hàng thương mại

| Mã | Ca | Mong đợi |
|---|---|---|
| B1 | Thêm mặt hàng hai đơn vị, giá theo từng đơn vị | Lưu đúng, cột Giá bán hiện hai giá, ô Chọn đơn vị không bị ô gợi ý đè |
| B2 | Thêm đơn vị cùng nhóm quy đổi với đơn vị đã có | Báo đỏ tại chỗ, máy chủ chặn 422 |
| B3 | Bỏ đơn vị đang còn tồn | Máy chủ chặn, câu lỗi tiếng Việt |
| B4 | Người không có Xem giá mở danh mục | Không thấy giá, JSON không có `gia_ban_theo_dvt` và `gia_nhap_gan_nhat` |
| B5 | Cột Tồn và tab Tồn theo kho | Đúng theo đơn vị gốc của lô, từng kho |
| B6 | Hàng thương mại không hiện ở màn Vật tư khác và Thành phẩm, và ngược lại | Mỗi mặt hàng chỉ ở một màn |
| B7 | Ngưng bán một mặt hàng | Không chọn được ở trang Tạo đơn |

### C. Mua về và nhập kho Cửa hàng

| Mã | Ca | Mong đợi |
|---|---|---|
| C1 | Yêu cầu mua loại mua để tồn, chọn hàng thương mại | Ô chọn mặt hàng liệt kê được hàng thương mại |
| C2 | Đơn mua, đợt giao, yêu cầu nhập, nhập vào kho Cửa hàng | Lô mang đơn giá nhập, tồn tăng đúng đơn vị |
| C3 | Hoá đơn mua, công nợ phải trả, phiếu chi | Đi đúng đường mua vật tư |

### D. Tạo đơn thương mại tại quầy

Bốn tổ hợp nút chính, mỗi tổ hợp một ca:

| Mã | Thanh toán / Xuất | Mong đợi |
|---|---|---|
| D1 | Trả ngay / Xuất ngay, người có quyền ghi sổ kho | Một lần bấm: đơn TM chốt, lượt xuất đã xuất, tồn trừ, phiếu thu đúng số giữ lại, giá vốn chụp vào dòng |
| D2 | Trả ngay / Xuất sau | Chốt và thu tiền, chưa có lượt xuất |
| D3 | Thanh toán sau / Xuất ngay | Chốt và xuất, không phiếu thu |
| D4 | Thanh toán sau / Xuất sau, có tiền cọc | Chỉ chốt và ghi cọc |

Các ca phụ:

| Mã | Ca | Mong đợi |
|---|---|---|
| D5 | Lưu nháp | Đơn nháp, bỏ qua thanh toán và xuất hàng |
| D6 | Xuất ngay mà thiếu tồn (mực Epson, gõ 5 chai) | Ô Số lượng nền vàng, rê chuột thấy "Thiếu 2 chai"; bấm thì 400, không ghi gì |
| D7 | Tiền khách đưa lớn hơn phải trả | Trả lại khách đúng, phiếu thu ghi số phải trả |
| D8 | Chuyển khoản thiếu tài khoản hoặc mã giao dịch | Chặn trước khi ghi |
| D9 | Thu vượt tổng | 400 trước khi ghi |
| D10 | Bán hàng thiếu quyền mở trang | Không có Khách trả ngay, đơn giá không tự điền; Xuất ngay thành yêu cầu gửi thủ kho |
| D11 | Đơn có dòng không phải hàng thương mại, gọi thẳng API | Máy chủ chặn |
| D12 | Không chọn khách, hoặc bỏ trống mọi dòng | Báo lỗi đỏ bên trái thanh nút, không gửi |
| D13 | Mặc định khi mở trang | Khách trả ngay, Xuất ngay, Không cần giao, kho Cửa hàng đứng đầu |

### E. Đơn thương mại sau khi tạo

| Mã | Ca | Mong đợi |
|---|---|---|
| E1 | Mã đơn | Tiền tố TM, đánh số riêng với DH |
| E2 | Đơn thương mại không vào sản xuất | Không có ở Hàng chờ tiếp nhận, Tạo lệnh, Lệnh sản xuất, Kế hoạch vật tư, Xếp lịch, Theo dõi sản xuất (đăng nhập Kế hoạch SX) |
| E3 | Danh sách Đơn hàng bán | Cột Loại đơn; đơn TM đã chốt hiện "Đã chốt", không vào tab Chờ cọc |
| E4 | Lọc Loại đơn, số trên các tab và URL `ban=` | Đếm ở máy chủ, tải lại trang giữ lọc |
| E5 | Ngăn đơn TM | Đầu ngăn ghi loại; không có ô báo giá, PO, ngày giao; chặng "Thu tiền" có nút Lập phiếu thu khi còn thiếu |
| E6 | Thu tiền sau chốt | Trần là phần còn thiếu; không bắn thông báo "đủ cọc, chuyển sản xuất" |
| E7 | Xuất một phần hai lần từ ngăn đơn | Hai lượt xuất, mỗi lượt một cách giao |
| E8 | Huỷ đơn nháp và đơn đã chốt chưa xuất | Theo luật huỷ đơn hiện có |
| E9 | Sửa dòng lúc nháp | Ghi đúng |

### F. Kho: lượt xuất thương mại

| Mã | Ca | Mong đợi |
|---|---|---|
| F1 | Xuất không ghi sổ ngay | Yêu cầu xuất tới thủ kho cửa hàng qua SSE, badge nhảy, có toast |
| F2 | Thủ kho ghi sổ | Lượt chuyển "đã xuất", SL thực xuất, giá vốn chụp theo lô |
| F3 | Thủ kho huỷ yêu cầu | Lượt chuyển "huỷ" |
| F4 | Ghi sổ khi tồn đã bị người khác lấy mất | Bị chặn, yêu cầu còn nguyên |
| F5 | Đơn chưa chốt | Không xuất được |
| F6 | Hàng thương mại xuất từ kho khác KHO-TP | Không bị luật thành phẩm chặn |

### G. Giao hàng HP

| Mã | Ca | Mong đợi |
|---|---|---|
| G1 | Xuất hàng đơn sản xuất và đơn thương mại | Bắt chọn một trong ba cách, không có mặc định ngầm ở hộp Xuất hàng ngăn đơn |
| G2 | Giao nội bộ: Người giao chỉ gồm nhân viên bộ phận giao hàng; chọn người thì Xe tự điền xe người đó phụ trách; đổi được; xe ngưng dùng không hiện | Đúng như mô tả; ô Người giao đã chọn chỉ ghi tên |
| G3 | Giao nội bộ không dùng xe công ty | Lưu được, ô Xe trống |
| G4 | Giao dịch vụ: đơn vị vận chuyển chỉ gồm nhà cung cấp có cờ; cước và mã vận đơn không bắt buộc | Lưu đúng |
| G5 | Cước vào hàng chờ chi theo đơn vị vận chuyển; gộp hai lần giao vào một phiếu chi | Đúng số, hết khỏi hàng chờ sau khi chi |
| G6 | Người không có quyền tiền xem lần xuất | Không thấy cước, JSON không có số |
| G7 | Người giao nhận thông báo ngay | Chuông nhảy, ghi lần xuất, đơn, xe |
| G8 | Cột Cách giao và Người giao ở Đơn hàng bán theo lần xuất gần nhất | Đúng chữ; bảng vừa màn 1600px |
| G9 | Lọc Cách giao và Người giao (nhân viên và đơn vị vận chuyển), URL `cg=` `ng=` | Đếm ở máy chủ; đơn tính khi có ít nhất một lần xuất khớp |
| G10 | Cờ "Đơn vị vận chuyển" ở Nhà cung cấp, cờ giao hàng ở Phòng ban | Chỉ hiện ở Hà Phương; phần khoán km vẫn ẩn |

### H. Kế toán và báo cáo

| Mã | Ca | Mong đợi |
|---|---|---|
| H1 | Hoá đơn bán của đơn TM | Bắt chọn lượt xuất "đã xuất"; giá trị gợi ý cộng dồn theo lượt; trần là tổng gồm VAT |
| H2 | Tiền đã thu theo đơn cấn vào hoá đơn của chính đơn | Công nợ còn lại đúng |
| H3 | Phần còn nợ sau hoá đơn vào "Đơn hàng chờ thu"; phiếu thu gộp một đơn TM và một đơn sản xuất | Mỗi dòng ghi rõ loại đơn |
| H4 | Hoá đơn, phiếu thu, công nợ theo đơn đều nhìn ra loại đơn | Có mã TM hoặc chữ "Thương mại" |
| H5 | Báo cáo kinh doanh lọc đơn sản xuất hoặc thương mại; "Đã giao" của đơn TM đọc từ lượt xuất | Số khớp |
| H6 | Giá vốn dòng đơn chỉ người có quyền xem giá vốn mới thấy | JSON không có `cost_snapshot` với người thiếu quyền |

### I. Ma trận quyền

| Mã | Ca | Mong đợi |
|---|---|---|
| I1 | Hai ô lối tắt dưới dòng Đơn hàng bán | Bật "Chọn hàng thương mại, thấy giá bán" thì bật Xem và Xem giá của Hàng thương mại; tắt thì chỉ tắt Xem giá |
| I2 | "Xuất kho ngay khi bán" | Bật hoặc tắt cùng ô thủ kho của Yêu cầu nhập xuất |
| I3 | Kho mới tạo | Chưa ai có quyền kho đó cho tới khi cấp (gặp khi tạo kho Cửa hàng 12/11) |

## 5. Thứ tự đi

1. Mục A trên cả hai bản.
2. Khai dữ liệu và tài khoản ở mục 2, khai bằng giao diện.
3. Đi một vòng trọn: C1 → C2 → D1 → F2 → G2 → H1 → H2 → C3 → G5. Vòng này phủ phần lớn đường tiền.
4. Đi các ca còn lại theo nhóm B, D, E, F, G, H, I.
5. Ghi kết quả từng ca vào mục 6: đạt, hoặc lỗi kèm ảnh và bước tái hiện.

## 6. Kết quả

| Mã | Ngày | Kết quả | Ghi chú |
|---|---|---|---|
| | | | |
