/** Popup chi tiết MỘT khoản chờ chi / chờ thu — phương án B (17/10/2026,
 *  docs/mockups/chi-tiet-khoan-cho-3-phuong-an.html): rộng 1000px, hai cột.
 *  - Trái: thẻ Hàng (bảng đủ cột SL, ĐVT, đơn giá, CK/VAT khi có, thành tiền + tổng ở chân) và thẻ Lịch sử
 *    (khoản đã đi qua những chứng từ nào, ngày nào, bao nhiêu).
 *  - Phải: thẻ "Còn phải chi/thu" với số lớn + nút lập phiếu, rồi thẻ Thông tin.
 *  Dưới 820px hai cột xếp chồng. Dùng chung cho "Mua hàng chờ chi" và "Đơn hàng chờ thu". */
import type { ReactNode } from "react";

import { DetailModal } from "../../../components/DetailModal";
import { tien, vietSo } from "./dinhDang";

export type DongHangKhoan = {
  khoa: string | number;
  ten: ReactNode;
  /** Chữ nổi của ô tên (tên đầy đủ khi bị cắt). */
  tenDu?: string;
  sl: ReactNode;
  dvt: string;
  donGia: number;
  ck?: number | null;
  vat?: number | null;
  thanhTien: number;
};

export type DongLichSu = {
  khoa: string;
  /** Ngày ISO; trống ⇒ `ngayChu` (vd "ngoài đơn"). */
  ngay: string | null;
  ngayChu?: string;
  noiDung: ReactNode;
  /** Có dấu: âm = trừ vào khoản (đã chi/thu, cọc trừ), dương = cộng vào khoản. */
  tien: number | null;
};

const pt = (v: number | null | undefined) => (v ? `${vietSo(v)}%` : "—");
const ngayVN = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};
const coDau = (so: number) => (so < 0 ? `−${tien(-so)}` : tien(so));

export function ChiTietKhoan({
  tieuDe,
  phuDe,
  nhanHang = "",
  slNhan = "SL",
  hang,
  dangTaiHang = false,
  loiHang,
  tong = [],
  lichSu,
  con,
  nut,
  thongTin,
  onClose,
}: {
  tieuDe: string;
  phuDe?: string | null;
  /** Khoản không có dòng hàng (gia công, trả lại khách) bỏ `hang` ⇒ ẩn cả thẻ Hàng. */
  nhanHang?: string;
  slNhan?: string;
  hang?: DongHangKhoan[];
  dangTaiHang?: boolean;
  loiHang?: string;
  /** Dòng tổng dưới bảng hàng; dòng `cuoi` có gạch trên và chữ to hơn. */
  tong?: { nhan: string; tien: number; cuoi?: boolean }[];
  lichSu: DongLichSu[];
  /** `chu` thay số tiền khi khoản chưa có số (gia công: tiền nhập lúc lập phiếu chi). */
  con: { nhan: string; tien?: number; chu?: string };
  nut?: ReactNode;
  thongTin: { nhan: string; giaTri: ReactNode }[];
  onClose: () => void;
}) {
  const hangDs = hang ?? [];
  const coCk = hangDs.some((h) => (h.ck ?? 0) > 0);
  const coVat = hangDs.some((h) => (h.vat ?? 0) > 0);
  return (
    <DetailModal title={tieuDe} subtitle={phuDe ?? undefined} width={1000} onClose={onClose}>
      <div className="kt-ctk">
        <div className="kt-ctk__trai">
          {hang && <section className="kt-ctk__the">
            <h4>{nhanHang}</h4>
            <div className="kt-ctk__cuon">
              <table className="kt-mh-bang">
                <thead>
                  <tr>
                    <th>Hàng</th>
                    <th className="n">{slNhan}</th>
                    <th>ĐVT</th>
                    <th className="n">Đơn giá</th>
                    {coCk && <th className="n">CK</th>}
                    {coVat && <th className="n">VAT</th>}
                    <th className="n">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {hangDs.length === 0 ? (
                    <tr>
                      <td colSpan={5 + Number(coCk) + Number(coVat)} className={loiHang ? "lds-do" : "lds-mu"}
                        role={loiHang ? "alert" : undefined}>
                        {loiHang ?? (dangTaiHang ? "Đang tải hàng…" : "Không có dòng hàng.")}
                      </td>
                    </tr>
                  ) : (
                    hangDs.map((h) => (
                      <tr key={h.khoa}>
                        <td title={h.tenDu}>{h.ten}</td>
                        <td className="n">{h.sl}</td>
                        <td>{h.dvt}</td>
                        <td className="n">{tien(h.donGia)}</td>
                        {coCk && <td className="n">{pt(h.ck)}</td>}
                        {coVat && <td className="n">{pt(h.vat)}</td>}
                        <td className="n">{tien(h.thanhTien)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {tong.length > 0 && (
              <dl className="kt-ctk__tong">
                {tong.map((t) => (
                  <div key={t.nhan} className={t.cuoi ? "kt-ctk__cuoi" : undefined}>
                    <dt>{t.nhan}</dt>
                    <dd>{tien(t.tien)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>}
          <section className="kt-ctk__the">
            <h4 id="kt-ctk-ls">Lịch sử</h4>
            {lichSu.length === 0 ? (
              <p className="kt-ctk__trong">Chưa có chứng từ nào.</p>
            ) : (
              <ul className="kt-ctk__ls" aria-labelledby="kt-ctk-ls">
                {lichSu.map((l) => (
                  <li key={l.khoa}>
                    <span className={l.ngay ? "kt-ctk__ng" : "kt-ctk__ng lds-mu"}>{l.ngay ? ngayVN(l.ngay) : l.ngayChu}</span>
                    <span className="kt-ctk__tx">{l.noiDung}</span>
                    <span className="kt-ctk__so">{l.tien != null ? coDau(l.tien) : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <div className="kt-ctk__phai">
          <section className="kt-ctk__the kt-ctk__con" aria-labelledby="kt-ctk-con">
            <div id="kt-ctk-con" className="kt-ctk__nhan">{con.nhan}</div>
            <div className="kt-ctk__lon">{con.tien != null ? tien(con.tien) : con.chu}</div>
            {nut}
          </section>
          <section className="kt-ctk__the">
            <h4>Thông tin</h4>
            <dl className="kt-ctk__kv">
              {thongTin.filter((t) => t.giaTri != null && t.giaTri !== false && t.giaTri !== "").map((t) => (
                <div key={t.nhan}>
                  <dt>{t.nhan}</dt>
                  <dd>{t.giaTri}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </DetailModal>
  );
}
