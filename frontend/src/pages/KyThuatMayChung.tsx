// Kỹ thuật máy — mảnh dùng chung cho 2 màn (Sửa chữa máy · Phiếu bảo trì).
// Đặt chung vì cả hai màn đều có: khối ảnh trước/sau, badge trạng thái, và cùng một luật
// "chưa có ảnh chứng thực thì chưa đóng được phiếu".
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useAuth } from "../auth/useAuth";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { ChipTT, type MauTT } from "../components/LuoiDs";
import { Icon } from "../components/Icons";
import { anhNho, assetUrl } from "../api/client";
import { nhatKyDanhMuc, type NhatKyItem } from "../api/rebuildCatalog";
import { kyThuatMay, type Anh, type LoaiPhieu } from "../api/kyThuatMay";
import { coChu, nenAnh } from "../lib/anhNen";
import { useHep } from "../lib/useHep";

/** Màn hẹp HOẶC không có hover (cảm ứng) ⇒ đổi sang bố cục danh sách/thẻ.
 *
 * Khai MỘT chỗ cho cả lịch lẫn bảng: hai định nghĩa breakpoint là sớm muộn một màn đổi hình còn
 * màn kia thì không, ngay trên cùng một cái điện thoại. */
export function useManHep(): boolean {
  return useHep("(max-width: 820px), (hover: none)");
}

/** Màu chip trạng thái của cả hai màn — bộ `--tt-*` chung với Báo giá/Đơn hàng (07/10/2026).
 *  Mỗi trạng thái một sắc trong cùng một màn; lọc nhanh dùng đúng màu này cho chấm. */
export const MAU_TT_KTM: Record<string, MauTT> = {
  cho_sua: "vang", da_sua_xong: "la",
  cho_tiep_nhan: "cam", da_tao_phieu: "la", tu_choi: "do",
  cho_thuc_hien: "vang", hoan_thanh: "la", da_huy: "xam",
};

export function ChipKtm({ tt, children }: { tt: string; children: ReactNode }) {
  return <ChipTT mau={MAU_TT_KTM[tt] ?? "xam"}>{children}</ChipTT>;
}

const MAU_MUC_DO: Record<string, MauTT> = { nhe: "la", trung_binh: "vang", nghiem_trong: "do" };

/** Gắn `title` = chữ đủ cho ô lưới đang bị cắt "…" (đo lúc rê chuột; ô vừa thì không bày tooltip). */
export function hienChuDu(e: MouseEvent<HTMLElement>) {
  const o = e.currentTarget;
  if (o.title) return;
  if (o.scrollWidth > o.clientWidth) o.title = o.textContent ?? "";
}

/** Mức độ trên lưới: chấm màu + chữ, KHÔNG đóng viên — để bảng chỉ còn một cột chip (Trạng thái). */
export function MucDo({ muc, nhan }: { muc: string; nhan: string }) {
  return (
    <span className="ktm-mucdo">
      <i className={`lds-dot lds-dot--${MAU_MUC_DO[muc] ?? "xam"}`} aria-hidden="true" />{nhan}
    </span>
  );
}

/** Chọn mức độ bằng ba nút liền (hộp thoại lập mới). */
export function ChonMucDo({ giaTri, nhan, onChange }: {
  giaTri: string; nhan: Record<string, string>; onChange: (v: string) => void;
}) {
  return (
    <span className="ktm-seg" role="radiogroup" aria-label="Mức độ">
      {Object.keys(MAU_MUC_DO).map((m) => (
        <button key={m} type="button" role="radio" aria-checked={giaTri === m}
          className={giaTri === m ? "on" : undefined} onClick={() => onChange(m)}>
          <i className={`lds-dot lds-dot--${MAU_MUC_DO[m]}`} aria-hidden="true" />{nhan[m] ?? m}
        </button>
      ))}
    </span>
  );
}

/** Cột thuộc tính bên phải ngăn (phương án A, khuôn Linear): nhãn trái, giá trị phải; `cuoi` là
 *  khối nút chốt việc dính đáy cột — luôn trong tầm mắt, không phải cuộn xuống tìm. */
export function CotPhieu({ children, cuoi }: { children: ReactNode; cuoi?: ReactNode }) {
  return (
    <div className="ktm-cot">
      <dl className="ktm-tc">{children}</dl>
      {cuoi && <div className="ktm-cot__cuoi">{cuoi}</div>}
    </div>
  );
}

export function DongTT({ nhan, children }: { nhan: string; children: ReactNode }) {
  return (
    <div className="ktm-tc__o">
      <dt>{nhan}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Ô nhập của cột trái: khoá thì hiện chữ thường (ô xám mờ đọc mệt), trống thì nói "Không ghi". */
export function ONhap({ nhan, phu, giaTri, khoa, nhieuDong, placeholder, goiY, onChange }: {
  nhan: string;
  phu?: string;
  giaTri: string;
  khoa: boolean;
  nhieuDong?: boolean;
  placeholder?: string;
  goiY?: ReactNode;
  onChange: (v: string) => void;
}) {
  return (
    <label className="ktm-f">
      <span className="ktm-f__nhan">{nhan}{phu && <span className="ktm-f__phu">{phu}</span>}</span>
      {khoa ? (
        <span className={`ktm-f__doc${giaTri ? "" : " lds-mu3"}`}>{giaTri || "Không ghi"}</span>
      ) : nhieuDong ? (
        <textarea className="ktm-o" rows={2} value={giaTri} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="ktm-o" value={giaTri} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)} />
      )}
      {goiY && <span className="ktm-f__goiy">{goiY}</span>}
    </label>
  );
}

/** Hộp thoại giữa màn cho form lập mới ngắn (khuôn "New issue" của Linear) — năm ô không cần một
 *  ngăn 1180px. Bọc FORM: Enter trong ô là gửi. Esc / bấm nền đóng; đang gõ dở thì hỏi trước. */
export function HopThoai({ tieuDe, rong = 600, chanTrai, nutChinh, dangGui, loi, coNoiDung, onGui, onDong, children }: {
  tieuDe: string;
  rong?: number;
  chanTrai?: ReactNode;
  nutChinh: string;
  dangGui: boolean;
  loi: string | null;
  coNoiDung: boolean;
  onGui: () => void;
  onDong: () => void;
  children: ReactNode;
}) {
  const [hoiBo, setHoiBo] = useState(false);
  const dong = () => (coNoiDung ? setHoiBo(true) : onDong());
  const dongRef = useRef(dong);
  dongRef.current = dong;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(".cdlg-overlay")) return;
      e.preventDefault();
      dongRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="ktm-hop-nen" role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) dong(); }}>
      <form className="ktm-hop" role="dialog" aria-modal="true" aria-label={tieuDe}
        style={{ width: `min(${rong}px, calc(100vw - 24px))` }}
        onSubmit={(e) => { e.preventDefault(); onGui(); }}>
        <div className="ktm-hop__dau">
          <h2>{tieuDe}</h2>
          <button type="button" className="ktm-ic" aria-label="Đóng" title="Đóng (Esc)" onClick={dong}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="ktm-hop__than">
          {loi && <div className="banner banner--error" role="alert">{loi}</div>}
          {children}
        </div>
        <div className="ktm-hop__chan">
          <span className="ktm-hop__phu">{chanTrai}</span>
          <Button variant="ghost" type="button" onClick={dong}>Hủy</Button>
          <Button variant="accent" type="submit" disabled={dangGui}>{dangGui ? "Đang lưu…" : nutChinh}</Button>
        </div>
      </form>
      <ConfirmDialog open={hoiBo} title="Bỏ phiếu đang nhập?" message="Những gì đã gõ sẽ mất."
        cancelLabel="Nhập tiếp" confirmLabel="Bỏ" danger
        onCancel={() => setHoiBo(false)} onConfirm={() => { setHoiBo(false); onDong(); }} />
    </div>
  );
}

/** "Đã kéo dài" từ lúc hỏng tới giờ (phiếu đang mở) hoặc tới lúc sửa xong: "45 phút", "10 giờ",
 *  "2 ngày 13 giờ". Đọc như nói, không cần đơn vị nhỏ hơn bậc kế tiếp. */
export function keoDai(tu: string | null | undefined, den?: string | null, bayGio = Date.now()): string {
  if (!tu) return "";
  const a = new Date(tu).getTime();
  const b = den ? new Date(den).getTime() : bayGio;
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return "";
  const phut = Math.floor((b - a) / 60000);
  if (phut < 60) return `${phut} phút`;
  const gio = Math.floor(phut / 60);
  if (gio < 24) return `${gio} giờ`;
  const ngay = Math.floor(gio / 24);
  return gio % 24 ? `${ngay} ngày ${gio % 24} giờ` : `${ngay} ngày`;
}

/** Giờ hỏng ngắn cho ô lưới: "07/10 11:30" — năm thêm vào khi khác năm nay. */
export function fmtNgayGioNgan(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  const nam = d.getFullYear() !== new Date().getFullYear() ? `/${d.getFullYear()}` : "";
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}${nam} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Khớp `LOAI_MODULE` bên `routers/nhat_ky_danh_muc.py` — sai chuỗi là 404, không phải danh sách rỗng. */
export type LoaiNhatKy = "ky_thuat_sua_chua" | "ky_thuat_bao_tri" | "ky_thuat_yeu_cau";

export function fmtNgay(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function fmtNgayGio(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })} ${d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`;
}

/** `yyyy-mm-dd` của HÔM NAY theo giờ máy người dùng — giá trị của ô ngày (`ChonNgay`). */
export function homNay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Chip trạng thái của PHIẾU BẢO TRÌ — một chỗ duy nhất dựng nó.
 *
 * "Quá hạn" không phải trạng thái lưu trong DB mà là dẫn xuất (chưa xong + hạn đã qua), nên nó
 * phải nằm chung với các trạng thái thật ở đây; tách ra là mỗi màn tự chọn lúc nào gọi là quá hạn.
 * Đã hủy đứng TRƯỚC nhánh quá hạn: phiếu hủy không bao giờ là "quá hạn" (backend cũng không tính).
 */
export function BadgeBaoTri({ trangThai, quaHan }: { trangThai: string; quaHan?: boolean }) {
  if (trangThai === "hoan_thanh") return <ChipTT mau="la">Đã xong</ChipTT>;
  if (trangThai === "da_huy") return <ChipTT mau="xam">Đã hủy</ChipTT>;
  if (quaHan) return <ChipTT mau="do">Quá hạn</ChipTT>;
  return <ChipTT mau="vang">Chưa làm</ChipTT>;
}

/** Lịch sử thao tác của MỘT phiếu — ai làm gì, lúc nào.
 *
 * Đọc `audit_logs` qua endpoint nhật ký dùng chung (`/api/nhat-ky-danh-muc/{loai}/{id}`), không
 * đẻ bảng lịch sử riêng. Đây là chỗ đọc được AI làm gì lúc nào: tick việc con, hủy phiếu kèm lý do,
 * và (dữ liệu cũ) lý do từng lần dời lịch trước khi chức năng dời bị gỡ.
 */
export function NhatKyPhieu({ loai, phieuId }: { loai: LoaiNhatKy; phieuId: number }) {
  const { token } = useAuth();
  const [rows, setRows] = useState<NhatKyItem[]>([]);
  const [dangTai, setDangTai] = useState(true);
  const [loi, setLoi] = useState<string | null>(null);
  const [lan, setLan] = useState(0);

  useEffect(() => {
    if (!token) return;
    setDangTai(true);
    setLoi(null);
    nhatKyDanhMuc(token, loai, phieuId)
      .then((r) => setRows(r.items ?? []))
      // Nuốt lỗi ở đây là mạng hỏng hiện y hệt "chưa có thao tác nào" — người đọc kết luận phiếu
      // sạch sẽ trong khi thật ra họ chưa nhìn thấy gì cả.
      .catch((e) => setLoi(e instanceof Error ? e.message : "Không tải được lịch sử thao tác."))
      .finally(() => setDangTai(false));
  }, [token, loai, phieuId, lan]);

  if (dangTai) return <EmptyState trangThai="dang-tai" gon nhanTai="Đang tải lịch sử…" />;
  if (loi) {
    return (
      <p className="ktm-hint ktm-hint--loi">
        {loi}{" "}
        <button type="button" className="ktm-hint__thu-lai" onClick={() => setLan((n) => n + 1)}>
          Thử lại
        </button>
      </p>
    );
  }
  if (rows.length === 0) {
    return <p className="ktm-hint">Chưa có thao tác nào được ghi lại trên phiếu này.</p>;
  }
  return (
    <ol className="ktm-nk">
      {rows.map((r, i) => (
        <li key={i}>
          <div className="ktm-nk__dau">
            <span className="ktm-nk__gio">{fmtNgayGio(r.at)}</span>
            {/* Không có tên = việc do hệ thống/seed sinh, nói thẳng chứ đừng để trống cho người
                đọc tự đoán là lỗi hiển thị. */}
            <span className="ktm-nk__ai">{r.actor_name ?? "Hệ thống"}</span>
          </div>
          <div className="ktm-nk__viec">{r.detail}</div>
        </li>
      ))}
    </ol>
  );
}

// `PhanTrang` tự viết ĐÃ GỠ 14/08/2026 — hai màn dùng `components/Pager.tsx` như mọi màn khác
// (`Pager` + `trangHopLe`). Bản riêng ở đây thiếu `loading` nên bấm dồn "Sau" ra hai lượt gọi
// chồng nhau, và tự ẩn khi chỉ có một trang nên người dùng mất luôn dòng "Tổng N phiếu".

/** Khối ảnh của MỘT giai đoạn (trước / sau) — ô 64px như phương án A (07/10/2026), không còn vùng
 *  kéo-thả cao ~200px chiếm nửa ngăn. Kéo ảnh thả vào khối vẫn được.
 *
 * `batBuoc` chỉ đổi cách trình bày (ô "+ Thêm" viền đỏ + dòng nhắc) — cửa chặn thật nằm ở backend:
 * khoá nút bên FE mà backend không chặn thì gọi thẳng API là qua.
 *
 * Danh sách ảnh do NGĂN nạp và truyền xuống (`tatCaAnh` = ảnh của cả phiếu, khối này tự lọc theo
 * giai đoạn): hai khối trước/sau nếu mỗi cái tự gọi API thì mở một phiếu là hai request giống hệt
 * nhau, thêm/xoá một tấm lại hai lần nữa.
 */
export function AnhBox({
  loai, phieuId, giaiDoan, tieuDe, canChu, batBuoc = false, khoa = false,
  tatCaAnh, onChanged,
}: {
  loai: LoaiPhieu;
  phieuId: number;
  giaiDoan: "truoc" | "sau";
  tieuDe: string;
  /** Dòng nhắc đỏ khi còn thiếu ảnh bắt buộc, vd "cần ít nhất 1 ảnh để đóng phiếu". */
  canChu?: string;
  batBuoc?: boolean;
  khoa?: boolean;
  tatCaAnh: Anh[];
  onChanged?: () => void;
}) {
  const { token } = useAuth();
  const [dangTai, setDangTai] = useState(false);
  const [dangNen, setDangNen] = useState(false);
  const [tietKiem, setTietKiem] = useState<{ goc: number; sau: number } | null>(null);
  const [keoVao, setKeoVao] = useState(false);
  const [xemAnh, setXemAnh] = useState<Anh | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const anh = tatCaAnh.filter((a) => a.giai_doan === giaiDoan);
  const thieu = batBuoc && anh.length === 0;

  const them = async (files: FileList | null) => {
    if (!token || !files?.length) return;
    setLoi(null);
    setTietKiem(null);
    let goc = 0;
    let sau = 0;
    try {
      for (const f of Array.from(files)) {
        // Nén TRƯỚC khi gửi: ảnh điện thoại 4–8MB/tấm, mạng xưởng yếu thì tải nguyên bản là thợ
        // đứng chờ. Nén hỏng (HEIC…) thì `nenAnh` trả lại file gốc chứ không chặn.
        setDangNen(true);
        const kq = await nenAnh(f);
        setDangNen(false);
        goc += kq.goc;
        sau += kq.sau;
        setDangTai(true);
        await kyThuatMay.uploadAnh(token, loai, phieuId, kq.file, giaiDoan);
      }
      if (sau < goc) setTietKiem({ goc, sau });
      onChanged?.();
    } catch (e) {
      setLoi(e instanceof Error ? e.message : "Tải ảnh không thành công.");
    } finally {
      setDangNen(false);
      setDangTai(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const xoa = async (a: Anh) => {
    if (!token) return;
    setLoi(null);
    try {
      await kyThuatMay.removeAnh(token, a.id);
      onChanged?.();
    } catch (e) {
      setLoi(e instanceof Error ? e.message : "Không xoá được ảnh.");
    }
  };

  return (
    <section className={`ktm-anh${keoVao ? " is-keo" : ""}`}
      onDragOver={(e) => { e.preventDefault(); if (!khoa) setKeoVao(true); }}
      onDragLeave={(e) => {
        e.preventDefault();
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setKeoVao(false);
      }}
      onDrop={(e) => { e.preventDefault(); setKeoVao(false); if (!khoa) void them(e.dataTransfer.files); }}>
      <h4 className="ktm-anh__dau">
        {tieuDe}
        {thieu && !khoa && canChu && <span className="lds-do">{canChu}</span>}
      </h4>
      <div className="ktm-anh__o">
        {anh.map((a) => (
          <figure className="ktm-anh__tam" key={a.id}>
            <button type="button" className="ktm-anh__xem" title={`Xem ảnh tải lên ${fmtNgayGio(a.uploaded_at)}`}
              onClick={() => setXemAnh(a)}>
              <img src={anhNho(a.file_url) ?? ""} alt={a.file_name} loading="lazy" />
            </button>
            {/* Nút xoá hiện SẴN, không chờ rê chuột: máy cảm ứng ở xưởng không có hover. */}
            {!khoa && (
              <button type="button" className="ktm-anh__xoa" aria-label="Xoá ảnh" title="Xoá ảnh"
                onClick={() => void xoa(a)}>
                <Icon name="x" size={11} />
              </button>
            )}
          </figure>
        ))}
        {!khoa ? (
          <button type="button" className={`ktm-anh__them${thieu ? " is-can" : ""}`}
            onClick={() => inputRef.current?.click()} disabled={dangTai || dangNen}>
            {dangNen ? "Đang nén…" : dangTai ? "Đang tải…" : "+ Thêm"}
          </button>
        ) : anh.length === 0 ? (
          <span className="lds-mu3">Không có ảnh</span>
        ) : null}
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple hidden
        onChange={(e) => void them(e.target.files)} />
      {/* Nói ra đã nén được bao nhiêu: thợ thấy "6,2 MB → 380 KB" thì hiểu vì sao lần này tải nhanh,
          và biết ảnh vẫn lên đủ chứ không phải bị bỏ bớt. */}
      {tietKiem && (
        <p className="ktm-anh__nen">Đã nén cho nhẹ: {coChu(tietKiem.goc)} → {coChu(tietKiem.sau)}</p>
      )}
      {loi && <p className="ktm-anh__loi">{loi}</p>}

      {xemAnh && (
        <div className="ktm-lightbox-overlay" onClick={() => setXemAnh(null)}>
          <div className="ktm-lightbox" onClick={(e) => e.stopPropagation()}>
            <div className="ktm-lightbox__head">
              <span className="ktm-lightbox__name">{xemAnh.file_name}</span>
              <button type="button" className="ktm-lightbox__close" onClick={() => setXemAnh(null)}>
                <Icon name="x" size={18} />
              </button>
            </div>
            <div className="ktm-lightbox__body">
              <img src={assetUrl(xemAnh.file_url) ?? ""} alt={xemAnh.file_name} />
            </div>
            <div className="ktm-lightbox__foot">
              Tải lên ngày {fmtNgayGio(xemAnh.uploaded_at)}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
