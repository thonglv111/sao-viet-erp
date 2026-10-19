// Màn KCS — SƠ ĐỒ CẢ NHÓM thành phẩm của lệnh (phương án B nâng cấp, 09/10/2026,
// `docs/mockups/kcs-phuong-an-B-nang-cap.html` Màn 3). Thay bảng "chuỗi công đoạn" của một lệnh.
//
// Mỗi lệnh của nhóm một làn: lệnh phụ (đi kèm) trên, lệnh chính dưới; lệnh phụ có đường nối xuống
// công đoạn của lệnh chính mà nó ghép vào. Mỗi ô công đoạn: trạng thái (gây lỗi thì đỏ, bắt ở đâu cũng
// tính cho nó), tổ đã làm bao nhiêu, lỗi tính cho nó / số đạt ở bước cuối, số tiêu chí bước cuối xét
// cho nó. Cuối làn lệnh chính là ô Nhập kho. Bấm một ô → bảng chi tiết dưới sơ đồ:
//   · bước cuối: Kiểm hàng, Gửi nhập kho, các lần kiểm (chỉ kê lỗi), lỗi theo công đoạn, nhập kho;
//   · công đoạn giữa: Ghi lỗi + ba tab Tiêu chí (lỗi ghi tại chỗ theo tiêu chí, kết quả bước cuối xét) |
//     Quy cách | Lỗi đã ghi (09/10/2026, `docs/design-kcs-ghi-loi-giua.md` §3b);
//   · Nhập kho: các yêu cầu nhập kho đã gửi.
// Số nào cũng suy từ đúng dữ liệu `GET /kcs/lenh/{id}/nhom` — lỗi tính cho công đoạn gom từ mọi lần
// kiểm trong nhóm (khoá công đoạn GÂY), kết quả tiêu chí đếm từ các lần kiểm của bước cuối.
// Kiểm hàng mở form kiểm bước cuối (`KcsKiemForm`); Ghi lỗi công đoạn giữa mở hộp tick tiêu chí
// (`KcsGhiLoiGiua`). Nút "Tệp của lệnh" ở đầu bày tệp Kế hoạch SX của cả nhóm (chỉ xem).
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ApiError, anhNho, api,
  type SxKcsAnh, type SxKcsCongDoan, type SxKcsLanKiem, type SxKcsLanKiemLoi,
  type SxKcsLanNhom, type SxKcsSoDoNhom,
} from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import { useCan } from "../../auth/permissions";
import type { NavigateFn } from "../../components/AppShell";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { XemTruoc } from "../../components/DinhKemTep";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icons";
import { ChipTT, type MauTT } from "../../components/LuoiDs";
import type { TepXem } from "../../components/tepDinhKem";
import { laDienThoai } from "../../utils/dienThoai";
import { ngayGio, num } from "../keHoachSxShared";
import { nhanChangLenh, nhanDonVi } from "../lsxBuoc";
import { useNapTenDonVi } from "../tenDonVi";
import { KcsQuyCach, KcsTepLenh, demTep, useTepNhomKcs } from "./KcsDoiChieu";
import { KcsDongLenh } from "./KcsDongLenh";
import { KcsGhiLoiGiua, daGhiTheoTieuChi } from "./KcsGhiLoiGiua";
import { KcsKiemForm } from "./KcsKiemForm";
import { ketQuaTheoCongDoan } from "./KcsLanKiemList";
import { KCS_YC_KHO_TRANG_THAI, kiemDuoc, loiHoiNhapKho } from "./kcsNhan";
import { CHIP_CONG_DOAN, IconNut, nutTuTrangThai, type TrangThaiNut } from "./kcsSoDo";
import { tenTieuChi } from "./theCongDoan";

type Chon = number | "kho";
interface CdNhom { cd: SxKcsCongDoan; lan: SxKcsLanNhom }
interface LoiCua { lk: SxKcsLanKiem; l: SxKcsLanKiemLoi }

const MAU_YC_KHO: Record<string, MauTT> = {
  draft: "slate", pending: "vang", approved: "xanh", received: "cyan", preparing: "tim",
  partial: "cam", done: "la", rejected: "do", cancelled: "xam",
};

/** Lỗi TÍNH cho công việc `cvId` — gom từ mọi lần kiểm trong nhóm, khoá theo công đoạn GÂY (dòng cũ
 *  thiếu công đoạn chịu là lỗi của chính công đoạn lần kiểm). Mới nhất trước. */
export function loiTinhCho(lanKiem: SxKcsLanKiem[], cvId: number): LoiCua[] {
  const out: LoiCua[] = [];
  for (const lk of lanKiem) {
    for (const l of lk.loi) {
      if ((l.cong_doan_id ?? lk.cong_viec_id) === cvId && l.so_luong > 0) out.push({ lk, l });
    }
  }
  return out.sort((a, b) => (b.lk.luc ?? "").localeCompare(a.lk.luc ?? ""));
}

/** Đơn vị tính của sản phẩm trong nhóm — chặng Thành phẩm gọi bằng chữ này ("cuốn"), xem
 *  `nhanChangLenh`. Mọi lệnh trong nhóm cùng một sản phẩm nên lấy của lệnh chính. */
const DvtNhom = createContext<string | null>(null);

function useNhanChang(): (dv: string | null | undefined) => string {
  const dvt = useContext(DvtNhom);
  return (dv) => nhanChangLenh(dv, dvt);
}

/** Cộng theo đơn vị nơi bắt — lỗi một công đoạn có thể bắt ở hai bước khác đơn vị. */
function theoDonVi(ds: LoiCua[]): [string, number][] {
  const m = new Map<string, number>();
  for (const { l } of ds) m.set(l.don_vi ?? "", (m.get(l.don_vi ?? "") ?? 0) + l.so_luong);
  return [...m.entries()];
}

function SoLoi({ ds }: { ds: [string, number][] }) {
  const nhanCd = useNhanChang();
  return (
    <span className="kcsb-hang">
      {ds.map(([dv, so]) => <span key={dv}>{num(so)} {nhanCd(dv)}</span>)}
    </span>
  );
}

/** Tiêu chí bước cuối xét cho công việc `cvId` + đếm lần xét / hỏng từ các lần kiểm của bước cuối. */
function tieuChiCua(cuoi: SxKcsCongDoan | null, cvId: number) {
  if (!cuoi) return [];
  return cuoi.checklist
    .filter((t) => (t.cong_viec_id ?? cuoi.cong_viec_id) === cvId)
    .map((t) => {
      let xet = 0;
      let hong = 0;
      for (const lk of cuoi.lan_kiem) {
        const kq = lk.checklist.find((k) => (k.cong_viec_id ?? cuoi.cong_viec_id) === cvId && k.thu_tu === t.thu_tu);
        if (kq) { xet += 1; if (!kq.dat) hong += 1; }
      }
      return { t, xet, hong };
    });
}

function tenCd(c: SxKcsCongDoan): string {
  return c.phan_doan_tong > 1 ? `${c.ten} (${c.phan_doan_so}/${c.phan_doan_tong})` : c.ten;
}

function choKiemCua(c: SxKcsCongDoan): number {
  return Math.max(0, c.tot - c.tong_dat - c.tong_loi);
}

function AnhLoi({ anh, onXem }: { anh: SxKcsAnh[]; onXem: (t: TepXem) => void }) {
  return (
    <>
      {anh.map((a) => (
        <button key={a.id} type="button" className="kcsb-anh" title={`Xem ${a.file_name}`}
          onClick={(e) => { e.stopPropagation(); onXem({ ten_tep: a.file_name, file_url: a.file_url, content_type: a.file_type ?? null }); }}>
          <img src={anhNho(a.file_url) ?? undefined} alt="" loading="lazy" />
        </button>
      ))}
    </>
  );
}

function DaXem({ l }: { l: SxKcsLanKiemLoi }) {
  return l.da_xem_luc
    ? <span className="lds-mu" title={l.nguoi_xem ?? undefined}>Đã xem {ngayGio(l.da_xem_luc)}</span>
    : <span className="lds-cam">Chưa xem</span>;
}

// ---- Ô sơ đồ ---------------------------------------------------------------------------------
function NutCongDoan({
  cd, tt, loi, tieuChi, cuoiGop, chon, onChon, gan,
}: {
  cd: SxKcsCongDoan;
  tt: TrangThaiNut;
  loi: [string, number][];
  tieuChi: number;
  /** Bước cuối: số tiêu chí gộp cả nhóm. */
  cuoiGop: number | null;
  chon: boolean;
  onChon: () => void;
  gan: (el: HTMLButtonElement | null) => void;
}) {
  const nhanCd = useNhanChang();
  const tc = cuoiGop != null
    ? <span className="kcsb-tc"><Icon name="listChecks" size={11} />{cuoiGop} tiêu chí gộp</span>
    : tieuChi > 0
      ? <span className="kcsb-tc" title={`${tieuChi} tiêu chí bước cuối xét cho công đoạn này`}><Icon name="listChecks" size={11} />{tieuChi}</span>
      : <span className="kcsb-tc lds-mu3" title="Lệnh này không giữ tiêu chí nào cho công đoạn này. Danh mục đổi sau lúc phát hành thì lấy bộ mới bằng Cập nhật tiêu chí ở hồ sơ lệnh.">lệnh chưa có tiêu chí</span>;
  const cho = cd.la_kcs_cuoi ? choKiemCua(cd) : 0;
  const coDong2 = loi.length > 0 || cd.la_kcs_cuoi;
  return (
    <button ref={gan} type="button" className={`kcsb-nut${chon ? " is-chon" : ""}`} aria-pressed={chon}
      onClick={onChon} title={`${tenCd(cd)}${cd.gia_cong_ngoai ? `, thuê ngoài${cd.nha_gia_cong ? ` ${cd.nha_gia_cong}` : ""}` : cd.to_ten ? `, ${cd.to_ten}` : ""}`}>
      <span className="kcsb-nut__h">
        <IconNut tt={tt} />
        <span className="kcsb-nut__ten">{tenCd(cd)}</span>
        {cd.la_kcs_cuoi && <span className="lds-tag kcsb-tag">Cuối</span>}
      </span>
      <span className="kcsb-nut__p">
        <span>{num(cd.tot)} {nhanCd(cd.don_vi)}</span>
        {loi.length > 0
          ? <span className="lds-do">lỗi <SoLoi ds={loi} /></span>
          : cd.la_kcs_cuoi ? <span className="lds-la">đạt {num(cd.tong_dat)}</span>
            : cd.gia_cong_ngoai ? <span className="lds-tag kcsb-tag">Thuê ngoài</span> : tc}
      </span>
      {coDong2 && (
        <span className="kcsb-nut__p">
          {tc}
          {cho > 0 && <span className="lds-cam">chờ kiểm {num(cho)}</span>}
        </span>
      )}
    </button>
  );
}

// ---- Bảng chi tiết: bước cuối --------------------------------------------------------------
// 11/10/2026: mỗi lần kiểm chỉ kê LỖI (không tick là đạt nên không kê lại công đoạn đạt); tab "Tiêu chí
// gộp" đổi thành "Lỗi theo công đoạn" — chỉ công đoạn và tiêu chí đã từng hỏng, số lỗi cộng dồn.

/** Lệnh của công việc, để gắn nhãn lệnh khi lỗi thuộc lệnh khác lệnh của bước cuối. */
type LenhCua = Map<number, SxKcsLanNhom>;

function TenCdLoi({ cvId, ten, lenhCua, lenhCuoi }: { cvId: number | null; ten: string; lenhCua: LenhCua; lenhCuoi: number }) {
  const lan = cvId != null ? lenhCua.get(cvId) : undefined;
  return (
    <span className="kcsb-hang">
      <span>{ten}</span>
      {lan && lan.lsx.id !== lenhCuoi && <span className="lds-tag kcsb-tag" title={lan.lsx.ma}>{lan.lsx.ten || lan.lsx.ma}</span>}
    </span>
  );
}

function BangLanKiem({ cuoi, lenhCua, lenhCuoi, onXem }: {
  cuoi: SxKcsCongDoan; lenhCua: LenhCua; lenhCuoi: number; onXem: (t: TepXem) => void;
}) {
  const nhanCd = useNhanChang();
  if (cuoi.lan_kiem.length === 0) return <p className="kcsb-trong">Chưa kiểm lần nào.</p>;
  const dv = nhanCd(cuoi.don_vi);
  return (
    <div className="lds-cuon">
      <table className="lds-g kcsb-lk" style={{ minWidth: 860 }}>
        <colgroup>
          <col style={{ width: 128 }} /><col style={{ width: 100 }} /><col style={{ width: 64 }} />
          <col style={{ width: 96 }} /><col style={{ width: 160 }} /><col /><col style={{ width: 172 }} />
        </colgroup>
        <thead>
          <tr>
            <th>Lúc kiểm</th><th>Người kiểm</th><th className="n">Đạt</th><th className="n">Lỗi</th>
            <th>Công đoạn gây lỗi</th><th>Lỗi gì</th><th>Tổ đã xem</th>
          </tr>
        </thead>
        <tbody>
          {cuoi.lan_kiem.flatMap((lk) => {
            const dau = (i: number) => (i === 0 ? (
              <>
                <td>{ngayGio(lk.luc)}</td>
                <td title={lk.nguoi_kiem ?? undefined}>{lk.nguoi_kiem ?? ""}</td>
                <td className="n lds-la">{num(lk.so_dat)}</td>
              </>
            ) : <><td /><td /><td /></>);
            const loi = lk.loi.filter((l) => l.so_luong > 0);
            if (loi.length === 0) {
              return [
                <tr key={`d${lk.id}`} className="kcsb-lk__dau">
                  {dau(0)}
                  <td className="n lds-mu3">0</td>
                  <td colSpan={3} className="lds-la">Tất cả đạt</td>
                </tr>,
              ];
            }
            // Dòng cũ (trước 11/10) không ghi tên tiêu chí vào mô tả ⇒ lấy tên tiêu chí hỏng của công đoạn.
            const nhom = ketQuaTheoCongDoan(lk, cuoi.checklist);
            return loi.map((l, i) => {
              const cv = l.cong_doan_id ?? lk.cong_viec_id ?? null;
              const moTa = l.mo_ta || nhom.find((g) => g.cvId === cv)?.hong.map((h) => h.ten).join("; ") || "";
              return (
                <tr key={`l${l.id}`} className={i === 0 ? "kcsb-lk__dau" : undefined}>
                  {dau(i)}
                  <td className="n lds-do">{num(l.so_luong)} {l.don_vi ? nhanCd(l.don_vi) : dv}</td>
                  <td className="kcsb-boc">
                    <TenCdLoi cvId={cv} ten={l.cong_doan_ten ?? lk.cong_doan_ten ?? ""} lenhCua={lenhCua} lenhCuoi={lenhCuoi} />
                  </td>
                  <td className="kcsb-boc">
                    <span className="kcsb-hang"><span>{moTa}</span><span><AnhLoi anh={l.anh} onXem={onXem} /></span></span>
                  </td>
                  <td><DaXem l={l} /></td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    </div>
  );
}

interface LoiTc { ten: string; so: number; lan: number }
interface LoiCd { cvId: number | null; ten: string; to: string | null; tc: LoiTc[] }

/** Cộng dồn lỗi của mọi lần kiểm bước cuối theo công đoạn GÂY → tiêu chí. Số của tiêu chí lấy từ
 *  `so_luong` trong kết quả tick (có từ 11/10/2026); phần lỗi của công đoạn không thuộc tiêu chí nào
 *  là "Lỗi khác". Lần kiểm cũ không có số theo tiêu chí ⇒ dồn cả vào dòng tiêu chí hỏng đầu tiên. */
export function loiTheoCongDoan(cuoi: SxKcsCongDoan): LoiCd[] {
  const cvCua = (id: number | null | undefined, lk: SxKcsLanKiem) => id ?? lk.cong_viec_id ?? null;
  const thuTuCv = new Map<number | null, number>();
  const tenTc = new Map<string, string>();
  cuoi.checklist.forEach((t, i) => {
    const cv = t.cong_viec_id ?? cuoi.cong_viec_id;
    if (!thuTuCv.has(cv)) thuTuCv.set(cv, i);
    tenTc.set(`${cv}:${t.thu_tu}`, tenTieuChi(t));
  });
  const theo = new Map<number | null, LoiCd & { tcMap: Map<string, LoiTc> }>();
  const lay = (cv: number | null, ten: string, to: string | null) => {
    let g = theo.get(cv);
    if (!g) { g = { cvId: cv, ten, to, tc: [], tcMap: new Map() }; theo.set(cv, g); }
    if (!g.to && to) g.to = to;
    return g;
  };
  const cong = (g: { tcMap: Map<string, LoiTc> }, khoa: string, ten: string, so: number) => {
    const r = g.tcMap.get(khoa) ?? { ten, so: 0, lan: 0 };
    r.so += so;
    r.lan += 1;
    g.tcMap.set(khoa, r);
  };
  for (const lk of cuoi.lan_kiem) {
    const tongCv = new Map<number | null, { ten: string; to: string | null; so: number }>();
    for (const l of lk.loi) {
      if (!(l.so_luong > 0)) continue;
      const cv = cvCua(l.cong_doan_id, lk);
      const t = tongCv.get(cv) ?? { ten: l.cong_doan_ten ?? lk.cong_doan_ten ?? "", to: l.to_chiu_ten ?? null, so: 0 };
      t.so += l.so_luong;
      tongCv.set(cv, t);
    }
    const hongCv = new Map<number | null, { khoa: string; ten: string; so: number | null }[]>();
    for (const c of lk.checklist) {
      if (c.dat) continue;
      const cv = cvCua(c.cong_viec_id, lk);
      const ds = hongCv.get(cv) ?? [];
      ds.push({ khoa: `${cv}:${c.thu_tu}`, ten: tenTc.get(`${cv}:${c.thu_tu}`) ?? `Tiêu chí #${c.thu_tu}`, so: c.so_luong ?? null });
      hongCv.set(cv, ds);
    }
    for (const [cv, t] of tongCv) {
      const g = lay(cv, t.ten, t.to);
      const hong = hongCv.get(cv) ?? [];
      const coSo = hong.length > 0 && hong.every((h) => h.so != null);
      let conLai = t.so;
      hong.forEach((h, i) => {
        const so = coSo ? Math.min(h.so ?? 0, conLai) : i === 0 ? t.so : 0;
        conLai -= so;
        cong(g, h.khoa, h.ten, so);
      });
      if (hong.length === 0 || (coSo && conLai > 1e-9)) cong(g, "khac", "Lỗi khác", hong.length === 0 ? t.so : conLai);
    }
  }
  return [...theo.values()]
    .sort((a, b) => (thuTuCv.get(a.cvId) ?? 1e9) - (thuTuCv.get(b.cvId) ?? 1e9))
    .map(({ tcMap, ...g }) => ({
      ...g,
      // "Lỗi khác" xuống cuối nhóm.
      tc: [...tcMap.entries()].sort(([a], [b]) => Number(a === "khac") - Number(b === "khac")).map(([, r]) => r),
    }));
}

function BangLoiTheoCd({ cuoi, lenhCua, lenhCuoi }: { cuoi: SxKcsCongDoan; lenhCua: LenhCua; lenhCuoi: number }) {
  const nhanCd = useNhanChang();
  const ds = loiTheoCongDoan(cuoi);
  if (ds.length === 0) {
    return <p className="kcsb-trong">{cuoi.lan_kiem.length === 0 ? "Chưa kiểm lần nào." : "Chưa có lỗi nào."}</p>;
  }
  const dv = nhanCd(cuoi.don_vi);
  return (
    <div className="lds-cuon">
      <table className="lds-g kcsb-lk" style={{ minWidth: 700 }}>
        <colgroup><col style={{ width: 230 }} /><col style={{ width: 170 }} /><col /><col style={{ width: 120 }} /><col style={{ width: 90 }} /></colgroup>
        <thead><tr><th>Công đoạn gây lỗi</th><th>Tổ</th><th>Lỗi gì</th><th className="n">Số lỗi</th><th className="n">Số lần</th></tr></thead>
        <tbody>
          {ds.flatMap((g) => g.tc.map((r, i) => (
            <tr key={`${g.cvId}:${r.ten}`} className={i === 0 ? "kcsb-lk__dau" : undefined}>
              <td className="kcsb-boc">{i === 0 && <TenCdLoi cvId={g.cvId} ten={g.ten} lenhCua={lenhCua} lenhCuoi={lenhCuoi} />}</td>
              <td className="lds-mu">{i === 0 ? g.to ?? "" : ""}</td>
              <td className="kcsb-boc">{r.ten}</td>
              <td className="n lds-do">{r.so > 0 ? `${num(r.so)} ${dv}` : ""}</td>
              <td className="n">{num(r.lan)}</td>
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}

function BangNhapKho({ cd, onMoYeuCauKho }: { cd: SxKcsCongDoan; onMoYeuCauKho?: (id: number) => void }) {
  if (cd.yeu_cau_kho.length === 0) return <p className="kcsb-trong">Chưa gửi yêu cầu nhập kho nào.</p>;
  return (
    <div className="lds-cuon">
      <table className="lds-g" style={{ minWidth: 720 }}>
        <colgroup><col style={{ width: 140 }} /><col style={{ width: 140 }} /><col style={{ width: 130 }} /><col style={{ width: 130 }} /><col /></colgroup>
        <thead><tr><th>Yêu cầu</th><th>Gửi lúc</th><th className="n">Đề nghị</th><th className="n">Kho đã nhận</th><th>Trạng thái</th></tr></thead>
        <tbody>
          {cd.yeu_cau_kho.map((y) => {
            const tt = KCS_YC_KHO_TRANG_THAI[y.trang_thai];
            return (
              <tr key={y.request_id}>
                <td>
                  {onMoYeuCauKho
                    ? <button type="button" className="lds-lk" title="Mở yêu cầu này ở màn Kho" onClick={() => onMoYeuCauKho(y.request_id)}>{y.ma}</button>
                    : y.ma}
                </td>
                <td>{ngayGio(y.tao_luc)}</td>
                <td className="n">{num(y.sl_de_nghi)} {nhanDonVi(y.don_vi)}</td>
                <td className={`n ${y.sl_da_nhan > 0 ? "" : "lds-mu3"}`}>{num(y.sl_da_nhan)}</td>
                <td><ChipTT mau={MAU_YC_KHO[y.trang_thai] ?? "slate"}>{tt?.nhan ?? y.trang_thai}</ChipTT></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- Màn -------------------------------------------------------------------------------------
export function KcsSoDoNhom({
  lsxId, eventTick, dinhKemDem, onBack, onChanged, onMoYeuCauKho, navigate,
}: {
  lsxId: number;
  eventTick?: number;
  /** Bộ đếm sự kiện tệp lệnh đổi (AppShell) — đổi là nạp lại danh sách "Tệp của lệnh". */
  dinhKemDem?: Record<number, number>;
  onBack: () => void;
  /** Vừa ghi gì đó (lần kiểm, yêu cầu kho, đóng nhóm) — trang cha làm mới danh sách + báo cáo. */
  onChanged: () => void;
  /** Mở một yêu cầu nhập kho ở màn Kho. Không truyền (thiếu quyền xem kho) ⇒ mã chỉ là chữ. */
  onMoYeuCauKho?: (requestId: number) => void;
  navigate?: NavigateFn;
}) {
  const { token } = useAuth();
  const can = useCan();
  // Ô Thao tác của dòng KCS: Kiểm hàng, Ghi lỗi, Gửi nhập kho, Đóng lệnh (máy chủ vẫn gác lại).
  const thaoTac = can("kcs", "create");
  const moTieuChi = navigate && can("dm_kcs_tieu_chi", "read") ? () => navigate("kcs-tieu-chi") : undefined;
  useNapTenDonVi();
  const [data, setData] = useState<SxKcsSoDoNhom | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [chon, setChon] = useState<Chon | null>(null);
  // Điện thoại: sơ đồ xếp dọc nên bảng chi tiết nằm dưới mép màn — chạm một bước thì cuộn tới bảng,
  // không thì chạm xong không thấy gì đổi. Chỉ khi NGƯỜI chạm (lần tự chọn bước lúc mở màn thì không).
  const pnRef = useRef<HTMLDivElement>(null);
  const vuaCham = useRef(false);
  const chamChon = (c: Chon) => {
    vuaCham.current = true;
    setChon(c);
  };
  useEffect(() => {
    if (!vuaCham.current) return;
    vuaCham.current = false;
    if (laDienThoai()) pnRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [chon]);
  const [tab, setTab] = useState<"lan" | "tc" | "kho">("lan");
  const [tabGiua, setTabGiua] = useState<"tc" | "qc" | "loi">("tc");
  const [moTep, setMoTep] = useState(false);
  const tep = useTepNhomKcs(lsxId, dinhKemDem);
  const tepRef = useRef<HTMLDivElement>(null);
  // Hộp tệp đóng khi bấm ra ngoài hoặc Esc (Esc của xem trước tệp đã chặn trước ở pha capture).
  useEffect(() => {
    if (!moTep) return;
    const bam = (e: MouseEvent) => {
      if (tepRef.current && !tepRef.current.contains(e.target as Node) && !(e.target as Element).closest?.(".dkt-xem")) setMoTep(false);
    };
    const phim = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) setMoTep(false); };
    document.addEventListener("mousedown", bam);
    document.addEventListener("keydown", phim);
    return () => { document.removeEventListener("mousedown", bam); document.removeEventListener("keydown", phim); };
  }, [moTep]);
  const [kiem, setKiem] = useState<CdNhom | null>(null);
  const [nhapKho, setNhapKho] = useState<CdNhom | null>(null);
  const [nhapKhoBusy, setNhapKhoBusy] = useState(false);
  const [nhapKhoLoi, setNhapKhoLoi] = useState<string | null>(null);
  const [thongBao, setThongBao] = useState<string | null>(null);
  const [xem, setXem] = useState<TepXem | null>(null);

  const tai = useCallback(() => {
    if (!token) return;
    api.sanXuat.kcsSoDoNhom(token, lsxId)
      .then((r) => { setData(r); setLoi(null); })
      .catch((e) => setLoi(e instanceof ApiError ? e.message : "Không tải được sơ đồ nhóm."));
  }, [token, lsxId]);
  useEffect(() => { tai(); }, [tai, eventTick]);

  const lanes = data?.lenh ?? [];
  const chinh = lanes.find((l) => !l.la_lenh_phu) ?? lanes[lanes.length - 1] ?? null;
  const dvt = chinh?.lsx.don_vi_tinh ?? null;
  const nhanCd = (dv: string | null | undefined) => nhanChangLenh(dv, dvt);
  const cuoi = chinh?.cong_doan.find((c) => c.la_kcs_cuoi) ?? null;
  const tatCa: CdNhom[] = lanes.flatMap((lan) => lan.cong_doan.map((cd) => ({ cd, lan })));
  const lanKiem = tatCa.flatMap((x) => x.cd.lan_kiem);
  const lenhCua: LenhCua = new Map(tatCa.map((x) => [x.cd.cong_viec_id, x.lan]));

  // Mở sơ đồ: chọn sẵn bước cuối (nơi KCS làm việc), không có thì công đoạn đầu của lệnh vừa bấm.
  useEffect(() => {
    if (data == null || chon != null) return;
    const lanBam = data.lenh.find((l) => l.lsx.id === lsxId);
    const dau = cuoi?.cong_viec_id ?? lanBam?.cong_doan[0]?.cong_viec_id ?? null;
    if (dau != null) setChon(dau);
  }, [data, chon, cuoi, lsxId]);

  // ---- Đường nối lệnh phụ → công đoạn ghép của lệnh chính (đo sau khi vẽ) ----
  const soDoRef = useRef<HTMLDivElement>(null);
  const nutRef = useRef(new Map<number, HTMLButtonElement>());
  const [duong, setDuong] = useState<{ d: string; w: number; h: number }[]>([]);
  const ganNut = (id: number) => (el: HTMLButtonElement | null) => {
    if (el) nutRef.current.set(id, el); else nutRef.current.delete(id);
  };
  useLayoutEffect(() => {
    const ve = () => {
      const box = soDoRef.current;
      if (!box) return;
      const o = box.getBoundingClientRect();
      const out: { d: string; w: number; h: number }[] = [];
      for (const lan of lanes) {
        const cuoiLan = lan.cong_doan[lan.cong_doan.length - 1];
        if (!lan.la_lenh_phu || lan.noi_vao_cong_viec_id == null || !cuoiLan) continue;
        const a = nutRef.current.get(cuoiLan.cong_viec_id)?.getBoundingClientRect();
        const b = nutRef.current.get(lan.noi_vao_cong_viec_id)?.getBoundingClientRect();
        if (!a || !b) continue;
        const x1 = a.left - o.left + box.scrollLeft + a.width / 2;
        const y1 = a.bottom - o.top + box.scrollTop;
        const x2 = b.left - o.left + box.scrollLeft + b.width / 2;
        const y2 = b.top - o.top + box.scrollTop - 2;
        const ym = y2 - 10;
        out.push({
          d: Math.abs(x1 - x2) < 2 ? `M${x1} ${y1} V${y2}` : `M${x1} ${y1} V${ym} H${x2} V${y2}`,
          w: box.scrollWidth, h: box.scrollHeight,
        });
      }
      setDuong(out);
    };
    ve();
    window.addEventListener("resize", ve);
    return () => window.removeEventListener("resize", ve);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  async function taoNhapKho() {
    if (!token || !nhapKho || nhapKhoBusy) return;
    setNhapKhoBusy(true);
    setNhapKhoLoi(null);
    try {
      const r = await api.sanXuat.taoYeuCauNhapKhoCongDoan(token, nhapKho.cd.cong_viec_id);
      setThongBao(`Đã tạo yêu cầu nhập kho ${r.ma}: ${num(r.so_luong)} ${nhanCd(nhapKho.cd.don_vi)}, chờ kho nhận.`);
      setNhapKho(null);
      tai();
      onChanged();
    } catch (e) {
      setNhapKhoLoi(e instanceof ApiError ? e.message : "Không tạo được yêu cầu nhập kho.");
    } finally {
      setNhapKhoBusy(false);
    }
  }

  const nhom = data?.nhom ?? null;
  const daDong = nhom?.trang_thai === "closed";
  const sel = typeof chon === "number" ? tatCa.find((x) => x.cd.cong_viec_id === chon) ?? null : null;
  const nutGuiKho = (x: CdNhom) => thaoTac && x.cd.con_gui_kho > 0 && !daDong && (
    <button type="button" className="btn btn--sm btn--ghost" onClick={() => { setNhapKhoLoi(null); setNhapKho(x); }}>
      <Icon name="warehouse" size={13} /> Gửi nhập kho {num(x.cd.con_gui_kho)} {nhanCd(x.cd.don_vi)}
    </button>
  );

  function panelCuoi(x: CdNhom) {
    const cd = x.cd;
    const dv = nhanCd(cd.don_vi);
    const cho = choKiemCua(cd);
    const chip = CHIP_CONG_DOAN[cd.trang_thai];
    const lyDo = !kiemDuoc(cd.trang_thai) ? "Công đoạn chưa bắt đầu, chưa kiểm được."
      : cho <= 0 ? "Tổ chưa ghi thêm sản lượng từ lần kiểm trước, chưa có gì để kiểm." : null;
    return (
      <>
        <div className="kcsb-pn__dau">
          <h3>{tenCd(cd)}</h3>
          <span className="lds-tag">Bước cuối</span>
          <span className="lds-tag">{x.lan.lsx.ma}</span>
          {cd.to_ten && <span className="lds-mu">{cd.to_ten}</span>}
          {chip && <ChipTT mau={chip.mau}>{chip.nhan}</ChipTT>}
          <span className="kcsb-gian" />
          {/* Kho nói một lần ở đây: đã gửi bao nhiêu, phần đạt chưa gửi nằm trên nút (không có nút thì thành chữ). */}
          {cd.da_yeu_cau_kho > 0 && <span className="lds-mu">Đã gửi kho {num(cd.da_yeu_cau_kho)} {dv}</span>}
          {nutGuiKho(x) || (cd.con_gui_kho > 0 && <span className="lds-cam">Chưa gửi kho {num(cd.con_gui_kho)} {dv}</span>)}
          {thaoTac && !daDong && (
            <button type="button" className="btn btn--sm btn--accent" disabled={lyDo != null} title={lyDo ?? undefined}
              onClick={() => setKiem(x)}>
              <Icon name="shield" size={13} /> {cho > 0 ? `Kiểm hàng ${num(cho)} ${dv}` : "Kiểm hàng"}
            </button>
          )}
        </div>
        <div className="kcsb-dk">
          <span>{cd.gia_cong_ngoai ? "Nhà gia công trả về" : "Tổ đã làm"}<b>{num(cd.tot)} {dv}</b></span>
          <span>Đạt<b className={cd.tong_dat > 0 ? "lds-la" : undefined}>{num(cd.tong_dat)}</b></span>
          <span>Lỗi<b className={cd.tong_loi > 0 ? "lds-do" : undefined}>{num(cd.tong_loi)}</b></span>
          <span>Chưa kiểm<b className={cho > 0 ? "lds-cam" : undefined}>{num(cho)}</b></span>
        </div>
        <div className="kcsb-ptab" role="tablist">
          {([["lan", "Lần kiểm"], ["tc", "Lỗi theo công đoạn"], ["kho", "Nhập kho"]] as const).map(([k, nhan]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : undefined}
              onClick={() => setTab(k)}>{nhan}</button>
          ))}
        </div>
        <div className="kcsb-pn__than">
          {tab === "lan" ? <BangLanKiem cuoi={cd} lenhCua={lenhCua} lenhCuoi={x.lan.lsx.id} onXem={setXem} />
            : tab === "tc" ? <BangLoiTheoCd cuoi={cd} lenhCua={lenhCua} lenhCuoi={x.lan.lsx.id} />
              : <BangNhapKho cd={cd} onMoYeuCauKho={onMoYeuCauKho} />}
        </div>
      </>
    );
  }

  function panelGiua(x: CdNhom) {
    const cd = x.cd;
    const dv = nhanCd(cd.don_vi);
    const ds = loiTinhCho(lanKiem, cd.cong_viec_id);
    const tong = theoDonVi(ds);
    const chip = CHIP_CONG_DOAN[cd.trang_thai];
    const xetCuoi = new Map(tieuChiCua(cuoi, cd.cong_viec_id).map((r) => [r.t.thu_tu, r]));
    // Lỗi ghi NGAY ở công đoạn này: theo tiêu chí (kết quả tick), phần còn lại là "Lỗi khác".
    const taiCho = daGhiTheoTieuChi(cd);
    const loiTaiCho = cd.lan_kiem.reduce((s, lk) => s + lk.loi
      .filter((l) => (l.cong_doan_id ?? lk.cong_viec_id) === cd.cong_viec_id)
      .reduce((a, l) => a + l.so_luong, 0), 0);
    const loiKhac = Math.max(0, loiTaiCho - [...taiCho.values()].reduce((a, b) => a + b, 0));
    const dsTc = (cd.tieu_chi ?? []).map((t) => ({
      thu_tu: t.thu_tu, ten: t.ten || t.ma || `Tiêu chí ${t.thu_tu}`, o: taiCho.get(t.thu_tu) ?? 0, cuoi: xetCuoi.get(t.thu_tu),
    }));
    const batO = [...new Set(ds.map(({ lk }) => (lk.cong_viec_id === cd.cong_viec_id
      ? "ngay tại công đoạn này"
      : `${lk.cong_doan_ten ?? "bước sau"}${(() => {
        const ma = tatCa.find((y) => y.cd.cong_viec_id === lk.cong_viec_id)?.lan.lsx.ma;
        return ma && ma !== x.lan.lsx.ma ? ` của ${ma}` : "";
      })()}`)))];
    const batOSau = ds.some(({ lk }) => lk.cong_viec_id !== cd.cong_viec_id);
    const soO = (n: number) => (n > 0 ? `${num(n)} ${dv}` : "0");
    // Bước thuê ngoài (11/10/2026): KCS không kiểm tại chỗ (máy chủ chặn) ⇒ không nút Ghi lỗi, không
    // bảng tiêu chí của bước; lỗi KCS cuối quy về nó vẫn xem ở tab Lỗi đã ghi.
    const ngoai = !!cd.gia_cong_ngoai;
    const tabG = ngoai && tabGiua === "tc" ? "qc" : tabGiua;
    return (
      <>
        <div className="kcsb-pn__dau">
          <h3>{tenCd(cd)}</h3>
          <span className="lds-tag">{x.lan.lsx.ma}</span>
          {ngoai && <span className="lds-tag">Thuê ngoài</span>}
          {ngoai ? cd.nha_gia_cong && <span className="lds-mu">{cd.nha_gia_cong}</span>
            : cd.to_ten && <span className="lds-mu">{cd.to_ten}</span>}
          {chip && <ChipTT mau={chip.mau}>{chip.nhan}</ChipTT>}
          {thaoTac && !daDong && !ngoai && (
            <button type="button" className="btn btn--sm btn--ghost kcsb-ghi-loi" disabled={!kiemDuoc(cd.trang_thai)}
              title={kiemDuoc(cd.trang_thai) ? undefined : "Công đoạn chưa bắt đầu, chưa ghi lỗi được."}
              onClick={() => setKiem(x)}>
              <Icon name="alert" size={13} /> Ghi lỗi
            </button>
          )}
        </div>
        <div className="kcsb-dk">
          <span>{cd.gia_cong_ngoai ? "Nhà gia công trả về" : "Tổ đã làm"}<b>{num(cd.tot)} {dv}</b></span>
          <span>Lỗi do {cd.ten} gây<b className={tong.length ? "lds-do" : "lds-mu3"}>{tong.length ? <SoLoi ds={tong} /> : "chưa có"}</b></span>
          {batO.length > 0 && <span>Bắt ở<b>{batO.join("; ")}</b></span>}
        </div>
        <div className="kcsb-ptab" role="tablist">
          {([["tc", "Tiêu chí"], ["qc", "Quy cách"], ["loi", "Lỗi đã ghi"]] as const).filter(([k]) => !(ngoai && k === "tc")).map(([k, nhan]) => (
            <button key={k} type="button" role="tab" aria-selected={tabG === k} className={tabG === k ? "on" : undefined}
              onClick={() => setTabGiua(k)}>{nhan}</button>
          ))}
        </div>
        <div className="kcsb-pn__than">
          {tabG === "tc" ? (dsTc.length > 0 ? (
            <>
              <div className="lds-cuon kcsb-tcg">
                <table className="lds-g">
                  <colgroup><col /><col style={{ width: 130 }} /><col style={{ width: 140 }} /><col style={{ width: 150 }} /></colgroup>
                  <thead>
                    <tr><th>Tiêu chí</th><th className="n">Lỗi ghi ở đây</th><th className="n">Kiểm cuối đã xét</th><th className="n">Kiểm cuối thấy hỏng</th></tr>
                  </thead>
                  <tbody>
                    {dsTc.map((r) => (
                      <tr key={r.thu_tu}>
                        <td className={r.o > 0 || r.cuoi?.hong ? "lds-do" : undefined} title={r.ten}>{r.ten}</td>
                        <td className={`n ${r.o > 0 ? "lds-do" : "lds-mu3"}`}>{soO(r.o)}</td>
                        <td className="n">{r.cuoi ? `${num(r.cuoi.xet)} lần` : <span className="lds-mu3">chưa có</span>}</td>
                        <td className={`n ${r.cuoi?.hong ? "lds-do" : "lds-mu3"}`}>{r.cuoi ? `${num(r.cuoi.hong)} lần` : ""}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className="lds-mu">Lỗi khác</td>
                      <td className={`n ${loiKhac > 0 ? "lds-do" : "lds-mu3"}`}>{soO(loiKhac)}</td>
                      <td /><td />
                    </tr>
                  </tbody>
                </table>
              </div>
              {/* Ngăn hẹp: mỗi tiêu chí một khối, số xếp dưới tên (bảng bốn cột không vừa). */}
              <div className="kcsb-tcd">
                {dsTc.map((r) => (
                  <div key={r.thu_tu} className="kcsb-tcd__dong">
                    <span className={r.o > 0 || r.cuoi?.hong ? "lds-do" : undefined}>{r.ten}</span>
                    <span className="kcsb-tcd__so">
                      <span>Lỗi ghi ở đây<b className={r.o > 0 ? "lds-do" : undefined}>{soO(r.o)}</b></span>
                      {r.cuoi && <span>Kiểm cuối đã xét<b>{num(r.cuoi.xet)} lần</b></span>}
                      {r.cuoi && <span>Kiểm cuối thấy hỏng<b className={r.cuoi.hong ? "lds-do" : undefined}>{num(r.cuoi.hong)} lần</b></span>}
                    </span>
                  </div>
                ))}
                <div className="kcsb-tcd__dong">
                  <span className="lds-mu">Lỗi khác</span>
                  <span className="kcsb-tcd__so"><span>Lỗi ghi ở đây<b className={loiKhac > 0 ? "lds-do" : undefined}>{soO(loiKhac)}</b></span></span>
                </div>
              </div>
            </>
          ) : (
            <p className="kcsb-khoi__chu">
              Lệnh này không giữ tiêu chí nào cho {cd.ten}. Tiêu chí chép vào lệnh lúc phát hành: khai thêm ở Tiêu chí
              KCS thì lệnh đang chạy lấy bộ mới bằng nút Cập nhật tiêu chí ở hồ sơ lệnh. Lỗi của {cd.ten} vẫn ghi được
              ở dòng Lỗi khác khi bấm Ghi lỗi.
              {moTieuChi && <> <button type="button" className="lds-lk" onClick={moTieuChi}>Khai ở Tiêu chí KCS</button></>}
            </p>
          )) : tabG === "qc" ? (
            <div className="kcsb-qc"><KcsQuyCach qc={cd.quy_cach} danDo={cd.ghi_chu_ky_thuat} /></div>
          ) : ds.length > 0 ? (
            <div className="lds-cuon">
              <table className="lds-g" style={{ minWidth: 620 }}>
                <colgroup><col style={{ width: 120 }} /><col style={{ width: 104 }} /><col /><col style={{ width: 150 }} /></colgroup>
                <thead><tr><th>Lúc</th><th className="n">Số</th><th>Mô tả</th><th>Tổ đã xem</th></tr></thead>
                <tbody>
                  {ds.map(({ lk, l }) => (
                    <tr key={l.id}>
                      <td>{ngayGio(lk.luc)}</td>
                      <td className="n lds-do">{num(l.so_luong)} {nhanCd(l.don_vi)}</td>
                      <td className="kcsb-mota"><span title={l.mo_ta ?? undefined}>{l.mo_ta ?? ""}</span><AnhLoi anh={l.anh} onXem={setXem} /></td>
                      <td><DaXem l={l} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="kcsb-trong">Chưa có lỗi nào tính cho công đoạn này.</p>}
          {tabG === "loi" && batOSau && (
            <p className="kcsb-ghi">
              Số {dv} tổ đã làm không bị trừ: lỗi bắt ở bước sau đếm theo đơn vị nơi bắt và trừ vào số đạt của bước đó.
            </p>
          )}
        </div>
      </>
    );
  }

  function panelKho() {
    if (!cuoi || !chinh) return null;
    const x = { cd: cuoi, lan: chinh };
    const daNhan = cuoi.yeu_cau_kho.reduce((s, y) => s + y.sl_da_nhan, 0);
    const dvKho = cuoi.yeu_cau_kho[0]?.don_vi;
    return (
      <>
        <div className="kcsb-pn__dau">
          <h3>Nhập kho thành phẩm</h3>
          {nhom && <span className="lds-tag">Nhóm {nhom.ma}</span>}
          <span className="kcsb-gian" />
          {nutGuiKho(x)}
        </div>
        <div className="kcsb-dk">
          <span>Đã kiểm đạt<b className="lds-la">{num(cuoi.tong_dat)} {nhanCd(cuoi.don_vi)}</b></span>
          <span>Đã gửi kho<b>{num(cuoi.da_yeu_cau_kho)}</b></span>
          <span>Kho đã nhận<b>{num(daNhan)}{dvKho ? ` ${nhanDonVi(dvKho)}` : ""}</b></span>
          <span>Chưa gửi kho<b className={cuoi.con_gui_kho > 0 ? "lds-cam" : undefined}>{num(cuoi.con_gui_kho)}</b></span>
        </div>
        <div className="kcsb-pn__than"><BangNhapKho cd={cuoi} onMoYeuCauKho={onMoYeuCauKho} /></div>
      </>
    );
  }

  const ttNhom = nhom ? (nhom.trang_thai === "closed" ? { nhan: "Đã đóng", mau: "xam" as MauTT } : { nhan: "Đang sản xuất", mau: "xanh" as MauTT }) : null;
  const ttKho: TrangThaiNut = !cuoi ? "chua" : cuoi.con_gui_kho > 0 ? "chay" : cuoi.da_yeu_cau_kho > 0 ? "xong" : "chua";

  return (
    <DvtNhom.Provider value={dvt}>
    <section className="kcsb-sd" aria-label="Sơ đồ nhóm">
      <div className="kcsb-sd__dau">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onBack}>
          <Icon name="chevron" size={13} style={{ transform: "rotate(90deg)" }} /> Danh sách
        </button>
        <h2>{nhom ? `Nhóm ${nhom.ma}` : lanes[0]?.lsx.ma ?? ""}</h2>
        {ttNhom && <ChipTT mau={ttNhom.mau}>{ttNhom.nhan}</ChipTT>}
        {nhom?.khach && <span className="lds-tag">{nhom.khach}</span>}
        {nhom?.ten && <span className="lds-mu">{nhom.ten}</span>}
        <span className="kcsb-gian" />
        <div className="kcsb-tepo" ref={tepRef}>
          <button type="button" className="btn btn--ghost btn--sm" aria-expanded={moTep} onClick={() => setMoTep((v) => !v)}>
            <Icon name="paperclip" size={13} /> Tệp của lệnh{tep.nhom && <span className="kcsb-tepo__dem">{demTep(tep.nhom)}</span>}
          </button>
          {moTep && (
            <div className="kcsb-tepo__hop" role="dialog" aria-label="Tệp của lệnh">
              <div className="kcsb-tepo__h">
                <span>Tệp của lệnh</span>
                <span className="lds-mu3">chỉ xem</span>
                <span className="kcsb-gian" />
                <button type="button" className="kcsb-tepo__x" aria-label="Đóng" onClick={() => setMoTep(false)}>
                  <Icon name="x" size={14} />
                </button>
              </div>
              <div className="kcsb-tepo__than"><KcsTepLenh nhom={tep.nhom} loi={tep.loi} onXem={setXem} /></div>
            </div>
          )}
        </div>
        {nhom && <KcsDongLenh nhomId={nhom.id} canDong={thaoTac} eventTick={eventTick} onDone={() => { tai(); onChanged(); }} />}
      </div>

      {thongBao && (
        <div className="banner banner--success" role="status">
          <span>{thongBao}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setThongBao(null)}>Đóng</button>
        </div>
      )}
      {loi && (
        <div className="banner banner--error" role="alert">
          <span>{loi}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={tai}>Tải lại</button>
        </div>
      )}

      {data == null && !loi ? <EmptyState trangThai="dang-tai" inline /> : data != null && (
        <>
          <div className="kcsb-sodo" ref={soDoRef}>
            {lanes.map((lan) => (
              <div key={lan.lsx.id} className="kcsb-lan">
                <div className="kcsb-lan__ten">
                  <span>{lan.lsx.ma}</span>
                  <span className="kcsb-lan__phu" title={lan.lsx.ten}>{lan.lsx.ten}</span>
                  <span className="lds-mu3">{lan.la_lenh_phu ? "đi kèm" : "lệnh chính"}</span>
                </div>
                {lan.cong_doan.length === 0 && <span className="lds-mu">Lệnh chưa có công đoạn nào.</span>}
                {lan.cong_doan.map((cd, i) => {
                  const loiCd = theoDonVi(loiTinhCho(lanKiem, cd.cong_viec_id));
                  return (
                    <span key={cd.cong_viec_id} className="kcsb-lan__o">
                      {i > 0 && <span className="kcsb-noi" />}
                      <NutCongDoan cd={cd} tt={loiCd.length ? "loi" : nutTuTrangThai(cd.trang_thai)} loi={loiCd}
                        tieuChi={tieuChiCua(cuoi, cd.cong_viec_id).length}
                        cuoiGop={cd.la_kcs_cuoi ? cd.checklist.length : null}
                        chon={chon === cd.cong_viec_id} gan={ganNut(cd.cong_viec_id)}
                        onChon={() => { chamChon(cd.cong_viec_id); setTab("lan"); }} />
                    </span>
                  );
                })}
                {lan === chinh && cuoi && (
                  <span className="kcsb-lan__o">
                    <span className="kcsb-noi" />
                    <button type="button" className={`kcsb-nut kcsb-nut--kho${chon === "kho" ? " is-chon" : ""}`}
                      aria-pressed={chon === "kho"} onClick={() => chamChon("kho")}>
                      <span className="kcsb-nut__h"><IconNut tt={ttKho} /><span className="kcsb-nut__ten">Nhập kho</span></span>
                      <span className="kcsb-nut__p"><span>đã gửi {num(cuoi.da_yeu_cau_kho)}</span></span>
                      <span className="kcsb-nut__p">
                        <span className={cuoi.con_gui_kho > 0 ? "lds-cam" : "lds-mu3"}>chưa gửi {num(cuoi.con_gui_kho)}</span>
                      </span>
                    </button>
                  </span>
                )}
              </div>
            ))}
            {duong.length > 0 && (
              <svg className="kcsb-duong" width={duong[0].w} height={duong[0].h} aria-hidden="true">
                <defs>
                  <marker id="kcsb-mui" viewBox="0 0 8 8" refX="4" refY="7" markerWidth="8" markerHeight="8" orient="auto">
                    <path d="M0 0 L8 0 L4 8 z" />
                  </marker>
                </defs>
                {duong.map((p, i) => <path key={i} d={p.d} markerEnd="url(#kcsb-mui)" />)}
              </svg>
            )}
            <div className="kcsb-cg kcsb-cg--sodo">
              <span className="kcsb-cg__m"><IconNut tt="xong" />Xong</span>
              <span className="kcsb-cg__m"><IconNut tt="chay" />Đang làm</span>
              <span className="kcsb-cg__m"><IconNut tt="chua" />Chưa làm</span>
              <span className="kcsb-cg__m"><IconNut tt="loi" />Gây lỗi, bắt ở đâu cũng tính cho nó</span>
              <span className="kcsb-cg__m"><span className="kcsb-tc"><Icon name="listChecks" size={11} />4</span>Số tiêu chí bước cuối xét cho công đoạn</span>
            </div>
          </div>

          <div className="kcsb-pn" ref={pnRef}>
            {chon === "kho" ? panelKho() : sel ? (sel.cd.la_kcs_cuoi ? panelCuoi(sel) : panelGiua(sel)) : null}
          </div>
        </>
      )}

      {kiem && !kiem.cd.la_kcs_cuoi && (
        <KcsGhiLoiGiua lenh={kiem.lan.lsx} cd={kiem.cd} dinhKemDem={dinhKemDem} onClose={() => setKiem(null)}
          onSaved={(r) => {
            setKiem(null);
            setThongBao(`Đã ghi lỗi ${r.ten_cong_doan}: ${num(r.so_loi)} ${nhanCd(kiem.cd.don_vi)}, đã báo ${kiem.cd.to_ten || "tổ làm công đoạn"}.`);
            setTabGiua("loi");
            tai();
            onChanged();
          }} />
      )}
      {kiem && kiem.cd.la_kcs_cuoi && (
        <KcsKiemForm lenh={kiem.lan.lsx} cd={kiem.cd} dinhKemDem={dinhKemDem} onClose={() => setKiem(null)}
          onSaved={(r) => {
            const laCuoi = kiem.cd.la_kcs_cuoi;
            setKiem(null);
            const nguon = r.bao_loi_nguon ?? [];
            const soNguon = nguon.reduce((s, n) => s + n.so_loi, 0);
            const baoNguon = nguon.map((n) => `${n.ten_cong_doan} (${num(n.so_loi)})`).join(", ");
            setThongBao(
              (laCuoi
                ? `Đã ghi lần kiểm ${r.ten_cong_doan}: đạt ${num(r.so_dat)}, lỗi ${num(r.so_loi)}`
                : `Đã ghi lỗi ${r.ten_cong_doan}: ${num(r.so_loi)} ${nhanCd(kiem.cd.don_vi)}`)
              + (r.so_loi - soNguon > 1e-9 ? ", đã báo tổ làm công đoạn" : "")
              + (baoNguon ? `${r.so_loi - soNguon > 1e-9 ? ";" : ","} lỗi quy về ${baoNguon}, đã báo tổ đó` : "")
              + ".",
            );
            tai();
            onChanged();
          }} />
      )}

      <ConfirmDialog
        open={nhapKho != null}
        title="Gửi nhập kho"
        message={nhapKho
          ? loiHoiNhapKho(num(nhapKho.cd.con_gui_kho), nhanCd(nhapKho.cd.don_vi), nhapKho.lan.lsx.ma, nhapKho.cd.ten)
          : undefined}
        confirmLabel="Gửi yêu cầu"
        busy={nhapKhoBusy}
        error={nhapKhoLoi}
        onConfirm={taoNhapKho}
        onCancel={() => { if (!nhapKhoBusy) setNhapKho(null); }}
      />
      {xem && createPortal(<XemTruoc tep={xem} onDong={() => setXem(null)} />, document.body)}
    </section>
    </DvtNhom.Provider>
  );
}
