// Ngăn chi tiết của bàn HẸN ĐẨY (mockup B, 08/11/2026). Vỏ NganPhai chung: đầu ngăn cố định, ba tab
// Vật tư / Lịch sử hẹn / Công đoạn, kéo mép trái để rộng ra. Trả lời "vì sao lệnh này chưa đẩy được,
// thiếu cái gì, ai hẹn". Chỉ vẽ — dữ liệu và việc ghi do màn cha lo.
import { useState } from "react";

import type { XlGoiPhatHanh, XlLichSuHen, XlNganHen as NganData } from "../api/client";
import { NganPhai } from "./ke-toan/shared/NganPhai";
import { ngayGioDu } from "./XlBan";

const so = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
const lop = { ok: "la", vang: "vang", do: "do" } as const;

/** "08/11 16:20" — cột Lúc của Lịch sử hẹn. */
function lucNgan(s: string): string {
  return `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}`;
}

export function XlNganHen({
  ngan, lichSu, goi, dangTai, loi, duyetDuoc, dangGhi,
  onBoHen, onDoiGio, onDayNgay, onThuHoi, onCapNhat, onMoHoSo, onDong, len, xuong,
}: {
  ngan: NganData | null;
  lichSu: XlLichSuHen[] | null;
  /** Gói đang chạy dưới xưởng — chỉ cần cho lệnh đã đẩy (Thu hồi / Đẩy cập nhật). */
  goi: XlGoiPhatHanh | null;
  dangTai: boolean;
  loi: boolean;
  duyetDuoc: boolean;
  dangGhi: boolean;
  onBoHen: () => void;
  onDoiGio: () => void;
  onDayNgay: () => void;
  onThuHoi: () => void;
  onCapNhat: () => void;
  onMoHoSo?: () => void;
  onDong: () => void;
  len?: () => void;
  xuong?: () => void;
}) {
  const [tab, setTab] = useState("vt");
  const d = ngan?.dau ?? null;
  const daDay = !!d && (d.trang_thai === "da_phat_hanh" || d.trang_thai === "da_dong");
  const chuaDay = !!d && !daDay;

  const chan = d && duyetDuoc ? (
    <div className="xh-chan-ngan">
      {chuaDay ? (
        <>
          {d.hen_luc && <button type="button" className="xa-btn" disabled={dangGhi} onClick={onBoHen}>Bỏ hẹn</button>}
          <button type="button" className="xa-btn" disabled={dangGhi} onClick={onDoiGio}>{d.hen_luc ? "Đổi giờ" : "Hẹn giờ"}</button>
          <button type="button" className="xa-btn xa-btn--den" disabled={dangGhi} onClick={onDayNgay}>Đẩy ngay</button>
        </>
      ) : (
        <>
          <button type="button" className="xa-btn xa-btn--do" disabled={dangGhi || goi?.cho_phep_thu_hoi === false}
            title={goi?.cho_phep_thu_hoi === false ? "Đã có việc bắt đầu chạy, chỉ còn đường Đẩy cập nhật" : undefined}
            onClick={onThuHoi}>Thu hồi</button>
          <button type="button" className="xa-btn" disabled={dangGhi || !goi?.cho_phep_cap_nhat} onClick={onCapNhat}>Đẩy cập nhật</button>
        </>
      )}
    </div>
  ) : undefined;

  return (
    <NganPhai
      duongDan="Xếp lịch"
      tieuDe={d?.ma ?? (loi ? "Không mở được lệnh" : "Đang tải")}
      the={d?.is_rush ? <span className="xh-chip xh-chip--gap">Gấp</span> : undefined}
      hanhDong={onMoHoSo && d ? <button type="button" className="xa-btn" onClick={onMoHoSo}>Hồ sơ lệnh</button> : undefined}
      tabs={[{ id: "vt", nhan: "Vật tư" }, { id: "ls", nhan: "Lịch sử hẹn" }, { id: "cd", nhan: "Công đoạn" }]}
      tab={tab}
      onTab={setTab}
      chan={chan}
      len={len}
      xuong={xuong}
      onDong={onDong}
    >
      {!d ? (
        <p className="xh-mo">{loi ? "Không tải được lệnh này." : dangTai ? "Đang tải" : ""}</p>
      ) : (
        <>
          <dl className="xh-tt">
            <dt>Sản phẩm</dt><dd>{d.ten || "—"}</dd>
            <dt>Khách hàng</dt><dd>{d.customer_name ?? "—"}</dd>
            <dt>Số lượng</dt><dd>{so(d.so_luong_dat)} {d.don_vi_tinh ?? ""}</dd>
            {daDay
              ? (<><dt>Đẩy lúc</dt><dd>{ngayGioDu(d.da_day_luc)}</dd></>)
              : (<><dt>Hẹn đẩy</dt><dd>{d.hen_luc ? ngayGioDu(d.hen_luc) : "Chưa hẹn"}</dd></>)}
            {d.nguoi_hen && !daDay && (<><dt>Người hẹn</dt><dd>{d.nguoi_hen}</dd></>)}
            <dt>Hạn giao khách</dt><dd>{d.han_giao_khach ? ngayGioDu(d.han_giao_khach) : "—"}</dd>
            {d.ket_ly_do && (<><dt>Chưa đẩy được</dt><dd className="xh-do">{d.ket_ly_do}</dd></>)}
          </dl>

          {tab === "vt" && (
            daDay ? <p className="xh-mo xh-ghi">Lệnh đã xuống xưởng, vật tư theo dõi ở Kế hoạch vật tư.</p>
              : ngan!.vat_tu.length === 0 ? <p className="xh-mo xh-ghi">Lệnh chưa khai vật tư nào.</p>
                : (
                  <table className="xh-vt">
                    <thead><tr><th>Vật tư</th><th className="num">Cần</th><th className="num">Đã giữ chỗ</th><th>Tình trạng</th><th>Đơn mua</th></tr></thead>
                    <tbody>
                      {ngan!.vat_tu.map((v, i) => (
                        <tr key={`${v.ten}-${i}`}>
                          <td>{v.ten}</td>
                          <td className="num">{so(v.can)} {v.don_vi ?? ""}</td>
                          <td className="num">{v.da_giu ? `${so(v.da_giu)} ${v.don_vi ?? ""}` : "0"}</td>
                          <td><span className={`xh-chip xh-chip--${lop[v.muc]}`}><span className="xh-dot" />{v.chu}</span></td>
                          <td>{v.don_mua ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
          )}

          {tab === "ls" && (
            !lichSu ? <p className="xh-mo xh-ghi">Đang tải</p>
              : lichSu.length === 0 ? <p className="xh-mo xh-ghi">Chưa có lần hẹn nào.</p>
                : (
                  <table className="xh-vt xh-ls">
                    <thead><tr><th className="c-luc">Lúc</th><th className="c-ng">Người</th><th>Việc</th></tr></thead>
                    <tbody>
                      {lichSu.map((x, i) => (
                        <tr key={`${x.luc}-${i}`}>
                          <td>{lucNgan(x.luc)}</td>
                          <td>{x.nguoi ?? "—"}</td>
                          <td>{x.viec}{x.chi_tiet && <span className="xh-phu">{x.chi_tiet}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
          )}

          {tab === "cd" && (
            <>
              {ngan!.cong_doan.length === 0 ? <p className="xh-mo xh-ghi">Lệnh chưa có công đoạn.</p> : (
                <table className="xh-vt">
                  <thead><tr><th className="c-b">Bước</th><th>Công đoạn</th><th>Bộ phận nhận</th><th className="num">Số lượng</th></tr></thead>
                  <tbody>
                    {ngan!.cong_doan.map((c) => (
                      <tr key={c.buoc}>
                        <td>{c.buoc}</td>
                        <td>{c.ten}</td>
                        <td>{c.bo_phan ?? <span className="xh-mo">Chưa có bộ phận</span>}</td>
                        <td className="num">{so(c.so_luong)} {c.don_vi ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="xh-mo xh-ghi">Đẩy lệnh thì mỗi bước tới bộ phận nhận. Máy và tổ do bộ phận chọn sau đó, ở Kế hoạch bộ phận.</p>
            </>
          )}
        </>
      )}
    </NganPhai>
  );
}
