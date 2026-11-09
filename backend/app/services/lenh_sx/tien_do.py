"""Tầng TÍNH của Lệnh SX & Theo dõi SX (Task 7): tiến độ có trọng số · giờ máy · trễ hạn.

Ba hàm ở đây trả lời đúng hai câu hỏi của điều độ: "lệnh này chạy tới đâu rồi" và "có trễ
không". "Bao giờ xong" (`du_kien_xong`, đường găng) GỠ 08/11/2026 cùng tốc độ máy. Lỗi ở tầng
này KHÔNG làm gãy gì — nó ra CON SỐ SAI mà trông vẫn hợp lý, nên mọi lựa chọn dưới đây đều ghi rõ
lý do.

ĐỌC TỪ `BoiCanh` (Task 6), KHÔNG truy vấn DB. Cả tầng này sinh ra để màn 200 lệnh không đẻ N+1:
nếu một hàm ở đây tự mở query thì công của `boi_canh.nap()` đổ sông. Thiếu dữ liệu thì bổ sung ở
`boi_canh.py`, không lén query tại đây.

--- Bốn luật của `phan_tram` ------------------------------------------------------------------
1. TRỌNG SỐ theo THỜI LƯỢNG kế hoạch (`du_kien_ket_thuc - du_kien_bat_dau` của công việc), KHÔNG
   theo số công đoạn. Lệnh có CTP 15' + In 360' mà xong CTP báo 50% là nói dối điều độ — đúng là
   15/375 ≈ 4%.
2. Công đoạn ĐANG CHẠY ăn phần theo SẢN LƯỢNG TỐT: `Σ batch.tot / so_luong_ra`, KẸP `[0, 1]`. Chạy
   dư (in bù hao) không được đẩy lệnh vượt 100%.
3. Thiếu thời lượng ⇒ CHIA ĐỀU và giương cờ `uoc_tinh=True` để UI nói rõ đây là số ước tính. Chỉ
   cần MỘT bước thiếu là cả lệnh chuyển sang chia đều: trộn nửa trọng-số-thật nửa trọng-số-bịa ra
   một con số không giải thích được cho ai.
4. Công việc `completed` tính 1.0 bất kể sản lượng ghi được bao nhiêu — tổ đã đóng bước thì bước
   xong, sổ sản lượng thiếu là việc của khâu khác.
5. Bước CHƯA xong mà `so_luong_ra` NULL/≤0 (không có mục tiêu để đo) cũng giương `uoc_tinh` — nó
   đóng góp 0% một cách im lặng, không có cờ thì không ai phân biệt được với "chưa ai làm". Bước
   đã `completed` KHÔNG tính vào luật này (xem `_khong_do_duoc`).

--- BƯỚC BỊ BÀI GHÉP PHỦ: đọc `cong_viec_du`, đừng đọc `cong_viec` -----------------------------
Bước gộp vào bài ghép KHÔNG đẻ công việc riêng — nó đẻ MỘT công việc CHUNG `lsx_id = None`. Đọc
`bc.cong_viec[lsx_id]` là mất đúng bước nặng nhất (ca in ghép), IM LẶNG. Ba hàm đọc công việc ở
đây (`phan_tram`, `gio_may`, `tre_han`) đều đi qua `bc.cong_viec_du(lsx_id)`.

--- Hai bẫy kiểu dữ liệu (đều là bẫy tái phát của repo) ---------------------------------------
`Decimal`: `batch.tot`, `cong_viec.so_luong_ra/so_luong_vao` là `Numeric` ⇒ SQLAlchemy trả
`Decimal`; `Decimal / float` nổ TypeError. Ép `float()` ngay tại chỗ ĐỌC.

NAIVE/AWARE: các cột `DateTime(timezone=True)` bị SQLite trả về NAIVE trong khi mốc máy chủ là
AWARE ⇒ trừ thẳng nổ TypeError. Mọi phép tính thời gian ở đây đi qua `_aware()`. ÉP LÊN aware,
tuyệt đối KHÔNG hạ `bay_gio` xuống naive cho hết lỗi: test SQLite sẽ xanh còn Postgres (trả
AWARE) thì lỗi quay lại, lần này im lặng hoặc sai giờ.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from ...models.san_xuat import CV_HOAN_THANH, SanXuatCongViec
from .boi_canh import BoiCanh

# Giờ xưởng (+7). Hạn SX là kiểu `Date` nên "trễ hay không" phải quy về NGÀY THEO GIỜ XƯỞNG:
# ca đêm 2h sáng giờ VN vẫn là ngày HÔM TRƯỚC theo UTC, mà xưởng này CÓ chạy ca đêm. Khai tại chỗ
# đúng khuôn `services/sequence_service.py:45` và `services/ky_thuat_may_service.py:130`.
BUSINESS_TZ = timezone(timedelta(hours=7))


def _aware(dt: datetime) -> datetime:
    """SQLite trả datetime NAIVE — ép về aware UTC trước khi so/trừ với mốc máy chủ (bẫy
    naive/aware từng làm 500 ở xếp lịch). Bản gốc: `services/san_xuat/thuc_thi.py:493`; khai lại
    cục bộ ở đây thay vì import tên `_`-riêng tư của module khác (thói quen sẵn có của repo)."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _thoi_luong_phut(cv: SanXuatCongViec) -> float | None:
    """Thời lượng KẾ HOẠCH của một công việc, phút. None = chưa xếp lịch / khoảng không hợp lệ.

    Khoảng ≤ 0 coi như KHÔNG có thời lượng: nó không thể làm trọng số (chia cho 0) và cũng không
    nói được gì về công sức của bước.
    """
    if cv.du_kien_bat_dau is None or cv.du_kien_ket_thuc is None:
        return None
    phut = (_aware(cv.du_kien_ket_thuc) - _aware(cv.du_kien_bat_dau)).total_seconds() / 60.0
    return phut if phut > 0 else None


def _phan_hoan_thanh(bc: BoiCanh, cv: SanXuatCongViec) -> float:
    """Phần đã xong của MỘT công việc, trong `[0, 1]`.

    `completed` ⇒ 1.0. Ngược lại `Σ batch.tot / so_luong_ra` (cả hai là `Numeric` ⇒ ép `float`).
    `so_luong_ra` NULL hoặc ≤ 0 ⇒ 0.0: không có mục tiêu thì không có tỷ lệ để nói, và 0 là con số
    KHÔNG khoe khoang (báo thấp hơn thực tế còn chấp nhận được, báo cao hơn thì điều độ ra quyết
    định sai).
    """
    if cv.trang_thai == CV_HOAN_THANH:
        return 1.0
    muc_tieu = float(cv.so_luong_ra) if cv.so_luong_ra is not None else 0.0
    if muc_tieu <= 0:
        return 0.0
    tot = sum(float(b.tot) for b in bc.batch[cv.id])
    return min(1.0, max(0.0, tot / muc_tieu))


def _khong_do_duoc(cv: SanXuatCongViec) -> bool:
    """Bước CHƯA xong mà không có mục tiêu để đo tiến độ (`so_luong_ra` NULL hoặc ≤ 0).

    Bước đã `completed` KHÔNG tính: nó bằng 1.0 theo luật 4, mục tiêu sản lượng hết ý nghĩa — giương
    cờ ở đó thì mọi lệnh ĐÃ XONG đều đeo cờ ước tính và cờ mất nghĩa (tinh chỉnh của reviewer cho
    phán quyết C34, chủ dự án chốt theo).
    """
    if cv.trang_thai == CV_HOAN_THANH:
        return False
    return cv.so_luong_ra is None or float(cv.so_luong_ra) <= 0


def phan_tram(bc: BoiCanh, lsx_id: int) -> tuple[float, bool]:
    """Tiến độ của một lệnh: `(phần trăm 0..100, uoc_tinh)`.

    `uoc_tinh=True` = con số này KHÔNG chắc chắn, UI phải nói rõ. HAI nguồn dựng cờ, đừng lẫn:

      · THIẾU THỜI LƯỢNG ⇒ trọng số chia đều (và cờ bật). Đây là nguồn duy nhất đổi CÁCH TÍNH.
      · KHÔNG ĐO ĐƯỢC (bước chưa xong, `so_luong_ra` NULL/≤0) ⇒ chỉ bật cờ, trọng số giữ nguyên.
        `so_luong_ra` là cột NOT NULL `default=0` (`models/lsx.py:221`, snapshot chép sang) nên ca
        "bằng 0" là ca THƯỜNG chứ không phải dữ liệu hỏng. Không có cờ thì bước đó im lặng đóng
        góp 0% và không ai phân biệt được với "chưa ai làm".

    CỜ NÀY BẬT NHIỀU LÀ ĐÚNG, KHÔNG PHẢI NHIỄU. Bước CHẾ BẢN thường không đo được: nó đứng ngoài
    dòng giấy nên `_ap_chuoi_nguoc` không tính số cho nó, và nếu người lập lệnh không tự khai ở
    bước thì `so_luong_ra` nằm lại ở 0 (công thức sản lượng ra ở danh mục GỠ 18/09/2026, mg
    `0324`). Trong danh mục PROD, cả ba bước chế bản
    (`CD-1001` Phơi kẽm PS · `CD-1002` Bình bài điện tử · `CD-1003` Xuất film) đều như vậy. Nghĩa
    là phần lớn lệnh sẽ đeo cờ `uoc_tinh` ở GIAI ĐOẠN ĐẦU — và đúng lúc đó con số phần trăm thật
    sự mềm. Nhờ luật "chỉ tính bước CHƯA `completed`", cờ TỰ TẮT ngay khi chế bản đóng: nó bật
    đúng cửa sổ số liệu mềm rồi tắt, chứ không phải bật vĩnh viễn.

    Lệnh chưa có công việc nào trả `(0.0, True)`: chưa phát hành thì chưa biết gì, không phải "0%
    chắc chắn".

    Đọc `cong_viec_du` chứ KHÔNG phải `cong_viec`: lệnh mà mọi bước đều bị bài ghép phủ có
    `cong_viec[lsx_id]` RỖNG, và trả 0% cho nó là nói dối một cách tự tin.
    """
    cvs = bc.cong_viec_du(lsx_id)
    if not cvs:
        return 0.0, True

    thoi_luong = [_thoi_luong_phut(cv) for cv in cvs]
    thieu_thoi_luong = any(tl is None for tl in thoi_luong)
    uoc_tinh = thieu_thoi_luong or any(_khong_do_duoc(cv) for cv in cvs)
    # Chia đều TOÀN BỘ khi thiếu, không chỉ bước thiếu: trộn nửa trọng-số-thật nửa trọng-số-bịa ra
    # một con số không giải thích được cho ai.
    trong_so = [1.0] * len(cvs) if thieu_thoi_luong else [float(tl) for tl in thoi_luong]

    # `tong_ts` luôn > 0: nhánh chia đều cho `len(cvs) ≥ 1`, nhánh thời lượng thì mọi phần tử > 0
    # (`_thoi_luong_phut` trả None cho khoảng ≤ 0, mà None đã đẩy sang nhánh chia đều).
    tong_ts = sum(trong_so)
    diem = sum(w * _phan_hoan_thanh(bc, cv) for w, cv in zip(trong_so, cvs))
    return 100.0 * diem / tong_ts, uoc_tinh


def gio_may(bc: BoiCanh, lsx_id: int, bay_gio: datetime | None = None) -> float:
    """Tổng GIỜ CHẠY THỰC TẾ của lệnh, đã loại trừ thời gian dừng.

    Không cần trừ khoảng dừng lần nữa: phiên tạm dừng là phiên ĐÃ ĐÓNG (`ket_thuc` +
    `loai_dong='tam_dung'`), nên cộng thời lượng TỪNG PHIÊN đã tự bỏ mọi khoảng giữa hai phiên.
    Trừ thêm một lần nữa là ra thiếu giờ.

    Phiên còn mở (`ket_thuc IS NULL`) đếm tới `bay_gio`; bỏ trống thì lấy mốc máy chủ — tham số có
    mặt để bài test chốt được con số, phần còn lại của hệ gọi 2 tham số như brief.

    HỆ QUẢ PHẢI BIẾT (phán quyết C36): phiên của BƯỚC GHÉP được đếm ĐỦ cho MỌI lệnh mà bước đó
    phục vụ, KHÔNG chia phần. Đúng cho câu hỏi "lệnh này đã ngốn bao nhiêu giờ máy" (một lượt in
    ghép 3 lệnh thì cả 3 lệnh đều thật sự chờ trọn lượt đó), nhưng nghĩa là **cộng `gio_may` của
    nhiều lệnh sẽ VƯỢT giờ máy thật của xưởng**. Cần tổng giờ máy không trùng lặp thì đọc màn Bài
    ghép, đừng cộng hàm này qua các lệnh.
    """
    moc = _aware(bay_gio) if bay_gio is not None else datetime.now(timezone.utc)
    tong_giay = 0.0
    for cv in bc.cong_viec_du(lsx_id):
        for p in bc.phien[cv.id]:
            bat_dau = _aware(p.bat_dau)
            ket_thuc = _aware(p.ket_thuc) if p.ket_thuc is not None else moc
            giay = (ket_thuc - bat_dau).total_seconds()
            if giay > 0:  # mốc lệch ngược (dữ liệu hỏng) không được ăn bớt giờ của phiên khác
                tong_giay += giay
    return tong_giay / 3600.0


def _da_xong_san_xuat(bc: BoiCanh, lsx_id: int) -> bool:
    """Lệnh đã xong khâu sản xuất: có công việc và MỌI công việc đã `completed`."""
    cvs = bc.cong_viec_du(lsx_id)
    return bool(cvs) and all(cv.trang_thai == CV_HOAN_THANH for cv in cvs)


def tre_han(bc: BoiCanh, lsx_id: int, bay_gio: datetime) -> bool:
    """Lệnh chưa xong sản xuất mà hôm nay (theo giờ xưởng) đã qua HẠN GIAO KHÁCH.

    Đổi 08/11/2026 (docs/design-go-toc-do-may-va-xep-lich.md §1, §3): "Dự kiến xong" và hạn hoàn
    thành sản xuất đã gỡ, nên không còn đường găng nào để dự báo. Cờ trễ chỉ còn nói một sự thật
    đo được: tới ngày giao rồi mà lệnh chưa xong. Hạn NULL ⇒ `False`. Hạn là kiểu `Date` nên so
    bằng NGÀY THEO GIỜ XƯỞNG: ca đêm 2h sáng giờ VN vẫn là ngày hôm trước theo UTC.
    """
    han = bc.lenh[lsx_id].han_giao_khach
    if han is None or _da_xong_san_xuat(bc, lsx_id):
        return False
    return _aware(bay_gio).astimezone(BUSINESS_TZ).date() > han
