// Drawer CHI TIẾT 1 BƯỚC routing — chỗ khai đủ thứ mà bảng không chứa nổi.
//
// Vì sao tách khỏi bảng: routing lát này cần nhiều dữ liệu mỗi bước (đơn vị, thời gian, nhân công,
// vật tư, phụ thuộc và gia công ngoài). Nhồi hết vào bảng thì mỗi ô còn
// ~60px và phải cuộn ngang liên tục. Bảng giữ phần QUYẾT ĐỊNH (bước nào, ai làm, bao lâu), drawer
// giữ phần KHAI BÁO.
//
// Sửa ở đây ghi THẲNG vào state của bảng (không có nút "Áp dụng" riêng) — vẫn chỉ một nút "Lưu
// công đoạn" duy nhất ở bảng, nên người dùng không phải nhớ mình đang ở tầng lưu nào.
//
// Năng suất là snapshot chỉ đọc từ máy hoặc định mức đầu việc; người dùng chỉ nhập đè thời gian.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ApiError, api, LSX_LOAI_BUOC_META, type LsxLoaiBuoc, type NhaGiaCong } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { Button } from "../components/Button";
import { Select, type SelectOption } from "../components/Select";
import { CongThucTip, ketQuaDienGiai } from "../components/CongThucTip";
import type { ViTriDai } from "./gia-cong/giaCong";
import { dvNhan as dvNhanChung, type RefRow } from "./LsxRoutingTable";
import { coDonViGoc, nhanDongTon } from "../lib/khoGiay";
import { num } from "./keHoachSxShared";
import { donViOptions, tenDonVi, useNapTenDonVi } from "./tenDonVi";
import {
  type EditRow,
  type HangLoai,
  capMon,
  giayChoLuu,
  heSoChu,
  mayChonDuoc,
  mayMacDinh,
  mayMacDinhCuaTo,
  toChuaCoMay,
  toKhacCuaMay,
  nhanChang,
  nhanDonVi,
  nhanGiayTheoDauVao,
  phut,
  tenBuoc,
  thoiLuong,
  thoiLuongLive,
} from "./lsxBuoc";

// Bước THUÊ NGOÀI (spec gia công ngoài 2026-09-26): nhà gia công lo máy, người, vật tư, thời gian.
// Drawer chỉ còn NHÀ GIA CÔNG (danh mục Nhà cung cấp tích "Nhận gia công") + ĐƠN GIÁ cả lần ở bước
// cuối dải. Mang đi / chốt số làm ở khối Gia công ngoài trên lệnh sau phát hành.
const LOAI_BUOC_ORDER: LsxLoaiBuoc[] = ["may", "to", "thue_ngoai"];

/** Gom máy theo `loai_may`.
 *  Xưởng có ~24 máy đủ loại (bế, bồi, UV, cán, in) — đổ phẳng thì gán máy bế cho bước ghi kẽm
 *  cũng trôi. Nhóm KHÔNG chặn: vẫn chọn được máy bất kỳ, chỉ là mắt phải đi qua nhãn loại. */
const DS_TEN = new Intl.ListFormat("vi", { style: "long", type: "conjunction" });

function nhomMayTheoLoai(mayRefs: RefRow[]): { ten: string; items: RefRow[] }[] {
  const groups = new Map<string, RefRow[]>();
  for (const m of mayRefs) {
    const k = (m.nhom || "").trim() || "Chưa phân loại";
    const arr = groups.get(k);
    if (arr) arr.push(m);
    else groups.set(k, [m]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "vi"))
    .map(([ten, items]) => ({ ten, items }));
}

export type TabKey =
  | "nhan_dien"
  | "so_luong"
  | "ai_lam"
  | "vat_tu"
  | "phu_thuoc"
  | "thoi_gian"
  | "cau_hinh"
  | "phan_cong"
  | "tien_do";

type MainTab = "cau_hinh" | "phan_cong" | "vat_tu" | "tien_do" | "phu_thuoc";

function normalizeTab(t?: TabKey): MainTab {
  if (!t) return "cau_hinh";
  if (t === "nhan_dien" || t === "so_luong" || t === "cau_hinh") return "cau_hinh";
  if (t === "ai_lam" || t === "phan_cong") return "phan_cong";
  if (t === "vat_tu") return "vat_tu";
  // Phụ thuộc DAG tách khỏi "Tiến độ & Thời gian" 18/08/2026: chọn tiền nhiệm là việc của người
  // xếp lịch, xem giờ chạy là việc của người lập kế hoạch — hai đầu việc khác nhau, cuộn qua nhau.
  if (t === "phu_thuoc") return "phu_thuoc";
  if (t === "thoi_gian" || t === "tien_do") return "tien_do";
  return "cau_hinh";
}

export function LsxBuocDrawer({
  row,
  index,
  tong,
  laBuocGiao,
  soLuongDat,
  congDoanRefs,
  toRefs,
  mayRefs,
  khuonRefs,
  tenSanPham,
  tenKhach,
  onTaoKhuon,
  vatTuRefs,
  giayRefs,
  phuThuocRefs,
  baiGhep,
  daiGiaCong = null,
  // (`dvChuoi` vẫn là prop — nơi gọi vẫn truyền — nhưng thân drawer hiện KHÔNG đọc tới, nên bỏ
  //  khỏi destructure cho `tsc` sạch. Cần dùng lại thì thêm tên vào đây, không phải sửa kiểu.)
  canUpdate,
  onPatch,
  onPatchLsx,
  onDoiCongDoan,
  onDoiMay,
  onDoiTo,
  tabDau,
  onClose,
  onPrev,
  onNext,
}: {
  row: EditRow;
  index: number;
  tong: number;
  /** Bước này có phải BƯỚC GIAO KHÁCH không — bước cuối TRÊN DÒNG GIẤY, do bảng cha suy từ cả
   *  chuỗi (khớp backend `buoc[-1]`). KHÔNG suy từ `index === tong-1`: bước bản-kèm/CTP chèn giữa
   *  vẫn có thể đứng cuối bảng mà không giao khách. */
  laBuocGiao: boolean;
  soLuongDat: number;
  congDoanRefs: RefRow[] | null;
  toRefs: RefRow[] | null;
  mayRefs: RefRow[] | null;
  /** Dao chọn được của LỆNH này — server đã lọc theo khách. Lọc tiếp theo loại của bước làm ở
   *  `KhuonCuaBuoc`; danh sách tới đây chỉ còn vài dòng nên lọc ở màn là hợp lý, không phải
   *  "kéo cả bảng về rồi cắt". */
  khuonRefs: import("../api/client").KhuonChonDuoc[] | null;
  /** Tên sản phẩm của lệnh — mặc định cho tên dao mới (KHÔNG lấy tên bước). */
  tenSanPham: string;
  /** Tên khách của lệnh — để khối Khuôn nói rõ danh sách đang lọc theo ai. */
  tenKhach: string;
  /** Tạo dao mới cho bước — trả id dao vừa tạo để gán luôn. */
  onTaoKhuon: (input: { ten: string; loai: string | null }) => Promise<number>;
  vatTuRefs: RefRow[] | null;
  giayRefs: RefRow[] | null;
  phuThuocRefs: import("../api/client").LsxPhuThuocOption[];
  /** Lệnh đang ghép chung tờ — bước in của nó do BÀI điều phối, khoá máy ở đây. */
  baiGhep: import("../api/client").LsxBaiGhep | null;
  /** Vị trí trong DẢI gia công (bảng cha suy bằng `viTriTrongDai`) — `null` khi không thuê ngoài. */
  daiGiaCong?: ViTriDai | null;
  /** Đơn vị bốn chặng của cả chuỗi (bảng routing suy ra bằng `donViChuoi`). Drawer chỉ thấy MỘT
   *  bước nên không tự suy được chặng thành phẩm — mà câu "số con sửa tại bài" cần đúng chặng đó. */
  dvChuoi: import("./lsxBuoc").DonViChuoi;
  canUpdate: boolean;
  onPatch: (p: Partial<EditRow>) => void;
  /** Sửa thẳng CẤP LỆNH — chỉ bước CUỐI dùng: SL thành phẩm cần giao (`so_luong_dat`). Cả chuỗi
   *  phía trên tính ngược lại từ số này. */
  onPatchLsx?: (p: { so_luong_dat?: number }) => void;
  /** Đổi công đoạn: kéo lại toàn bộ mặc định của công đoạn mới (giữ SL vào/ra). */
  onDoiCongDoan: (congDoanId: number | null) => void;
  /** Đổi máy: tốc độ + chuẩn bị lấy theo danh mục Máy NGAY, rồi hỏi server thời lượng mới. Không
   *  đi qua `onPatch` vì hai số đó không nằm trong form — chúng tới từ máy vừa chọn. */
  onDoiMay: (mayId: number | null) => void;
  /** Đổi tổ: chọn MỘT trong các tổ phụ trách của công đoạn. */
  onDoiTo: (departmentId: number | null) => void;
  /** Mở sẵn tới khối nào (badge ngoài bảng/sơ đồ bấm vào là nhảy thẳng, khỏi cuộn tìm). */
  tabDau?: TabKey;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [activeTab, setActiveTab] = useState<MainTab>(() => normalizeTab(tabDau));

  // Bước đang bị bài ghép ĐÈ: máy thật nằm ở bài. Cho sửa ở đây là cho sửa một ô vô tác dụng —
  // xếp lịch không đọc nó, thời lượng cũng tính theo máy của bài.
  const deLen = baiGhep?.buoc_bi_de?.[row.key] ?? null;
  const buocGhep = baiGhep && deLen ? baiGhep : null;
  const doiDonVi = !!row.don_vi_vao && !!row.don_vi_ra && row.don_vi_vao !== row.don_vi_ra;
  // Bước GIAO KHÁCH là chỗ DUY NHẤT còn gõ số: SL thành phẩm cần giao (`so_luong_dat`). Bảng cha
  // đã xác định bước nào giao khách (cuối dòng giấy, không phải cuối bảng) và truyền `laBuocGiao`.
  const laBuocCuoi = laBuocGiao && !!row.don_vi_ra;
  const [slRaCuoi, setSlRaCuoi] = useState(String(soLuongDat ?? 0));
  useEffect(() => setSlRaCuoi(String(soLuongDat ?? 0)), [soLuongDat]);

  // Bảng nhãn đơn vị nạp ở bảng cha rồi, gọi lại ở đây chỉ để drawer TỰ vẽ lại khi bảng về muộn
  // (hook có cache + danh sách người chờ dùng chung, không đẻ thêm request).
  const napDv = useNapTenDonVi();
  // Bước NGOÀI dòng giấy (ghi kẽm, đóng thùng): số không suy được từ chuỗi giấy, cũng không công
  // thức chung nào ở danh mục nói hộ — số bản kẽm đổi theo số màu/số mặt/số bài của TỪNG đơn. Nên
  // đây là chỗ DUY NHẤT khai được, và khai xong thì danh mục thôi kéo lại (`tu_khai_don_vi` ở BE).
  const laNgoaiDong = row.tren_dong_giay === false;
  const khaiTay = laNgoaiDong && canUpdate;
  const dvOpts = useMemo<SelectOption<string>[]>(() => {
    const ds = donViOptions();
    return [
      { value: "", label: ds.length ? "— chưa khai —" : "Đang nạp danh mục Đơn vị…" },
      ...ds.map((o) => ({ value: o.value, label: o.label, hint: o.value })),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [napDv]);
  // Đơn vị để DÁN CẠNH SỐ — cùng hàm bảng routing dùng. Lối lùi về đơn vị sản lượng của danh mục
  // GỠ 18/09/2026 (mg `0324`): bước ngoài dòng chỉ có đơn vị khi người lập lệnh tự khai.
  // Thôi truyền `row` từ 20/09/2026: nhãn giờ chỉ phụ thuộc MÃ đơn vị, không còn bị nhóm công
  // đoạn của bước bịt lại (xem `dvNhan` ở LsxRoutingTable).
  const dvNhan = dvNhanChung;
  // Dòng "Số vào = ra ÷ hệ số × (1 + hao%) + hao" của bước ngoài dòng GỠ 18/09/2026 (mg `0324`)
  // cùng `LsxService.buoc_ngoai_dong` nó diễn giải — server thôi suy số vào từ số ra cho bước ấy.

  // Danh sách CÔNG ĐOẠN cho ô gõ-lọc. Danh mục công đoạn đã hơn 30 dòng và còn dài ra; thẻ
  // <select> gốc chỉ nhảy theo ký tự ĐẦU nên "cán màng" phải gõ đúng "c-á-n", gõ "can mang"
  // hay "mang mo" đều trượt. `Select searchable` khớp gần đúng (bỏ dấu, tách từ — xem
  // `utils/timGanDung`) và soi cả `hint`, nên mã CD-00xx cũng tìm được.
  const cdOpts = useMemo<SelectOption<string>[]>(() => {
    if (!congDoanRefs) return [];
    const ds: SelectOption<string>[] = [{ value: "", label: "— chọn công đoạn —" }];
    // Bước khai tên tự do (không nối danh mục) và bước trỏ tới công đoạn ĐÃ ẨN/XOÁ khỏi danh mục
    // vẫn phải hiện đúng tên đang có, không thì mở drawer ra là thấy ô rỗng và lưu đè mất tên.
    if (row.cong_doan_id == null && row.ten) {
      ds.push({ value: "__keep__", label: `${row.ten} (tên tự do)` });
    }
    if (row.cong_doan_id != null && !congDoanRefs.some((c) => c.id === row.cong_doan_id)) {
      ds.push({ value: String(row.cong_doan_id), label: row.ten });
    }
    for (const c of congDoanRefs) {
      ds.push({ value: String(c.id), label: c.ten, search: c.ma ?? "" });
    }
    return ds;
  }, [congDoanRefs, row.cong_doan_id, row.ten]);

  // Danh sách MÓN thêm được vào khối vật tư của bước. Nhãn KHÔNG mang mã: danh sách này dài và
  // mã "GL-0001-COPY-COPY" đẩy tên món ra sau, nhìn cả cột chỉ thấy tiền tố giống nhau. Mã chuyển
  // xuống `search` — vẫn gõ mã ra được, chỉ là không chiếm chỗ trên màn.
  const themMonOpts = useMemo<SelectOption<string>[]>(() => {
    const daCo = (hl: HangLoai, id: number) =>
      row.vat_tus.some((v) => capMon(v.hang_loai, v.vat_tu_id) === capMon(hl, id));
    const ds: SelectOption<string>[] = [];
    // GIẤY đứng TRƯỚC: đây là món đắt nhất và là thứ người lập lệnh tìm đầu tiên. Chọn giấy ở đây
    // CHÍNH LÀ khai NVL chính cho bước — bước nào mang dòng giấy thì ngày cần giấy bám bước đó.
    for (const x of giayRefs ?? []) {
      if (daCo("giay", x.id)) continue;
      // Khổ gợi ý của chính mã này (nếu máy chủ đã tính cho bước) — để nhãn nói "khổ 1000 mm (kg)".
      const khoGoiY = row.vat_tu_goi_y.find((g) => capMon(g.hang_loai, g.vat_tu_id) === capMon("giay", x.id))?.kho_rong;
      const nhanDv = nhanGiayTheoDauVao(row.don_vi_vao, nhanDonVi(x.donVi), khoGoiY);
      ds.push({
        value: capMon("giay", x.id),
        label: nhanDv ? `${x.ten} (${nhanDv})` : x.ten,
        search: x.ma ?? "",
        group: "NVL chính — danh mục Giấy",
      });
    }
    for (const x of vatTuRefs ?? []) {
      if (daCo("vat_tu", x.id)) continue;
      ds.push({
        value: capMon("vat_tu", x.id),
        label: `${x.ten} (${nhanDonVi(x.donVi)})`,
        search: x.ma ?? "",
        group: "Vật tư in ấn",
      });
    }
    return ds;
  }, [giayRefs, vatTuRefs, row.vat_tus, row.don_vi_vao]);

  const mayForm = mayRefs?.find((m) => m.id === row.may_id) ?? null;
  const t = useMemo(() => thoiLuong(row, mayForm), [row, mayForm]);
  const tg = useMemo(() => thoiLuongLive(row, mayForm), [row, mayForm]);
  // Luật lọc nằm ở `mayChonDuoc` (xem `lsxBuoc.ts`) — cùng một luật với backend, và tách ra khỏi
  // JSX để test được: máy của bảng công đoạn, công đoạn có tổ thì chỉ máy THUỘC tổ của bước.
  const cdBuoc = congDoanRefs?.find((c) => c.id === row.cong_doan_id) ?? null;
  const mayMoi = useMemo(
    () => (mayRefs ? mayChonDuoc(mayRefs, cdBuoc, row.department_id, row.may_id) : []),
    [mayRefs, cdBuoc, row.department_id, row.may_id],
  );
  const nhomMay = useMemo(() => nhomMayTheoLoai(mayMoi), [mayMoi]);
  // Máy đầu danh sách (của tổ, khi công đoạn có tổ) — ô chọn máy ghi "(mặc định)" như ô tổ.
  const mayMd = useMemo(() => {
    if (!mayRefs) return null;
    if (cdBuoc?.coRangBuocTo) {
      return mayMoi.filter((m) => m.id !== row.may_id || m.active !== false).length > 1
        ? mayMacDinhCuaTo(mayRefs, cdBuoc, row.department_id) : null;
    }
    return (cdBuoc?.mayChoPhep?.length ?? 0) > 1 ? mayMacDinh(mayRefs, cdBuoc) : null;
  }, [mayRefs, cdBuoc, mayMoi, row.department_id, row.may_id]);
  // Máy thuộc nhiều tổ (mg `0435`): bày TÊN các tổ khác của máy — chọn máy không bị chặn, chỉ để
  // người lập biết máy đang chia cho tổ nào nữa. `lech` = máy đang gán KHÔNG thuộc tổ đang chọn ⇒
  // nói "thuộc", không nói "cũng thuộc" (23/10/2026).
  const toKhacCua = useCallback((m: RefRow): { ten: string[]; lech: boolean } => {
    const { khac, lech } = toKhacCuaMay(m.toIds, row.department_id);
    return { ten: khac.map((t) => toRefs?.find((x) => x.id === t)?.ten ?? `Tổ #${t}`), lech };
  }, [toRefs, row.department_id]);
  // Việc của bước đã chạy ở bàn tổ ⇒ máy chủ không nhận đổi tổ/máy ở lệnh: khoá sẵn hai ô.
  const khoaToMay = !canUpdate || row.da_bat_dau;
  // Tổ của bước chưa có máy nào chạy được công đoạn ⇒ nói thẳng, đừng để ô máy trống không lời.
  const toHetMay = !!mayRefs && toChuaCoMay(mayRefs, cdBuoc, row.department_id);
  // Ô TỔ: chỉ các tổ phụ trách khai ở danh mục Công đoạn (nhiều tổ, 18/09/2026), đúng thứ tự khai
  // (tổ đầu = mặc định). Công đoạn chưa khai tổ ⇒ mời mọi tổ, như server không chặn.
  // CHỈ nút lá (07/10/2026): `toRefs` là danh sách tổ = nút lá khối Sản xuất, id nào không nằm trong
  // đó (nút cha, tổ đã xoá) thì không bày ra. Tổ đang gán là TỔ THẬT nhưng không còn phụ trách công
  // đoạn thì vẫn hiện (gắn nhãn); bước đang gán nút cha thì select đứng ở "— chọn tổ —" — chỉ đổi khi
  // người dùng chọn, nên không mất gì nếu họ không đụng.
  const toChon = useMemo(() => {
    if (!toRefs) return { items: [] as { id: number; ten: string }[], gioiHan: false };
    const cd = congDoanRefs?.find((c) => c.id === row.cong_doan_id) ?? null;
    const ids = (cd?.toChoPhep ?? []).filter((id) => toRefs.some((t) => t.id === id));
    const items = ids.length
      ? ids.map((id) => ({ id, ten: toRefs.find((t) => t.id === id)!.ten }))
      : toRefs.map((t) => ({ id: t.id, ten: t.ten }));
    const dangGan = toRefs.find((t) => t.id === row.department_id);
    if (dangGan && !items.some((t) => t.id === dangGan.id)) {
      items.push({ id: dangGan.id, ten: `${dangGan.ten} (không còn phụ trách công đoạn)` });
    }
    return { items, gioiHan: ids.length > 0 };
  }, [toRefs, congDoanRefs, row.cong_doan_id, row.department_id]);
  const toDangGanHienDuoc = row.department_id != null && toChon.items.some((t) => t.id === row.department_id);

  // Đầu việc khoán của bước (`dsKhoan` / `khoanDaChon`) GỠ 18/09/2026 (mg `0320`).
  const mayDaChon = mayRefs?.find((m) => m.id === row.may_id);
  const nhomPhuThuoc = useMemo(() => {
    const currentLsxId = phuThuocRefs.find((o) => o.step_key === row.key)?.lsx_id;
    const groups = new Map<number, typeof phuThuocRefs>();
    for (const option of phuThuocRefs.filter((o) => o.step_key !== row.key)) {
      groups.set(option.lsx_id, [...(groups.get(option.lsx_id) ?? []), option]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => (a === currentLsxId ? -1 : b === currentLsxId ? 1 : a - b))
      .map(([lsxId, options]) => ({
        lsxId,
        label: `${options[0]?.lsx_ma ?? `LSX #${lsxId}`}${lsxId === currentLsxId ? " (lệnh này)" : ""}`,
        options,
      }));
  }, [phuThuocRefs, row.key]);

  useEffect(() => titleRef.current?.focus(), [row.key]);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables || focusables.length === 0) return;
    const dau = focusables[0];
    const cuoi = focusables[focusables.length - 1];
    if (!e.shiftKey && document.activeElement === cuoi) {
      e.preventDefault();
      dau.focus();
    } else if (e.shiftKey && document.activeElement === dau) {
      e.preventDefault();
      cuoi.focus();
    }
  }

  function set<K extends keyof EditRow>(k: K, v: EditRow[K]) {
    onPatch({ [k]: v } as Partial<EditRow>);
  }

  // `tuDinhMuc` · `bungVatTu` · `chonDauViec` GỠ 18/09/2026: vật tư bung theo CÔNG ĐOẠN ở server
  // (tab Vật tư của danh mục, mg `0316`), bước thôi chọn đầu việc.

  function doiLoaiBuoc(k: LsxLoaiBuoc) {
    if (k === "thue_ngoai") {
      // Gia công ngoài: không tổ, không máy, một lượt, không vật tư — nhà gia công lo. Dọn ngay
      // trong bản nháp để bảng không còn chip tổ/máy cũ; máy chủ cũng dọn khi lưu (Task 3).
      onPatch({
        loai_buoc: k, may_id: null, department_id: null, department_ten: null,
        so_luot_chay: "1", vat_tus: [],
      });
      return;
    }
    // Máy: giờ theo tốc độ máy. Tổ: giờ kế hoạch gõ tay (tab Thời gian).
    if (k === "may") {
      onPatch({ loai_buoc: k });
      return;
    }
    onPatch({
      loai_buoc: k,
      may_id: null,
      // Ô "số lượt qua máy" không hiện ở bước tổ (08/09/2026) — trả về 1 ngay lúc đổi loại, để
      // số 2 lượt của bước máy cũ không nằm lại vô hình trong bản nháp.
      so_luot_chay: "1",
    });
  }

  const meta = LSX_LOAI_BUOC_META[row.loai_buoc];
  const ngoai = row.loai_buoc === "thue_ngoai";

  // Mở drawer từ badge trạng thái ngoài bảng/sơ đồ → nhảy thẳng tới tab đó
  useEffect(() => {
    if (tabDau) {
      setActiveTab(normalizeTab(tabDau));
    }
  }, [row.key, tabDau]);

  const setup = Number(tg.setup_phut ?? 0);
  const phatSinh = Number(tg.phat_sinh_phut ?? 0);
  const chayTB = Number(tg.chay_phut ?? 0);
  const coDai = Boolean(tg.co_dai_toc_do);
  const khoanChuanBi: { ten?: string; phut?: number }[] = Array.isArray(tg.chuan_bi_khoan)
    ? (tg.chuan_bi_khoan as { ten?: string; phut?: number }[])
    : [];
  const mayTen = mayDaChon?.ten ?? "";
  const chiemTB = Number(tg.chiem_tai_nguyen_phut ?? 0);
  const chiemMin = phatSinh + setup + Number(tg.chay_phut_min ?? chayTB);
  const chiemMax = phatSinh + setup + Number(tg.chay_phut_max ?? chayTB);

  // Danh sách Tab chính cho Drawer
  const tabsList = useMemo(() => {
    // Thuê ngoài: nhà gia công lo vật tư + thời gian ⇒ chỉ còn Cấu hình, Nhà gia công, Phụ thuộc.
    const list: { key: MainTab; label: string; badge?: number }[] = ngoai
      ? [
          { key: "cau_hinh", label: "Cấu hình & Số lượng" },
          { key: "phan_cong", label: "Nhà gia công" },
        ]
      : [
          { key: "cau_hinh", label: "Cấu hình & Số lượng" },
          { key: "phan_cong", label: "Phân công & Thiết bị" },
          { key: "vat_tu", label: "Vật tư", badge: row.vat_tus.length },
          { key: "tien_do", label: "Tiến độ & Thời gian" },
        ];
    // CUỐI hàng — badge đếm số bước tiền nhiệm đang chọn, đúng con số trước đây treo ở tab Tiến độ.
    list.push({ key: "phu_thuoc", label: "Phụ thuộc", badge: row.phu_thuoc_step_keys.length });
    return list;
  }, [ngoai, row.vat_tus.length, row.phu_thuoc_step_keys.length]);

  // Đang đứng ở tab vừa biến mất (đổi sang thuê ngoài, hoặc badge ngoài bảng mở thẳng tab đó).
  useEffect(() => {
    if (ngoai && (activeTab === "vat_tu" || activeTab === "tien_do")) setActiveTab("phan_cong");
  }, [ngoai, activeTab]);

  return (
    <div className="khsx-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panelRef}
        className={`khsx-drawer khsx-drawer--buoc khsx-drawer--${row.loai_buoc}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="khsx-buoc-title"
        onKeyDown={onKeyDown}
      >
        <header className="khsx-drawer__head">
          {/* Accent bar thể hiện loại bước ở cạnh trên */}
          <div className={`khsx-drawer__accent khsx-drawer__accent--${meta.tone}`} />

          {/* Top Bar: Kicker + Type + Title + Nav actions */}
          <div className="khsx-drawer__head-main">
            <div className="khsx-drawer__head-info">
              <div className="khsx-drawer__head-meta">
                <span className="khsx-step-kicker">
                  BƯỚC {String(index + 1).padStart(2, "0")}/{String(tong).padStart(2, "0")}
                </span>
                <span className={`khsx-type-tag khsx-type-tag--${meta.tone}`}>
                  {meta.label}
                </span>
              </div>
              <h2
                className="khsx-drawer__title-main"
                id="khsx-buoc-title"
                tabIndex={-1}
                ref={titleRef}
              >
                {tenBuoc(row, congDoanRefs) || "Công đoạn chưa đặt tên"}
              </h2>
            </div>

            <div className="khsx-drawer__head-actions">
              <div className="khsx-nav-group" role="group" aria-label="Điều hướng bước">
                <button
                  type="button"
                  className="khsx-nav-btn"
                  onClick={onPrev}
                  disabled={index === 0}
                  aria-label="Bước trước"
                  title="Bước trước (←)"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="khsx-nav-btn"
                  onClick={onNext}
                  disabled={index >= tong - 1}
                  aria-label="Bước sau"
                  title="Bước sau (→)"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              </div>

              <button
                type="button"
                className="khsx-close-btn"
                onClick={onClose}
                aria-label="Đóng panel"
                title="Đóng (Esc)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Segmented Capsule Tabs Navigation */}
          <nav className="khsx-tabs-bar" aria-label="Phân đoạn nội dung">
            {tabsList.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`khsx-tab-btn ${activeTab === tab.key ? "is-active" : ""}`}
                onClick={() => setActiveTab(tab.key)}
              >
                <span className="khsx-tab-label">{tab.label}</span>
                {tab.badge != null && tab.badge > 0 && (
                  <span className="khsx-tab-badge">{tab.badge}</span>
                )}
              </button>
            ))}
          </nav>
        </header>

        <div className="khsx-drawer__body">
          {/* =========================================================================
              TAB 1: CẤU HÌNH & SỐ LƯỢNG
             ========================================================================= */}
          {activeTab === "cau_hinh" && (
            <div className="khsx-tab-pane">
              {/* Khối Nhận diện */}
              <section className="khsx-section-card">
                <div className="khsx-section-card__head">
                  <h3 className="khsx-section-card__title">Nhận diện công đoạn</h3>
                </div>

                <div className="khsx-nhan-dien-grid">
                  {/* Hàng 1 - Cột 1: Công đoạn */}
                  <label className="khsx-field">
                    <span className="khsx-field__label">TÊN CÔNG ĐOẠN</span>
                    {congDoanRefs ? (
                      <Select
                        options={cdOpts}
                        value={
                          row.cong_doan_id != null
                            ? String(row.cong_doan_id)
                            : row.ten
                              ? "__keep__"
                              : ""
                        }
                        onChange={(v) => {
                          if (v === "__keep__") return;
                          onDoiCongDoan(v ? Number(v) : null);
                        }}
                        disabled={!canUpdate}
                        ariaLabel="Tên công đoạn"
                        placeholder="— chọn công đoạn —"
                        searchable
                        searchPlaceholder="Gõ tên hoặc mã công đoạn…"
                        // `portal`: drawer cuộn dọc, popover thường bị cắt ở mép khối "Nhận diện".
                        portal
                        className="khsx-select-std"
                      />
                    ) : (
                      <input
                        className="khsx-input-std"
                        value={row.ten}
                        disabled={!canUpdate}
                        onChange={(e) => set("ten", e.target.value)}
                      />
                    )}
                  </label>

                  {/* Hàng 1 - Cột 2: Loại bước */}
                  <div className="khsx-field">
                    <span className="khsx-field__label">LOẠI BƯỚC THỰC HIỆN</span>
                    <div className="khsx-seg-std" role="group" aria-label="Loại bước">
                      {LOAI_BUOC_ORDER.map((k) => {
                        const m = LSX_LOAI_BUOC_META[k];
                        return (
                          <button
                            key={k}
                            type="button"
                            className={row.loai_buoc === k ? "is-active" : ""}
                            disabled={!canUpdate}
                            aria-pressed={row.loai_buoc === k}
                            title={m.hint}
                            onClick={() => doiLoaiBuoc(k)}
                          >
                            {m.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Hàng 2: Ghi chú kỹ thuật — chiếm cả hàng từ 07/09/2026, khi ô "Bước bắt buộc"
                      ở cột 2 bị GỠ: routing đã khai bước nào thì bước đó PHẢI làm, không có bước
                      tuỳ chọn nữa (`lsx_cong_doan.bat_buoc` luôn TRUE, xem migration 0275). */}
                  <label className="khsx-field khsx-field--wide">
                    <span className="khsx-field__label">GHI CHÚ KỸ THUẬT CHO THỢ</span>
                    <input
                      className="khsx-input-std"
                      value={row.ghi_chu}
                      disabled={!canUpdate}
                      placeholder="vd: canh màu theo mẫu đã ký, kiểm tra keo..."
                      onChange={(e) => set("ghi_chu", e.target.value)}
                    />
                  </label>
                </div>
              </section>

              {/* Khối Nhãn (gắn thẻ tự do cho bước) ẨN 07/09/2026. API `cong-doan-tags` + nhãn đã
                  gán vẫn còn nguyên trong DB, chỉ không bày cửa gán/gỡ ở drawer nữa — bật lại là
                  trả `<TagPicker buocLoai="lsx" buocId={row.id} …>` vào đúng chỗ này. */}

              {/* Ô "Tiêu chí KCS bổ sung" GỠ 08/09/2026 (mg 0283): tiêu chí KCS chỉ còn MỘT
                  nguồn là danh mục Tiêu chí KCS gắn theo công đoạn, khai một lần áp cho mọi
                  lệnh chạy công đoạn đó. Xem `docs/design-kcs-theo-cong-doan.md` mục 5. */}

              {/* Khối Dòng chảy Số lượng (Production Flow Pipeline) */}
              <section className="khsx-section-card">
                <div className="khsx-section-card__head">
                  <h3 className="khsx-section-card__title">Dòng chảy số lượng & hao hụt</h3>
                </div>

                {/* Băng giải thích "bước không nằm trên dòng giấy" ĐÃ BỎ 09/09/2026 theo yêu cầu —
                    nó chỉ mô tả lại cách máy tính số, không đòi người khai làm gì. `tren_dong_giay`
                    vẫn về từ API và vẫn lái cách tính, chỉ không bày một câu chữ ở đây nữa.
                    Băng ĐỎ "Chưa tính được số vào" (`loi_quy_doi`) GỠ 18/09/2026 (mg `0324`). */}

                <div className="khsx-flow-pipeline">
                  {/* Node Vào */}
                  <div className="khsx-flow-node khsx-flow-node--in">
                    <span className="khsx-flow-node__kicker">SỐ LƯỢNG VÀO</span>
                    <div className="khsx-flow-node__val-row">
                      {khaiTay ? (
                        <div className="khsx-flow-input-wrap">
                          <input
                            type="number"
                            min={0}
                            className="khsx-flow-editable-input"
                            aria-label="Số lượng vào của bước"
                            value={row.so_luong_vao}
                            onChange={(e) => onPatch({ so_luong_vao: e.target.value })}
                          />
                          <Select
                            options={dvOpts}
                            value={row.don_vi_vao}
                            // Chọn MỘT vế thì điền luôn vế kia nếu nó còn trống: bước ngoài dòng
                            // thường đếm cùng một thứ ở hai đầu (nhận việc ghi 4 bản, giao 4 bản).
                            // Server chỉ coi là "khai tay" khi ĐỦ CẢ HAI ô, nên để người dùng chọn
                            // một ô rồi tưởng xong là ô kia im lặng không có tác dụng gì.
                            onChange={(v) => onPatch({
                              don_vi_vao: v, ...(row.don_vi_ra ? {} : { don_vi_ra: v }),
                            })}
                            ariaLabel="Đơn vị đầu vào của bước"
                            searchable
                            portal
                            className="khsx-flow-dv-select"
                          />
                        </div>
                      ) : (
                        <>
                          <span className="khsx-flow-node__val">{num(Number(row.so_luong_vao || 0))}</span>
                          <span className="khsx-unit-pill">{dvNhan(row.don_vi_vao)}</span>
                        </>
                      )}
                    </div>
                    <span className="khsx-flow-node__hint">
                      {khaiTay ? "Bước ngoài dòng giấy — kế hoạch tự khai" : "Đầu vào công đoạn"}
                    </span>
                  </div>

                  {/* Connector Trung gian (Hao hụt & Quy đổi) */}
                  <div className="khsx-flow-connector">
                    <div className="khsx-flow-arrow-line">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </div>

                    <div className="khsx-flow-badges-stack">
                      <div className="khsx-flow-chip khsx-flow-chip--waste">
                        <span className="khsx-flow-chip__label">Hao hụt:</span>
                        <span className="khsx-flow-chip__val">
                          {Number(row.hao_hut || 0) > 0 || Number(row.hao_hut_pct || 0) > 0 ? (
                            <>
                              <strong>{num(Number(row.hao_hut))}</strong> {dvNhan(row.don_vi_vao)}
                              {Number(row.hao_hut_pct || 0) > 0 && ` (+${row.hao_hut_pct}%)`}
                            </>
                          ) : (
                            "—"
                          )}
                        </span>
                      </div>

                      {doiDonVi && heSoChu(Number(row.he_so_quy_doi || 1), row.don_vi_vao, row.don_vi_ra) && (
                        <div className="khsx-flow-chip khsx-flow-chip--ratio">
                          <span className="khsx-flow-chip__label">Quy đổi:</span>
                          <span className="khsx-flow-chip__val">
                            <strong>{heSoChu(Number(row.he_so_quy_doi || 1), row.don_vi_vao, row.don_vi_ra)}</strong>
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Node Ra */}
                  <div className={`khsx-flow-node khsx-flow-node--out ${laBuocCuoi ? "is-final" : ""}`}>
                    <div className="khsx-flow-node__head">
                      <span className="khsx-flow-node__kicker">SỐ LƯỢNG RA</span>
                      {laBuocCuoi && <span className="khsx-tag-final">Số giao</span>}
                    </div>

                    <div className="khsx-flow-node__val-row">
                      {laBuocCuoi ? (
                        <div className="khsx-flow-input-wrap">
                          <input
                            type="number"
                            min={1}
                            className="khsx-flow-editable-input"
                            value={slRaCuoi}
                            disabled={!canUpdate}
                            onChange={(e) => setSlRaCuoi(e.target.value)}
                            onBlur={() =>
                              onPatchLsx?.({ so_luong_dat: Math.max(0, Number(slRaCuoi) || 0) })
                            }
                          />
                          <span className="khsx-unit-pill">{dvNhan(row.don_vi_ra)}</span>
                        </div>
                      ) : khaiTay ? (
                        <div className="khsx-flow-input-wrap">
                          <input
                            type="number"
                            min={0}
                            className="khsx-flow-editable-input"
                            aria-label="Số lượng ra của bước"
                            value={row.so_luong_ra}
                            onChange={(e) => onPatch({ so_luong_ra: e.target.value })}
                          />
                          <Select
                            options={dvOpts}
                            value={row.don_vi_ra}
                            onChange={(v) => onPatch({
                              don_vi_ra: v, ...(row.don_vi_vao ? {} : { don_vi_vao: v }),
                            })}
                            ariaLabel="Đơn vị đầu ra của bước"
                            searchable
                            portal
                            className="khsx-flow-dv-select"
                          />
                        </div>
                      ) : (
                        <>
                          <span className="khsx-flow-node__val">{num(Number(row.so_luong_ra || 0))}</span>
                          <span className="khsx-unit-pill">{dvNhan(row.don_vi_ra)}</span>
                        </>
                      )}
                    </div>
                    <span className="khsx-flow-node__hint">
                      {laBuocCuoi
                        ? "Số thành phẩm giao khách"
                        : khaiTay
                          ? "Gõ số rồi bấm Lưu công đoạn — số này xuống thẳng thẻ việc của tổ"
                          : laNgoaiDong
                            ? "Bước ngoài dòng giấy — kế hoạch tự khai"
                            : "Tự động tính ngược từ bước cuối"}
                    </span>
                  </div>
                </div>

                {/* Hai dòng diễn giải "Số ra = …" / "Số vào = …" của bước ngoài dòng giấy GỠ
                    18/09/2026 (mg `0324`) cùng công thức sản lượng ra của công đoạn. */}
              </section>
            </div>
          )}

          {/* =========================================================================
              TAB 2: PHÂN CÔNG & THIẾT BỊ
             ========================================================================= */}
          {activeTab === "phan_cong" && (
            <div className="khsx-tab-pane">
                <div className="khsx-form-stack">
                  {ngoai && (
                    <NhaGiaCongCard
                      row={row}
                      dai={daiGiaCong}
                      canUpdate={canUpdate}
                      onPatch={onPatch}
                    />
                  )}
                  {!ngoai && (
                  <>
                  {/* Thẻ Tổ phụ trách */}
                  <section className="khsx-section-card">
                    <div className="khsx-section-card__head">
                      <h3 className="khsx-section-card__title">Tổ sản xuất & Máy thiết bị</h3>
                    </div>

                    <div className="khsx-assign-grid">
                      {/* TỔ PHỤ TRÁCH — chọn MỘT trong các tổ khai ở danh mục Công đoạn (nhiều tổ,
                          18/09/2026). Bước chạy chung ở bài ghép thì tổ do lượt chung quyết, như máy. */}
                      <label className="khsx-field">
                        <span className="khsx-field__label">TỔ PHỤ TRÁCH</span>
                        {buocGhep && deLen ? (
                          <div className="khsx-gang-box">
                            <span className="khsx-gang-box__title">
                              {deLen.to_ten ?? "Chưa chọn ở bài"}
                            </span>
                            <span className="khsx-gang-box__hint">
                              Tổ của lượt chung — đổi ở bài <strong>{buocGhep.ma}</strong>.
                            </span>
                          </div>
                        ) : toRefs ? (
                          <>
                            <select
                              className="khsx-select-std"
                              value={toDangGanHienDuoc ? (row.department_id ?? "") : ""}
                              disabled={khoaToMay}
                              onChange={(e) => onDoiTo(e.target.value ? Number(e.target.value) : null)}
                            >
                              {!toDangGanHienDuoc && <option value="">— chọn tổ —</option>}
                              {toChon.items.map((t, i) => (
                                <option key={t.id} value={t.id}>
                                  {toChon.gioiHan && i === 0 ? `${t.ten} (mặc định)` : t.ten}
                                </option>
                              ))}
                            </select>
                            <span className="khsx-field__hint">
                              {row.da_bat_dau ? "Việc đã bắt đầu ở bàn tổ — đổi máy ở bàn tổ."
                                : toChon.gioiHan
                                ? "Chỉ các tổ phụ trách khai ở danh mục Công đoạn. Lúc ghi sản lượng, bàn tổ chọn trong công việc khoán của tổ này."
                                : "Công đoạn chưa khai tổ phụ trách — đang mời mọi tổ."}
                            </span>
                          </>
                        ) : (
                          <span className="khsx-val-text">{row.department_ten ?? "—"}</span>
                        )}
                      </label>

                      {/* Máy sản xuất (chỉ với bước MÁY) */}
                      {row.loai_buoc !== "to" && (
                        <label className="khsx-field">
                          <span className="khsx-field__label">MÁY SẢN XUẤT</span>
                          {buocGhep && deLen ? (
                            <div className="khsx-gang-box">
                              <span className="khsx-gang-box__title">
                                {deLen.may_ten ?? buocGhep.may_ten ?? "Chưa chọn ở bài"}
                              </span>
                              <span className="khsx-gang-box__hint">
                                Bước "{deLen.ten}" chạy chung ở bài <strong>{buocGhep.ma}</strong> (cấp {deLen.so_luong_vao.toLocaleString("vi-VN")} {dvNhanChung(row.don_vi_vao)}).
                              </span>
                            </div>
                          ) : mayRefs ? (
                            <select
                              className="khsx-select-std"
                              value={row.may_id ?? ""}
                              disabled={khoaToMay}
                              onChange={(e) =>
                                onDoiMay(e.target.value ? Number(e.target.value) : null)
                              }
                            >
                              <option value="">— chưa gán máy —</option>
                              {nhomMay.map((g) => (
                                <optgroup key={g.ten} label={g.ten}>
                                  {g.items.map((m) => {
                                    const { ten: khac, lech } = toKhacCua(m);
                                    const nhan = m.active === false ? `${m.ten} (ngừng dùng)`
                                      : m.id === mayMd ? `${m.ten} (mặc định)` : m.ten;
                                    return (
                                      <option key={m.id} value={m.id}>
                                        {khac.length ? `${nhan} — ${lech ? "thuộc" : "cũng thuộc"} ${DS_TEN.format(khac)}` : nhan}
                                      </option>
                                    );
                                  })}
                                </optgroup>
                              ))}
                            </select>
                          ) : (
                            <span className="khsx-val-text">—</span>
                          )}
                          {!(buocGhep && deLen) && mayForm && toKhacCua(mayForm).ten.length > 0 && (
                            <span className="khsx-field__hint">
                              {toKhacCua(mayForm).lech ? "Máy này không thuộc tổ đang chọn, máy của" : "Máy này cũng thuộc"}{" "}
                              {toKhacCua(mayForm).ten.map((t) => <span key={t} className="lds-tag">{t}</span>)}
                            </span>
                          )}
                          {!(buocGhep && deLen) && toHetMay && (
                            <span className="khsx-field__hint">Tổ này chưa có máy chạy công đoạn này.</span>
                          )}
                        </label>
                      )}
                    </div>
                  </section>

                  {/* Hai thẻ "KÍP CHUẨN" và "Đầu việc thợ làm" GỠ 18/09/2026 (mg `0320` + `0321`, chủ
                      khoanh đỏ trên màn): bỏ hẳn logic kíp người, bước thôi chọn đầu việc — việc
                      khoán thợ chọn lúc ghi mẻ ở bàn tổ. Giờ của bước tổ gõ ở tab Thời gian. */}
                  </>
                  )}

                  {/* Thẻ Khuôn dao của bước */}
                  {row.requires_tooling && (
                    <KhuonCuaBuoc
                      row={row}
                      tenSanPham={tenSanPham}
                      tenKhach={tenKhach}
                      khuonRefs={khuonRefs}
                      canUpdate={canUpdate}
                      onChon={(id) => {
                        // Gán ĐỦ bộ trường của dao, không chỉ id: thẻ DAG / bảng công đoạn đọc
                        // `khuon_be_ma` + tình trạng, mà mấy trường đó trước chỉ có sau khi Lưu ⇒
                        // chọn xong thẻ vẫn kêu "chưa chốt khuôn". Bỏ chọn thì xoá sạch, kẻo thẻ
                        // còn giữ mã cũ. Dao vừa tạo chưa kịp vào danh sách ⇒ chỉ có id, Lưu xong
                        // máy chủ trả đủ.
                        const dao = id == null ? null : (khuonRefs ?? []).find((k) => k.id === id);
                        onPatch({
                          khuon_be_id: id,
                          khuon_be_ma: dao?.ma ?? null,
                          khuon_be_ten: dao?.ten ?? null,
                          khuon_be_so_ke: dao?.so_ke ?? null,
                          khuon_be_tinh_trang: dao?.tinh_trang ?? null,
                        });
                      }}
                      onTaoMoi={onTaoKhuon}
                    />
                  )}
                </div>
            </div>
          )}

          {/* =========================================================================
              TAB 3: VẬT TƯ (BOM)
             ========================================================================= */}
          {activeTab === "vat_tu" && (
            <div className="khsx-tab-pane">
              <section className="khsx-section-card">
                {/* 06/10/2026: bỏ huy hiệu "N món" và thanh "Tổng · Tự tính · Đã sửa" — số món đã
                    nằm trên nhãn tab, còn "đã sửa" chỉ đáng nói ở đúng dòng bị sửa (nhãn cạnh ô số). */}
                <div className="khsx-section-card__head">
                  <div>
                    <h3 className="khsx-section-card__title">Định mức vật tư</h3>
                    <p className="khsx-section-card__sub">
                      Giấy khai ở bước nào thì ngày cần giấy bám theo bước đó. Rê chuột vào tên để xem
                      công thức.
                    </p>
                  </div>
                </div>

                {/* Bảng Kỹ Thuật Data Table */}
                <div className="khsx-vattu-table-wrap">
                  <table className="khsx-vattu-table khsx-vattu-table--lsx">
                    <thead className="khsx-vattu-thead">
                      <tr>
                        <th className="khsx-vattu-th">VẬT TƯ</th>
                        <th className="khsx-vattu-th" style={{ width: "240px", textAlign: "right" }}>ĐỊNH MỨC</th>
                        <th className="khsx-vattu-th" style={{ width: "48px" }} aria-label="Xoá"></th>
                      </tr>
                    </thead>
                    <tbody className="khsx-vattu-tbody">
                      {row.vat_tus.length === 0 ? (
                        <tr className="khsx-vattu-tr">
                          <td colSpan={3} className="khsx-vattu-td" style={{ textAlign: "center", color: "#94a3b8", padding: "20px" }}>
                            Chưa khai món nào cho công đoạn này — chọn giấy hoặc vật tư ở ô bên dưới.
                          </td>
                        </tr>
                      ) : (
                        row.vat_tus.map((v, i) => {
                          const goiY = row.vat_tu_goi_y.find(
                            (g) => capMon(g.hang_loai, g.vat_tu_id) === capMon(v.hang_loai, v.vat_tu_id));
                          // Giấy vừa chọn chưa lưu: máy chủ chưa dẫn xuất — có lý do lỗi thì vẫn nói lý do.
                          const choLuu = giayChoLuu(v) && !goiY?.ly_do;
                          return (
                            <tr className="khsx-vattu-tr" key={capMon(v.hang_loai, v.vat_tu_id)}>
                              <td className="khsx-vattu-td khsx-vattu-td--info">
                                <div className="khsx-vattu-cell-name">
                                  <span className="khsx-vattu-code">{v.vat_tu_ma}</span>
                                  {/* Công thức định mức hiện khi rê chuột vào TÊN — bày ra luôn thì câu
                                      diễn giải dài chiếm cả một cột mà ít khi ai đọc. */}
                                  <CongThucTip
                                    tieuDe={v.vat_tu_ten}
                                    congThuc={goiY?.dien_giai}
                                    ghiChu={!goiY?.dien_giai && choLuu ? "Số tờ theo đầu vào của bước — máy tính khi lưu." : null}
                                  >
                                    <span className="khsx-vattu-name">{v.vat_tu_ten}</span>
                                  </CongThucTip>
                                  {v.hang_loai === "giay" && (
                                    <span className="khsx-vattu-nvl-badge">NVL chính</span>
                                  )}
                                </div>
                                {/* Vật tư khác: chip đã chép từ phiếu — chỉ đọc. */}
                                {v.hang_loai !== "giay" && (v.chips ?? []).length > 0 && (
                                  <div className="lsx-vt-chip">
                                    {(v.chips ?? []).map((c) => (
                                      <span key={c.ma}>{c.ten}: <b>{v.gia_tri_chip?.[c.ma] ?? 0}</b>{c.don_vi && tenDonVi(c.don_vi) ? ` ${tenDonVi(c.don_vi)}` : ""}</span>
                                    ))}
                                  </div>
                                )}
                                {/* Giấy: khổ + đơn vị gốc do MÁY CHỦ suy từ đầu vào của bước — chỉ đọc. */}
                                {v.hang_loai === "giay" && (
                                  <div className="khsx-vattu-kho">
                                    <span className="khsx-vattu-kho__label">
                                      {(v.don_vi_goc || goiY?.don_vi_goc)
                                        ? nhanDongTon(
                                          v.don_vi_goc || goiY?.don_vi_goc,
                                          Number(v.kho_rong) || goiY?.kho_rong || 0,
                                          Number(v.kho_dai) || goiY?.kho_dai || 0,
                                          { laGiay: true },
                                        )
                                        : "Khổ do máy tính khi lưu"}
                                    </span>
                                  </div>
                                )}
                                {/* Không tự tính được thì PHẢI thấy ngay, không giấu sau rê chuột. */}
                                {!goiY?.dien_giai && !choLuu && (
                                  <span className="khsx-vattu-no-formula">
                                    Chưa tự tính được — {goiY?.ly_do ?? "chưa có công thức lượng."}
                                  </span>
                                )}
                              </td>
                              <td className="khsx-vattu-td khsx-vattu-td--input">
                                {/* Vật tư khác giấy: máy tính sẵn từ công thức nhưng người lập lệnh SỬA được —
                                    gõ là thành "Đã sửa", máy thôi tính đè. Giấy suy từ đầu vào của bước — chỉ đọc. */}
                                {v.hang_loai !== "giay" && canUpdate ? (
                                  <div className="khsx-vattu-dinh-muc">
                                    <div className="khsx-vattu-input-group">
                                      <input
                                        type="number"
                                        inputMode="decimal"
                                        min={0}
                                        step="any"
                                        className="khsx-vattu-num-input"
                                        aria-label={`Định mức ${v.vat_tu_ten}`}
                                        value={v.so_luong}
                                        onChange={(e) =>
                                          set("vat_tus", row.vat_tus.map((x, j) => (j === i
                                            ? { ...x, so_luong: e.target.value, sua_tay: true, tu_dong: false }
                                            : x)))
                                        }
                                      />
                                      <span className="khsx-vattu-unit-tag">{nhanDonVi(v.don_vi)}</span>
                                    </div>
                                    {v.sua_tay && (
                                      <span className="khsx-vattu-sua-tay">
                                      <span className="khsx-vattu-sua-tay__nhan">Đã sửa tay</span>
                                      <button
                                        type="button"
                                        className="khsx-vattu-tinh-lai"
                                        title="Bỏ số đã gõ, để máy tính lại theo công thức khi lưu"
                                        onClick={() =>
                                          set("vat_tus", row.vat_tus.map((x, j) => (j === i
                                            ? { ...x, sua_tay: false,
                                                so_luong: goiY?.so_luong != null ? String(goiY.so_luong) : x.so_luong }
                                            : x)))
                                        }
                                      >
                                        Tính lại theo công thức
                                      </button>
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                <div className="khsx-vattu-input-group is-readonly">
                                  {choLuu ? (
                                    <span className="khsx-vattu-unit-tag">Tính khi lưu</span>
                                  ) : (
                                    <>
                                      <strong>
                                        {Number.isFinite(Number(v.so_luong))
                                          ? Number(v.so_luong).toLocaleString("vi-VN", { maximumFractionDigits: 3 })
                                          : v.so_luong}
                                      </strong>
                                      <span className="khsx-vattu-unit-tag">{nhanDonVi(v.don_vi)}</span>
                                    </>
                                  )}
                                </div>
                                )}
                              </td>
                              <td className="khsx-vattu-td khsx-vattu-td--action" style={{ textAlign: "center" }}>
                                {canUpdate && (
                                  <button
                                    type="button"
                                    className="khsx-vattu-del-btn"
                                    title="Xóa vật tư khỏi công đoạn"
                                    onClick={() =>
                                      set(
                                        "vat_tus",
                                        row.vat_tus.filter((_, j) => j !== i),
                                      )
                                    }
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M18 6L6 18M6 6l12 12" />
                                    </svg>
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                    {canUpdate && (vatTuRefs || giayRefs) && (
                      <tfoot className="khsx-vattu-tfoot">
                        <tr>
                          <td colSpan={3} className="khsx-vattu-td-add">
                            <div className="khsx-vattu-add-bar">
                              <span className="khsx-vattu-add-icon">＋</span>
                              <Select
                                options={themMonOpts}
                                value=""
                                placeholder="— Thêm vật tư / NVL chính vào công đoạn —"
                                ariaLabel="Thêm vật tư hoặc NVL chính vào công đoạn"
                                searchable
                                searchPlaceholder="Gõ tên hoặc mã vật tư…"
                                portal
                                className="khsx-vattu-select-clean"
                                onChange={(v) => {
                                  // Giá trị là CẶP `hang_loai:id` — hai danh mục đánh số độc lập,
                                  // gửi id trần thì server không biết tra bảng nào.
                                  const [hl, sid] = String(v).split(":");
                                  if (!hl || !sid) return;
                                  const hangLoai = hl as HangLoai;
                                  const item = (hangLoai === "giay" ? giayRefs : vatTuRefs)
                                    ?.find((v) => v.id === Number(sid));
                                  const cap = capMon(hangLoai, Number(sid));
                                  if (!item) return;
                                  if (row.vat_tus.some(
                                    (v) => capMon(v.hang_loai, v.vat_tu_id) === cap)) return;
                                  const goiY = row.vat_tu_goi_y.find(
                                    (g) => capMon(g.hang_loai, g.vat_tu_id) === cap);
                                  set("vat_tus", [
                                    ...row.vat_tus,
                                    {
                                      hang_loai: hangLoai,
                                      vat_tu_id: item.id,
                                      vat_tu_ma: item.ma ?? "",
                                      vat_tu_ten: item.ten,
                                      // Giấy: đơn vị + khổ + đơn vị gốc do máy chủ gợi ý theo đầu vào của
                                      // bước (chỉ để hiện — lưu xong máy chủ ghi lại).
                                      don_vi: (hangLoai === "giay" ? goiY?.don_vi : undefined)
                                        ?? item.donVi ?? "",
                                      so_luong: goiY?.so_luong != null ? String(goiY.so_luong) : "",
                                      tu_dong: false,
                                      kho_rong: hangLoai === "giay" && goiY?.kho_rong ? String(goiY.kho_rong) : "",
                                      kho_dai: hangLoai === "giay" && goiY?.kho_dai ? String(goiY.kho_dai) : "",
                                      // Giấy rỗng ⇒ dòng còn "chờ lưu" (giayChoLuu) cho tới khi máy chủ dẫn
                                      // xuất. Vật tư khác cũng mang đơn vị gốc (nhóm đơn vị đã khai).
                                      don_vi_goc: coDonViGoc(hangLoai) ? goiY?.don_vi_goc ?? "" : "",
                                    },
                                  ]);
                                }}
                              />
                            </div>
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </section>
            </div>
          )}

          {/* =========================================================================
              TAB 4: TIẾN ĐỘ & THỜI GIAN
             ========================================================================= */}
          {/* =========================================================================
              TAB CUỐI: PHỤ THUỘC XẾP LỊCH (DAG)
             ========================================================================= */}
          {activeTab === "phu_thuoc" && (
            <div className="khsx-tab-pane">
              <section className="khsx-section-card">
                <div className="khsx-section-card__head">
                  <div>
                    <h3 className="khsx-section-card__title">Phụ thuộc xếp lịch (DAG)</h3>
                    <p className="khsx-section-card__sub">
                      Bước này chỉ bắt đầu sau khi các bước tiền nhiệm hoàn thành.
                    </p>
                  </div>
                </div>

                <div className="khsx-dag-groups">
                  {nhomPhuThuoc.map((group) => (
                    <div className="khsx-dag-group-card" key={group.lsxId}>
                      <div className="khsx-dag-group-card__head">{group.label}</div>
                      <div className="khsx-dag-chips">
                        {group.options.map((o) => {
                          const active = row.phu_thuoc_step_keys.includes(o.step_key);
                          return (
                            <label
                              key={o.step_key}
                              className={`khsx-dag-chip ${active ? "is-active" : ""}`}
                            >
                              <input
                                type="checkbox"
                                disabled={!canUpdate}
                                checked={active}
                                onChange={(e) =>
                                  set(
                                    "phu_thuoc_step_keys",
                                    e.target.checked
                                      ? [...row.phu_thuoc_step_keys, o.step_key]
                                      : row.phu_thuoc_step_keys.filter((k) => k !== o.step_key),
                                  )
                                }
                              />
                              <span className="khsx-dag-chip__text">{o.ten_buoc}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {nhomPhuThuoc.length === 0 && (
                    <span className="khsx-field__hint">Chưa có bước khác trong đơn hàng để tạo phụ thuộc.</span>
                  )}
                </div>
              </section>
            </div>
          )}

          {activeTab === "tien_do" && (() => {
            // 06/10/2026 — dựng lại: KẾT QUẢ lên đầu (bước này chiếm máy bao lâu), bóc tách thành
            // các dòng cộng dồn như một phiếu tính, ô điều chỉnh xuống cuối. Trước đây cùng một con
            // số hiện ba lần (dải tỷ trọng, thẻ giai đoạn, ô "Kế hoạch Gantt") và phút lẻ
            // "7.866,67′" đứng to hơn giờ đọc được.
            const coMay = row.loai_buoc !== "to" && Number(tg.nang_suat_hieu_dung ?? 0) > 0;
            const coQuyDoi = coMay && tg.phuong_phap !== "chua_quy_doi";
            const pct = (v: number) => (chiemTB > 0 ? Math.max(2, (v / chiemTB) * 100) : 0);
            const viTriKH = chiemMax > chiemMin ? ((chiemTB - chiemMin) / (chiemMax - chiemMin)) * 100 : 50;
            return (
            <div className="khsx-tab-pane">
              <section className="khsx-section-card khsx-tgb">
                {Array.isArray(tg.canh_bao) &&
                  tg.canh_bao.map((warning) => (
                    <div className="khsx-alert" key={String(warning)}>
                      {String(warning)}
                    </div>
                  ))}

                <div className="khsx-tgb__ket-qua">
                  <span className="khsx-tgb__nhan">{row.loai_buoc === "to" ? "Tổ làm trong" : "Chiếm máy"}</span>
                  <span className="khsx-tgb__so-lon">{phut(chiemTB)}</span>
                  {t.tong !== t.chiemMay && (
                    <span className="khsx-tgb__phu">
                      Xong sau {phut(t.tong)} — gồm {phut(t.tong - t.chiemMay)} chờ
                    </span>
                  )}
                </div>

                {chiemTB > 0 && (
                  <div className="khsx-tgb__thanh" aria-hidden="true">
                    {setup > 0 && <span className="khsx-tgb__doan is-chuan-bi" style={{ width: `${pct(setup)}%` }} />}
                    {chayTB > 0 && <span className="khsx-tgb__doan is-chay" style={{ width: `${pct(chayTB)}%` }} />}
                    {phatSinh > 0 && <span className="khsx-tgb__doan is-phat-sinh" style={{ width: `${pct(phatSinh)}%` }} />}
                  </div>
                )}

                <ul className="khsx-tgb__ds">
                  <li className="khsx-tgb__dong">
                    <span className="khsx-tgb__cham is-chuan-bi" aria-hidden="true" />
                    <div className="khsx-tgb__giua">
                      <span className="khsx-tgb__ten">Chuẩn bị &amp; căn chỉnh</span>
                      {khoanChuanBi.length > 0 && (
                        <span className="khsx-tgb__khoan">
                          {khoanChuanBi.map((k, i) => (
                            <span key={`${k.ten}-${i}`} className="khsx-tgb__khoan-o">
                              {k.ten || "—"} <b>{num(Number(k.phut ?? 0))} phút</b>
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                    <span className="khsx-tgb__gio">{phut(setup)}</span>
                  </li>

                  <li className="khsx-tgb__dong">
                    <span className="khsx-tgb__cham is-chay" aria-hidden="true" />
                    <div className="khsx-tgb__giua">
                      {/* Công thức quy đổi (có khi là cả câu `if (…)` ba dòng) hiện khi rê chuột vào
                          tên — dòng dưới chỉ giữ phép chia ngắn. */}
                      <CongThucTip
                        tieuDe={row.loai_buoc === "to" ? "Tổ làm" : "Chạy máy"}
                        congThuc={coMay && tg.quy_doi_dien_giai ? String(tg.quy_doi_dien_giai) : null}
                        them={
                          coMay && tg.quy_doi_dien_giai
                            ? `÷ ${num(Number(tg.nang_suat_hieu_dung ?? 0))}/giờ${
                                Number(tg.so_luot_chay ?? 1) !== 1 ? ` × ${Number(tg.so_luot_chay ?? 1)} lượt` : ""
                              } = ${phut(chayTB)}`
                            : null
                        }
                        ghiChu={coMay ? `Nguồn tính: ${mayTen || "Chưa gán máy"}` : null}
                      >
                        <span className="khsx-tgb__ten">{row.loai_buoc === "to" ? "Tổ làm" : "Chạy máy"}</span>
                      </CongThucTip>
                      {coQuyDoi && (
                        <span className="khsx-tgb__phep">
                          {tg.quy_doi_dien_giai
                            ? ketQuaDienGiai(String(tg.quy_doi_dien_giai))
                            : `${num(Number(tg.so_luong_vao ?? 0))} ${nhanChang(tg.don_vi_vao as string | null)}`}
                          {" ÷ "}
                          {num(Number(tg.nang_suat_hieu_dung ?? 0))}/giờ
                          {Number(tg.so_luot_chay ?? 1) !== 1 ? ` × ${Number(tg.so_luot_chay ?? 1)} lượt` : ""}
                        </span>
                      )}
                      {row.loai_buoc === "to" && (
                        <span className="khsx-tgb__phep">Theo số giờ kế hoạch người lập lệnh gõ</span>
                      )}
                    </div>
                    <span className="khsx-tgb__gio">{phut(chayTB)}</span>
                  </li>

                  {phatSinh > 0 && (
                    <li className="khsx-tgb__dong">
                      <span className="khsx-tgb__cham is-phat-sinh" aria-hidden="true" />
                      <div className="khsx-tgb__giua">
                        <span className="khsx-tgb__ten">Phát sinh ngoài định mức</span>
                      </div>
                      <span className="khsx-tgb__gio">{phut(phatSinh)}</span>
                    </li>
                  )}
                </ul>

                {coDai ? (
                  <div className="khsx-tgb__dai">
                    <span className="khsx-tgb__dai-nhan">Khoảng theo tốc độ máy</span>
                    <div className="khsx-tgb__dai-hang">
                      <span className="khsx-tgb__dai-dau">
                        Nhanh nhất <b>{phut(chiemMin)}</b>
                      </span>
                      <span className="khsx-tgb__dai-ray" aria-hidden="true">
                        <span
                          className="khsx-tgb__dai-moc"
                          style={{ left: `${Math.min(100, Math.max(0, viTriKH))}%` }}
                        />
                      </span>
                      <span className="khsx-tgb__dai-dau">
                        Chậm nhất <b>{phut(chiemMax)}</b>
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="khsx-tgb__dai-trong">
                    {row.loai_buoc === "to"
                      ? "Bước tổ chạy theo số giờ kế hoạch gõ tay — không có khoảng nhanh–chậm."
                      : "Máy chưa khai tốc độ tối thiểu / tối đa nên chưa có khoảng nhanh–chậm."}
                  </p>
                )}
              </section>

              <section className="khsx-section-card">
                <div className="khsx-section-card__head">
                  <h3 className="khsx-section-card__title">Điều chỉnh</h3>
                </div>
                <div className="khsx-thoi-gian-grid">
                  {/* 08/09/2026: ô CHỈ hiện ở bước máy/thuê ngoài — làm tay thì không có "lượt qua
                      máy" nào để đếm. Bước tổ ép cứng 1 lượt (payload gửi 1, server ghi lại 1 lần
                      nữa). 06/10/2026: bỏ cặp nút "1 lượt / 2 lượt" đứng cạnh ô số — hai điều khiển
                      cùng sửa một giá trị; ô số nay có nút trừ/cộng. */}
                  {row.loai_buoc !== "to" && (
                    <div className="khsx-field">
                      <label className="khsx-field__label" htmlFor={`luot-${row.key}`}>Số lượt qua máy</label>
                      <div className="khsx-tgb__buoc-so">
                        <button
                          type="button"
                          className="khsx-tgb__buoc-nut"
                          aria-label="Bớt một lượt"
                          disabled={!canUpdate || Number(row.so_luot_chay || 1) <= 1}
                          onClick={() => set("so_luot_chay", String(Math.max(1, Number(row.so_luot_chay || 1) - 1)))}
                        >
                          −
                        </button>
                        <input
                          id={`luot-${row.key}`}
                          type="number"
                          min="1"
                          className="khsx-tgb__buoc-o"
                          value={row.so_luot_chay}
                          placeholder="1"
                          disabled={!canUpdate}
                          onChange={(e) => set("so_luot_chay", e.target.value)}
                        />
                        <button
                          type="button"
                          className="khsx-tgb__buoc-nut"
                          aria-label="Thêm một lượt"
                          disabled={!canUpdate}
                          onClick={() => set("so_luot_chay", String(Number(row.so_luot_chay || 1) + 1))}
                        >
                          +
                        </button>
                        <span className="khsx-tgb__buoc-dv">lượt</span>
                      </div>
                      <span className="khsx-field__hint">In trở 2 mặt = 2 lượt qua máy</span>
                    </div>
                  )}

                  {/* SỐ GIỜ KẾ HOẠCH (18/09/2026, mg `0319`) — bước TỔ không còn năng suất hay kíp
                      để máy chia, nên giờ của nó là số người lập lệnh ƯỚC gõ tay. Mặc định 0, nhận
                      số lẻ (1,5 giờ), để 0 cũng không cảnh báo gì (chủ chốt). */}
                  {row.loai_buoc === "to" && (
                    <div className="khsx-field">
                      <label className="khsx-field__label" htmlFor={`gio-kh-${row.key}`}>Số giờ kế hoạch</label>
                      <div className="khsx-input-unit-combine">
                        <input
                          id={`gio-kh-${row.key}`}
                          type="number"
                          min="0"
                          step="0.25"
                          inputMode="decimal"
                          className="khsx-input-combine__num"
                          value={row.so_gio_ke_hoach}
                          placeholder="0"
                          disabled={!canUpdate}
                          onChange={(e) => {
                            // Chỉ nhận SỐ: ô rỗng về "" (gửi đi thành 0), số âm kẹp về 0. Giữ nguyên
                            // chuỗi đang gõ ("1." / "0,5" giữa chừng) để không nuốt dấu thập phân.
                            const v = e.target.value;
                            set("so_gio_ke_hoach", v === "" || Number(v) >= 0 ? v : "0");
                          }}
                        />
                        <span className="khsx-input-combine__unit">giờ</span>
                      </div>
                      <span className="khsx-field__hint">
                        Tổ ước làm bao lâu — xếp lịch chiếm đúng chừng ấy giờ của tổ. Để 0 nếu chưa ước.
                      </span>
                    </div>
                  )}

                  <div className="khsx-field">
                    <label className="khsx-field__label" htmlFor={`phat-sinh-${row.key}`}>Thời gian phát sinh</label>
                    <div className="khsx-extra-time-control">
                      <div className="khsx-input-unit-combine">
                        <input
                          id={`phat-sinh-${row.key}`}
                          type="number"
                          min="0"
                          className="khsx-input-combine__num"
                          value={row.phat_sinh_phut}
                          placeholder="0"
                          disabled={!canUpdate}
                          onChange={(e) => set("phat_sinh_phut", Math.max(0, Number(e.target.value) || 0).toString())}
                        />
                        <span className="khsx-input-combine__unit">phút</span>
                      </div>
                      {canUpdate && (
                        <div className="khsx-quick-presets">
                          <button
                            type="button"
                            className="khsx-preset-btn"
                            title="Thêm 15 phút"
                            onClick={() => set("phat_sinh_phut", (Number(row.phat_sinh_phut || 0) + 15).toString())}
                          >
                            +15 phút
                          </button>
                          <button
                            type="button"
                            className="khsx-preset-btn"
                            title="Thêm 30 phút"
                            onClick={() => set("phat_sinh_phut", (Number(row.phat_sinh_phut || 0) + 30).toString())}
                          >
                            +30 phút
                          </button>
                          {Number(row.phat_sinh_phut || 0) > 0 && (
                            <button
                              type="button"
                              className="khsx-preset-btn khsx-preset-btn--reset"
                              title="Đặt lại 0 phút"
                              onClick={() => set("phat_sinh_phut", "0")}
                            >
                              Xoá
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <span className="khsx-field__hint">Cộng thẳng vào thời gian chiếm máy</span>
                  </div>
                </div>
              </section>
            </div>
            );
          })()}
        </div>

        <footer className="khsx-drawer__foot">
          <p className="khsx-drawer__tally">
            Sửa ở đây chưa ghi vào DB — bấm <strong>Lưu công đoạn</strong> ở bảng chính.
          </p>
          <div className="khsx-drawer__footbtns">
            <Button variant="secondary" onClick={onClose}>
              Xong
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/** Nhãn loại dụng cụ — khớp `khuon_be.LOAI_KHUON`. 01/10/2026: chỉ còn khuôn bế (ép kim / khung
 *  lụa đã gỡ; máy chủ không bật cờ "phải chốt khuôn" cho hai loại đó nên thẻ này không mở ra với
 *  chúng). Dòng chưa phân loại (`loai = null`) rơi về chữ chung. */
const NHAN_TOOLING: Record<string, string> = {
  khuon_be: "khuôn bế",
};

/** Tình trạng khuôn rút thành CHỮ NGẮN đứng cạnh tên trong ô chọn — chỉ hiện khi KHÔNG bình
 *  thường. Dao sẵn sàng thì để trống cho danh sách đỡ rối; đã chọn rồi mới xem câu đầy đủ ở
 *  `moTaTinhTrang`. */
function nhanTinhTrangNgan(tt: string | null | undefined): string | undefined {
  switch (tt) {
    case "dang_dat_lam": return "ĐANG LÀM";
    case "hong": return "HỎNG";
    case "thanh_ly": return "ĐÃ THANH LÝ";
    default: return undefined;
  }
}

/** Ba MỨC của tình trạng dao */
function nhomTinhTrang(tt: string | null | undefined): "san" | "cho" | "hong" {
  if (tt === "hong" || tt === "thanh_ly") return "hong";
  if (tt === "dang_dat_lam") return "cho";
  return "san";
}

/** Một câu trả lời trọn vẹn cho "dao này dùng được chưa, lấy ở đâu". */
function moTaTinhTrang(dao: { so_ke?: string | null; tinh_trang?: string } | null): string {
  if (!dao) return "Chưa nạp được thông tin khuôn — bấm Làm mới ở đầu màn.";
  switch (dao.tinh_trang) {
    case "dang_dat_lam":
      // Không kèm ngày dự kiến nữa (mg `0293` gỡ cột): mốc đó chưa ai cập nhật bao giờ. Người theo
      // dõi dao đổi tình trạng khi cầm được nó — đó mới là tin nói ra được.
      return "Đang đặt làm — chưa có trong tay. Bước này chưa chạy được.";
    case "hong":
      return "Khuôn HỎNG — không dùng được. Chọn con khác hoặc làm khuôn mới.";
    case "thanh_ly":
      return "Khuôn ĐÃ THANH LÝ — không còn trong kho. Chọn con khác hoặc làm khuôn mới.";
    default:
      return dao.so_ke ? `Có sẵn — lấy tại ${dao.so_ke}` : "Có sẵn — chưa khai số kệ";
  }
}

/** Khối KHUÔN của một bước */
function KhuonCuaBuoc({
  row,
  tenSanPham,
  tenKhach,
  khuonRefs,
  canUpdate,
  onChon,
  onTaoMoi,
}: {
  row: EditRow;
  tenSanPham: string;
  /** Tên khách của lệnh — CHỈ để nói ra thành lời cái bộ lọc server đã áp. Danh sách chỉ có vài
   *  dòng nên dễ tưởng kho rỗng; ghi tên khách ra thì người chốt dao biết ngay vì sao ngắn. */
  tenKhach: string;
  khuonRefs: import("../api/client").KhuonChonDuoc[] | null;
  canUpdate: boolean;
  onChon: (id: number | null) => void;
  onTaoMoi: (input: { ten: string; loai: string | null }) => Promise<number>;
}) {
  const [moTaoMoi, setMoTaoMoi] = useState(false);
  const [tenMoi, setTenMoi] = useState("");
  const [dangTao, setDangTao] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);

  const nhanLoai = NHAN_TOOLING[row.tooling_type ?? ""] ?? "khuôn / khung";

  const chonDuoc = useMemo(() => {
    const ds = khuonRefs ?? [];
    return ds.filter((k) => !row.tooling_type || !k.loai || k.loai === row.tooling_type);
  }, [khuonRefs, row.tooling_type]);

  // Ô chọn là `<Select>` gõ-lọc (bỏ dấu), không phải `<select>` gốc: kho dao của một khách lặp
  // lại vẫn tới vài chục con và tên chúng na ná nhau ("hộp bánh 20×20", "hộp bánh 20×25"), cuộn
  // tay để tìm là chỗ người ta bỏ cuộc rồi bấm "Làm khuôn mới" — đặt lại con dao đang nằm trên kệ.
  // MÃ + SỐ KỆ xuống dòng phụ chứ không bỏ đi như ô vật tư/máy: ở đây mã là thứ dán trên con dao
  // và số kệ là chỗ đi lấy nó, hai thứ đều phải đọc được lúc chọn. `khopGanDung` quét cả dòng phụ
  // nên gõ "kb-0002" hay "b1" vẫn ra.
  const khuonOpts = useMemo<SelectOption<string>[]>(
    () => chonDuoc.map((k) => ({
      value: String(k.id),
      label: k.ten || k.ma,
      sub: k.so_ke ? `${k.ma} (${k.so_ke})` : k.ma,
      hint: nhanTinhTrangNgan(k.tinh_trang),
    })),
    [chonDuoc],
  );

  const dao = useMemo(() => {
    if (row.khuon_be_id == null) return null;
    const trong = (khuonRefs ?? []).find((k) => k.id === row.khuon_be_id);
    if (trong) return trong;
    if (!row.khuon_be_ma && !row.khuon_be_ten) return null;
    return {
      id: row.khuon_be_id,
      ma: row.khuon_be_ma ?? `#${row.khuon_be_id}`,
      ten: row.khuon_be_ten ?? "",
      loai: row.tooling_type,
      so_ke: row.khuon_be_so_ke,
      tinh_trang: row.khuon_be_tinh_trang ?? "",
    };
  }, [row, khuonRefs]);

  const daChon = row.khuon_be_id != null;

  async function taoMoi() {
    const ten = tenMoi.trim();
    if (!ten) {
      setLoi("Cần tên khuôn.");
      return;
    }
    setDangTao(true);
    setLoi(null);
    try {
      onChon(await onTaoMoi({ ten, loai: row.tooling_type }));
      setMoTaoMoi(false);
      setTenMoi("");
    } catch (e) {
      setLoi(e instanceof Error ? e.message : "Không tạo được khuôn.");
    } finally {
      setDangTao(false);
    }
  }

  return (
    <section className="khsx-section-card">
      <div className="khsx-section-card__head">
        <h3 className="khsx-section-card__title">Khuôn của bước ({nhanLoai})</h3>
      </div>

      {/* Ý ĐỊNH CỦA SALE, chép từ phiếu tính giá — đọc TRƯỚC khi chọn dao (chốt 04/09/2026). Không
          có dòng này thì kế hoạch chốt dao trong bóng tối: tiền khuôn đã báo cho khách rồi mà
          người chốt không biết, tới lúc lệch mới lòi ra ở hoá đơn. */}
      {row.khuon_nguon && (
        <p className="khsx-khuon__y-dinh">
          Sale báo:{" "}
          {row.khuon_nguon === "lam_moi"
            ? `làm khuôn mới${row.khuon_phi ? `, ${row.khuon_phi.toLocaleString("vi-VN")}đ` : ""}`
            : "dùng khuôn có sẵn"}
        </p>
      )}
      {/* NHẮC chứ không chặn: máy không biết xưởng sẽ báo lại khách hay tự nuốt chi phí. */}
      {row.khuon_lech && <p className="khsx-khuon__lech">{row.khuon_lech}</p>}

      {daChon ? (
        <div className="khsx-khuon__da-chon">
          <div className="khsx-khuon__hang1">
            <span className="khsx-khuon__ma">{dao?.ma ?? `#${row.khuon_be_id}`}</span>
            <span className="khsx-khuon__ten">{dao?.ten || "—"}</span>
            {canUpdate && (
              <button type="button" className="khsx-khuon__bo" onClick={() => onChon(null)}>
                Bỏ chọn
              </button>
            )}
          </div>
          <span className={`khsx-khuon__tt khsx-khuon__tt--${nhomTinhTrang(dao?.tinh_trang)}`}>
            {moTaTinhTrang(dao)}
          </span>
        </div>
      ) : !canUpdate ? (
        <span className="khsx-val-text">Chưa gán khuôn</span>
      ) : moTaoMoi ? (
        <div className="khsx-khuon__form">
          <label className="khsx-field">
            <span className="khsx-field__label">Tên khuôn</span>
            <input
              className="khsx-input-std"
              value={tenMoi}
              onChange={(e) => setTenMoi(e.target.value)}
              placeholder="vd: Hộp bánh trung thu 20×20"
              autoFocus
            />
          </label>
          <div className="khsx-khuon__form-nut">
            <Button variant="primary" onClick={taoMoi} loading={dangTao}>Tạo khuôn</Button>
            <Button variant="ghost" onClick={() => { setMoTaoMoi(false); setLoi(null); }}>Huỷ</Button>
          </div>
          {loi && <div className="khsx-alert" role="alert">{loi}</div>}
          <span className="khsx-field__hint">
            Khuôn mới vào kho ở tình trạng <b>đang đặt làm</b>. Có dao trong tay thì vào màn Khuôn
            đổi tình trạng — mọi lệnh đang chờ nó tự cập nhật.
          </span>
        </div>
      ) : (
        <>
          <div className="khsx-khuon__chon">
            <Select
              options={khuonOpts}
              value=""
              placeholder={chonDuoc.length > 0
                ? `— chọn ${nhanLoai} có sẵn (${chonDuoc.length}) —`
                : `— khách này chưa có ${nhanLoai} nào —`}
              ariaLabel={`Chọn ${nhanLoai} có sẵn`}
              disabled={chonDuoc.length === 0}
              searchable
              searchPlaceholder="Gõ tên, mã hoặc số kệ…"
              portal
              onChange={(v) => v && onChon(Number(v))}
            />
            <Button variant="secondary" onClick={() => { setMoTaoMoi(true); setTenMoi(tenSanPham); }}>
              + Làm khuôn mới
            </Button>
          </div>
          {/* Nói THÀNH LỜI bộ lọc mà server đã áp (`lsx_service.khuon_chon_duoc`: khách của lệnh +
              loại của bước). Không có câu này thì danh sách 1–2 dòng trông y như kho rỗng, và
              người chốt dao đi làm con dao mới trong khi khách khác đang giữ đúng con đó. */}
          <span className="khsx-field__hint">
            Chỉ hiện {nhanLoai} của khách <b>{tenKhach || "— chưa có khách"}</b> — dụng cụ là của
            khách, không dùng chéo. Chưa thấy con cần tìm thì kiểm ở màn Khuôn xem nó
            đã gắn đúng khách chưa.
          </span>
        </>
      )}
    </section>
  );
}

/** Thẻ NHÀ GIA CÔNG của bước thuê ngoài (spec gia công ngoài §7). Nhà gia công = Nhà cung cấp tích
 *  "Nhận gia công" — không thêm nhanh ở đây, bên mua hàng tạo ở màn Nhà cung cấp. */
function NhaGiaCongCard({
  row,
  dai,
  canUpdate,
  onPatch,
}: {
  row: EditRow;
  dai: ViTriDai | null;
  canUpdate: boolean;
  onPatch: (p: Partial<EditRow>) => void;
}) {
  const { token } = useAuth();
  const [ds, setDs] = useState<NhaGiaCong[] | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return;
    let song = true;
    api.giaCongNgoai.nhaGiaCong(token)
      .then((r) => { if (song) setDs(r); })
      .catch((e: unknown) => { if (song) setLoi(e instanceof ApiError ? e.message : String(e)); });
    return () => { song = false; };
  }, [token]);
  // Nhà đã chọn nhưng nay bỏ tích / ngừng giao dịch vẫn phải HIỆN — không thì ô chọn trống trơn
  // trong khi bước vẫn trỏ tới họ, và bảng "còn thiếu" không nhắc (máy chủ giữ nguyên id).
  const mat = row.nha_cung_cap_id != null && ds != null
    && !ds.some((n) => n.id === row.nha_cung_cap_id);
  return (
    <section className="khsx-section-card">
      <div className="khsx-section-card__head">
        <h3 className="khsx-section-card__title">Nhà gia công</h3>
      </div>
      <div className="khsx-assign-grid">
        <label className="khsx-field">
          <span className="khsx-field__label">NHÀ GIA CÔNG</span>
          {loi ? (
            <span className="khsx-field__hint">{loi}</span>
          ) : (
            // Tìm GẦN ĐÚNG như ô Tên công đoạn ở trên — gõ không dấu, một mẩu tên.
            <Select<number | null>
              value={row.nha_cung_cap_id ?? null}
              disabled={!canUpdate || ds == null}
              ariaLabel="Nhà gia công"
              placeholder="— chọn nhà gia công —"
              searchable
              searchPlaceholder="Gõ tên nhà gia công…"
              options={[
                ...(mat && row.nha_cung_cap_id != null
                  ? [{
                      value: row.nha_cung_cap_id,
                      label: row.nha_cung_cap || "Nhà đã chọn",
                      sub: "Đã bỏ tích “Nhận gia công”",
                    }]
                  : []),
                ...(ds ?? []).map((n) => ({ value: n.id, label: n.ten })),
              ]}
              onChange={(id) => {
                onPatch({
                  nha_cung_cap_id: id,
                  nha_cung_cap: ds?.find((n) => n.id === id)?.ten
                    ?? (id != null && id === row.nha_cung_cap_id ? row.nha_cung_cap ?? "" : ""),
                });
              }}
            />
          )}
          {ds != null && ds.length === 0 && (
            <span className="khsx-field__hint">
              Chưa có nhà cung cấp nào tích “Nhận gia công” — vào màn Nhà cung cấp tích ô đó cho
              nhà gia công rồi chọn lại ở đây.
            </span>
          )}
          {dai?.truoc && (
            <span className="khsx-field__hint">
              Đi chung một lần gia công với bước “{dai.truoc}”.
            </span>
          )}
        </label>
      </div>
    </section>
  );
}
