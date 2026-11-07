// Thẻ "Tệp của lệnh" trong drawer Bàn tổ / KCS — maket, bản vẽ Kế hoạch SX đính kèm vào lệnh, tổ
// xem trước và tải về ngay tại việc mình làm (không có quyền mở hồ sơ lệnh). CHỈ ĐỌC: thêm/xoá tệp
// vẫn ở tab Tệp đính kèm của Kế hoạch SX.
//
// Danh sách gọn cho drawer hẹp (16/09/2026): mỗi tệp MỘT dòng thấp, bấm ảnh/tên để xem trước, hai
// nút biểu tượng Xem/Tải về bên phải; quá `HIEN_TRUOC` tệp thì gấp phần còn lại sau nút "Xem thêm".
// Không dùng `DinhKemTep` (khung tải lên đầy đủ) — chỉ mượn hộp xem trước và màu theo loại tệp.
//
// Công việc bài ghép thuộc nhiều lệnh ⇒ mỗi lệnh một nhóm, có nhãn mã lệnh. `dinhKemDem` là bộ đếm
// SSE `lsx_dinh_kem_changed` theo lệnh (AppShell): kế hoạch vừa thêm/xoá tệp thì thẻ tự nạp lại.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, ApiError, type SxTepLenhNhom } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { XemTruoc } from "../components/DinhKemTep";
import { Icon } from "../components/Icons";
import { dungLuong, type TepXem } from "../components/tepDinhKem";
import { ngayGio } from "./keHoachSxShared";
import { DongTep } from "./ThsxDongTep";

/** Số tệp hiện sẵn — đủ thấy maket chính, không đẩy Lịch sử phiên chạy xuống quá xa. */
const HIEN_TRUOC = 3;

export function ThsxTepLenh({
  congViecId,
  dinhKemDem,
  nap,
}: {
  congViecId: number;
  dinhKemDem?: Record<number, number>;
  /** Nạp tệp qua đường khác (Kế hoạch bộ phận gác theo quyền của nó, không theo quyền tổ).
   *  Vắng thì nạp như Việc của tổ. */
  nap?: (token: string, congViecId: number) => Promise<SxTepLenhNhom[]>;
}) {
  const { token } = useAuth();
  const [nhom, setNhom] = useState<SxTepLenhNhom[] | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [lanNap, setLanNap] = useState(0);
  const [moHet, setMoHet] = useState(false);
  const [xem, setXem] = useState<TepXem | null>(null);

  // Chỉ nạp lại khi bộ đếm của CHÍNH các lệnh trong thẻ đổi — lệnh khác thêm tệp không kéo API.
  const lsxIds = nhom?.map((n) => n.lsx_id) ?? [];
  const dem = lsxIds.reduce((s, id) => s + (dinhKemDem?.[id] ?? 0), 0);

  useEffect(() => {
    if (!token) return;
    let bo = false;
    setLoi(null);
    (nap ?? api.sanXuat.tepLenh)(token, congViecId)
      .then((r) => { if (!bo) setNhom(r); })
      .catch((e) => {
        if (bo) return;
        setLoi(e instanceof ApiError && e.isNetwork ? "Mất kết nối tới máy chủ" : "Không nạp được tệp của lệnh");
      });
    return () => { bo = true; };
    // `nap` cố ý không vào deps: nơi gọi truyền hàm tạo mới mỗi lần vẽ, đổi nguồn giữa chừng không có.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, congViecId, dem, lanNap]);

  // Đổi sang việc khác thì gấp lại — mỗi việc mở ra đều bắt đầu gọn.
  useEffect(() => { setMoHet(false); }, [congViecId]);

  const tong = nhom?.reduce((s, n) => s + n.items.length, 0) ?? 0;
  const nhieuLenh = (nhom?.length ?? 0) > 1;

  // Cắt theo TỔNG số tệp, không theo từng nhóm: bài ghép 3 lệnh vẫn chỉ hiện 3 dòng khi gấp.
  let conCho = moHet ? Infinity : HIEN_TRUOC;
  const nhomHien = (nhom ?? []).map((n) => {
    const items = n.items.slice(0, Math.max(conCho, 0));
    conCho -= items.length;
    return { ...n, items, an: n.items.length - items.length };
  });
  const soAn = tong - nhomHien.reduce((s, n) => s + n.items.length, 0);

  return (
    <div className="thsx-teplenh">
      <h3 className="thsx-b-blk__h">
        Tệp của lệnh{nhom && tong > 0 && <> <span className="thsx-b-mo3">{tong}</span></>}
      </h3>
      {loi ? (
        <div className="thsx-tep__loi" role="alert">
          <span><Icon name="alert" size={14} /> {loi}</span>
          <button type="button" className="thsx-tep__thu-lai" onClick={() => setLanNap((n) => n + 1)}>
            <Icon name="refresh" size={14} /> Thử lại
          </button>
        </div>
      ) : nhom === null ? (
        <ul className="thsx-tep__ds" aria-busy="true" aria-label="Đang nạp tệp của lệnh">
          {[0, 1].map((i) => (
            <li key={i} className="thsx-tep thsx-tep--cho">
              <span className="thsx-tep__thumb" />
              <span className="thsx-tep__chu"><span className="thsx-tep__vach" /><span className="thsx-tep__vach thsx-tep__vach--ngan" /></span>
            </li>
          ))}
        </ul>
      ) : tong === 0 ? (
        <p className="thsx-dando thsx-dando--trong">Lệnh chưa có tệp đính kèm</p>
      ) : (
        <>
          {nhomHien.map((n) =>
            n.items.length === 0 ? (
              // Nhóm bị gấp hết thì thôi không vẽ nhãn; nhóm vốn trống (bài ghép) mới nói "chưa có tệp".
              n.an === 0 && nhieuLenh ? (
                <p key={n.lsx_id} className="thsx-teplenh__lenh">
                  <span>{n.lsx_ma}</span><span className="thsx-teplenh__trong">chưa có tệp</span>
                </p>
              ) : null
            ) : (
              <div key={n.lsx_id} className="thsx-teplenh__nhom">
                {nhieuLenh && (
                  <p className="thsx-teplenh__lenh" title={n.lsx_ten ?? undefined}>
                    <span>{n.lsx_ma}</span>{n.lsx_ten && <span>{n.lsx_ten}</span>}
                  </p>
                )}
                <ul className="thsx-tep__ds">
                  {n.items.map((t) => (
                    <DongTep key={t.id} t={t} onXem={setXem}
                      meta={(
                        <span className="thsx-teplenh__meta">
                          <span>{dungLuong(t.kich_thuoc)}</span>
                          <span>{ngayGio(t.tai_luc)}</span>
                          {t.nguoi_tai_ten && <span>{t.nguoi_tai_ten}</span>}
                        </span>
                      )} />
                  ))}
                </ul>
              </div>
            ),
          )}
          {(soAn > 0 || moHet) && tong > HIEN_TRUOC && (
            <button type="button" className="thsx-tep__them" aria-expanded={moHet} onClick={() => setMoHet((m) => !m)}>
              {moHet ? "Thu gọn" : `Xem thêm ${soAn} tệp`}
              <Icon name="chevron" size={14} className={moHet ? "thsx-tep__chev--len" : undefined} />
            </button>
          )}
        </>
      )}
      {/* Ra thẳng body: drawer có transform trượt vào nên `position: fixed` bên trong bị nhốt trong drawer. */}
      {xem && createPortal(<XemTruoc tep={xem} onDong={() => setXem(null)} />, document.body)}
    </div>
  );
}
