// Mảnh dùng chung của ngăn kho khuôn A (07/10/2026): thẻ, cặp nhãn–giá trị, ô mặt hàng, tiến độ
// theo mặt hàng, nguồn của yêu cầu và dòng thời gian Lịch sử. Bản thiết kế:
// docs/mockups/yeu-cau-nhap-xuat-phuong-an-A.html. CSS ở kho-ngan-a.css.
import type { ReactNode } from "react";
import { AlertTriangle, Check, Clock, FileText, Package, Plus, X } from "lucide-react";

import type { StockRequest, StockRequestLine, StockVoucher } from "../api/client";
import { fmtDateTime } from "../utils/format";
import { fmtGioCan, fmtQty } from "./khoShared";
import { tenDonVi } from "./tenDonVi";
import "./kho-ngan-a.css";

export function TheA({
  tieuDe,
  phai,
  cat,
  children,
}: {
  tieuDe?: ReactNode;
  phai?: ReactNode;
  /** Thẻ chứa bảng sát mép: cắt góc bo cho bảng. */
  cat?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`kna-the${cat ? " kna-the--cat" : ""}`}>
      {tieuDe != null && (
        <div className="kna-the__dau">
          <h3>{tieuDe}</h3>
          {phai != null && <span className="kna-the__phai">{phai}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Cặp nhãn – giá trị ở cột bên. Dòng `null` thì bỏ (không in "—" cho thứ không có). */
export function KvA({ dong }: { dong: ([ReactNode, ReactNode, ReactNode?] | null | false)[] }) {
  return (
    <dl className="kna-kv">
      {dong.filter((d): d is [ReactNode, ReactNode, ReactNode?] => !!d).map(([nhan, giaTri, phu], i) => (
        <div key={i} style={{ display: "contents" }}>
          <dt>{nhan}</dt>
          <dd>
            {giaTri}
            {phu}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Ô mặt hàng: ảnh nhỏ (hoặc biểu tượng) + tên + hàng thẻ phụ. */
export function HangA({ ten, anh, phu, anhNut }: { ten: ReactNode; anh?: string | null; phu?: ReactNode; anhNut?: ReactNode }) {
  return (
    <div className="kna-hang">
      {anhNut ?? (
        <span className="kna-hang__anh" aria-hidden="true">
          {anh ? <img src={anh} alt="" /> : <Package size={16} />}
        </span>
      )}
      <div style={{ minWidth: 0 }}>
        <div className="kna-hang__ten">{ten}</div>
        {phu != null && <div className="kna-hang__phu">{phu}</div>}
      </div>
    </div>
  );
}

/** Số + đơn vị nhỏ đứng sau. */
export function SoA({ so, dv, dam, thieu }: { so: number | null | undefined; dv?: string | null; dam?: boolean; thieu?: boolean }) {
  return (
    <>
      <span className={`kna-so${thieu ? " kna-so--thieu" : dam ? " kna-so--dam" : ""}`}>{fmtQty(so ?? 0)}</span>
      {dv ? <span className="kna-dv">{dv}</span> : null}
    </>
  );
}

export const tenDv = (ma: string | null | undefined) => (ma ? tenDonVi(ma) ?? ma : "");

/** Mục tiêu hiệu lực của dòng — CÙNG công thức `StockRequestService.muc_tieu_hieu_luc`. */
export const mucTieu = (l: StockRequestLine) => l.sl_chot_thuc_xuat ?? l.sl_duyet;

/** Dòng đã đủ: kho đã cấp/nhập hết mục tiêu (kể cả mục tiêu đã chốt lại thấp hơn). */
export const dongDu = (l: StockRequestLine) => l.sl_con_lai <= 1e-9;

/** Tiến độ của một yêu cầu. Các dòng KHÁC đơn vị thì đếm theo MẶT HÀNG ("1/2 mặt hàng") — cộng
 *  75 tờ với 5 kg là con số vô nghĩa. Cùng đơn vị thì cộng số lượng như cũ. */
export function tienDoYeuCau(r: StockRequest) {
  const dvs = new Set(r.lines.map((l) => l.dvt));
  if (dvs.size === 1 && r.lines.length > 0) {
    const total = r.lines.reduce((s, l) => s + mucTieu(l), 0);
    const done = r.lines.reduce((s, l) => s + l.sl_da_ung, 0);
    return { kieu: "so" as const, done, total, dv: tenDv(r.lines[0].dvt), pct: total > 0 ? Math.min(100, (done / total) * 100) : 0 };
  }
  const total = r.lines.length;
  const done = r.lines.filter(dongDu).length;
  return { kieu: "mat-hang" as const, done, total, dv: "mặt hàng", pct: total > 0 ? (done / total) * 100 : 0 };
}

export function TienDoA({ r }: { r: StockRequest }) {
  const p = tienDoYeuCau(r);
  if ((r.trang_thai === "cancelled" || r.trang_thai === "rejected") && p.done === 0) {
    return <span className="kna-mo">{r.loai === "NHAP" ? "Không nhập" : "Không cấp"}</span>;
  }
  return (
    <span className="kna-tien">
      {p.kieu === "so" ? (
        <span>
          <span className="kna-so">{fmtQty(p.done)}/{fmtQty(p.total)}</span>
          {p.dv && <span className="kna-dv">{p.dv}</span>}
        </span>
      ) : (
        <span className="kna-dv" style={{ marginLeft: 0 }}>{p.done}/{p.total} mặt hàng</span>
      )}
      <span className={`kna-tien__vach${p.pct >= 100 ? "" : " kna-tien__vach--do-dang"}`}>
        <i style={{ width: `${p.pct}%` }} />
      </span>
    </span>
  );
}

/** Mã lệnh/bài của các dòng, không trùng. */
export function lenhCua(r: StockRequest): string[] {
  return [...new Set(r.lines.map((l) => l.lsx_ma ?? l.bai_ghep_ma).filter((m): m is string => !!m))];
}

export const tuKcs = (r: StockRequest) => r.lines.some((l) => l.tu_kcs);

/** Nguồn sản xuất của yêu cầu: gia công ngoài THẮNG KCS (#41, 18/10/2026). Yêu cầu nhập do chốt gia
 *  công về kho cũng mang cờ thành phẩm (`tu_kcs` — cờ đó lo cột giá gốc), nhưng hàng do nhà gia công
 *  giao về, KCS không kiểm. Cùng thứ tự với bộ lọc Nguồn ở máy chủ. */
export function nguonSanXuat(r: StockRequest): "gia_cong" | "kcs" | null {
  if (r.gia_cong_ngoai_id != null) return "gia_cong";
  return tuKcs(r) ? "kcs" : null;
}

/** Ô "Nguồn" ở danh sách: đơn mua + đợt, KCS + lệnh, điều chuyển từ kho nào, giao hàng (lượt xe +
 *  đơn), hoặc lệnh SX. */
export function NguonA({ r }: { r: StockRequest }) {
  if (r.don_mua_ma) {
    return (
      <span className="kna-nguon">
        <span className="kna-tag kna-tag--ma">{r.don_mua_ma}</span>
        {r.dot_so != null && <span className="kna-tag">Đợt {r.dot_so}</span>}
      </span>
    );
  }
  if (r.dieu_chuyen) {
    return <span className="kna-nguon">Từ {r.kho_nguon_ten ?? "kho khác"}</span>;
  }
  if (r.giao_yeu_cau_ma) {
    // Giao hàng lập (12/10/2026): mã lượt cho kho biết các phiếu lên CÙNG một xe; chuyến cũ ngoài
    // lượt thì lùi về mã yêu cầu giao. Rê chuột thấy đủ cả hai mã.
    return (
      <span className="kna-nguon" title={[r.giao_luot_ma, r.giao_yeu_cau_ma, r.giao_don_ma].filter(Boolean).join("\n")}>
        <span className="kna-tag">Giao hàng</span>
        <span>{r.giao_luot_ma ?? r.giao_yeu_cau_ma}</span>
        {r.giao_don_ma && <span className="kna-tag kna-tag--ma">{r.giao_don_ma}</span>}
      </span>
    );
  }
  const lenh = lenhCua(r);
  // Gia công ngoài (giấy cấp cho nhà gia công / thành phẩm nhận về) — cùng nhãn điều kiện lọc Nguồn.
  const nguon = nguonSanXuat(r);
  if (!lenh.length && !nguon) return <span className="kna-mo">—</span>;
  return (
    <span className="kna-nguon">
      {nguon === "kcs" && <span className="kna-tag">KCS</span>}
      {nguon === "gia_cong" && <span className="kna-tag">Gia công</span>}
      {/* Hệ thống tự lập lúc phát hành lệnh (18/10/2026) — không phải tổ bấm xin. */}
      {r.san_xuat_tu_lap && <span className="kna-tag">Tự lập khi phát hành</span>}
      {lenh.slice(0, 2).map((m) => <span key={m}>{m}</span>)}
      {lenh.length > 2 && <span className="kna-tag">+{lenh.length - 2} lệnh</span>}
    </span>
  );
}

/** Thẻ "Nguồn hàng" ở cột bên — chỉ yêu cầu NHẬP sinh từ đơn mua hoặc từ KCS mới có. */
/** Khối "Giao hàng" của đề nghị xuất do Giao hàng lập (12/10/2026, docs/mockups/kho-xuat-giao-khach):
 *  thủ kho biết hàng của khách nào, lên xe nào, ai tới lấy — đọc thẳng từ chuyến giao nên đổi tài xế /
 *  xe bên Giao hàng là khối này đổi theo. Đề nghị khác (sản xuất, điều chuyển) không hiện. */
export function TheGiaoHang({ r }: { r: StockRequest }) {
  if (r.loai !== "XUAT" || !r.giao_yeu_cau_ma) return null;
  return (
    <TheA tieuDe="Giao hàng">
      <div className="kna-the__than">
        <KvA dong={[
          ["Khách hàng", r.giao_khach_ten ?? "—"],
          r.giao_don_ma ? ["Đơn bán", <span className="kna-tag kna-tag--ma">{r.giao_don_ma}</span>] : null,
          ["Yêu cầu giao", r.giao_yeu_cau_ma],
          r.giao_luot_ma ? ["Lượt xe", r.giao_luot_ma] : null,
          ["Xe", r.giao_xe_bien_so ?? <span className="kna-mo">Chưa gán xe</span>],
          ["Tài xế tới lấy", r.giao_tai_xe_ten ?? "—"],
        ]} />
      </div>
    </TheA>
  );
}

export function TheNguonHang({ r, khach }: { r: StockRequest; khach?: string | null }) {
  if (r.loai !== "NHAP") return null;
  if (r.don_mua_ma) {
    return (
      <TheA tieuDe="Nguồn hàng">
        <div className="kna-the__than">
          <KvA dong={[
            ["Đơn mua", <span className="kna-tag kna-tag--ma">{r.don_mua_ma}</span>],
            r.dot_so != null && ["Đợt giao", `Đợt ${r.dot_so}`],
          ]} />
        </div>
      </TheA>
    );
  }
  const nguon = nguonSanXuat(r);
  if (!nguon || (nguon === "gia_cong" && !tuKcs(r))) return null;
  const lenh = lenhCua(r);
  const don = [...new Set(r.lines.map((l) => l.don_ban_ma).filter((m): m is string => !!m))];
  return (
    <TheA tieuDe="Nguồn hàng">
      <div className="kna-the__than">
        <KvA dong={[
          ["Từ", nguon === "gia_cong" ? "Nhà gia công giao thành phẩm" : "KCS gửi thành phẩm"],
          r.san_xuat_cong_doan_ten ? ["Công đoạn", r.san_xuat_cong_doan_ten] : null,
          lenh.length > 0 && ["Lệnh sản xuất", <span className="kna-nguon" style={{ justifyContent: "flex-end" }}>{lenh.map((m) => <span key={m} className="kna-tag kna-tag--ma">{m}</span>)}</span>],
          don.length > 0 && ["Đơn bán", <span className="kna-nguon" style={{ justifyContent: "flex-end" }}>{don.map((m) => <span key={m} className="kna-tag kna-tag--ma">{m}</span>)}</span>],
          khach ? ["Khách hàng", khach] : null,
        ]} />
      </div>
    </TheA>
  );
}

/** Ngày cần hiển thị: giờ cần thật (từ đề nghị sản xuất) ưu tiên, không thì ngày trơn. */
export function canLucCua(r: StockRequest): string | null {
  if (r.can_luc) return fmtGioCan(r.can_luc);
  if (r.ngay_can) return new Date(`${r.ngay_can}T00:00:00`).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  return null;
}

// ── Dòng thời gian ──────────────────────────────────────────────────────────

export type MucLichSu = {
  kieu: "tao" | "xong" | "canh" | "huy" | "cho";
  tieuDe: ReactNode;
  /** ISO; không có thì không in mốc giờ (vd lý do thiếu: máy không lưu lúc ghi). */
  luc?: string | null;
  phu?: ReactNode;
  trich?: ReactNode;
  /** Mục sinh từ một phiếu — để đặt lý do thiếu ngay trên phiếu mới nhất. */
  phieu?: boolean;
};

const CHAM = {
  tao: <Plus size={13} />,
  xong: <Check size={13} />,
  canh: <AlertTriangle size={13} />,
  huy: <X size={13} />,
  cho: <Clock size={13} />,
};

export function LichSuA({ muc }: { muc: MucLichSu[] }) {
  return (
    <TheA>
      <div className="kna-the__than" style={{ paddingTop: 18 }}>
        <ul className="kna-tl">
          {muc.map((m, i) => (
            <li key={i}>
              <span className={`kna-tl__cham${m.kieu === "tao" ? "" : ` kna-tl__cham--${m.kieu}`}`}>{CHAM[m.kieu]}</span>
              <div className="kna-tl__t">{m.tieuDe}</div>
              {(m.luc || m.phu) && <div className="kna-tl__m">{m.luc ? fmtDateTime(m.luc) : null}{m.luc && m.phu ? <>&nbsp;&nbsp;</> : null}{m.phu}</div>}
              {m.trich != null && <div className="kna-tl__q">{m.trich}</div>}
            </li>
          ))}
        </ul>
      </div>
    </TheA>
  );
}

/** Hai mốc cách nhau dưới 2 phút và cùng người ⇒ "lập và ghi sổ" một lần. */
export function lapVaGhiSoCungLuc(v: StockVoucher): boolean {
  if (v.trang_thai !== "posted" || !v.ghi_so_luc) return false;
  if ((v.nguoi_ghi_so_ten ?? null) !== (v.nguoi_lap_ten ?? null)) return false;
  return Math.abs(new Date(v.ghi_so_luc).getTime() - new Date(v.created_at).getTime()) < 120_000;
}

/** Các dòng của phiếu thành gạch đầu dòng "75 tờ nguyên COUCHE 150GSM" (gộp lô cùng mặt hàng). */
function dongPhieu(v: StockVoucher): ReactNode {
  const gop = new Map<number, { ten: string; sl: number; dv: string }>();
  for (const l of v.lines) {
    const g = gop.get(l.request_line_id);
    if (g) g.sl += l.so_luong;
    else gop.set(l.request_line_id, { ten: l.hang_ten ?? "—", sl: l.so_luong, dv: tenDv(l.dvt) });
  }
  if (!gop.size) return null;
  return (
    <ul>
      {[...gop.values()].map((g, i) => (
        <li key={i}>{fmtQty(g.sl)} {g.dv} {g.ten}</li>
      ))}
    </ul>
  );
}

/** Lịch sử của một yêu cầu dựng TỪ DỮ LIỆU SẴN CÓ (không có bảng nhật ký riêng): lúc tạo, từng
 *  phiếu (lập / ghi sổ / hủy), lý do thiếu của từng dòng, lý do từ chối / hủy, và việc còn chờ. */
export function lichSuYeuCau(
  r: StockRequest,
  vouchers: StockVoucher[],
  moPhieu?: (id: number) => void,
): MucLichSu[] {
  const nhap = r.loai === "NHAP";
  const dong = (v: StockVoucher) =>
    moPhieu ? (
      <button type="button" className="kna-lien" style={{ fontSize: "inherit" }} onClick={() => moPhieu(v.id)}>{v.ma}</button>
    ) : (
      <b>{v.ma}</b>
    );
  const coLuc: MucLichSu[] = [];
  const nguoiTao = <b>{r.nguoi_tao_ten ?? "Người yêu cầu"}</b>;
  coLuc.push({
    kieu: "tao",
    luc: r.created_at,
    tieuDe: r.don_mua_ma ? (
      <>{nguoiTao} tạo yêu cầu nhập từ {r.dot_so != null ? `đợt giao ${r.dot_so} của ` : ""}<b>{r.don_mua_ma}</b></>
    ) : (
      <>{nguoiTao} tạo yêu cầu {nhap ? "nhập" : "xuất"} {r.lines.length} mặt hàng</>
    ),
  });
  const sapXep = [...vouchers].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const v of sapXep) {
    const gop = lapVaGhiSoCungLuc(v);
    coLuc.push({
      kieu: gop ? "xong" : "tao",
      phieu: true,
      luc: v.created_at,
      tieuDe: <><b>{v.nguoi_lap_ten ?? "Kho"}</b> {gop ? "lập và ghi sổ" : "lập"} phiếu {dong(v)}</>,
      phu: v.kho_ten ?? undefined,
      trich: dongPhieu(v),
    });
    if (v.trang_thai === "posted" && v.ghi_so_luc && !gop) {
      coLuc.push({ kieu: "xong", phieu: true, luc: v.ghi_so_luc, tieuDe: <><b>{v.nguoi_ghi_so_ten ?? "Kho"}</b> ghi sổ phiếu {dong(v)}</> });
    }
    if (v.trang_thai === "cancelled") {
      coLuc.push({ kieu: "huy", tieuDe: <>Phiếu {dong(v)} đã hủy</> });
    }
  }
  if (r.trang_thai === "rejected") {
    coLuc.push({
      kieu: "huy", luc: r.duyet_luc,
      tieuDe: <><b>{r.nguoi_duyet_ten ?? "Người duyệt"}</b> từ chối yêu cầu</>,
      trich: r.ly_do_tu_choi || undefined,
    });
  }
  if (r.trang_thai === "cancelled") {
    // `updated_at` = lần đổi cuối; hủy là trạng thái cuối nên mốc này chính là lúc hủy.
    coLuc.push({ kieu: "huy", luc: r.updated_at, tieuDe: <>Yêu cầu đã hủy</>, trich: r.ly_do_huy || undefined });
  }
  // Mới nhất lên đầu; mục không có mốc giờ giữ nguyên chỗ sau mục đứng trước nó.
  const ds = coLuc.map((m, i) => ({ m, i, t: m.luc ? new Date(m.luc).getTime() : NaN }));
  let truoc = 0;
  for (const x of ds) {
    if (Number.isNaN(x.t)) x.t = truoc;
    else truoc = x.t;
  }
  ds.sort((a, b) => b.t - a.t || b.i - a.i);
  const ketQua = ds.map((x) => x.m);

  // Lý do thiếu của từng dòng: máy không lưu lúc ghi ⇒ đặt ngay trên phiếu mới nhất, không in giờ.
  const lyDo = r.lines.filter((l) => l.ly_do_thieu);
  if (lyDo.length) {
    const iPhieu = ketQua.findIndex((m) => m.phieu);
    const viTri = iPhieu >= 0 ? iPhieu : ketQua.length - 1;
    const muc: MucLichSu[] = lyDo.map((l) => ({
      kieu: "canh",
      tieuDe: <>Kho ghi lý do {nhap ? "nhập" : "cấp"} thiếu <b>{l.hang_ten ?? "—"}</b></>,
      trich: l.ly_do_thieu,
    }));
    ketQua.splice(Math.max(0, viTri), 0, ...muc);
  }

  // Việc còn chờ — chỉ khi yêu cầu còn mở.
  const conMo = ["approved", "received", "preparing", "partial"].includes(r.trang_thai);
  const con = r.lines.filter((l) => l.sl_con_lai > 1e-9);
  if (conMo && con.length) {
    const can = canLucCua(r);
    ketQua.unshift({
      kieu: "cho",
      tieuDe: con.length === 1 ? (
        <>Chờ {nhap ? "nhập" : "cấp"}{vouchers.some((v) => v.trang_thai === "posted") ? " nốt" : ""} <b>{fmtQty(con[0].sl_con_lai)} {tenDv(con[0].dvt)} {con[0].hang_ten ?? ""}</b></>
      ) : (
        <>Chờ {nhap ? "nhập" : "cấp"} <b>{con.length} mặt hàng</b></>
      ),
      phu: can ? `Cần lúc ${can}` : undefined,
    });
  }
  return ketQua;
}

export function IconPhieu() {
  return <FileText size={16} aria-hidden="true" />;
}
