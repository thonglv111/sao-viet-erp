// NGĂN SỔ CHI TIẾT của MỘT đối tượng — mở khi bấm một dòng ở sổ tổng hợp (phương án C, 11/10/2026).
//
// Đầu ngăn: phép tính của kỳ "còn nợ đầu kỳ + nhận hàng − đã trả = còn nợ cuối kỳ" và phần quá hạn —
// đọc một hàng là hiểu con số ở sổ tổng hợp từ đâu ra. Hai tab:
//   - Sổ chi tiết: còn nợ đầu kỳ → từng chứng từ (mới nhất lên đầu, cắt trang ở máy chủ) → còn nợ cuối
//     kỳ. Dòng cuối kỳ luôn khớp ô của chính đối tượng bên sổ tổng hợp (máy chủ đọc chung một luồng).
//   - Đợt còn nợ (331) / Hoá đơn còn nợ (131): các khoản chưa trả hết TẠI NGÀY CUỐI KỲ với hạn và số
//     ngày còn / trễ. Cùng vòng cấn trừ với cột tuổi nợ nên cộng ra đúng các ô tuổi nợ của dòng.
//
// Chỉ đọc nên đóng thoải mái (Esc, nút đóng). ↑ ↓ ở đầu ngăn đổi sang đối tượng trước / sau.
import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ApiError, api, type KhoanConNoList, type SoChiTietCongNo } from "../../../api/client";
import { useAuth } from "../../../auth/useAuth";
import type { NavigateFn } from "../../../components/AppShell";
import { soVN } from "../../../components/LuoiDs";
import { PhanTrangDayDu } from "../../../components/PhanTrangDayDu";
import { TheNho } from "../shared/Cum";
import { NganPhai } from "../shared/NganPhai";

export type TabSo = "so" | "dot";

/** Tên loại chứng từ — máy chủ trả khoá, giao diện đặt tên. */
const NHAN_LOAI: Record<string, string> = {
  hoa_don: "Hoá đơn bán",
  phieu_thu: "Phiếu thu",
  dot_giao: "Nhận hàng",
  phieu_chi: "Phiếu chi",
  hoan_tien: "NCC hoàn tiền",
  hoan_tien_khach: "Trả lại tiền khách",
};

const CHU = {
  payables: {
    man: "Tổng hợp công nợ phải trả", doiTac: "Nhà cung cấp", tang: "Nhận hàng", giam: "Đã trả",
    tabKhoan: "Đợt còn nợ", khoan: "đợt", ctKhoan: "Đơn mua", ngayKhoan: "Ngày nhận", han: "Hạn trả",
    traTruoc: "Đã trả trước",
  },
  receivables: {
    man: "Tổng hợp công nợ phải thu", doiTac: "Khách hàng", tang: "Bán ra", giam: "Đã thu",
    tabKhoan: "Hoá đơn còn nợ", khoan: "hoá đơn", ctKhoan: "Hoá đơn", ngayKhoan: "Ngày hoá đơn", han: "Hạn thu",
    traTruoc: "Khách trả trước",
  },
} as const;

/** Diễn giải máy chủ tự điền khi chứng từ không có nội dung — nói lại đúng cột Loại nên để trống. */
const DIEN_GIAI_MAC_DINH = new Set(["Hoá đơn bán hàng", "Khách trả tiền", "Hàng đã nhận", "Chi trả nhà cung cấp", "Nhà cung cấp hoàn tiền", "Hoàn tiền cho khách"]);

const CO_TRANG = 50;

function ngay(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

/** `HH:mm` của lúc ghi nhận. Chứng từ cũ chưa có mốc thì để trống — không bịa "00:00". */
function gioPhut(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function oSo(n: number): ReactNode {
  if (n === 0) return <span className="lds-mu3">–</span>;
  return n < 0 ? `−${soVN(-n)}` : soVN(n);
}

/** Chứng từ hoàn tiền: sổ ghi cùng phía hoá đơn / hàng về, ở đây hiện là thu âm / trả âm. */
const LOAI_HOAN = new Set(["hoan_tien", "hoan_tien_khach"]);

/** Số dư sau chứng từ: âm là bên kia (trả trước) — nói bằng chữ, không in số âm. */
function oDu(du: number, chuTruoc: string): ReactNode {
  if (du >= 0) return soVN(du);
  return <span className="lds-mu">{`${chuTruoc.toLowerCase()} ${soVN(-du)}`}</span>;
}

export function SoChiTietDrawer({
  ben,
  doiTuongId,
  tenLui,
  ma,
  tabDau = "so",
  tuNgay,
  denNgay,
  trangThaiKy,
  onClose,
  len,
  xuong,
}: {
  ben: "receivables" | "payables";
  /** `null` = dòng gom "ngoài danh mục" — KHÔNG phải "lấy tất cả". */
  doiTuongId: number | null;
  /** Tên lấy sẵn từ dòng vừa bấm, để hiện ngay lúc còn đang tải. */
  tenLui: string;
  ma?: string | null;
  tabDau?: TabSo;
  tuNgay: string;
  denNgay: string;
  /** "Chưa chốt" / "Đã chốt" / "Chốt một phần" của kỳ đang xem. */
  trangThaiKy: string;
  onClose: () => void;
  len?: () => void;
  xuong?: () => void;
  navigate?: NavigateFn;
}) {
  const { token } = useAuth();
  const c = CHU[ben];
  const [tab, setTab] = useState<TabSo>(tabDau);
  const [trang, setTrang] = useState(1);
  const [size, setSize] = useState(CO_TRANG);
  const [so, setSo] = useState<SoChiTietCongNo | null>(null);
  const [khoan, setKhoan] = useState<KhoanConNoList | null>(null);
  const [dangTai, setDangTai] = useState(true);
  const [loi, setLoi] = useState<string | null>(null);
  const [dangXuat, setDangXuat] = useState(false);

  // Đổi đối tượng (↑ ↓) hay bấm số quá hạn của dòng khác: về trang 1, mở đúng tab được yêu cầu.
  useEffect(() => {
    setTab(tabDau);
    setTrang(1);
  }, [doiTuongId, tenLui, tabDau, tuNgay, denNgay]);

  // Sổ chi tiết theo trang — câu trả lời cũ về muộn bị bỏ.
  const luot = useRef(0);
  useEffect(() => {
    if (!token) return;
    const l = ++luot.current;
    setDangTai(true);
    setLoi(null);
    api.accounting
      .soChiTietCongNo(token, ben, { doiTuongId, tuNgay, denNgay, page: trang, size })
      .then((d) => {
        if (l === luot.current) setSo(d);
      })
      .catch((err) => {
        if (l !== luot.current) return;
        setSo(null);
        setLoi(err instanceof ApiError ? err.message : "Không tải được sổ chi tiết.");
      })
      .finally(() => {
        if (l === luot.current) setDangTai(false);
      });
  }, [token, ben, doiTuongId, tuNgay, denNgay, trang, size]);

  // Các khoản còn nợ tại cuối kỳ — tải luôn (đầu ngăn cần số quá hạn), không đợi bấm tab.
  const luotKhoan = useRef(0);
  const [loiKhoan, setLoiKhoan] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return;
    const l = ++luotKhoan.current;
    setLoiKhoan(null);
    api.accounting
      .khoanConNo(token, ben, { doiTuongId, tuNgay, denNgay })
      .then((d) => {
        if (l === luotKhoan.current) setKhoan(d);
      })
      .catch((err) => {
        if (l !== luotKhoan.current) return;
        setKhoan(null);
        setLoiKhoan(err instanceof ApiError ? err.message : "Không tải được các khoản còn nợ.");
      });
  }, [token, ben, doiTuongId, tuNgay, denNgay]);

  async function xuatExcel() {
    if (!token) return;
    setDangXuat(true);
    try {
      const { url, ten } = await api.accounting.baoCaoCongNoXlsx(token, ben, { tuNgay, denNgay }, true, { doiTuongId });
      const a = document.createElement("a");
      a.href = url;
      a.download = ten;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
      setLoi(e instanceof ApiError ? e.message : "Không xuất được file.");
    } finally {
      setDangXuat(false);
    }
  }

  // Quy về chiều "còn nợ": 331 dư bên Có, 131 dư bên Nợ.
  const chieu = (no: number, co: number) => (ben === "payables" ? co - no : no - co);
  const dau = so ? chieu(so.dau_no, so.dau_co) : 0;
  const cuoi = so ? chieu(so.cuoi_no, so.cuoi_co) : 0;
  // Tiền hoàn không phải bán ra / nhận hàng: trừ khỏi cột tăng, tính là thu âm / trả âm.
  const tang = so ? (ben === "payables" ? so.ps_co : so.ps_no) - so.hoan : 0;
  const giam = so ? (ben === "payables" ? so.ps_no : so.ps_co) - so.hoan : 0;
  const quaHan = (khoan?.items ?? []).reduce((t, k) => t + ((k.tre_ngay ?? 0) > 0 ? k.con_no : 0), 0);
  const soKhoan = khoan?.items.length ?? 0;

  const ten = so?.ten ?? tenLui;
  const maHien = so?.ma ?? ma ?? null;

  const o = (nhan: string, giaTri: ReactNode, lop?: string) => (
    <div className={`bccn-pt__o${lop ? ` ${lop}` : ""}`}>
      <span className="bccn-pt__nhan">{nhan}</span>
      <span className="bccn-pt__so">{giaTri}</span>
    </div>
  );
  const phepTinh = so ? (
    <div className="bccn-pt" aria-label="Phép tính của kỳ">
      {o("Còn nợ đầu kỳ", oDu(dau, c.traTruoc))}
      <span className="bccn-pt__dau" aria-hidden="true">+</span>
      {o(c.tang, soVN(tang))}
      <span className="bccn-pt__dau" aria-hidden="true">−</span>
      {o(c.giam, giam < 0 ? `−${soVN(-giam)}` : soVN(giam))}
      <span className="bccn-pt__dau" aria-hidden="true">=</span>
      {cuoi >= 0 ? o("Còn nợ cuối kỳ", soVN(cuoi), "bccn-pt__o--cuoi") : o(c.traTruoc, soVN(-cuoi), "bccn-pt__o--cuoi")}
      {quaHan > 0 && o("Trong đó quá hạn", <span className="lds-do">{soVN(quaHan)}</span>, "bccn-pt__o--tach")}
    </div>
  ) : null;

  const soDong = so?.so_dong ?? 0;

  return (
    <NganPhai
      duongDan={
        <>
          {c.man}
          <ChevronRight size={14} aria-hidden="true" />
          {c.doiTac}
        </>
      }
      tieuDe={ten}
      phuDe={
        <span className="bccn-phu">
          {maHien ? <TheNho>{maHien}</TheNho> : doiTuongId == null ? <TheNho>ngoài danh mục</TheNho> : null}
          <span>{`${ngay(tuNgay)} – ${ngay(denNgay)}`}</span>
          <TheNho>{trangThaiKy}</TheNho>
        </span>
      }
      hanhDong={
        <button type="button" className="kt-btn kt-btn--nho" onClick={() => void xuatExcel()} disabled={dangXuat || !so}
          title="Sổ chi tiết của riêng đối tượng này ra .xlsx (kèm tài khoản đối ứng)">
          {dangXuat ? "Đang xuất…" : "Xuất Excel"}
        </button>
      }
      soLon={phepTinh}
      tabs={[
        { id: "so", nhan: "Sổ chi tiết" },
        { id: "dot", nhan: c.tabKhoan },
      ]}
      tab={tab}
      onTab={(id) => setTab(id as TabSo)}
      len={len}
      xuong={xuong}
      onDong={onClose}
    >
      {tab === "so" ? (
        <>
          {loi && <p className="kt-do" role="alert">{loi}</p>}
          {!so && dangTai && <p className="kt-mo">Đang tải sổ chi tiết…</p>}
          {so && (
            <div className={`lds-bang kt-sk-khung${dangTai ? " kt-sk-khung--tai" : ""}`} aria-busy={dangTai}>
              <table className="lds-g">
                {/* Số chứng từ rộng 190: "DMH-261007-VBF4 đợt 1" đo 189px. Diễn giải co giãn. */}
                <colgroup>
                  <col style={{ width: 98 }} />
                  <col style={{ width: 64 }} />
                  <col style={{ width: 112 }} />
                  <col style={{ width: 190 }} />
                  <col />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 120 }} />
                  {/* "đã trả trước 216.000.000" đo ~150px. */}
                  <col style={{ width: 168 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Ngày</th>
                    <th>Giờ</th>
                    <th>Loại</th>
                    <th>Số chứng từ</th>
                    <th>Diễn giải</th>
                    <th className="n">{c.tang}</th>
                    <th className="n">{c.giam}</th>
                    <th className="n">Còn nợ sau</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="lds-cong">
                    <td colSpan={5}>
                      Còn nợ đầu kỳ <span className="lds-mu">{`trước ${ngay(tuNgay)}`}</span>
                    </td>
                    <td />
                    <td />
                    <td className="n">{oDu(dau, c.traTruoc)}</td>
                  </tr>
                  {so.dong.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="lds-trong">Kỳ này không có chứng từ nào.</td>
                    </tr>
                  ) : (
                    so.dong.map((d, i) => {
                      const hoan = LOAI_HOAN.has(d.loai);
                      const t0 = ben === "payables" ? d.co : d.no;
                      const g0 = ben === "payables" ? d.no : d.co;
                      const t = hoan ? 0 : t0;
                      const g = hoan ? -t0 : g0;
                      const nhan = NHAN_LOAI[d.loai] ?? d.loai;
                      return (
                        <tr key={`${d.so_ct}-${d.ngay}-${i}`}>
                          <td>{ngay(d.ngay)}</td>
                          <td className="lds-mu">{gioPhut(d.luc)}</td>
                          <td>{nhan}</td>
                          <td title={d.so_ct}>{d.so_ct}</td>
                          <td title={d.dien_giai}>{DIEN_GIAI_MAC_DINH.has(d.dien_giai) ? "" : d.dien_giai}</td>
                          <td className="n">{oSo(t)}</td>
                          <td className="n">{oSo(g)}</td>
                          <td className="n">{oDu(chieu(d.luy_ke_no, d.luy_ke_co), c.traTruoc)}</td>
                        </tr>
                      );
                    })
                  )}
                  <tr className="lds-cong">
                    <td colSpan={5}>
                      Còn nợ cuối kỳ <span className="lds-mu">{`hết ngày ${ngay(denNgay)}`}</span>
                    </td>
                    <td className="n">{soVN(tang)}</td>
                    <td className="n">{giam < 0 ? `−${soVN(-giam)}` : soVN(giam)}</td>
                    <td className="n">{oDu(cuoi, c.traTruoc)}</td>
                  </tr>
                </tbody>
              </table>
              {soDong > size && (
                <PhanTrangDayDu trang={trang} size={size} tong={soDong} soDong={so.dong.length} onTrang={setTrang}
                  onSize={(n) => {
                    setSize(n);
                    setTrang(1);
                  }}
                  loading={dangTai} donVi="chứng từ" ariaLabel="Phân trang sổ chi tiết" />
              )}
            </div>
          )}
          {so && (
            <p className="bccn-ghi-chan lds-mu">
              {`${soVN(soDong)} chứng từ trong kỳ, mới nhất lên đầu. Dòng còn nợ cuối kỳ khớp số ở bảng tổng hợp.`}
            </p>
          )}
        </>
      ) : (
        <>
          {loiKhoan && <p className="kt-do" role="alert">{loiKhoan}</p>}
          {!khoan && !loiKhoan && <p className="kt-mo">Đang tải…</p>}
          {khoan && (
            <div className="lds-bang kt-sk-khung">
              <table className="lds-g">
                <colgroup>
                  <col style={{ width: 240 }} />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 150 }} />
                  <col style={{ width: 140 }} />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <th>{c.ctKhoan}</th>
                    <th>{c.ngayKhoan}</th>
                    <th>{c.han}</th>
                    <th>Tình trạng</th>
                    <th className="n">Còn nợ</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {soKhoan === 0 ? (
                    <tr>
                      <td colSpan={6} className="lds-trong">
                        {`Tại ngày ${ngay(khoan.den_ngay)} không còn ${c.khoan} nào chưa ${ben === "payables" ? "trả" : "thu"} hết.`}
                      </td>
                    </tr>
                  ) : (
                    khoan.items.map((k, i) => (
                      <tr key={`${k.so_ct}-${i}`}>
                        <td title={k.so_ct}>{k.so_ct}</td>
                        <td>{ngay(k.ngay)}</td>
                        <td>{k.han ? ngay(k.han) : <span className="lds-mu3">chưa đặt hạn</span>}</td>
                        <td>
                          {k.tre_ngay == null ? null : k.tre_ngay > 0 ? (
                            <span className="lds-do">{`trễ ${soVN(k.tre_ngay)} ngày`}</span>
                          ) : k.tre_ngay < 0 ? (
                            <span className="lds-mu">{`còn ${soVN(-k.tre_ngay)} ngày`}</span>
                          ) : (
                            <span className="lds-mu">tới hạn hôm đó</span>
                          )}
                        </td>
                        <td className="n">{soVN(k.con_no)}</td>
                        <td />
                      </tr>
                    ))
                  )}
                  {soKhoan > 0 && (
                    <tr className="lds-cong">
                      <td colSpan={4}>{`Cộng ${soVN(soKhoan)} ${c.khoan}`}</td>
                      <td className="n">{soVN(khoan.tong)}</td>
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {khoan && (
            <p className="bccn-ghi-chan lds-mu">
              {`Tính tại ngày cuối kỳ ${ngay(khoan.den_ngay)}, hạn sớm nhất lên đầu. Cộng các ${c.khoan} khớp các cột chia theo hạn ở bảng tổng hợp.`}
            </p>
          )}
        </>
      )}
    </NganPhai>
  );
}
