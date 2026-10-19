// MỘT nút "Xóa", HAI kết cục do SỐ LIỆU quyết định — người khai không phải học hai khái niệm, và
// không bao giờ tự tay làm mồ côi dữ liệu:
//   còn nơi dùng  → chỉ cho NGỪNG DÙNG, liệt kê ai đang dùng;
//   chưa ai dùng  → cho XOÁ HẲN (khai nhầm thì xoá ngay, đừng để làm rác danh mục).
// Màn nào không rà được nơi dùng (chưa khai `nhatKyLoai`) thì giữ nguyên lối cũ.
import { useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ApiError } from "../../api/client";
import { crud, kiemXoa, type KiemXoa } from "../../api/rebuildCatalog";
import type { CatalogConfig, Row } from "./types";

export function XoaDanhMucDialog({
  row, config, token, onClose, onXong, onLoi,
}: {
  row: Row;
  config: CatalogConfig;
  token: string;
  onClose: () => void;
  onXong: () => void;
  onLoi: (msg: string) => void;
}) {
  const api = useMemo(() => crud(config.prefix), [config.prefix]);
  // `null` = đang hỏi server. Khác hẳn "đã hỏi xong, không ai dùng" — gộp hai cái là hộp thoại
  // mời xoá hẳn trong lúc chưa biết gì.
  const [kiem, setKiem] = useState<KiemXoa | null>(null);

  // Hỏi server "còn ai dùng không" NGAY khi mở hộp thoại. Danh mục KHÔNG có xoá mềm thì khỏi hỏi:
  // câu trả lời không đổi được kết cục (chỉ có xoá hẳn), mà `may_thiet_bi` còn chưa có bản đồ
  // tham chiếu nên hỏi là ăn 404 rồi banner đỏ "Not Found" bày ra giữa màn.
  useEffect(() => {
    const loai = config.nhatKyLoai;
    if (!loai || !config.softDelete) return;
    let huy = false;
    kiemXoa(token, loai, row.id)
      .then((k) => { if (!huy) setKiem(k); })
      // Hỏi không được thì rơi về lối AN TOÀN (ngừng dùng), không đoán là "chắc chưa ai dùng".
      .catch(() => { if (!huy) setKiem({ xoa_han_duoc: false, chan: [], keo_theo: [] }); });
    return () => { huy = true; };
  }, [token, config.nhatKyLoai, row.id]);

  // "Ngừng dùng" chỉ tồn tại ở danh mục CÓ cột `active`. Trước 15/08/2026 chỗ này suy theo
  // `nhatKyLoai`, nên màn Máy — có nhật ký nhưng KHÔNG có cột `active` — rơi vào ngõ cụt: hỏi
  // "ai đang dùng" ăn 404, rồi ngừng-dùng cũng ăn 404, bấm nút không ra kết cục nào.
  //
  // Danh mục không có xoá mềm thì chỉ một đường: XOÁ HẲN, và máy chủ mới là cửa chặn thật —
  // `delete()` của nó tự đếm ràng buộc rồi trả 409 kèm lý do tiếng Việt.
  const coXoaMem = Boolean(config.softDelete);
  const dangHoi = coXoaMem && Boolean(config.nhatKyLoai) && kiem === null;
  const xoaHan = coXoaMem && kiem?.xoa_han_duoc === true;
  const cung = !coXoaMem;

  // Nơi đang dùng / thứ mất theo là DANH SÁCH (mỗi mục một dòng), không nối bằng dấu chấm giữa.
  const chan = kiem?.chan ?? [];
  const keoTheo = kiem?.keo_theo ?? [];
  const cauNgung =
    ` Mục này sẽ không còn hiện ở các ô chọn, nhưng chứng từ cũ vẫn giữ nguyên.`
    + ` Bật lại ở thẻ "Đã ngừng".`;
  const ds = (muc: string[]) => (
    <ul className="cdlg__ds">
      {muc.map((m) => <li key={m}>{m}</li>)}
    </ul>
  );

  return (
    <ConfirmDialog
      open
      title={dangHoi ? "Đang kiểm…" : (xoaHan || cung) ? "Xóa hẳn" : "Ngừng dùng"}
      message={
        dangHoi
          ? `Đang xem "${row.ten}" (${row.ma}) còn ai dùng không…`
          : cung
            ? `Xóa "${row.ten}" (${row.ma})? Hành động này sẽ xóa hoàn toàn bản ghi khỏi hệ thống.`
            : xoaHan
              ? `Chưa nơi nào dùng "${row.ten}" (${row.ma}) — xóa hẳn khỏi hệ thống?`
                + (keoTheo.length ? " Sẽ mất theo:" : "")
              : `Ngừng dùng "${row.ten}" (${row.ma})?`
                + (chan.length
                    ? " Đang được dùng ở các nơi dưới đây nên không xóa hẳn được."
                    : cauNgung)
      }
      confirmLabel={(xoaHan || cung) ? "Xóa hẳn" : "Ngừng dùng"}
      hideConfirm={dangHoi}
      danger
      onConfirm={async () => {
        onClose();
        try {
          if (xoaHan || cung) await api.remove(token, row.id);
          else await api.datActive(token, row.id, false);
          onXong();
        } catch (e) {
          onLoi(e instanceof ApiError ? e.message : "Không xóa được.");
        }
      }}
      onCancel={onClose}
    >
      {xoaHan && keoTheo.length > 0 && ds(keoTheo)}
      {!xoaHan && !cung && !dangHoi && chan.length > 0 && (
        <>
          {ds(chan)}
          <p className="cdlg__msg">{cauNgung.trim()}</p>
        </>
      )}
    </ConfirmDialog>
  );
}
