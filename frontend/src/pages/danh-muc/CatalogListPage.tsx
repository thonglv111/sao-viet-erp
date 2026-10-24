// Trang danh mục GENERIC — list + drawer form theo SECTION + search + filter tab.
// 1 component cho 10 danh mục qua `config` (danh sách ở `REBUILD_CONFIGS`). On-brand với
// design system app (tokens rust/ink/paper).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, CircleDot, MapPin, Ruler, Truck, Users, Wrench, type LucideIcon } from "lucide-react";

import { useAuth } from "../../auth/useAuth";
import { useCan } from "../../auth/permissions";
import { Button } from "../../components/Button";
import { trangHopLe } from "../../components/Pager";
import { PhanTrangDayDu } from "../../components/PhanTrangDayDu";
import { useTre } from "../../lib/useTre";
import { ApiError } from "../../api/client";
import { crud, type Row } from "../../api/rebuildCatalog";
import { useNapTenDonVi } from "../tenDonVi";
import { CatalogDrawer } from "./CatalogDrawer";
import { ImportExcelDialog } from "../../components/ImportExcelDialog";
import { XoaDanhMucDialog } from "./XoaDanhMucDialog";
import { CopyIcon, DownloadIcon, LockIcon, PlusIcon, TrashIcon, UndoIcon, UploadIcon } from "./icons";
import type { CatalogConfig, DieuKienDanhMuc, Option } from "./types";
import type { DemGiaTri } from "../../api/rebuildCatalog";
import { ThanhLoc } from "../thanh-loc/ThanhLoc";
import { thamSoKy } from "../thanh-loc/ky-danh-sach";
import { useLocMan } from "../thanh-loc/useLocMan";
import type { DieuKien } from "../thanh-loc/thanh-loc";
import {
  KHOA_ACTIVE, MOC_DM, docLocDM, ghiLocDM, gopGiaTri, locMacDinh, nenCua, ngayGioTao, ngayTao,
  type LocDM, type LocManDM,
} from "./locDanhMuc";
import { DieuHuongDanhMuc } from "./dieuHuong";
import type { NavigateFn } from "../../components/AppShell";
import "../rebuild-catalog.css";
import { EmptyRow } from "../../components/EmptyState";
import {
  CuonLuoi, ChonCot, LocNhanhTrangThai, OTim, rongLuoi, useCauHinhLuoi, type CotLuoi, type MucLocNhanh,
} from "../../components/LuoiDs";

/** Số dòng mỗi trang MẶC ĐỊNH của mọi màn danh mục — người dùng đổi được ở ô "Dòng/trang" dưới
 *  chân bảng (05/10/2026, khuôn của màn Nhật ký). Trang cắt Ở MÁY CHỦ (`page`+`size`): mỗi lần mở
 *  màn chỉ kéo về một trang, không phải cả danh mục. Tìm kiếm và tab lọc vì thế cũng phải chạy ở máy
 *  chủ — lọc trong JS trên 20 dòng đang xem sẽ biến ô tìm thành "tìm trong trang này".
 *
 *  ⚠️ KHÔNG export: đây là con số của MÀN NÀY. Chỗ khác cần "20" thì tự khai — chia sẻ hằng này
 *  ra ngoài là sớm muộn có người đổi nó cho màn của họ rồi kéo cả 10 màn danh mục đi theo. */
const PAGE_SIZE = 25;

/** Bề rộng (px) cột Hành động = đúng cụm nút có thể hiện. Trước 18/09/2026 cột đóng cứng 8%: "Nhân
 *  bản" + "Xóa" bị ép tràn ra ngoài bảng, mở màn lên không thấy nút Xóa đâu.
 *
 *  05/10/2026 (chủ: "icon to ra cho dễ bấm và xóa chữ đi"): ba nút thành NÚT CHỈ ICON
 *  (`.rc__icon-btn`) — tên nút nằm ở `title` (rê chuột) + `aria-label` (trình đọc màn hình).
 *  08/10/2026 vào lưới dòng 34px: nút 28 × 26 (khớp rule `td.lds-nut .rc__icon-btn` ở
 *  `rebuild-catalog.css`: đổi cỡ ở đó thì đổi cả ở đây). */
const NUT_RONG = { nhanBan: 28, xoa: 28, batLai: 28 } as const;
/** Khe giữa hai nút (`.rc__acts` gap) + đệm trái / phải của ô nút. */
const NUT_KHE = 6;
const COT_NUT_DEM = 20;
/** Bề rộng mặc định cột Mã / Tên khi config không khai `widthMa` / `widthTen`. */
const RONG_MA = 130;
const RONG_TEN = 240;
/** Cột Ngày tạo: vừa "dd/mm/yyyy" + đệm ô. */
const COT_NGAY_RONG = 104;

/** Một cột của lưới danh mục: cột trang tự vẽ (Mã, Tên, Ngày tạo, Hành động) + cột khai ở config. */
interface CotDM extends CotLuoi { w?: number; n?: boolean }

/** Icon của điều kiện lọc theo tên khai trong config (`types.ts` không import component). */
const ICON_DK: Record<NonNullable<DieuKienDanhMuc["icon"]>, LucideIcon> = {
  nhom: Boxes, nguoi: Users, "trang-thai": CircleDot, "vi-tri": MapPin, "don-vi": Ruler,
  xe: Truck, "dung-cu": Wrench,
};
/** Mã màn trên URL khi config không khai `man` (màn dùng trong test). */
const manTuPrefix = (prefix: string) => prefix.replace(/^\/api\//, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function CatalogListPage({ config, onMutate, navigate }: {
  config: CatalogConfig; onMutate?: () => void;
  /** Cho ô bấm-để-mở-màn-khác (vd mã đơn ở Thành phẩm) — xem `dieuHuong.ts`. */
  navigate?: NavigateFn;
}) {
  const { token } = useAuth();
  const can = useCan();
  // Nạp bảng nhãn ĐƠN VỊ + CHẶNG dòng giấy cho cả trang lẫn drawer con: cột "Đơn vị" của màn Công
  // đoạn và ô chọn Đơn vị đầu vào/ra đọc `/api/don-vi/tram` (xem `tenDonVi.ts`). Gọi ở ĐÂY chứ
  // không ở từng config vì config là dữ liệu, không phải component — và một lần gọi ở gốc thì
  // drawer vẽ lại theo. Bảng nạp một lần cho cả phiên nên các màn khác không tốn thêm chuyến nào.
  useNapTenDonVi();
  // Gác nút GHI theo quyền module. Trước 15/08/2026 màn này không hỏi quyền một câu nào: vai
  // chỉ-đọc vẫn thấy đủ Thêm / Xóa / Bật lại, bấm xong mới ăn 403 — nút bày ra để rồi từ chối.
  // `moduleQuyen` bỏ trống (vd màn dùng trong test) = không gác, hành vi cũ y nguyên.
  const mQuyen = config.moduleQuyen;
  // `khongTaoTay` / `khongXoa` là luật CỦA MÀN, đứng TRƯỚC quyền: có quyền tạo vẫn không tạo
  // tay được, vì dòng ở đó do hệ sinh (xem `types.ts`).
  const duocTao = !config.khongTaoTay && (!mQuyen || can(mQuyen, "create"));
  const duocXoa = !config.khongXoa && (!mQuyen || can(mQuyen, "delete"));
  const duocBatLai = !mQuyen || can(mQuyen, "update");
  // `enableClone` là luật CỦA MÀN (chỉ 5 danh mục khai tay có route `/clone`); quyền `clone` TÁCH
  // khỏi `create` — vai được tạo mới (gõ tay) chưa chắc nên nhân bản hàng cũ (nhân đôi giá/công
  // thức đang chạy mà không soát lại từng ô).
  const duocClone = Boolean(config.enableClone) && (!mQuyen || can(mQuyen, "clone"));
  // Excel — HAI nút, HAI mức quyền khác nhau, đừng gộp làm một:
  //   · "Xuất Excel" chỉ cần quyền ĐỌC (đang đứng ở màn là đã đủ) — backend cũng gác `/mau-excel`
  //     bằng đúng dependency đọc của màn. Gộp chung với nhập là giấu mất đường lấy file khỏi
  //     người chỉ có quyền xem, trong khi họ chẳng ghi được gì.
  //   · "Nhập Excel" đòi CẢ `create` LẪN `update`: một dòng có thể là tạo mới hay cập nhật, mà
  //     lúc gác thì chưa ai biết — biết được thì đã đọc xong file rồi. Thiếu một trong hai mà vẫn
  //     hiện nút là mời bấm để ăn 403 giữa luồng.
  //   · Kể cả màn `khongTaoTay` (Thành phẩm): file chỉ SỬA được dòng đã có, nhưng cổng
  //     `POST /import-excel` của máy chủ vẫn đòi đủ `create` + `update` (`catalog_base.req_import`).
  //     Trước 05/10/2026 màn này miễn `create` ⇒ người chỉ có `update` thấy nút rồi bấm ăn 403.
  const duocXuatExcel = Boolean(config.enableImport);
  const coQuyenTao = !mQuyen || can(mQuyen, "create");
  const duocImport = duocXuatExcel && duocBatLai && coQuyenTao;
  const [showImport, setShowImport] = useState(false);
  const api = useMemo(() => crud(config.prefix), [config.prefix]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);      // renderDeleteDialog: dialog xóa riêng
  const [q, setQ] = useState("");
  const qTre = useTre(q);              // gõ xong 300ms mới hỏi máy chủ
  // Thanh lọc chung (06/10/2026): kỳ theo Ngày tạo + điều kiện của màn + Đang dùng / Đã ngừng —
  // thay hàng tab facet, bảng "Lọc nâng cao" và công tắc "Hiện mục đã ngừng" cũ. Ghi lên URL
  // (`?man=<id màn>`) và nhớ theo màn; lọc + đếm + cắt trang đều ở máy chủ.
  const man = config.man ?? manTuPrefix(config.prefix);
  // Ẩn / hiện / đổi chỗ cột: nhớ theo TỪNG danh mục (mỗi màn một khoá), mất thì về mặc định.
  const luoi = useCauHinhLuoi(`dm-${man}`);
  const macDinh = useMemo(() => locMacDinh(config), [config]);
  const [locMan, setLocMan] = useLocMan<LocManDM>(man, macDinh,
    (p) => docLocDM(p, config), (t) => ghiLocDM(t, config));
  const khoaLoc = JSON.stringify(locMan);
  const xemDaNgung = locMan.loc[KHOA_ACTIVE] === "false";
  const [dem, setDem] = useState<Record<string, DemGiaTri[]>>({});   // giá trị + số của từng điều kiện
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(PAGE_SIZE);
  const [total, setTotal] = useState(0);                                  // tổng SAU bộ lọc
  // Đổi bộ lọc thì về trang đầu — đứng ở trang 7 rồi gõ tìm còn 3 kết quả là bảng trống trơn.
  useEffect(() => { setPage(1); }, [qTre, khoaLoc, size]);

  // Dữ liệu phụ theo dòng (vd trạng thái máy). Nạp SONG SONG, không nối tiếp: cột phụ chậm không
  // được phép giữ cả bảng ở trạng thái skeleton.
  // `null` = CHƯA BIẾT (đang nạp, hoặc nạp hỏng) — khác hẳn "đã nạp xong, dòng này không có gì".
  // Gộp hai cái làm một là trong lúc chờ API, máy đang hỏng hiện "Rảnh" — sai đúng thứ người ta
  // mở bảng ra để tìm.
  const [extra, setExtra] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    // MỘT request cho MỘT trang: lọc + đếm + cắt trang đều nằm ở máy chủ. Trước 14/08/2026 màn
    // kéo cả danh mục về rồi lọc trong JS — danh mục lớn là vừa nặng đường truyền vừa cụt dữ
    // liệu (trần `size` của backend là 200).
    const { ky, loc } = JSON.parse(khoaLoc) as LocManDM;
    api.list(token, {
      page,
      size,
      ...(qTre.trim() ? { q: qTre.trim() } : {}),
      // Kỳ (`tu_ngay`/`den_ngay`/`moc`) + mọi điều kiện, kể cả `active` của màn xoá mềm.
      ...thamSoKy(ky),
      ...loc,
      // Xin số đếm của thanh lọc (`dem`) — máy chủ chỉ tính khi được hỏi rõ; ô chọn ở màn khác
      // gọi cùng endpoint mà không gửi cờ này nên không gánh thêm câu GROUP BY.
      kem_dem: true,
    })
      .then((r) => {
        setRows(r.items);
        setTotal(r.total);
        setDem(r.dem ?? {});
        // Xoá nốt dòng cuối của trang cuối ⇒ `total` co lại mà `page` đứng yên ⇒ bảng rỗng trơn,
        // người dùng tưởng mất sạch dữ liệu. Lùi về trang cuối còn thật.
        const ve = trangHopLe(page, r.total, size);
        if (ve !== null) setPage(ve);
      })
      // Giữ LÝ DO thôi, không gói sẵn câu "Không tải được danh sách" vào đây: khối rỗng của bảng
      // đã nói câu đó rồi, nhét cả hai vào một chỗ là đọc ra hai lần cùng một ý.
      .catch((e) => setError(e instanceof ApiError ? e.message : "Máy chủ không phản hồi."))
      .finally(() => setLoading(false));
  }, [token, api, page, size, qTre, khoaLoc]);
  useEffect(() => { load(); }, [load]);

  // Dữ liệu phụ nạp RIÊNG, không đi kèm mỗi lần lật trang: nó là map cho CẢ danh mục (vd trạng
  // thái mọi máy), lật trang không làm nó khác đi. Chỉ nạp lại sau khi có người ghi (`tick`).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!token || !config.loadExtra) return;
    // Hỏng thì để nguyên `null` — cột phụ sẽ nói "chưa biết" chứ không bịa ra trạng thái đẹp.
    config.loadExtra(token).then(setExtra).catch(() => setExtra(null));
  }, [token, config.loadExtra, tick]);

  /** Sau khi TẠO / SỬA / XÓA: tải lại cả bảng lẫn dữ liệu phụ. */
  const lamMoi = useCallback(() => { load(); setTick((t) => t + 1); }, [load]);

  // Danh mục THẬT làm nền cho giá trị của điều kiện (`dieuKien[].nguon`, vd Nhóm máy). Nạp lại sau
  // mỗi lần ghi (`tick`): khai thêm một nhóm trong drawer là thanh lọc phải có ngay chỗ của nó, kể
  // cả khi chưa dòng nào thuộc về (số 0). Hỏng thì chỉ còn giá trị máy chủ đếm được — KHÔNG bịa ra
  // danh sách tên nằm sẵn trong code (danh mục là động).
  const khoaNguon = (config.dieuKien ?? []).map((d) => d.nguon).filter(Boolean).join("|");
  const [nguon, setNguon] = useState<Record<string, Option[]>>({});
  useEffect(() => {
    if (!token || !khoaNguon) return;
    let alive = true;
    for (const prefix of khoaNguon.split("|")) {
      crud(prefix).list(token, { page: 1, size: 200 })
        .then((r) => {
          if (!alive) return;
          const ds = r.items.map((it) => String(it.ten ?? "").trim()).filter(Boolean)
            .map((v) => ({ value: v, label: v }));
          setNguon((n) => ({ ...n, [prefix]: ds }));
        })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, [token, khoaNguon, tick]);

  const dieuKien = useMemo<DieuKien<LocDM>[]>(() => {
    const ds: DieuKien<LocDM>[] = (config.dieuKien ?? []).map((d) => ({
      khoa: d.key, nhan: d.nhan, icon: ICON_DK[d.icon ?? "nhom"], kieu: "mot",
      // Giá trị đến từ danh mục khác hoặc từ chính dữ liệu (không có nền khai sẵn) ⇒ luôn có ô tìm.
      tim: Boolean(d.nguon) || !d.giaTri,
      giaTri: gopGiaTri(nenCua(d, nguon), dem[d.key], d.nhanGiaTri),
      doc: (l) => l[d.key],
      ghi: (l, v) => ({ ...l, [d.key]: v }),
    }));
    return ds;
  }, [config.dieuKien, nguon, dem]);

  // Hàng lọc nhanh Đang dùng / Đã ngừng / Tất cả (màn xoá mềm) — số đếm của MÁY CHỦ (`dem.active`,
  // đếm dưới mọi bộ lọc khác), không đếm trong JS. Trước 08/10/2026 đây là một điều kiện trong nút
  // Lọc; nay là hàng nút bật riêng phía trên ô tìm, cùng khuôn lưới của 5 màn Kinh doanh.
  const trangThai = locMan.loc[KHOA_ACTIVE] ?? "";
  const demActive = dem[KHOA_ACTIVE];
  const soDung = demActive?.find((d) => d.value === "true")?.so;
  const soNgung = demActive?.find((d) => d.value === "false")?.so;
  const mucTrangThai: MucLocNhanh[] = [
    { key: "", label: "Tất cả", count: demActive ? (soDung ?? 0) + (soNgung ?? 0) : undefined },
    { key: "true", label: "Đang dùng", count: demActive ? soDung ?? 0 : undefined, mau: "la" },
    { key: "false", label: "Đã ngừng", count: demActive ? soNgung ?? 0 : undefined, mau: "xam" },
  ];
  const chonTrangThai = (key: string) => setLocMan({ ...locMan, loc: { ...locMan.loc, [KHOA_ACTIVE]: key || undefined } });

  // Bảng rỗng khi đang lọc KHÔNG có nghĩa "chưa có gì trong hệ thống" — kể cả khi đang xem mục
  // đã ngừng. Mặc định (Đang dùng, kỳ Tất cả) thì không tính là đang lọc.
  const dangLoc = qTre.trim() !== "" || khoaLoc !== JSON.stringify(macDinh);
  const bangTrong = !loading && rows.length === 0;
  // Cột Hành động rộng theo cụm nút DÀI NHẤT có thể nằm trên một dòng: dòng còn dùng mang Nhân bản
  // + Xóa, dòng đã ngừng chỉ mang Bật lại. Sàn 96px để tiêu đề "Hành động" đứng một dòng. Không
  // dòng nào có nút (vd Thành phẩm: không xoá, không nhân bản) thì KHÔNG mọc cột — trước đây vẫn
  // chừa 8% trống trơn dưới tiêu đề "Hành động".
  const rongNutSong = (duocClone ? NUT_RONG.nhanBan : 0) + (duocXoa ? NUT_RONG.xoa : 0)
    + (duocClone && duocXoa ? NUT_KHE : 0);
  const rongNutNgung = duocBatLai && (xemDaNgung || rows.some((r) => r.active === false)) ? NUT_RONG.batLai : 0;
  const rongNut = Math.max(rongNutSong, rongNutNgung);
  const coCotNut = rongNut > 0;
  const rongCotNut = Math.max(96, rongNut + COT_NUT_DEM);

  // Cột của lưới: Mã + Tên cố định (ghim khi cuộn ngang), Ngày tạo, rồi cột khai ở config theo thứ tự
  // nhóm nghĩa của màn (Ghi chú cuối, không khai bề rộng ⇒ ăn phần còn lại), cột Hành động nếu có.
  // Cột Hành động cố định ở cuối và KHÔNG nằm trong hộp "Cột" (`cotDuLieu`) — luôn hiện.
  const cotDuLieu: CotDM[] = [
    { key: "ma", label: "Mã", coDinh: true, w: config.widthMa ?? RONG_MA },
    { key: "ten", label: "Tên", coDinh: true, w: config.widthTen ?? RONG_TEN },
    ...(config.anNgayTao ? [] : [{ key: "ngay", label: "Ngày tạo", w: COT_NGAY_RONG }]),
    ...config.columns.map((c) => ({ key: c.key, label: c.label, w: c.w, n: c.n })),
  ];
  const cotTatCa: CotDM[] = coCotNut
    ? [...cotDuLieu, { key: "nut", label: "Hành động", coDinh: true, w: rongCotNut }]
    : cotDuLieu;
  const cotHien = luoi.rongHien(luoi.xep(cotTatCa).filter((c) => !luoi.an.has(c.key)));
  const dangMo = editing && editing !== "new" ? editing.id : null;
  const cotCuaConfig = new Map(config.columns.map((c) => [c.key, c]));

  const [confirmDeleteRow, setConfirmDeleteRow] = useState<Row | null>(null);

  function remove(r: Row) {
    if (!token) return;
    if (config.renderDeleteDialog) { setDeleting(r); return; }   // luồng xóa riêng (vd Kho)
    setConfirmDeleteRow(r);
  }

  /** Bật lại một mục đã ngừng — route riêng `PATCH /{id}/active`, xem `crud.datActive`. */
  async function batLai(r: Row) {
    if (!token) return;
    try {
      await api.datActive(token, r.id, true);
      lamMoi();
      onMutate?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không bật lại được.");
    }
  }

  /** Nhân bản — server copy toàn bộ cột, tự đặt mã/tên "(bản sao)" không trùng. Mở luôn dòng mới
   *  trong drawer để đổi tên/giá ngay, không bắt tìm lại nó giữa cả bảng. */
  async function clone(r: Row) {
    if (!token) return;
    try {
      const moi = await api.clone(token, r.id);
      lamMoi();
      onMutate?.();
      setEditing(moi);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không nhân bản được.");
    }
  }

  /** Xuất Excel — CHỈ dòng đang dùng, nhưng ĐỦ ô cấu hình hiện hành: mọi công thức, bậc tính và bảng
   *  con đi ra sheet riêng đọc được. Danh mục rỗng thì chỉ còn dòng tiêu đề, tự đóng vai file mẫu —
   *  nên không còn nút "Tải mẫu" riêng. */
  async function xuatExcel() {
    if (!token) return;
    try {
      const url = await api.templateBlobUrl(token);
      const a = document.createElement("a");
      a.href = url;
      a.download = `xuat-${config.prefix.split("/").pop()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không xuất được file.");
    }
  }

  const khoaCua = (r: Row) => config.dongKhoa?.(r) ?? null;
  /** Dòng khoá mà KHÔNG mở form (mục cố định Mục thu chi); `dongKhoaMoDuoc` thì vẫn mở. */
  const chanMo = (r: Row) => !!khoaCua(r) && !config.dongKhoaMoDuoc;

  /** Một ô của dòng `r` ở cột `cot`. Chữ dài cắt "…", đủ chữ ở `title`. */
  function oDong(cot: CotDM, r: Row) {
    switch (cot.key) {
      case "ma": {
        const ma = config.maHienHoa ? String(r.ma).toUpperCase() : String(r.ma);
        return <td key={cot.key} title={ma}>{ma}</td>;
      }
      case "ten":
        return (
          <td key={cot.key} title={String(r.ten)}>
            {/* Tên cắt "…" khi dài, nhãn "Đã ngừng" luôn còn (xem `.dm-ten` ở rebuild-catalog.css). */}
            <div className="dm-ten">
              <span className="dm-ten__chu">{String(r.ten)}</span>
              {khoaCua(r) && (
                <span className="dm-ten__khoa" title={khoaCua(r) ?? undefined} aria-label={khoaCua(r) ?? undefined}>
                  <LockIcon size={13} />
                </span>
              )}
              {r.active === false && (
                <span className="lds-tag" title="Đã ngừng dùng — không hiện ở ô chọn khi tạo mới, nhưng chứng từ cũ vẫn giữ nguyên">
                  Đã ngừng
                </span>
              )}
            </div>
          </td>
        );
      case "ngay":
        return <td key={cot.key} title={ngayGioTao(r.created_at)}>{ngayTao(r.created_at)}</td>;
      case "nut":
        // Không có quyền thì ô rỗng, KHÔNG phải nút xám: nút xám vẫn là một lời mời, người ta hover đi
        // hover lại tìm cách bật nó lên. Xóa vẫn qua hộp xác nhận nên bấm nhầm không mất dòng ngay.
        // Nhãn đọc màn hình kèm TÊN dòng: cả cột đều là "Xóa", nghe một chuỗi "Xóa, Xóa, Xóa" là
        // không biết đang đứng ở dòng nào.
        if (khoaCua(r)) return <td key={cot.key} className="lds-nut" />;
        return (
          <td key={cot.key} className="lds-nut" onClick={(e) => e.stopPropagation()}>
            <div className="rc__acts">
              {r.active === false ? (
                duocBatLai && (
                  <button type="button" className="rc__icon-btn" onClick={() => batLai(r)}
                    aria-label={`Bật lại ${String(r.ten)}`}
                    title="Bật lại — mục này sẽ hiện lại ở các ô chọn">
                    <UndoIcon size={17} />
                  </button>
                )
              ) : (
                <>
                  {duocClone && (
                    <button type="button" className="rc__icon-btn" onClick={() => clone(r)}
                      aria-label={`Nhân bản ${String(r.ten)}`}
                      title="Nhân bản — tạo một dòng mới sao y dòng này, đổi tên rồi lưu">
                      <CopyIcon size={17} />
                    </button>
                  )}
                  {duocXoa && (
                    <button type="button" className="rc__icon-btn rc__icon-btn--danger" onClick={() => remove(r)}
                      aria-label={`Xóa ${String(r.ten)}`} title="Xóa">
                      <TrashIcon size={17} />
                    </button>
                  )}
                </>
              )}
            </div>
          </td>
        );
      default: {
        const c = cotCuaConfig.get(cot.key);
        if (!c) return <td key={cot.key} />;
        const noi = c.render
          ? c.render(r, extra ? (extra[String(r.id)] ?? null) : undefined)
          : (r[c.key] == null || r[c.key] === "" ? "" : String(r[c.key]));
        return (
          <td key={cot.key} className={c.n ? "n" : undefined} title={typeof noi === "string" && noi !== "" ? noi : undefined}>
            {noi}
          </td>
        );
      }
    }
  }

  return (
    // `rc--dm`: scope RIÊNG của màn danh mục. Không dùng `.rc` sẵn có làm mốc vì `KhoPage` và
    // `KhoHangView` cũng là `<main className="rc">` — đè theo `.rc` là rò ngược sang Kho.
    // Xem khối "GIÀNH LẠI …" ở cuối `rebuild-catalog.css`.
    // Provider để ngoài cùng, không thụt lề cả khối cho gọn diff — xem `dieuHuong.ts`.
    <DieuHuongDanhMuc.Provider value={navigate}>
    <main className="rc rc--dm lds">
      {/* Đầu trang: tên màn + các nút chính (Excel, Thêm) — một hàng riêng, không chen ô lọc. Số bản
          ghi nằm ở chân bảng ("tổng N bản ghi"), không nhắc lại ở đây. */}
      <header className="lds-dau">
        <h1 className="lds-dau__ten">{config.heading ?? config.title}</h1>
        <div className="lds-dau__nut">
          {duocXuatExcel && (
            <Button variant="ghost" onClick={xuatExcel} title="Xuất toàn bộ cấu hình đang dùng ra Excel — sửa rồi nhập lại để cập nhật hàng loạt">
              <DownloadIcon /> Xuất Excel
            </Button>
          )}
          {duocImport && (
            <Button variant="ghost" onClick={() => setShowImport(true)}>
              <UploadIcon /> Nhập Excel
            </Button>
          )}
          {duocTao && (
            <Button variant="accent" onClick={() => setEditing("new")}>
              <PlusIcon /> Thêm {config.title.toLowerCase()}
            </Button>
          )}
        </div>
      </header>

      {/* Bảng RỖNG vì tải hỏng thì để khối rỗng nói (nó có nút Tải lại rồi) — hai chỗ cùng kêu một
          lỗi kèm hai nút "Tải lại" là bắt người ta đoán xem nên bấm cái nào. Banner ở đây chỉ còn
          lo lỗi XẢY RA KHI BẢNG ĐANG CÓ DỮ LIỆU (xoá hụt, bật lại hụt). */}
      {error && !bangTrong && (
        <div className="banner banner--error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn--ghost" style={{ padding: "4px 12px", fontSize: "12px" }} onClick={() => { setError(null); load(); }}>Tải lại</button>
        </div>
      )}

      <section className="lds-loc">
        {config.softDelete && (
          <LocNhanhTrangThai muc={mucTrangThai} dang={trangThai} onChon={chonTrangThai} />
        )}
        <div className="lds-loc__thanh tl-thanh" role="search">
          <OTim value={q} onChange={setQ} placeholder={config.timGoiY ?? "Tìm mã / tên…"} ariaLabel={`Tìm ${config.title.toLowerCase()}`} />
          <ThanhLoc
            ky={locMan.ky}
            moc={MOC_DM}
            onKy={(ky) => setLocMan({ ...locMan, ky })}
            dieuKien={dieuKien}
            loc={locMan.loc}
            onLoc={(loc) => setLocMan({ ...locMan, loc })}
          />
          <ChonCot cot={cotDuLieu} {...luoi.chonCot} />
        </div>
      </section>

      <div className="lds-sheet">
        <CuonLuoi ghim={luoi.soGhim(cotHien)}>
          <table className="lds-g" style={{ minWidth: rongLuoi(cotHien) }}>
            <colgroup>
              {cotHien.map((c) => <col key={c.key} style={c.w ? { width: c.w } : undefined} />)}
            </colgroup>
            <thead>
              <tr>
                {cotHien.map((c) => <th key={c.key} className={c.n ? "n" : undefined}>{c.label}{luoi.keo(c.key)}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <EmptyRow colSpan={cotHien.length} trangThai="dang-tai" />
              ) : rows.length === 0 ? (
                // BA ca khác hẳn nhau, đừng gộp: (a) chưa có gì · (b) bộ lọc không ra · (c) TẢI HỎNG.
                // Trước 15/08/2026 backend chết là bảng vẫn in "Chưa có giấy nào trong hệ thống." —
                // bảng NÓI SAI SỰ THẬT, và câu sai đó còn mời người ta đi tạo lại dữ liệu đang có.
                <tr>
                  <td colSpan={cotHien.length} className="lds-trong">
                    {error ? (
                      <>
                        <span className="lds-do">Không tải được danh sách.</span>{" "}
                        <span className="lds-mu">{error}</span>{" "}
                        <button type="button" className="lds-lk" onClick={() => { setError(null); load(); }}>Tải lại</button>
                      </>
                    ) : dangLoc ? (
                      <>
                        {`Không có ${config.title.toLowerCase()} nào khớp điều kiện đang lọc.`}{" "}
                        <button type="button" className="lds-lk" onClick={() => { setQ(""); setLocMan(macDinh); }}>Xoá bộ lọc</button>
                      </>
                    ) : (
                      <>
                        {`Chưa có ${config.title.toLowerCase()} nào trong hệ thống.`}
                        {duocTao && (
                          <>
                            {" "}
                            <button type="button" className="lds-lk" onClick={() => setEditing("new")}>
                              Tạo {config.title.toLowerCase()}
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ) : rows.map((r) => (
                // Cả dòng bấm được bằng chuột; bàn phím thì Tab tới dòng rồi Enter / Space — dòng là
                // `<tr tabIndex>` chứ không gán `role="button"` (gán vai nút cho hàng là mất vai
                // "row", trình đọc màn hình hết đọc được tên cột đi kèm ô).
                // Dòng khoá (chỉ đọc) không mở form: không tab tới, không con trỏ tay.
                <tr key={r.id} tabIndex={chanMo(r) ? undefined : 0}
                  className={`lds-dong${r.active === false ? " is-ngung" : ""}${r.id === dangMo ? " is-chon" : ""}${chanMo(r) ? " is-khoa" : ""}`}
                  onClick={() => { if (!chanMo(r)) setEditing(r); }}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget || chanMo(r)) return;   // Enter trên nút trong dòng là việc của nút
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditing(r); }
                  }}>
                  {cotHien.map((c) => oDong(c, r))}
                </tr>
              ))}
            </tbody>
          </table>
        </CuonLuoi>
        {/* Chân bảng: `total` là tổng SAU bộ lọc (đúng cái đang được cắt trang). Bảng rỗng thì ẩn —
            khối "chưa có / không tìm thấy" đã nói giúp, thêm dòng "Tổng 0 bản ghi" là thừa. Khóa nút
            khi đang tải để bấm dồn không đẻ ra hai lượt gọi chồng nhau. */}
        {total > 0 && (
          <PhanTrangDayDu trang={page} size={size} tong={total} soDong={rows.length}
            onTrang={setPage} onSize={setSize} loading={loading} ariaLabel={`Phân trang ${config.title.toLowerCase()}`} />
        )}
      </div>

      {editing && (
        <CatalogDrawer config={config} existing={editing === "new" ? null : editing}
          onClose={() => { setEditing(null); lamMoi(); }}
          onSaved={(moi) => {
            setEditing(config.moLaiSauKhiTao && editing === "new" && moi ? moi : null);
            lamMoi();
            onMutate?.();
          }} />
      )}

      {deleting && token && config.renderDeleteDialog?.(deleting, {
        token,
        onClose: () => setDeleting(null),
        onDone: () => { setDeleting(null); lamMoi(); onMutate?.(); },
      })}

      {confirmDeleteRow && token && (
        <XoaDanhMucDialog
          row={confirmDeleteRow}
          config={config}
          token={token}
          onClose={() => setConfirmDeleteRow(null)}
          onXong={() => { lamMoi(); onMutate?.(); }}
          onLoi={setError}
        />
      )}

      {showImport && token && (
        <ImportExcelDialog
          ten={config.title.toLowerCase()}
          // Màn `khongTaoTay` (Thành phẩm): máy chủ bác mọi mã mới ⇒ câu mặc định "Mã chưa có sẽ
          // TẠO MỚI" là nói sai, người dùng làm theo là bị bác cả file.
          luat={config.khongTaoTay
            ? `Bấm "Xuất Excel" cạnh nút này để lấy file đúng định dạng đang chạy, sửa trên chính file đó rồi chọn lại ở đây. Chỉ SỬA được dòng đã có — ${config.title.toLowerCase()} không khai tay được nên mã chưa có trong hệ thống sẽ bị báo lỗi và cả file không được ghi. Ô để trống ở một cột CÓ trong file sẽ xoá giá trị cột đó, còn cột không có trong file thì giữ nguyên. Dòng không có trong file được giữ nguyên, không bị xoá. Cả file là MỘT lượt: còn một dòng lỗi thì không ghi gì cả.`
            : undefined}
          chay={(f, mode) => crud(config.prefix).importExcel(token, f, mode)}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); lamMoi(); onMutate?.(); }}
        />
      )}
    </main>
    </DieuHuongDanhMuc.Provider>
  );
}
