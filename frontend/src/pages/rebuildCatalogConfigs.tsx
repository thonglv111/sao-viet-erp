// Config 10 danh mục cho RebuildCatalogPage (xem REBUILD_CONFIGS cuối file). Field có `group` (section drawer),
// `showIf` (ẩn/hiện theo kiểu), `ref`/`ref-multi` (chọn theo TÊN thay vì gõ id),
// `default` (prefill khi tạo), `jsonKey` (lưu lồng vào fields_theo_loai).
// Enum hiển thị bằng thuật ngữ in ấn thuần Việt — dùng chung 1 bảng nhãn cho cả dropdown lẫn cột.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { CatalogConfig, ChuanBiKhoanRow } from "./RebuildCatalogPage";
import { tongChuanBi } from "./RebuildCatalogPage";
import { nhanDonViTocDo } from "./danh-muc/fields/DonViTocDo";
import { nhanTramDai, tenDonVi, tramOptions } from "./tenDonVi";
import { NHOM_CONG_DOAN, ngayGio } from "./keHoachSxShared";
import { QuyDoiCuaDonVi } from "./QuyDoiCuaDonVi";
import { KhoViTriPanel } from "./KhoViTriPanel";
import { DON_VI_KHOA } from "./danh-muc/ODonViNhieu";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Package } from "lucide-react";
import { ChipTT, TheDem, type MauTT } from "../components/LuoiDs";
import { CodeLink } from "../components/CodeLink";
import { useCan } from "../auth/permissions";
import { useAuth } from "../auth/useAuth";
import { useDieuHuongDanhMuc } from "./danh-muc/dieuHuong";
import { ApiError, anhNho, assetUrl, authed } from "../api/client";
import { crud, trangThaiMay, type Row, type TrangThaiMay } from "../api/rebuildCatalog";

// ── Bảng nhãn thuần Việt (in ấn) — 1 nguồn cho options + column render ──────────
type Lbls = Record<string, string>;
const mapOpt = (m: Lbls) => Object.entries(m).map(([value, label]) => ({ value, label }));
const lbl = (m: Lbls) => (v: unknown) => (v == null || v === "" ? "" : (m[String(v)] ?? String(v)));


// DỜI sang `keHoachSxShared.tsx` (02/09/2026) — màn "Hồ sơ lệnh sản xuất" cần đúng bốn nhãn này
// cho ô lọc Nhóm công đoạn, mà import ngược file này thì kéo cả bộ máy 13 màn danh mục theo.
// Bí danh cục bộ giữ nguyên để 3 chỗ dùng bên dưới không phải đổi.
const NHOM_CD: Lbls = NHOM_CONG_DOAN;

// Dụng cụ DÙNG CHUNG mà bước phải mượn từ kho khuôn — khớp `cong_doan.TOOLING_TYPE` ở backend
// (service chặn giá trị ngoài danh sách). "Bản kẽm" đã gỡ 16/08/2026: kẽm là vật tư tiêu hao,
// không có dòng nào trong kho khuôn để trỏ tới — xem lý do đầy đủ ở `models/cong_doan.TOOLING_TYPE`.
//
// 01/10/2026: CHỈ còn khuôn bế để CHỌN. Ép kim / khung lụa gỡ — dữ liệu cũ còn mang hai mã đó vẫn
// được hiện đúng nhãn (`TOOLING_TYPE_CU`) và lưu lại không vỡ, chỉ không gán mới được nữa.
const TOOLING_TYPE: Lbls = {
  khuon_be: "Khuôn bế",
};
const TOOLING_TYPE_CU: Lbls = {
  khuon_ep: "Khuôn ép kim",
  khung_lua: "Khung lụa",
};
const TOOLING_TYPE_NHAN: Lbls = { ...TOOLING_TYPE, ...TOOLING_TYPE_CU };

// Chặng `cai` (Thành phẩm) từng ẨN khỏi menu Đơn vị đầu vào/ra (03/10/2026), TRẢ LẠI 11/10/2026:
// thiếu nó thì sách không có chỗ khai "vào keo: tay sách → thành phẩm", cả chuỗi đếm tay tới cuối
// và bước cuối ra 4.000 tay thay vì 1.000 cuốn. Đây là CHẶNG của dòng giấy (tờ đã thành sản phẩm),
// KHÔNG phải đơn vị tính của sản phẩm (cuốn, hộp…) — menu ghi đúng chữ "Thành phẩm".

// 5 CHẶNG của dòng giấy — nhãn lấy từ `/api/don-vi/tram` (hằng `models/don_vi_do.TRAM_NHAN`),
// màn này KHÔNG giữ bản sao nữa. Bảng cứng `TRAM_DONG_GIAY` từng nằm đây GỠ 09/09/2026: nó là
// bảng nhãn THỨ HAI cho cùng 5 mã, nên một bước Đóng gói hiện "Con → Thành phẩm" ở màn này mà
// "20.000 con → 20.000 cái" ở phiếu tính giá — hai màn đọc hai bảng khác nhau. Nhãn nạp cùng
// chuyến với danh mục Đơn vị (`useNapTenDonVi`, gọi ở `danh-muc/CatalogListPage`), xem `tenDonVi.ts`.
//
// Tờ giấy đổi cách đếm đúng 5 lần, chảy MỘT CHIỀU:
//   tờ nguyên ──(số mảnh xả)──▶ tờ in ──(con/tờ)──▶ con ──▶ thành phẩm
//                                     └─(gấp)────▶ tay sách ──(bắt tay/vào keo)──▶ thành phẩm
// `con` KHÁC `thành phẩm`: sách gấp tay thì nhiều tờ mới gom thành MỘT cuốn. Hệ số các cầu này
// SUY ở `_he_so_cau` từ quy cách lệnh, không khai tay.
//
// Đây là menu ĐÓNG thật: engine chạy chuỗi bù hao theo đúng 5 mức này, thêm mức thứ 6 là phải khai
// cả hệ số cầu của nó trong code — nên nó KHÔNG mở ra danh mục Đơn vị & quy đổi (nơi có kg, ram,
// thùng… của kho và mua hàng). Trước 06/09/2026 hai ô đó là picker vào danh mục, còn "chặng nào"
// thì khai gián tiếp bằng cờ `don_vi_do.tram_dong_giay`; cờ ấy đã gỡ khỏi màn Đơn vị.

/** Cặp chặng "vào → ra" cho Ô DANH SÁCH: cắt phần trong ngoặc để lọt bề ngang cột (`Tờ nguyên
 *  (giấy mua về)` → `Tờ nguyên`), nhãn đủ nằm ở `title` khi rê chuột. Mã lạ (giá trị cũ còn sót)
 *  thì hiện NGUYÊN mã, đừng nuốt — nuốt là người ta tưởng bước không chạm giấy. */
const tramNgan = (v: unknown) => {
  const s = String(v ?? "").trim();
  if (!s) return "—";
  return (nhanTramDai(s) ?? s).replace(/\s*\(.*$/, "");
};
const tramVaoRa = (vao: unknown, ra: unknown) => {
  const co = (x: unknown) => x != null && x !== "";
  if (!co(vao) && !co(ra)) return "—";
  const day = [vao, ra].map((x) => (co(x) ? (nhanTramDai(String(x)) ?? String(x)) : "—")).join(" → ");
  return <span title={day}>{`${tramNgan(vao)} → ${tramNgan(ra)}`}</span>;
};

// Cách công đoạn góp bù hao. Bậc nằm TRÊN CHÍNH công đoạn (22/09/2026) — danh mục Bù hao riêng
// cùng mã `tra_bang` đã gỡ, migration `0327` đổi dữ liệu cũ sang `theo_bac`.
const KIEU_BU_HAO: Lbls = {
  khong: "Không bù hao",
  theo_bac: "Theo bậc số lượng",
  co_dinh: "Cộng cố định (số tờ)",
};


// GỠ 2026-08-08: `DV_GIA_GIAY` / `DV_GIA_VAT_TU` — hai danh sách đơn vị CỨNG. Đơn vị giờ chọn từ
// danh mục Đơn vị & quy đổi (`/api/don-vi`), là NGUỒN DUY NHẤT dùng chung cho Kho · NCC · khoán ·
// tính giá. Thêm đơn vị = khai ở màn Đơn vị, không phải sửa code rồi build lại.

/** Ô ĐVT của mặt hàng gốc: gõ để tìm trong danh mục Đơn vị, lưu MÃ (`kg`, `to`…) chứ không lưu id
 *  — quy đổi làm việc trên mã. Bỏ trống = chưa chọn (bảng hiện badge "Chưa chọn đơn vị").
 *  Đơn vị đã NGỪNG DÙNG bị `locConDung` (CatalogDrawer) gạt khỏi menu — lọc ở đây bằng
 *  `active: true` thì hàng cũ đang trỏ vào đơn vị vừa ngừng mở ra thấy TRỐNG, bấm Lưu là mất mã. */
const F_DON_VI = {
  type: "ref-search-ma" as const,
  refPrefix: "/api/don-vi",
  hint: "Gõ mã / tên đơn vị để tìm…",
};

/** Chưa chọn đơn vị là trạng thái THẬT (hàng cũ có mã lạ bị xoá trắng) — phải nhìn ra ngay ở bảng,
 *  vì thiếu nó thì kho không nhập được mặt hàng đó.
 *  Hiện TÊN (`don_vi_ten` server gán) chứ không hiện mã: `kem` không ai đoán ra "bản kẽm". */
const dvCell = (r: Row) => {
  const ma = r.don_vi_gia ? String(r.don_vi_gia) : "";
  if (!ma) return <span className="lds-cam">Chưa chọn đơn vị</span>;
  return r.don_vi_ten ? String(r.don_vi_ten) : ma;
};

/** Ô "Đơn vị thêm" của Giấy / Vật tư khác (spec 2026-10-10 mặt hàng nhiều ĐVT): mảng MÃ đơn vị khai
 *  cạnh ĐVT chính, mỗi đơn vị kéo theo cả nhóm quy đổi của nó. Đơn giá danh mục chỉ thuộc ĐVT chính —
 *  đơn vị thêm lấy giá ở bảng giá nhà cung cấp. Thành phẩm KHÔNG có ô này. */
const F_DON_VI_THEM = {
  key: "don_vi_them",
  label: "Đơn vị thêm",
  type: "don-vi-them" as const,
  refPrefix: "/api/don-vi",
  group: "Thông số",
};

/** Cột ĐVT của Giấy / Vật tư khác: ĐVT chính + mỗi đơn vị thêm một thẻ nhỏ (không nối bằng dấu). */
const dvCellNhieu = (r: Row) => {
  const them = Array.isArray(r.don_vi_them) ? (r.don_vi_them as unknown[]).map((x) => String(x)).filter(Boolean) : [];
  if (them.length === 0) return dvCell(r);
  return (
    <span className="dm-gop" title={[String(r.don_vi_ten ?? r.don_vi_gia ?? ""), ...them.map((m) => tenDonVi(m) ?? m)].join("\n")}>
      <span>{dvCell(r)}</span>
      {them.map((m) => <span key={m} className="lds-tag">{tenDonVi(m) ?? m}</span>)}
    </span>
  );
};


// ── Ô bảng phụ (05/10/2026: "thêm thông tin quan trọng vào bảng, nhìn trống trải quá") ─────────
/** `{id: tên}` của một danh mục nguồn, nạp qua `thamChieu` — mọi ô cùng nguồn trên trang dùng CHUNG
 *  một request (nhớ + gộp lúc đang bay), nên 20 dòng không đẻ 20 lượt gọi. Chưa về / không quyền
 *  đọc thì `null`: ô tự hiện số đếm thay vì bịa tên. */
function useBangDong(prefix: string): Map<number, Row> | null {
  const { token } = useAuth();
  const [rows, setRows] = useState<Row[] | undefined>(() => (token ? crud(prefix).daNho(token) : undefined));
  useEffect(() => {
    if (!token) return;
    let song = true;
    const { nho, moi } = crud(prefix).thamChieu(token);
    if (nho) setRows(nho);
    moi.then((r) => { if (song) setRows(r); }).catch(() => { /* mất cột phụ, không làm trắng bảng */ });
    return () => { song = false; };
  }, [token, prefix]);
  return useMemo(() => (rows ? new Map(rows.map((r) => [Number(r.id), r])) : null), [rows]);
}
function useBangTen(prefix: string): Map<number, string> | null {
  const bang = useBangDong(prefix);
  return useMemo(() => (bang ? new Map([...bang].map(([id, r]) => [id, String(r.ten)])) : null), [bang]);
}

/** Có / chưa có — chip hai sắc cho cột "đã khai X chưa" (CT tính giá, CT khoán của Công đoạn). */
const chipCo = (co: boolean, title?: string) =>
  co ? <ChipTT mau="la" title={title}>Có</ChipTT> : <ChipTT mau="xam">Chưa có</ChipTT>;
const coChu = (v: unknown) => typeof v === "string" && v.trim() !== "";

/** Cột Vật tư của Công đoạn: thẻ "N vật tư", rê chuột liệt kê tên + ĐVT từng món (tên tra danh mục
 *  Vật tư khác — cùng nguồn với ô chọn trong drawer). Chưa về danh mục thì vẫn đếm, tên tạm `#id`. */
function VatTuCongDoanO({ ds }: { ds: unknown }) {
  const bang = useBangDong("/api/vat-lieu-kho/vat-tu-in-an");
  const ids = Array.isArray(ds) ? ds.map((d) => Number((d as { vat_tu_id?: unknown }).vat_tu_id)).filter(Number.isFinite) : [];
  if (ids.length === 0) return <span className="lds-mu">Chưa có</span>;
  const dong = ids.map((id) => {
    const r = bang?.get(id);
    const dv = r ? String(r.don_vi_ten ?? r.don_vi_gia ?? "") : "";
    return { ten: r ? String(r.ten) : `#${id}`, phu: dv };
  });
  return <TheDem dong={dong} donVi="vật tư" tieuDe="Vật tư công đoạn tiêu thụ"
    icon={<Package size={13} strokeWidth={1.8} aria-hidden="true" />} />;
}

/** Hàng chip tên cho một mảng id (tổ phụ trách). Rỗng ⇒ ô trống. Chỉ bày `toiDa`
 *  chip đầu, phần còn lại gom thành "+n" (rê chuột đọc đủ) — một công đoạn 6 tổ mà bày hết thì
 *  dòng cao gấp năm lần dòng bên cạnh. */
function ChipTen({ prefix, ids, nhanDau, toiDa = 2 }: { prefix: string; ids: unknown; nhanDau?: string; toiDa?: number }) {
  const bang = useBangTen(prefix);
  const ds = Array.isArray(ids) ? ids.map(Number).filter((n) => Number.isFinite(n)) : [];
  if (ds.length === 0) return null;
  if (!bang) return <span className="lds-tag">{ds.length}</span>;
  const ten = ds.map((id, i) => {
    const t = bang.get(id) ?? `#${id}`;
    return i === 0 && nhanDau ? `${t} (${nhanDau})` : t;
  });
  const con = ten.length - toiDa;
  return (
    <span className="dm-gop" title={ten.join("\n")}>
      {ds.slice(0, toiDa).map((id) => <span key={id} className="lds-tag">{bang.get(id) ?? `#${id}`}</span>)}
      {con > 0 && <span className="lds-mu">+{con}</span>}
    </span>
  );
}

/** Các mẩu trong MỘT ô lưới, cùng một dòng, cách nhau bằng khoảng trống (không dấu nối) — dòng của
 *  lưới cao 34px nên không xếp dọc được. `title` = đủ chữ khi ô bị cắt "…". */
const doc = (dong: ReactNode[], title?: string) => {
  const co = dong.filter((d) => d !== null && d !== false && d !== "");
  if (co.length === 0) return "";
  return <span className="dm-gop" title={title}>{co}</span>;
};

/** Mức khoán km của xe — BẮT BUỘC từ 14/09/2026, nên thiếu phải lộ ra ở bảng. */
function MucKhoanXe({ id }: { id: unknown }) {
  const bang = useBangTen("/api/giao-hang/muc-khoan-km");
  if (id == null || id === "") return <span className="lds-cam">Chưa chọn mức</span>;
  const ten = bang?.get(Number(id));
  return <>{ten ?? `Mức #${id}`}</>;
}

// Form MỞ (phẳng): mọi ô luôn hiện, không phân loại cứng. Chủ xưởng tự đặt "Nhóm máy"
// (chữ tự do) rồi nhập khổ kẽm / nhíp / khổ giấy / vùng in / ghi chú.
// Nhãn đơn vị tốc độ DỜI sang `fields/DonViTocDo` (08/09/2026): bảng "Máy chạy được công đoạn này"
// của drawer Công đoạn nay cũng bày đơn vị của máy, hai bản sao là hai màn nói lệch nhau.

/** Màu chip trạng thái máy — mỗi trạng thái MỘT sắc, không hai trạng thái trùng màu. Cũng KHÔNG
 *  trùng sắc chấm của hàng lọc Đang dùng (lá) / Đã ngừng (xám) ở cùng màn: Rảnh = ngọc, Khoá = slate. */
const MAU_TT_MAY: Record<string, MauTT> = {
  may_dung: "do",
  bao_tri: "cam",
  co_phieu_sua: "vang",
  khoa: "slate",
  dang_chay: "xanh",
  ranh: "ngoc",
};

export const CFG_MAY: CatalogConfig = {
  title: "Thiết bị & Máy móc",
  moduleQuyen: "dm_thiet_bi",
  enableClone: true,
  enableImport: true,
  // Máy có cột `active` từ 15/08/2026 (mg `0202`) ⇒ vào được luật xoá chung: còn dùng ở lệnh /
  // công đoạn thì NGỪNG DÙNG, khai nhầm thì xoá hẳn. Trước đó màn này chỉ có xoá cứng.
  softDelete: true,
  prefix: "/api/may-thiet-bi",
  nhatKyLoai: "may_thiet_bi",
  // Bề rộng px của lưới (08/10/2026): khai đủ cho Mã/Tên (`widthMa`/`widthTen`) và mọi cột trừ cột
  // CUỐI (Ghi chú) — cột không khai ăn phần còn lại; chữ dài cắt "…", rê chuột xem đủ.
  widthMa: 100,
  widthTen: 200,
  columns: [
    { key: "loai_may", label: "Nhóm máy", w: 120, render: (r) => (r.loai_may ? String(r.loai_may) : "") },
    // Nhận diện tài sản — ba ô đã khai ở tab Thông tin chung, trước đây chỉ thấy khi mở thẻ máy.
    // Một dòng của lưới: hãng, model, rồi seri chữ nhỏ mờ; đủ chữ ở `title`.
    { key: "hang_san_xuat", label: "Hãng & model", w: 230,
      render: (r) => doc([
        r.hang_san_xuat ? <span key="h">{String(r.hang_san_xuat)}</span> : null,
        r.model ? <span key="m">{String(r.model)}</span> : null,
        r.so_seri ? <span key="s" className="lds-u">Seri {String(r.so_seri)}</span> : null,
      ], [r.hang_san_xuat, r.model, r.so_seri ? `Seri ${String(r.so_seri)}` : ""].filter(Boolean).join("\n")) },
    // Cột "Khổ máy & Vùng in" + "Chừa lề tờ in" ĐÃ ẨN (04/09/2026): mọi ô đổ ra hai cột này đã
    // rút khỏi form khai, để lại cột thì bảng chỉ còn bày số cũ mà không ai sửa được ở đâu nữa.
    { key: "toc_do", label: "Tốc độ & Chuẩn bị", w: 230,
      render: (r) => {
        const nSpeed = r.toc_do ? `${Number(r.toc_do).toLocaleString("vi-VN")} ${nhanDonViTocDo(r)}` : null;
        const box = (r.fields_theo_loai ?? {}) as Record<string, unknown>;
        const khoan = box.chuan_bi_khoan as ChuanBiKhoanRow[] | undefined;
        const tongKhoan = Array.isArray(khoan) && khoan.length > 0 ? tongChuanBi(khoan) : 0;
        const totalMakeready = tongKhoan > 0 ? tongKhoan : (Number(r.makeready_time_default) || 0);

        if (!nSpeed && !totalMakeready) return "";
        return doc([
          nSpeed ? <span key="t">{nSpeed}</span> : null,
          totalMakeready > 0 ? <span key="c" className="lds-u">Chuẩn bị {totalMakeready} phút</span> : null,
        ], [nSpeed, totalMakeready > 0 ? `Chuẩn bị ${totalMakeready} phút` : ""].filter(Boolean).join("\n"));
      }
    },
    // Trạng thái LÚC NÀY — dẫn xuất từ sự cố + vùng khoá + lệnh đang chạy (`loadExtra` bên dưới).
    // Cố ý KHÔNG đẻ lại cột `trang_thai` trên máy: cột đó từng có và bị gỡ 11/08/2026 vì là ô khai
    // tay không ai vào sửa, nên máy đang nằm vẫn hiện "đang hoạt động".
    { key: "trang_thai", label: "Trạng thái", w: 260,
      render: (_r, extra) => {
        // `undefined` = CHƯA BIẾT (đang nạp / nạp hỏng). Nói "Rảnh" lúc đó là bịa — cái máy đang
        // hỏng cũng sẽ hiện Rảnh cho tới khi API về.
        if (extra === undefined) {
          return <span className="lds-mu3" title="Đang lấy trạng thái máy…">—</span>;
        }
        const tt = extra as TrangThaiMay | null;
        const kieu = tt?.trang_thai ?? "ranh";
        // Chấm + CHỮ, không chỉ dựa màu — xưởng có người phân biệt màu kém, mà đây đúng là thứ họ
        // cần đọc nhanh nhất. Mỗi trạng thái một sắc (bộ `--tt-*`), không hai trạng thái trùng màu.
        // Fallback nhãn phải KHỚP `NHAN[TT_RANH]` bên backend (`services/may_trang_thai.py`): máy
        // rảnh không có mặt trong map nên nhãn của nó chỉ tồn tại ở đây.
        return (
          <>
            <ChipTT mau={MAU_TT_MAY[kieu] ?? "slate"} title={tt?.chi_tiet ?? undefined}>{tt?.nhan ?? "Xếp được"}</ChipTT>
            {tt?.chi_tiet && <span className="lds-u" title={tt.chi_tiet}>{tt.chi_tiet}</span>}
          </>
        );
      } },
  ],
  loadExtra: (token) => trangThaiMay(token),
  // Thanh lọc (06/10/2026): Nhóm máy — giá trị lấy thẳng từ DANH MỤC nhóm máy (`/api/nhom-may`),
  // đúng nguồn đổ chip trong drawer, nên nhóm vừa khai mà chưa có máy vẫn chọn được (số 0). Máy cũ
  // mang tên nhóm đã gỡ khỏi danh mục vẫn có lối lọc tới: máy chủ đếm được thì giá trị đó hiện thêm.
  man: "may-thiet-bi",
  dieuKien: [{ key: "loai_may", nhan: "Nhóm máy", icon: "nhom", nguon: "/api/nhom-may" }],
  // `nhanTabCongThuc` GỠ cùng ô "Cách đo lượng" (06/09/2026): màn Máy không còn ô công thức nào
  // nên tab công thức tự biến mất, giữ nhãn lại là nhãn của một tab không tồn tại.
  // Khai máy vẫn chia 3 tab theo việc: cuộn một mạch thì khối Lịch bảo trì nằm tít dưới đáy,
  // ai vào sửa chu kỳ cũng phải lướt hết phần vận hành.
  tabsKhai: [
    { id: "chung", label: "Thông tin chung", groups: ["Thông tin chung"] },
    { id: "ky-thuat", label: "Thông số kỹ thuật",
      groups: ["Tốc độ & Vận hành", "Ghi chú"] },
    { id: "bao-tri", label: "Lịch bảo trì", groups: ["Bảo trì định kỳ"] },
  ],
  fields: [
    // ── Nhóm máy (chữ gợi ý + tự do) ──────────────────────────────────────────
    // ── 1. Thông tin chung ──────────────────────────────────────────────────
    { key: "loai_may", label: "Nhóm máy", type: "nhom_may", required: true, group: "Thông tin chung",
      refPrefix: "/api/nhom-may" },
    // Nhận diện tài sản — cột đã có sẵn trong DB (chỉ chưa bày ra form).
    { key: "hang_san_xuat", label: "Hãng sản xuất", type: "text", group: "Thông tin chung" },
    { key: "model", label: "Model", type: "text", group: "Thông tin chung" },
    { key: "so_seri", label: "Số seri", type: "text", group: "Thông tin chung" },
    // Khổ kẽm · Vùng in max · Chừa lề tờ in · Khổ giấy min/max ĐÃ ẨN (04/09/2026): mấy số này chỉ
    // phục vụ bình bài THEO MÁY ở phiếu tính giá, mà ô "Máy in" của phiếu cũng vừa ẩn cùng đợt.
    // Cột DB + engine giữ nguyên (phiếu cũ đã gắn máy vẫn tính đúng), chỉ không bày ra form nữa.
    // ── 2. Tốc độ & Năng suất vận hành ───────────────────────────────────────
    { key: "toc_do", label: "Tốc độ trung bình", type: "number", group: "Tốc độ & Vận hành" },
    // Dải tốc độ BÀY LẠI (08/09/2026). Lần ẩn trước (04/09/2026) đi kèm lời "dải tốc độ chỉ để
    // khai, không nối vào công thức nào" — nay KHÔNG còn đúng: `lsxBuoc.ts`, `lsx_service` và
    // `xep_lich_service` đều đọc hai số này để ra khoảng nhanh–chậm ("Biên độ tốc độ máy" ở drawer
    // bước, râu Gantt). Ẩn ô mà engine vẫn đọc ⇒ người khai thấy một khoảng 130h–312h không biết
    // từ đâu ra và không có cửa nào sửa. Chưa khai thì cả ba mức bằng nhau, không vẽ khoảng.
    { key: "toc_do_min", label: "Tốc độ tối thiểu", type: "number", group: "Tốc độ & Vận hành" },
    { key: "toc_do_max", label: "Tốc độ tối đa", type: "number", group: "Tốc độ & Vận hành" },
    { key: "don_vi_toc_do", label: "Đơn vị tốc độ", type: "don_vi_toc_do",
      refPrefix: "/api/don-vi", refParams: { size: 200 },
      group: "Tốc độ & Vận hành", default: "to_gio" },
    // Ô "Cách đo lượng theo đơn vị tốc độ" ĐÃ GỠ (06/09/2026): cách đo nay khai theo CẶP (công
    // đoạn × máy) ở drawer Công đoạn — cùng một máy chạy hai công đoạn thì đo khác nhau.
    // Ô "Số người vận hành tiêu chuẩn" ĐÃ GỠ (06/09/2026, mg `0270`): kíp nay khai MỘT chỗ duy
    // nhất là định mức đầu việc của công đoạn, và mọi loại bước lệnh đều điền sẵn từ đó.
    // Ô "Ca làm việc của máy này" ĐÃ BỎ (2026-08-10): máy là thiết bị, bàn xếp lịch cho chạy
    // LIÊN TỤC (chỉ dừng vì ngày nghỉ/lễ + vùng khoá máy). Ca là chuyện của người và khai một chỗ
    // ở Nhân sự → Ca kíp; tăng ca thì cứ xếp việc vào giờ đó, khỏi sửa danh mục máy.
    // Ô "Thời gian rửa mực" ĐÃ BỎ (2026-08-04): vệ sinh/rửa mực gỡ khỏi hệ, engine xếp lịch
    // thôi cộng vào thời gian chiếm máy. Cột DB giữ dormant — đừng khai lại ô này.
    { key: "_chuan_bi_kieu", label: "Thời gian chuẩn bị", type: "select", group: "Tốc độ & Vận hành",
      default: "trong",
      options: [
        { value: "trong", label: "Để trống — chưa khai" },
        { value: "tong", label: "Điền tổng — gõ thẳng một số" },
        { value: "khoan", label: "Theo từng khoản — máy tự cộng" },
      ] },
    { key: "makeready_time_default", label: "Tổng thời gian chuẩn bị (phút)", type: "number",
      group: "Tốc độ & Vận hành",
      showIf: (f) => f._chuan_bi_kieu === "tong" },
    { key: "chuan_bi_khoan", label: "Các khoản chuẩn bị", type: "chuan_bi_khoan",
      group: "Tốc độ & Vận hành", jsonKey: "fields_theo_loai",
      showIf: (f) => f._chuan_bi_kieu === "khoan" },
    // ── 6. Bảo trì định kỳ (lưu lồng trong fields_theo_loai — KHÔNG cột mới, KHÔNG migration) ─
    { key: "lich_bao_tri", label: "Lịch bảo trì định kỳ", type: "lich_bao_tri",
      group: "Bảo trì định kỳ", jsonKey: "fields_theo_loai" },
    // ── 7. Ghi chú ───────────────────────────────────────────────────────────
    { key: "ghi_chu", label: "Ghi chú", type: "text", group: "Ghi chú" },
  ],
  // Đơn vị tốc độ là Ô CHỌN 2 giá trị, không suy từ `loai_may`: nhóm máy ở đây là CHỮ TỰ DO
  // ("Máy in", "Bế", "Cán màng / UV"…) nên suy theo nó là đoán, mà đoán sai thì lệnh SX lặng lẽ
  // bỏ qua tốc độ. Chỉ bày 2 lựa chọn đang dùng thật (tờ/giờ · kẽm/giờ), không đổ hết 5 đơn vị.
  // Kiểu chuẩn bị KHÔNG có cột riêng — SUY từ dữ liệu đã lưu. Thêm cột "kiểu" là đẻ trạng thái
  // thứ hai có thể đá nhau với chính dữ liệu (kiểu="khoản" mà danh sách rỗng thì tin ai?).
  deriveInitial: (existing) => {
    const box = (existing?.fields_theo_loai ?? {}) as Record<string, unknown>;
    const khoan = box.chuan_bi_khoan;
    const co_khoan = Array.isArray(khoan) && khoan.length > 0;
    const co_tong = existing?.makeready_time_default != null && existing.makeready_time_default !== "";
    return { _chuan_bi_kieu: co_khoan ? "khoan" : co_tong ? "tong" : "trong" };
  },
  transformSubmit: (body, form, existing) => {
    const out: Record<string, unknown> = {
      ...body,
      // Đơn vị đi theo BẤT KỲ ô tốc độ nào có số, không riêng ô trung bình: khai mỗi dải
      // nhanh–chậm mà đơn vị bị xoá thì lệnh SX coi như lệch đơn vị và bỏ qua tốc độ trong im lặng.
      don_vi_toc_do: (body.toc_do || body.toc_do_min || body.toc_do_max)
        ? (body.don_vi_toc_do || "to_gio") : null,
    };
    // Ô CHỈ ĐỂ UI, không có cột — gửi lên là 422.
    delete out._chuan_bi_kieu;

    // Đổi kiểu phải DỌN kiểu cũ. Form chỉ gửi field ĐANG HIỆN, mà backend gán từng phần
    // (`if k in data`) ⇒ không dọn thì số cũ nằm lại: chuyển "tổng 30" sang "để trống" vẫn còn 30,
    // và `deriveInitial` lần sau đọc được nó rồi lật ngược kiểu về "tổng".
    const kieu = form._chuan_bi_kieu;
    // ⚠️ Nền phải là JSON CŨ của bản ghi, không phải {}: ở kiểu "tổng"/"trống" thì ô các-khoản bị
    // ẩn nên `body.fields_theo_loai` không tồn tại — dựng lại từ số 0 là XOÁ SẠCH các khoá khác
    // của cột này (thông số riêng của máy web/digital/flexo… đều nằm trong đó).
    const box = {
      ...((existing?.fields_theo_loai as Record<string, unknown>) ?? {}),
      ...((out.fields_theo_loai as Record<string, unknown>) ?? {}),
    };
    if (kieu === "khoan") {
      const rows = (Array.isArray(box.chuan_bi_khoan) ? box.chuan_bi_khoan : []) as ChuanBiKhoanRow[];
      // Tổng do MÁY cộng — đây là số Xếp lịch đọc. Nguồn chân lý vẫn là một cột duy nhất.
      out.makeready_time_default = tongChuanBi(rows) || null;
    } else {
      box.chuan_bi_khoan = [];
      if (kieu === "trong") out.makeready_time_default = null;
    }
    out.fields_theo_loai = box;
    return out;
  },
};

export const CFG_CONG_DOAN: CatalogConfig = {
  title: "Công đoạn",
  moduleQuyen: "dm_cong_doan",
  enableClone: true,
  enableImport: true,
  prefix: "/api/cong-doan",
  nhatKyLoai: "cong_doan",
  // Xoá MỀM: nút "Xóa" hỏi server "còn ai dùng không" rồi tự chọn kết cục — chưa ai dùng thì
  // xoá hẳn, còn nơi dùng thì chỉ ngừng dùng. Mục đã ngừng xem lại ở công tắc trên dải lọc.
  softDelete: true,
  // Drawer chỉ còn MỘT ô công thức (`cong_thuc_gia`) — ô "Công thức sản lượng ra" GỠ 18/09/2026
  // (mg `0324`). Ô còn lại tự khai `nhanTab` nên KHÔNG cần nhãn tab gộp `nhanTabCongThuc`.
  // Thanh lọc (06/10/2026): Giai đoạn · Tổ phụ trách (tên tổ do máy chủ gắn) · Cần khuôn.
  man: "cong-doan",
  dieuKien: [
    { key: "nhom", nhan: "Giai đoạn", icon: "nhom", giaTri: mapOpt(NHOM_CD) },
    { key: "to_id", nhan: "Tổ phụ trách", icon: "nguoi" },
    { key: "can_khuon", nhan: "Cần khuôn", icon: "dung-cu",
      giaTri: [{ value: "true", label: "Có cần khuôn" }, { value: "false", label: "Không cần khuôn" }] },
  ],
  // Hai tab khai (18/09/2026): "Thông tin" gom mọi nhóm cũ, "Vật tư" là bảng vật tư + công thức
  // định mức của từng món (mg `0316`). Nhóm nào không liệt kê thì drawer tự dồn vào tab đầu.
  tabsKhai: [
    { id: "info", label: "Thông tin", groups: ["Thông tin"] },
    { id: "khoan", label: "Khoán", groups: ["Khoán"] },
    { id: "vat-tu", label: "Vật tư", groups: ["Vật tư"] },
  ],
  // Bề rộng px đo theo chữ dài nhất đang có: Giai đoạn "Gia công sau in" ~100 · Đơn vị "Tờ nguyên
  // → Thành phẩm" ~170 · Bù hao "Theo bậc — chưa khai" ~160 · Tên dài nhất "Cắt thành phẩm" ~110.
  // Ghi chú không khai ⇒ ăn phần còn lại; chữ dài cắt "…", rê chuột xem đủ.
  widthMa: 100,
  widthTen: 170,
  columns: [
    { key: "nhom", label: "Giai đoạn", w: 130, render: (r) => lbl(NHOM_CD)(r.nhom) },
    // Nhìn ra ngay bước nào ĐỔI CHẶNG, và bước nào để trống (không nằm trên dòng giấy).
    // Nhãn lấy từ `/api/don-vi/tram` — CÙNG nguồn mà ô chọn trong drawer dùng. Trước 08/09/2026 cột này đọc
    // `don_vi_vao_ten` server gán, mà server tra mã chặng vào danh mục Đơn vị & quy đổi: cùng một
    // bước hiện "con → cái" ở danh sách nhưng "Con (mảnh bế ra) → Thành phẩm" trong drawer.
    // Chưa khai thì hiện "—", đúng nghĩa "bước không chạm giấy", chứ không bịa tên.
    { key: "don_vi_vao", label: "Đơn vị", w: 190, render: (r) => tramVaoRa(r.don_vi_vao, r.don_vi_ra) },
    // Đọc ra NGAY mức khai, không phải chỉ tên chế độ: "Theo bậc" mà rỗng bậc là công đoạn khai
    // dở (migration mất mã nguồn để lại đúng trạng thái này) — phải lộ ở danh sách.
    { key: "kieu_bu_hao", label: "Bù hao", w: 170, render: (r) => {
        if (r.kieu_bu_hao === "co_dinh") return `Cố định ${r.so_to_bu_hao ?? 50} tờ`;
        if (r.kieu_bu_hao === "theo_bac") {
          const n = Array.isArray(r.bac_bu_hao) ? r.bac_bu_hao.length : 0;
          return n > 0 ? `Theo ${n} bậc` : "Theo bậc — chưa khai";
        }
        return lbl(KIEU_BU_HAO)(r.kieu_bu_hao ?? "khong");
      } },
    // Cột "Ràng buộc" (cần khuôn/dụng cụ) đã gỡ khỏi danh sách 05/10/2026 — gần như trống cả bảng;
    // vẫn khai trong thẻ công đoạn. Nhãn "Cần khuôn bế" nay nằm trong ô Máy & vật tư bên dưới.
    // Tổ đầu tiên là tổ MẶC ĐỊNH lúc lên lệnh (rê chuột thấy chữ "mặc định").
    { key: "department_ids", label: "Tổ phụ trách", w: 210,
      render: (r) => <ChipTen prefix="/api/cong-doan/phong-ban" ids={r.department_ids} nhanDau="mặc định" /> },
    // Đếm máy thôi, không kể tên: tên máy nằm trong thẻ công đoạn. Đủ để thấy bước nào CHƯA gán máy
    // (bài ghép không chặn được gán sai). Vật tư tách cột riêng (08/10/2026) — rê chuột xem từng món.
    { key: "may_lam_duoc", label: "Máy", w: 170, render: (r) => {
        const may = Array.isArray(r.may_lam_duoc) ? r.may_lam_duoc.length : 0;
        return doc([
          <span key="m" className={may ? undefined : "lds-mu"}>{may ? `${may} máy` : "Chưa gán máy"}</span>,
          r.requires_tooling ? <span key="k" className="lds-tag">Cần khuôn bế</span> : null,
        ]);
      } },
    { key: "vat_tus", label: "Vật tư", w: 120, render: (r) => <VatTuCongDoanO ds={r.vat_tus} /> },
    // Có / chưa có công thức (08/10/2026). Giá: công thức chung của công đoạn HOẶC công thức riêng ở
    // máy (ghi đè khi phiếu tính giá chọn đúng máy) — có một trong hai là tính được.
    { key: "ct_gia", label: "CT tính giá", w: 110, render: (r) => {
        const mays = Array.isArray(r.may_lam_duoc) ? (r.may_lam_duoc as { cong_thuc_gia?: unknown }[]) : [];
        const theoMay = mays.filter((m) => coChu(m.cong_thuc_gia)).length;
        const chung = coChu(r.cong_thuc_gia);
        const title = [chung ? "Có công thức chung" : "", theoMay ? `Công thức riêng ở ${theoMay}/${mays.length} máy` : ""]
          .filter(Boolean).join("\n");
        return chipCo(chung || theoMay > 0, title || undefined);
      } },
    { key: "ct_khoan", label: "CT khoán", w: 100, render: (r) =>
        chipCo(coChu((r.khoan as { cong_thuc_khoan?: unknown } | null | undefined)?.cong_thuc_khoan)) },
    { key: "ghi_chu", label: "Ghi chú", render: (r) => (r.ghi_chu ? String(r.ghi_chu) : "") },
  ],
  fields: [
    { key: "nhom", label: "Giai đoạn", type: "select", required: true, group: "Thông tin", options: mapOpt(NHOM_CD) },
    // NHIỀU tổ (18/09/2026, mg `0312`): "Cán màng mờ" do tổ Cán lẫn tổ Thành phẩm làm. Bước lệnh CHỌN
    // MỘT trong các tổ này; tổ bấm chọn ĐẦU TIÊN là tổ mặc định lúc lên lệnh.
    { key: "department_ids", label: "Phòng ban / Tổ phụ trách", type: "to-multi", refPrefix: "/api/cong-doan/phong-ban",
      group: "Thông tin", nhanDau: "mặc định",
      hint: "Chọn được nhiều tổ — lệnh sản xuất chọn một trong số này cho từng bước. Tổ chọn đầu tiên là tổ mặc định." },
    { key: "khoan", label: "", type: "khoan-cong-doan", refPrefix: "/api/don-vi", group: "Khoán" },

    // ── Nguồn nuôi thẳng thời lượng bước ở Lệnh sản xuất ──────────────────────────────────────
    { key: "requires_tooling", label: "Bước này cần khuôn", type: "checkbox",
      group: "Khuôn & dụng cụ",},
    { key: "tooling_type", label: "Loại khuôn", type: "select", group: "Khuôn & dụng cụ",
      options: mapOpt(TOOLING_TYPE), nhanCu: TOOLING_TYPE_CU, showIf: (f) => !!f.requires_tooling },
    // Bảng "Đầu việc và định mức của tổ" GỠ 18/09/2026 (mg `0320`) — công đoạn là CÔNG NGHỆ, việc
    // của tổ khai ở danh mục Công việc khoán. Vật tư (nền BOM) chuyển sang tab "Vật tư" bên dưới.
    { key: "vat_tus", label: "Vật tư công đoạn tiêu thụ", type: "vat-tu-cong-doan", group: "Vật tư" },
    // Chặn gán máy SAI LOẠI ở bài ghép (vd Ghi kẽm CTP không cho máy Bế). Lưu mảng TÊN nhóm máy.
    { key: "nhom_may_cho_phep", label: "Máy làm được công đoạn này", type: "nhom_may-multi",
      refPrefix: "/api/nhom-may", group: "Lệnh sản xuất" },
    // Máy CỤ THỂ + công thức của riêng từng cặp (06/09/2026). Hàng tick ngay trên chỉ còn là bộ
    // lọc cho bảng này; luật chặn gán máy ở bước đọc DANH SÁCH này khi công đoạn có khai.
    { key: "may_lam_duoc", label: "Máy chạy được công đoạn này", type: "may-cua-cong-doan",
      // `size` phải ≤ 200: khung danh mục chung chặn trần ở `catalog_base.py` (`le=200`). Xin 500
      // thì router trả 422 và ô chọn máy rỗng IM LẶNG — không báo lỗi gì cho người dùng thấy.
      // Máy ngừng dùng do `locConDung` gạt, KHÔNG lọc bằng `active: true`: lọc ở query thì máy
      // ngừng đang nằm sẵn trong bảng dưới mất tên, chỉ còn `#id`.
      refPrefix: "/api/may-thiet-bi", refParams: { size: 200 },
      group: "Lệnh sản xuất" },

    // CHỈ TÍNH THEO CÔNG THỨC: đã bỏ ô 'Cách tính giá' / 'Đơn giá' / 'Bậc kích thước'.
    // Đơn giá nhập per-phiếu (mỗi dòng phiếu tính giá tự mang don_gia); công đoạn chỉ khai CÔNG THỨC.
    //
    // `to_dau_vao`/`to_sau_in` không còn chip ở đây — từ 03/09/2026 hai biến bị ẩn ở MỌI ô công
    // thức (`AN_MOI_O` trong `fields/FormulaField.tsx`), không riêng công đoạn nữa.
    { key: "cong_thuc_gia", label: "Công thức tính giá", type: "formula", group: "Giá",
      nhanTab: "Công thức tính giá" },
    // ── Đơn vị đứng TRƯỚC Bù hao: nó quyết định bù hao được tra theo số gì (tờ hay con) ────────
    // MENU ĐÓNG 5 TRẠM của dòng giấy (06/09/2026). Hai ô này KHÔNG còn trỏ vào danh mục Đơn vị &
    // quy đổi: danh mục đó phục vụ kho/mua hàng (kg, ram, thùng…), mời hết vào đây thì người khai
    // chọn được `kg` cho một bước in — sai mà không ai chặn. Câu hỏi ở đây hẹp hơn nhiều: bước này
    // đứng ở CHẶNG NÀO của tờ giấy? Chỉ có đúng 5 chặng, và engine bù hao chỉ biết 5 cầu giữa
    // chúng (`CAU_TRAM` bên backend) — thêm chặng thứ 6 là phải sửa code chứ không phải khai danh mục.
    // Để TRỐNG cả hai = bước NGOÀI dòng giấy (ghi kẽm, đóng thùng…): không dính chuỗi bù hao của
    // giấy; đơn vị + số của nó do người lập lệnh TỰ KHAI ở drawer bước lệnh.
    { key: "don_vi_vao", label: "Đơn vị đầu vào", type: "select", options: tramOptions,
      group: "Đơn vị", default: "to" },
    { key: "don_vi_ra", label: "Đơn vị đầu ra", type: "select", options: tramOptions,
      group: "Đơn vị", default: "to" },
    // GỠ 18/09/2026 (mg `0324`): "Công thức sản lượng ra" + "Đơn vị sản lượng" của bước ngoài dòng
    // giấy (cùng `he_so_ngoai_dong` đã ngưng từ 20/08) — số của bước ấy nay khai tay ở bước lệnh.
    { key: "kieu_bu_hao", label: "Bù hao", type: "select", group: "Bù hao", options: mapOpt(KIEU_BU_HAO), default: "khong" },
    // Nhãn KHÔNG được kết thúc bằng "(…)": `parseLabelAndSuffix` cắt phần trong ngoặc ra làm hậu
    // tố đơn vị dán vào ô nhập — `bands` không có ô đơn nào để dán nên chữ đó biến mất im lặng.
    { key: "bac_bu_hao", label: "Bậc số lượng → giá trị hao", type: "bands", group: "Bù hao",
      showIf: (f) => f.kieu_bu_hao === "theo_bac" },
    { key: "so_to_bu_hao", label: "Số lượng cộng cố định", type: "number", group: "Bù hao", default: 50,
      showIf: (f) => f.kieu_bu_hao === "co_dinh" },
    { key: "ghi_chu", label: "Ghi chú", type: "text", group: "Thông tin" },
  ],
  // CHỈ TÍNH THEO CÔNG THỨC: công đoạn luôn ở chế độ sản lượng + basis 'per_other' (giá phẳng/công
  // thức) để backend không chặn E-CD-BASIS. Dọn run_rate/size_tiers (đơn giá nay nhập per-phiếu).
  transformSubmit: (body) => {
    body.department_ids = Array.isArray(body.department_ids) ? body.department_ids : [];
    // Vắng khoá = server GIỮ nguyên — nhưng drawer luôn mở với đủ danh sách, nên gửi mảng rỗng là
    // đúng ý "đã gỡ hết" chứ không phải "không đụng tới".
    body.vat_tus = body.vat_tus ?? [];
    const khoan = body.khoan && typeof body.khoan === "object"
      ? body.khoan as Record<string, unknown> : {};
    const phatSinh = Array.isArray(khoan.viec_phat_sinh) ? khoan.viec_phat_sinh : [];
    const coCauHinh = !!String(khoan.unit ?? "").trim()
      || (khoan.unit_price !== null && khoan.unit_price !== undefined && khoan.unit_price !== "")
      || !!String(khoan.cong_thuc_khoan ?? "").trim()
      || phatSinh.length > 0;
    body.khoan = coCauHinh ? { ...khoan, viec_phat_sinh: phatSinh } : null;
    // Bỏ tick "cần khuôn" thì ô Loại dụng cụ bị `showIf` ẩn ⇒ không nằm trong body ⇒ backend giữ
    // giá trị cũ. Xoá thẳng ở đây, không thì công đoạn hiện "không cần khuôn" mà vẫn đeo nhãn
    // "Khuôn bế" trong dữ liệu.
    body.requires_tooling = !!body.requires_tooling;
    if (!body.requires_tooling) body.tooling_type = null;
    // Chỉ còn một loại để chọn (khuôn bế) nên tick "cần khuôn" mà để trống ô loại thì hiểu là bế.
    else if (!body.tooling_type) body.tooling_type = "khuon_be";
    body.che_do_tinh = "theo_san_luong";
    body.pricing_basis = "per_other";
    body.run_rate = null;
    body.size_tiers = [];
    return body;
  },
};

/** Giấy này bán/đếm theo CÂN hay theo TỜ — câu hỏi quyết định cả hai công thức điền sẵn dưới đây.
 *
 *  ĐVT chưa chọn (ô đó không có `default`, mở drawer ra là trống) thì coi như theo CÂN: giấy ở
 *  đây bán theo cân, ô đơn giá ngay trên cũng ghi đ/kg. Chọn ĐVT xong thì công thức tự đổi lại.
 *  Cùng tập mã với nhánh dự phòng bên `thanh_phan_engine.py`. */
const giayTheoCan = (donViGia: unknown): boolean => {
  const dv = String(donViGia ?? "");
  return !dv || dv === "kg" || dv === "tan";
};

/** Công thức TIỀN giấy điền sẵn cho mặt hàng mới.
 *
 *  Theo CÂN thì tiền = khối lượng × đ/kg, mà khối lượng phải dựng lại từ định lượng × khổ tờ × số
 *  tờ. Đếm theo TỜ thì đơn giá đã là tiền một tờ — nhân thêm định lượng và diện tích nữa là lệch
 *  hàng chục lần, và phiếu vẫn ra một con số trông hợp lý nên không ai soi ra. */
const congThucGiaGiay = (donViGia: unknown): string =>
  (giayTheoCan(donViGia)
    ? "dinh_luong * dai_nguyen * rong_nguyen * to_nguyen * don_gia_giay"
    : "don_gia_giay * to_nguyen");

/** Loại mã giấy — `giay` = tờ để in, `song` = tấm sóng để bồi (mg 0426). */
const LOAI_GIAY_OPT = [{ value: "giay", label: "Giấy" }, { value: "song", label: "Sóng" }];

export const CFG_GIAY: CatalogConfig = {
  title: "Giấy",
  moduleQuyen: "dm_giay",
  enableClone: true,
  enableImport: true,
  prefix: "/api/vat-lieu-kho/giay",
  nhatKyLoai: "giay",
  softDelete: true,
  // Thanh lọc (06/10/2026): Đơn vị giá — giá trị + tên đơn vị do máy chủ đếm/tra.
  man: "giay",
  dieuKien: [
    { key: "loai", nhan: "Loại", icon: "nhom", giaTri: LOAI_GIAY_OPT },
    { key: "don_vi_gia", nhan: "Đơn vị giá", icon: "don-vi" },
  ],
  // Bề rộng px của lưới (08/10/2026): khai đủ cho Mã/Tên (`widthMa`/`widthTen`) và mọi cột trừ cột
  // CUỐI (Ghi chú) — cột không khai ăn phần còn lại; chữ dài cắt "…", rê chuột xem đủ.
  widthMa: 130,
  widthTen: 230,
  columns: [
    { key: "loai", label: "Loại", w: 80, render: (r) => (r.loai === "song" ? "Sóng" : "Giấy") },
    { key: "gsm", label: "Định lượng", w: 120, n: true, render: (r) => `${r.gsm} g/m²` },
    { key: "don_vi_gia", label: "ĐVT", w: 150, render: (r) => dvCellNhieu(r) },
    { key: "don_gia", label: "Đơn giá", w: 130, n: true, render: (r) => (Number(r.don_gia) ? Number(r.don_gia).toLocaleString("vi-VN") : "") },
    // Cột "Cách tính tiền" đã gỡ khỏi BẢNG (05/10/2026) — vẫn khai/xem ở ô Công thức tính giá.
    { key: "ghi_chu", label: "Ghi chú", render: (r) => (r.ghi_chu ? String(r.ghi_chu) : "") },
  ],
  fields: [
    // Loại (mg 0426, 19/10/2026): một sản phẩm tính giá / một lệnh có tối đa 1 Giấy + 1 Sóng.
    { key: "loai", label: "Loại", type: "select", required: true, group: "Thông số", default: "giay",
      options: LOAI_GIAY_OPT },
    { key: "gsm", label: "Định lượng (g/m²)", type: "number", required: true, group: "Thông số" },
    // Đơn vị GỐC: tồn kho cộng dồn theo đơn vị này. Giấy để `kg` thì kho đếm theo cân; muốn đếm
    // theo tờ thì chọn `tờ` — cặp cố định "1 ram = 500 tờ" chạy sẵn, không cần khai khổ.
    { key: "don_vi_gia", label: "ĐVT", ...F_DON_VI, group: "Thông số" },
    // Đơn vị THÊM (10/10/2026): cùng loại giấy lúc mua theo tờ lúc mua theo kg — hai nhóm không quy
    // đổi lẫn nhau, mỗi nhóm một dòng tồn. Từ 18/10/2026 mọi mã giấy BẮT BUỘC có nhóm tờ + nhóm kg
    // (bước nhận tờ xin kho bằng tờ, bước ra kg xin bằng kg): chip tờ/kg không bỏ được.
    { ...F_DON_VI_THEM, donViBatBuoc: DON_VI_KHOA },
    // Đơn giá theo ĐVT chính — CHỐT CỨNG ở danh mục (engine lấy thẳng, phiếu không sửa).
    { key: "don_gia", label: "Đơn giá", type: "number", group: "Giá", hint: "Giá một ĐVT chính (đ/kg, đ/tờ, đ/ram…). Tính giá tự quy về giá một tờ hoặc một kg." },
    { key: "cong_thuc_gia", label: "Công thức tính giá", type: "formula", group: "Giá",
      nhanTab: "Công thức tính giá",
      // ĐIỀN SẴN khi thêm mới (11/09/2026), sửa/xoá được. Trước đó ô này để trống và engine âm
      // thầm chạy đúng hai chuỗi dưới đây làm dự phòng — thứ đang tính tiền giấy mà người khai
      // không nhìn thấy ở đâu cả. Hai chuỗi phải khớp nhánh dự phòng bên
      // `thanh_phan_engine.py`: sửa một bên thì sửa cả hai.
      macDinhTheo: (f) => congThucGiaGiay(f.don_vi_gia) },
    { key: "ghi_chu", label: "Ghi chú", type: "text", group: "Ghi chú" },
    // Ô "Giấy thay thế" (`thay_the_ids`, mg 0239) ĐÃ GỠ 13/10/2026 cùng cột DB (mg 0405).
  ],
};

export const CFG_VAT_TU: CatalogConfig = {
  title: "Vật tư khác",
  moduleQuyen: "dm_vat_tu",
  enableClone: true,
  enableImport: true,
  prefix: "/api/vat-lieu-kho/vat-tu-in-an",
  nhatKyLoai: "vat_tu",
  man: "vat-tu-in-an",
  dieuKien: [{ key: "don_vi_gia", nhan: "Đơn vị giá", icon: "don-vi" }],
  // Hai tab công thức (giá · định mức) khai bằng `nhanTab` trên từng ô — xem `fields` bên dưới.
  // Xoá MỀM: nút "Xóa" hỏi server "còn ai dùng không" rồi tự chọn kết cục — chưa ai dùng thì
  // xoá hẳn, còn nơi dùng thì chỉ ngừng dùng. Mục đã ngừng xem lại ở công tắc trên dải lọc.
  softDelete: true,
  // Bề rộng px của lưới (08/10/2026): khai đủ cho Mã/Tên (`widthMa`/`widthTen`) và mọi cột trừ cột
  // CUỐI (Ghi chú) — cột không khai ăn phần còn lại; chữ dài cắt "…", rê chuột xem đủ.
  widthMa: 130,
  widthTen: 230,
  columns: [
    { key: "don_vi_gia", label: "ĐVT", w: 160, render: (r) => dvCellNhieu(r) },
    // Cột "Đơn giá" ĐÃ ẨN 09/09/2026 — xem khối chú thích ở `fields` bên dưới.
    // Hai công thức + chip riêng (05/10/2026): thiếu công thức định mức thì lệnh SX không tự ra
    // lượng vật tư — phải thấy được từ bảng, không phải mở từng thẻ.
    { key: "cong_thuc_gia", label: "Công thức", w: 270, render: (r) => {
        const co = (v: unknown) => String(v ?? "").trim() !== "";
        // Có công thức = chữ thường; chưa có = chữ cam nói thẳng "Chưa có …" (thiếu định mức là
        // lệnh SX không ra lượng vật tư).
        const o = (coKhai: boolean, ten: string) => (
          <span key={ten} className={coKhai ? undefined : "lds-cam"}>{coKhai ? ten : `Chưa có ${ten.toLowerCase()}`}</span>
        );
        return doc([o(co(r.cong_thuc_gia), "Tính giá"), o(co(r.cong_thuc_dinh_muc), "Định mức")]);
      } },
    { key: "chips", label: "Chip riêng", w: 260, render: (r) => {
        const chips = Array.isArray(r.chips) ? (r.chips as { ma?: string; ten?: string }[]) : [];
        if (chips.length === 0) return "";
        return (
          <span className="dm-gop" title={chips.map((c) => c.ten ?? c.ma ?? "").join("\n")}>
            {chips.map((c, i) => <span key={c.ma ?? i} className="lds-tag">{c.ten ?? c.ma}</span>)}
          </span>
        );
      } },
    { key: "ghi_chu", label: "Ghi chú", render: (r) => (r.ghi_chu ? String(r.ghi_chu) : "") },
  ],
  fields: [
    // Quy cách đóng gói (đơn vị đóng gói + hệ số) ĐÃ BỎ 10/08/2026: khai quy đổi ở hai nơi là bắt
    // người dùng nhớ luật vô ích. Cần "1 thùng keo = 20 kg" thì khai thẳng đơn vị đó trong danh
    // mục Đơn vị & quy đổi rồi chọn ở ô ĐVT — một nơi duy nhất cho mọi quy đổi.
    { key: "don_vi_gia", label: "Đơn vị tính (ĐVT)", ...F_DON_VI, group: "Thông số" },
    // Đơn vị THÊM (10/10/2026): keo mua theo kg lẫn theo thùng — hai nhóm không quy đổi, mỗi nhóm
    // một dòng tồn.
    F_DON_VI_THEM,
    // ẨN KHỎI UI 09/09/2026 — cùng lối đã làm với `cong_thuc_gia`: giấu ô, GIỮ NGUYÊN cột DB,
    // dữ liệu cũ và mọi đường engine. Thứ bị giấu ở màn này:
    //
    //   · `don_gia` — cả ô trong drawer LẪN cột trong bảng. Cột `vat_tu_in_an.don_gia` còn
    //     nguyên, engine vẫn phơi biến `don_gia` cho công thức vật tư (`thanh_phan_engine` /
    //     `tinh_gia_service`), Excel nhập/xuất vẫn mang cột này — chỉ là không khai/không xem
    //     bằng tay ở đây nữa.
    //   · `thay_the_ids` ("Vật tư thay thế") ĐÃ GỠ hẳn cùng cột DB, mg 0405 (13/10/2026).
    //
    // Cần mở lại thì thêm về đúng chỗ này:
    //   { key: "don_gia", label: "Đơn giá", type: "number", group: "Giá",
    //     hint: "Đơn giá theo ĐVT đã chọn — dùng làm biến don_gia trong công thức" },
    // và trả cột `don_gia` vào `columns`. Ô của GIẤY (CFG_GIAY) GIỮ NGUYÊN — giấy chốt đơn giá/kg
    // ở danh mục là luật riêng của nó, đừng gỡ theo.
    //
    // 01/10/2026: vật tư MỞ LẠI hai ô công thức, mỗi ô một tab, kèm CHIP RIÊNG của chính vật tư
    // (vd Support: Dài support, Rộng support). Chip khai một lần ở đây, dùng ở cả hai công thức;
    // số cụ thể nhập ở phiếu tính giá theo từng bước. Định mức khai ở đây thay cho ô định mức ở dòng
    // vật tư của Công đoạn (đã bỏ).
    { key: "ghi_chu", label: "Ghi chú", type: "text", group: "Ghi chú" },
    { key: "chips", label: "Chip riêng của vật tư", type: "vat-tu-chip", group: "Chip riêng",
      refPrefix: "/api/don-vi",
      hint: "Tên các con số bạn nhập khi tính giá cho vật tư này (vd Dài support, Rộng support). Dùng làm biến trong hai công thức." },
    // 03/10/2026: ẩn chip Đơn giá vật tư khỏi bảng chip; công thức cũ đã gõ nó vẫn hợp lệ.
    { key: "cong_thuc_gia", label: "Công thức tính giá", type: "formula",
      nhanTab: "Công thức tính giá", loaiO: "vat_tu", chipsTu: "chips", an: ["don_gia_vat_tu"],
      hint: "Ra TIỀN của vật tư này ở phiếu tính giá." },
    { key: "cong_thuc_dinh_muc", label: "Công thức định mức", type: "formula",
      nhanTab: "Công thức định mức", loaiO: "quy_doi", chipsTu: "chips",
      hint: "Số lượng vật tư này tiêu hao cho MỘT bước; lệnh sản xuất tự tính, không nhập tay." },
  ],
};

// THÀNH PHẨM — cùng bảng `vat_tu_in_an` với Vật tư khác, chia nhau bằng `order_line_id`
// (docs/prd-thanh-pham.md §3). Menu + ô quyền riêng, nhưng KHÔNG phải `hang_loai` thứ ba: với
// kho thành phẩm vẫn là "vat_tu", nên luồng nhập kho · lập phiếu · trừ tồn không sửa gì.
export const CFG_THANH_PHAM: CatalogConfig = {
  title: "Thành phẩm",
  moduleQuyen: "dm_thanh_pham",
  enableImport: true,
  prefix: "/api/vat-lieu-kho/thanh-pham",
  nhatKyLoai: "thanh_pham",
  // KHÔNG khai tay (chủ 18/09/2026: "bỏ nút thêm thành phẩm đi") — dòng chỉ do chốt đơn sinh ra.
  // 19/08–18/09/2026 từng nới cho Bán hàng khai trước món khách sắp đặt. Nhập Excel vẫn còn để SỬA
  // hàng loạt; mã mới trong file bị máy chủ báo lỗi đúng dòng (`_chan_tao_tay`).
  // KHÔNG cho Xóa: dòng có thể đang có lô tồn hoặc phiếu đã ghi sổ, xoá là làm mồ côi. Cả hai
  // đều chặn song song ở máy chủ, không chỉ giấu nút.
  khongTaoTay: true,
  khongXoa: true,
  softDelete: true,
  widthMa: 170,
  // Thanh lọc (06/10/2026): khách của thành phẩm (`customer_id`, tên do máy chủ gắn).
  man: "thanh-pham",
  dieuKien: [{ key: "khach_hang_id", nhan: "Khách hàng", icon: "nguoi" }],
  columns: [
    // Ô CHỌN "Khách hàng" ĐÃ GỠ HẲN (chủ 21/08/2026: "khách hàng mình lưu làm gì, mình không
    // dùng tới — thành phẩm này là một cái tên hàng mới, nêu chưa khai để tái sử dụng, tránh
    // phình lên"). Thành phẩm KHÔNG thuộc về ai: hai khách đặt cùng tên dùng CHUNG một dòng, công
    // tắc chia hai màn là cột `la_thanh_pham` (mg 0228) do repo tự đóng dấu.
    //
    // HIỆN LẠI dạng CHỈ ĐỌC 17/09/2026 (chủ: "hiển thị hết đi" — màn thiếu so với thứ bảng lưu).
    // Từ 11/10/2026 (mg 0394) khách là CHỦ của thành phẩm: hàng in riêng cho khách nào là của
    // khách đó, hai khách trùng tên là hai mã, tồn của mã là hàng của khách. Vẫn chỉ đọc — máy
    // ghi lúc chốt đơn.
    // Bề rộng px: mã thành phẩm dài ("TP-DH-2026-041-11") nên Mã (`widthMa` ở đầu
    // config) rộng hơn mặc định của trang; Ghi chú cuối không khai bề rộng ⇒ ăn phần còn lại.
    { key: "don_vi_gia", label: "ĐVT", w: 110, render: (r) => dvCell(r) },
    { key: "order_no", label: "Đơn đầu tiên", w: 130, render: (r) => <MaDon r={r} ngan /> },
    { key: "customer_ten", label: "Khách hàng", w: 240,
      render: (r) => (r.customer_ten ? String(r.customer_ten) : "") },
    // Cột "Ngày khai" GỠ 06/10/2026: trang chung đã có cột "Ngày tạo" (cùng `created_at`).
    { key: "ghi_chu", label: "Ghi chú",
      render: (r) => (r.ghi_chu ? String(r.ghi_chu) : "") },
  ],
  fields: [
    { key: "don_vi_gia", label: "Đơn vị tính (ĐVT)", ...F_DON_VI, group: "Thông số",
      hint: "Lấy theo đơn vị trên dòng đơn hàng — sửa nếu kho đếm bằng đơn vị khác" },
    { key: "ghi_chu", label: "Ghi chú", type: "text", group: "Ghi chú" },
  ],
  renderChiDoc: (r) => <NguonGocThanhPham r={r} />,
};

/** "DH002" · "Khai tay" · hoặc đơn đã mất khỏi hệ thống (soft-ref, không FK). `ngan` = chữ cho ô
 *  bảng hẹp; drawer dùng câu đầy đủ. */
function donDauTien(r: Row, ngan: boolean): ReactNode {
  if (r.order_no) return String(r.order_no);
  if (r.order_id != null) return ngan ? `#${r.order_id}` : `Đơn #${r.order_id} — không còn trong hệ thống`;
  return ngan
    ? <span className="lds-mu">Khai tay</span>
    : "Khai tay trên danh mục — không từ đơn nào";
}

/** Mã đơn BẤM ĐƯỢC → mở luôn drawer đơn ở màn Đơn hàng bán (cùng đường Báo giá / Phiếu thu đang
 *  dùng). Chữ thường khi: đơn đã mất · không quyền đọc đơn (link dẫn vào màn cấm là mời bấm để ăn
 *  lỗi) · màn không có đường điều hướng (dựng trong test). */
function MaDon({ r, ngan }: { r: Row; ngan: boolean }) {
  const navigate = useDieuHuongDanhMuc();
  const can = useCan();
  const chu = donDauTien(r, ngan);
  if (!r.order_no || r.order_id == null || !navigate || !can("don_hang_ban", "read")) return <>{chu}</>;
  return (
    <CodeLink code={String(r.order_no)} title={`Mở đơn ${r.order_no}`}
      onOpen={() => navigate("don-hang-ban", { openOrderId: Number(r.order_id) })} />
  );
}

/** Khối CHỈ ĐỌC cuối tab khai báo của Thành phẩm: thứ bảng lưu mà không ai gõ tay. */
function NguonGocThanhPham({ r }: { r: Row }) {
  const khach = r.customer_ten
    ? [r.customer_ma, r.customer_ten].filter(Boolean).map(String).join(" · ")
    : r.customer_id != null ? `Khách #${r.customer_id} — không còn trong hệ thống` : "—";
  const anh = assetUrl(r.anh_url as string | null);
  const o = (nhan: string, giaTri: string, goiY?: string) => (
    <label className={`rc-field${goiY ? " rc-field--full" : ""}`}>
      <span className="rc-field__label">{nhan}</span>
      <div className="rc-input-wrapper rc-input-wrapper--ro">
        <input className="rc-input" value={giaTri} readOnly />
      </div>
      {goiY && <span className="rc-field__hint">{goiY}</span>}
    </label>
  );
  return (
    <section className="rc-card-section" style={{ padding: "16px 20px" }}>
      <div className="rc-card-section__title">Nguồn gốc &amp; trạng thái</div>
      <div className="rc-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)", gap: "12px 16px" }}>
        {r.order_no ? (
          // `div` chứ không `label` như `o()`: label chuyển cú bấm vào nút đầu tiên bên trong, bấm
          // trúng chữ "Đơn hàng đầu tiên" cũng bị đá sang màn đơn.
          <div className="rc-field">
            <span className="rc-field__label">Đơn hàng đầu tiên</span>
            <div className="rc-input-wrapper rc-input-wrapper--ro">
              <span className="rc-input" style={{ display: "block" }}><MaDon r={r} ngan={false} /></span>
            </div>
          </div>
        ) : o("Đơn hàng đầu tiên", String(donDauTien(r, false)))}
        {o("Trạng thái", r.active === false ? "Đã ngừng dùng" : "Đang dùng")}
        {o("Khách hàng", khach,
          "Thành phẩm thuộc về khách này. Khách khác đặt cùng tên là một mã khác.")}
        {o("Ngày khai", ngayGio(r.created_at as string | null))}
        {o("Sửa lần cuối", ngayGio(r.updated_at as string | null))}
        {anh && (
          <div className="rc-field rc-field--full">
            <span className="rc-field__label">Ảnh minh hoạ</span>
            <a href={anh} target="_blank" rel="noreferrer" style={{ alignSelf: "flex-start" }}>
              <img src={anhNho(r.anh_url as string | null, 320) ?? anh} alt={String(r.ten)} style={{
                maxWidth: 160, maxHeight: 160, objectFit: "cover", borderRadius: 8,
                border: "1px solid var(--rule-soft, #e8e3d3)",
              }} />
            </a>
          </div>
        )}
      </div>
    </section>
  );
}

// Xóa kho KHÔNG dùng luồng ẩn-mềm mặc định: kho là gốc của lô/phiếu/yêu cầu nên phải CHẶN nếu còn
// dính, và bắt gõ mã xác nhận (thao tác nặng). Gọi /delete-check để soi rồi mới cho xóa qua DELETE
// (backend xóa mềm + tự chặn lần nữa). Chỉ role có quyền kho:delete mới thấy nút Xóa.
function KhoDeleteDialog({ row, token, onClose, onDone }: {
  row: Row; token: string; onClose: () => void; onDone: () => void;
}) {
  const [checking, setChecking] = useState(true);
  const [blockers, setBlockers] = useState<string[]>([]);
  const [confirmMa, setConfirmMa] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    authed<{ can_delete: boolean; blockers: string[] }>(`/api/kho/${row.id}/delete-check`, token)
      .then((r) => { if (alive) setBlockers(r.blockers); })
      .catch((e) => { if (alive) setErr(e instanceof ApiError ? e.message : "Không kiểm tra được kho."); })
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, [row.id, token]);

  const blocked = blockers.length > 0;
  const maOk = confirmMa.trim().toUpperCase() === row.ma.trim().toUpperCase();

  async function doDelete() {
    setBusy(true); setErr(null);
    try {
      await crud("/api/kho").remove(token, row.id);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Không xóa được kho.");
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open
      danger
      busy={busy}
      error={err}
      title={<>Xóa kho “{row.ten}”</>}
      confirmLabel="Xóa kho"
      confirmDisabled={checking || blocked || !maOk}
      hideConfirm={checking || blocked}
      onCancel={onClose}
      onConfirm={doDelete}
    >
      {checking ? (
        <p className="kho-del__muted">Đang kiểm tra kho…</p>
      ) : blocked ? (
        <div className="kho-del__block">
          <p className="kho-del__warn">Không thể xóa — kho đang được dùng:</p>
          <ul className="kho-del__list">
            {blockers.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
          <p className="kho-del__muted">Hãy xử lý xong tồn / phiếu / yêu cầu của kho này rồi mới xóa.</p>
        </div>
      ) : (
        <div className="kho-del__ok">
          <p>Kho <b>{row.ma}</b> sẽ được <b>xóa</b> — lịch sử phiếu đã ghi sổ vẫn giữ nguyên.</p>
          <label className="kho-del__field">
            <span>Gõ lại mã <b>{row.ma}</b> để xác nhận xóa</span>
            <input
              className="kho-del__input"
              value={confirmMa}
              onChange={(e) => setConfirmMa(e.target.value)}
              placeholder={row.ma}
              autoFocus
            />
          </label>
        </div>
      )}
    </ConfirmDialog>
  );
}

// Khai báo kho — master data NHẸ (chỉ tên / vị trí / ghi chú). Kho tạo ở đây tự đổ
// ra navbar (mục "Kho hàng"). Mã KHO-xxxx tự gợi ý (suggestNextCode). Xóa mềm để giữ dấu vết.
export const CFG_KHO_HANG: CatalogConfig = {
  title: "Kho hàng",             // danh từ ở nút/lọc: "Thêm kho hàng", "Lọc kho hàng"
  heading: "Khai báo kho",       // H1 khớp menu "Khai báo kho"
  moduleQuyen: "dm_kho_hang",
  enableImport: true,
  prefix: "/api/kho",
  nhatKyLoai: "kho_hang",
  softDelete: true,
  // Thanh lọc: kỳ Ngày tạo + Trạng thái (Đang dùng / Đã ngừng) — trang tự có, không khai thêm.
  man: "khai-bao-kho",
  autoCode: true,          // mã KHO-#### sinh ngầm ở backend, ẩn ô nhập mã
  // Bề rộng px của lưới (08/10/2026): khai đủ cho Mã/Tên (`widthMa`/`widthTen`) và mọi cột trừ cột
  // CUỐI (Ghi chú) — cột không khai ăn phần còn lại; chữ dài cắt "…", rê chuột xem đủ.
  widthMa: 120,
  widthTen: 230,
  columns: [
    { key: "vi_tri", label: "Vị trí", w: 260, render: (r) => (r.vi_tri ? String(r.vi_tri) : "") },
    // Số kệ/ô đang dùng (server đếm, `so_vi_tri`). Chưa khai thì lập lô/phiếu không có gì để chọn.
    { key: "so_vi_tri", label: "Vị trí cất", w: 170, render: (r) => {
        const n = Number(r.so_vi_tri) || 0;
        return n ? `${n} vị trí` : <span className="lds-cam">Chưa khai vị trí</span>;
      } },
    { key: "ghi_chu", label: "Ghi chú", render: (r) => (r.ghi_chu ? String(r.ghi_chu) : "") },
  ],
  fields: [
    { key: "vi_tri", label: "Vị trí kho", type: "text", group: "Thông tin"},
    { key: "ghi_chu", label: "Ghi chú", type: "text", group: "Thông tin" },
  ],
  // Tab thứ 2 trong drawer: khai DANH SÁCH vị trí cất (kệ/ô) của kho — để lập lô/phiếu chọn dropdown
  // thay vì gõ tay. Dùng lại điểm mở rộng `renderExtra` (như bảng quy đổi của Đơn vị). `moLaiSauKhiTao`
  // giữ drawer mở sau khi TẠO kho để khai vị trí ngay (panel cần id, tạo mới chưa có).
  nhanTabCongThuc: "Vị trí kho",
  moLaiSauKhiTao: true,
  renderExtra: (_form, existing) => <KhoViTriPanel kho={existing} />,
  renderDeleteDialog: (row, ctx) => <KhoDeleteDialog row={row} {...ctx} />,
  // Kho thành phẩm của hệ thống (`KHO-TP`, 12/10/2026): ổ khoá, không nút xoá — như mục cố định của
  // Mục thu chi. Khác ở chỗ VẪN mở được để khai vị trí / ghi chú / vị trí cất; máy chủ chặn đổi tên,
  // ngừng dùng, xoá.
  dongKhoa: (r) => (r.co_dinh ? "Kho cố định của hệ thống: không xoá, không ngừng dùng, không đổi tên được." : null),
  dongKhoaMoDuoc: true,
};

// Tình trạng khuôn — record-only (con người phán, máy chỉ ghi nhận).
// `dang_dat_lam` (mg 0177): dao CHƯA có trong tay — thuê ngoài chưa về, hoặc xưởng đang tự làm.
// Đi kèm NGÀY CÓ KHUÔN (dự kiến): bước dùng dao ở Lệnh sản xuất hiện ngày đó để người xếp việc
// biết chờ tới bao giờ. Không có nó thì "đang đặt làm" chỉ là một chữ.
// Loại dao — CÙNG bộ mã với `TOOLING_TYPE` của công đoạn (ô chọn dao ở bước lệnh lọc bằng phép so
// thẳng hai giá trị, lệch bộ mã là lọc ra rỗng). 01/10/2026: chỉ còn khuôn bế để chọn/lọc; nhãn của
// hai loại đã gỡ giữ ở `TOOLING_TYPE_CU` để dòng cũ trong kho vẫn hiện đúng chữ.
export const LOAI_KHUON: Lbls = TOOLING_TYPE_NHAN;

export const TINH_TRANG_KHUON: Lbls = {
  dang_dung: "Đang dùng",
  dang_dat_lam: "Đang đặt làm",
  hong: "Hỏng",
  thanh_ly: "Thanh lý",
};

// Khai báo KHUÔN BẾ — master data NHẸ, khai TAY. Mỗi khuôn làm riêng cho hình bế của 1
// ấn phẩm; đơn lặp lại thì lôi khuôn cũ ra dùng. Chỉ đủ để TÌM LẠI: số kệ (vị trí lưu) +
// tình trạng. Ref ấn phẩm/khách hàng đấu sau. Mã KB-#### tự sinh; xóa mềm giữ dấu vết.
/** Màu chip Tình trạng khuôn — mỗi tình trạng một sắc. */
const MAU_TINH_TRANG_KHUON: Record<string, MauTT> = {
  dang_dung: "la",
  dang_dat_lam: "vang",
  hong: "do",
  thanh_ly: "xam",
};

export const CFG_KHUON_BE: CatalogConfig = {
  // Nhan đề "Khuôn" (18/09/2026, trước đó "Khuôn & khung" từ 04/09/2026) — màn nay chỉ còn khuôn bế
  // (ép kim / khung lụa gỡ 01/10/2026; dòng cũ mang hai loại đó vẫn hiện, chỉ không tạo mới được). `prefix`, `nhatKyLoai` và
  // `moduleQuyen` GIỮ NGUYÊN chuỗi `khuon_be`, xem cảnh báo ngay dưới.
  title: "Khuôn",
  // ⚠️ `khuon_be` KHÔNG có tiền tố `dm_` như 9 màn kia — đây là chuỗi ĐANG NẰM TRONG bảng
  // `role_permissions` của DB thật (khớp `components/Sidebar.tsx`). Đổi cho "nhất quán" là mọi vai
  // mất sạch quyền màn này.
  moduleQuyen: "khuon_be",
  enableImport: true,
  prefix: "/api/khuon-be",
  nhatKyLoai: "khuon_be",
  softDelete: true,
  autoCode: true,          // mã KB-#### sinh ngầm ở backend, ẩn ô nhập mã
  // Thanh lọc (06/10/2026) thay hàng chip LOẠI + bảng "Lọc nâng cao" cũ: Loại · Khách hàng ·
  // Tình trạng · Số kệ, ghép VÀ, đều lọc + đếm ở máy chủ (`routers/khuon_be.py`: `loc` +
  // `loc_them` + `dem_them`). Đổi `key` ở đây là phải đổi cả tên tham số bên đó. Số kệ nay CHỌN
  // trong các số kệ đang có (máy chủ vẫn khớp CHỨA).
  man: "khuon-be",
  dieuKien: [
    { key: "loai", nhan: "Loại", icon: "dung-cu", giaTri: mapOpt(TOOLING_TYPE), nhanGiaTri: LOAI_KHUON },
    { key: "khach_hang_id", nhan: "Khách hàng", icon: "nguoi" },
    { key: "tinh_trang", nhan: "Tình trạng", icon: "trang-thai", giaTri: mapOpt(TINH_TRANG_KHUON) },
    { key: "so_ke", nhan: "Số kệ", icon: "vi-tri" },
  ],
  // Ô tìm quét cả tên khách + số kệ (`khuon_be_repo._loc_q`) — nói ra, không thì chẳng ai thử.
  timGoiY: "Tìm mã / tên / khách / số kệ…",
  // Bề rộng px của lưới (08/10/2026): khai đủ cho Mã/Tên (`widthMa`/`widthTen`) và mọi cột trừ cột
  // CUỐI (Ghi chú) — cột không khai ăn phần còn lại; chữ dài cắt "…", rê chuột xem đủ.
  widthMa: 120,
  widthTen: 220,
  columns: [
    { key: "khach_hang_ten", label: "Khách hàng", w: 230,
      render: (r) => (r.khach_hang_ten ? String(r.khach_hang_ten) : "") },
    { key: "loai", label: "Loại", w: 130, render: (r) => (r.loai ? lbl(LOAI_KHUON)(r.loai) : "") },
    { key: "so_ke", label: "Số kệ", w: 110, render: (r) => (r.so_ke ? String(r.so_ke) : "") },
    // 🔴 Cột "Ngày có khuôn" ĐÃ GỠ (mg `0293`, 10/09/2026) — kho khuôn nay KHÔNG còn ô ngày nào.
    // Ngày dự kiến không cắm vào phép tính nào (xem `docs/DB_SCHEMA.md` mục `khuon_be`), chỉ bắt
    // người khai bịa một con số rồi để đó lạc hậu. "Đang đặt làm" ở cột Tình trạng là đủ.
    // Tình trạng khuôn là trạng thái thật: chip, mỗi tình trạng một sắc.
    { key: "tinh_trang", label: "Tình trạng", w: 150, render: (r) => {
        const ma = String(r.tinh_trang ?? "");
        if (!ma) return "";
        return <ChipTT mau={MAU_TINH_TRANG_KHUON[ma] ?? "slate"}>{lbl(TINH_TRANG_KHUON)(ma)}</ChipTT>;
      } },
    { key: "ghi_chu", label: "Ghi chú", render: (r) => (r.ghi_chu ? String(r.ghi_chu) : "") },
  ],
  fields: [
    // Hai ô này là HAI CHIỀU LỌC của ô chọn dao ở bước lệnh sản xuất. Khai đủ thì người cấu hình
    // lệnh mở ra chỉ thấy vài con dao đúng khách, đúng loại; bỏ trống thì họ phải lội cả kho.
    // `size: 200` = trần của nền danh mục. Mặc định chỉ lấy trang đầu, mà ô chọn khách thiếu dòng
    // thì người ta tưởng chưa có khách đó rồi bỏ trống — đúng thứ làm chiều lọc này vô dụng.
    { key: "khach_hang_id", label: "Khách hàng", type: "ref", refPrefix: "/api/customers",
      refParams: { size: 200 }, group: "Nhận diện" },
    { key: "loai", label: "Loại", type: "select", group: "Nhận diện",
      options: mapOpt(TOOLING_TYPE), nhanCu: TOOLING_TYPE_CU },
    { key: "so_ke", label: "Số kệ / vị trí lưu", type: "text", group: "Lưu trữ" },
    // Ô ngày đi kèm ĐÃ GỠ cùng mg `0293`: tình trạng là thứ DUY NHẤT kho khuôn nói về "dao đã có
    // trong tay chưa", và nó có người chịu trách nhiệm cập nhật — khác hẳn một ngày khai một lần.
    { key: "tinh_trang", label: "Tình trạng", type: "select", group: "Lưu trữ",
      options: mapOpt(TINH_TRANG_KHUON), default: "dang_dung"},
    { key: "ghi_chu", label: "Ghi chú", type: "text", group: "Lưu trữ" },
  ],
};

// ── Đơn vị & quy đổi ─────────────────────────────────────────────────────────────
// Ba bước, không hơn: tạo đơn vị A, tạo đơn vị B, khai "1 A = n B". Mọi khái niệm khác (loại đo,
// đơn vị chuẩn, ngày hiệu lực) là chuyện nội bộ — không phơi ra màn khai.
export const CFG_DON_VI: CatalogConfig = {
  title: "Đơn vị & quy đổi",
  moduleQuyen: "dm_don_vi",
  enableImport: true,
  prefix: "/api/don-vi",
  nhatKyLoai: "don_vi_do",
  softDelete: true,
  // Thanh lọc (06/10/2026): Loại đo (họ đơn vị — nhãn do máy chủ gắn từ `HO_NHAN`).
  man: "don-vi",
  dieuKien: [{ key: "ho", nhan: "Loại đo", icon: "don-vi" }],
  // Tạo xong giữ drawer mở để khai quy đổi ngay — khối quy đổi phải có id mới gắn vào được.
  moLaiSauKhiTao: true,
  // Tờ + kg là đơn vị bắt buộc của mọi mã giấy (18/10/2026): ổ khoá, không nút xoá; vẫn mở được để
  // sửa tên / quy đổi. Máy chủ chặn xoá, ngừng dùng, đổi mã.
  dongKhoa: (r) => (DON_VI_KHOA.includes(String(r.ma ?? "").trim().toLowerCase())
    ? "Đơn vị bắt buộc của giấy: không xoá, không ngừng dùng, không đổi mã được. Quy đổi vẫn sửa được."
    : null),
  dongKhoaMoDuoc: true,
  // Bề rộng px của lưới (08/10/2026): khai đủ cho Mã/Tên (`widthMa`/`widthTen`) và mọi cột trừ cột
  // CUỐI (Ghi chú) — cột không khai ăn phần còn lại; chữ dài cắt "…", rê chuột xem đủ.
  widthMa: 110,
  widthTen: 180,
  columns: [
    {
      key: "quy_doi_text",
      label: "Quy đổi",
      w: 380,
      // Loại của từng mảnh do SERVER trả (`quy_doi_chips`), màn này chỉ tô màu. Bản trước tự tách
      // `quy_doi_text` rồi đoán loại bằng cách dò tên biến ghi cứng — mà server đã đổi mã biến sang
      // nhãn tiếng Việt trước khi trả, nên "bài in = Tờ vào máy + 2000" hiện xám như một hệ số.
      render: (r) => {
        const chips = Array.isArray(r.quy_doi_chips)
          ? (r.quy_doi_chips as { text?: string; loai?: string }[])
          : [];
        if (chips.length === 0) {
          return <span className="lds-mu">Chưa khai báo</span>;
        }
        return (
          <span className="dm-gop" title={chips.map((c) => c.text ?? "").join("\n")}>
            {chips.map((c, i) => (
              // Mảnh "là công thức" chữ cam (cùng sắc accent của app); hệ số thường dùng thẻ xám.
              <span key={i} className={c.loai === "cong_thuc" ? "lds-tag lds-cam" : "lds-tag"}>{c.text}</span>
            ))}
          </span>
        );
      },
    },
    // Cột "Lưu ý" (`canh_bao`) GỠ 18/09/2026 theo chủ: phần lớn dòng chỉ lặp lại "Chưa khai" mà
    // cột Quy đổi đã nói. Server vẫn trả `canh_bao`, chỉ màn này thôi hiện.
    // Mặt hàng đang lấy đơn vị này làm ĐVT (server đếm, `mat_hang_dung`) — sửa/xoá đơn vị là đụng
    // tới chừng ấy hàng trong kho.
    { key: "mat_hang_dung", label: "Đang dùng ở", w: 260, render: (r) => {
        const d = (r.mat_hang_dung ?? {}) as Record<string, number>;
        const nhan: [string, string][] = [["giay", "giấy"], ["vat_tu", "vật tư"], ["thanh_pham", "thành phẩm"]];
        const co = nhan.filter(([k]) => (d[k] ?? 0) > 0);
        if (co.length === 0) return <span className="lds-mu">Chưa mặt hàng nào</span>;
        return (
          <span className="dm-gop" title={co.map(([k, ten]) => `${d[k]} ${ten}`).join("\n")}>
            {co.map(([k, ten]) => <span key={k} className="lds-tag">{d[k]} {ten}</span>)}
          </span>
        );
      } },
    { key: "ghi_chu", label: "Ghi chú", render: (r) => (r.ghi_chu ? String(r.ghi_chu) : "") },
  ],
  fields: [
    { key: "ghi_chu", label: "Ghi chú", type: "text" },
    // GỠ 06/09/2026: ô "Trạm trên dòng giấy". Nó là lớp trung gian cho một thứ không cần trung
    // gian — dòng giấy có ĐÚNG 5 chặng đóng cứng trong engine, cờ này chỉ cho phép ĐỔI TÊN chặng
    // chứ không thêm được chặng thứ 6. Đổi lại, ai khai đơn vị (kho, mua hàng) cũng phải hiểu
    // dòng giấy để không gắn nhầm cờ. Nay 5 chặng nằm thẳng ở ô Đơn vị vào/ra của màn Công đoạn —
    // hỏi đúng người, đúng lúc. Danh mục đơn vị giữ NGUYÊN mọi dòng (kg · ram · thùng · m²…),
    // chỉ mất cái cờ. Cột `don_vi_do.tram_dong_giay` còn trong DB nhưng không ai đọc nữa.
  ],
  // Quy đổi khai NGAY TẠI ĐÂY, dưới ô Ghi chú — một chỗ nhập, không màn thứ hai.
  renderExtra: (_form, existing) => <QuyDoiCuaDonVi donVi={existing} />,
};

export const CFG_XE: CatalogConfig = {
  title: "Xe giao hàng",
  moduleQuyen: "dm_xe",
  enableImport: true,
  prefix: "/api/xe",
  nhatKyLoai: "xe",
  // Khoá nghiệp vụ của xe LÀ BIỂN SỐ. Gọi nó là "Mã" + điền sẵn "MA-0001" thì người khai gõ biển
  // số vào ô Tên rồi để nguyên mã tự sinh — đã dính đúng lỗi đó ngay lần khai đầu tiên.
  nhanMa: "Biển số",
  khongGoiYMa: true,
  // Xoá MỀM: xe bán đi vẫn phải giữ tên cho những chuyến nó đã chạy — xoá hẳn là làm mồ côi
  // `delivery_trips.vehicle_id` của cả lịch sử.
  softDelete: true,
  // Thanh lọc (06/10/2026): Mức khoán km (tên mức do máy chủ gắn).
  man: "xe",
  dieuKien: [{ key: "muc_khoan_km_id", nhan: "Mức khoán km", icon: "xe" }],
  columns: [
    // Mức khoán km quyết định tiền mỗi chuyến — ô bắt buộc mà trước đây chỉ thấy khi mở thẻ xe.
    { key: "muc_khoan_km_id", label: "Mức khoán km", w: 220, render: (r) => <MucKhoanXe id={r.muc_khoan_km_id} /> },
    { key: "tai_trong", label: "Tải trọng", w: 120, n: true, render: (r) =>
        r.tai_trong != null ? `${Number(r.tai_trong).toLocaleString("vi-VN")} tấn` : "" },
    { key: "ghi_chu", label: "Ghi chú", render: (r) => (r.ghi_chu ? String(r.ghi_chu) : "") },
  ],
  fields: [
    // MỨC KHOÁN KM — ô quan trọng nhất của màn này: nó quyết định xe chạy một chuyến ra bao nhiêu
    // tiền. BẮT BUỘC từ 14/09/2026 (máy chủ chặn): trước đó để trống được và xe trống âm thầm ăn
    // đơn giá phẳng của phòng mà không màn nào hiện số đó. Mức tạo ở Cấu hình lương → Khoán km
    // giao hàng.
    // ⚠️ `hint` của ô `ref-search` được `CatalogDrawer` dùng LÀM PLACEHOLDER — viết dài là cả câu
    // hướng dẫn tràn vào trong ô, trông như đã nhập sẵn. Giữ ngắn đúng một dòng.
    { key: "muc_khoan_km_id", label: "Mức khoán km", type: "ref-search",
      refPrefix: "/api/giao-hang/muc-khoan-km", required: true, group: "Thông tin",
      hint: "Chọn mức…" },
    { key: "tai_trong", label: "Tải trọng (tấn)", type: "number", group: "Thông tin",
      hint: "Chỉ để đối chiếu — giá km do MỨC ở trên quyết." },
    { key: "ghi_chu", label: "Ghi chú", type: "text", group: "Thông tin" },
  ],
};


const LOAI_MUC = [{ value: "thu", label: "Thu" }, { value: "chi", label: "Chi" }];

/** Cột "Đã dùng" của Mục thu chi: số phiếu mang mục, bấm mở Báo cáo thu chi lọc đúng mục đó
 *  (mockup danh mục phương án A). Chữ thường khi 0, không quyền xem báo cáo, hoặc màn dựng trong test. */
function DaDungMuc({ r }: { r: Row }) {
  const navigate = useDieuHuongDanhMuc();
  const can = useCan();
  const so = Number(r.da_dung ?? 0);
  if (so === 0) return <span className="lds-mu">0</span>;
  if (!navigate || !can("bao_cao_thu_chi", "read")) return <>{so.toLocaleString("vi-VN")}</>;
  return (
    <button type="button" className="lds-lk" title={`Mở Báo cáo thu chi lọc mục ${String(r.ten)}`}
      onClick={(e) => { e.stopPropagation(); navigate("bao-cao-thu-chi", { locMucThuChi: Number(r.id) }); }}>
      {so.toLocaleString("vi-VN")}
    </button>
  );
}

/** Mục thu chi (11/10/2026; 12/10/2026 theo mockup `bao-cao-thu-chi-3-phuong-an.html` danh mục A).
 *  Sáu mục CỐ ĐỊNH theo nguồn phiếu (Trả nhà cung cấp, Thuê gia công ngoài…) do máy chủ ghép vào
 *  danh sách (id âm, `co_dinh`) — hiện để thấy đủ, khoá: không sửa, không ngừng. */
export const CFG_MUC_THU_CHI: CatalogConfig = {
  title: "Mục thu chi",
  moduleQuyen: "dm_muc_thu_chi",
  prefix: "/api/muc-thu-chi",
  nhatKyLoai: "muc_thu_chi",
  // Xoá như mọi danh mục (12/10/2026, khuôn màn Giấy): chưa phiếu nào mang thì xoá hẳn, đã có phiếu
  // thì chỉ ngừng dùng — báo cáo thu chi của các kỳ cũ vẫn cần tên mục mà phiếu đã mang.
  softDelete: true,
  man: "muc-thu-chi",
  // Hàng Tất cả / Đang dùng / Đã ngừng mặc định; Thu / Chi là điều kiện trong nút Lọc.
  dieuKien: [{ key: "loai", nhan: "Bên", icon: "nhom", giaTri: LOAI_MUC }],
  dongKhoa: (r) => (r.co_dinh
    ? `Mục cố định: ${String(r.ghi_chu ?? "").toLowerCase()} tự vào mục này. Không sửa, không ngừng được.`
    : null),
  anNgayTao: true,
  widthTen: 260,
  columns: [
    { key: "loai", label: "Bên", w: 90, render: (r) => (r.loai === "thu"
      ? <ChipTT mau="xanh">Thu</ChipTT> : <ChipTT mau="cam">Chi</ChipTT>) },
    { key: "da_dung", label: "Đã dùng", w: 90, n: true, render: (r) => <DaDungMuc r={r} /> },
    { key: "ghi_chu", label: "Ghi chú", render: (r) => (r.ghi_chu ? String(r.ghi_chu) : "") },
  ],
  fields: [
    { key: "loai", label: "Loại", type: "select", required: true, default: "chi", options: LOAI_MUC },
    { key: "ghi_chu", label: "Ghi chú", type: "text" },
  ],
};


export const REBUILD_CONFIGS: Record<string, CatalogConfig> = {
  "khai-bao-kho": CFG_KHO_HANG,
  "may-thiet-bi": CFG_MAY,
  "cong-doan": CFG_CONG_DOAN,
  "don-vi": CFG_DON_VI,
  "giay": CFG_GIAY,
  "vat-tu-in-an": CFG_VAT_TU,
  "thanh-pham": CFG_THANH_PHAM,
  "khuon-be": CFG_KHUON_BE,
  "xe": CFG_XE,
  "muc-thu-chi": CFG_MUC_THU_CHI,
};
