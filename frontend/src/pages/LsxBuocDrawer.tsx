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
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ApiError, api, LSX_LOAI_BUOC_LENH, type LsxLoaiBuoc, type NhaGiaCong } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { Button } from "../components/Button";
import { Select, type SelectOption } from "../components/Select";
import { CongThucTip } from "../components/CongThucTip";
import type { ViTriDai } from "./gia-cong/giaCong";
import { dvNhan as dvNhanChung, type RefRow } from "./LsxRoutingTable";
import { coDonViGoc, nhanDongTon, nhanKho } from "../lib/khoGiay";
import { KhungKho } from "../components/kho-giay/KhungKho";
import { num } from "./keHoachSxShared";
import { donViOptions, tenDonVi, useNapTenDonVi } from "./tenDonVi";
import {
  type EditRow,
  type HangLoai,
  capMon,
  giayChoLuu,
  heSoChu,
  nhanDonVi,
  nhanGiayTheoDauVao,
  patchLoaiBuoc,
  tenBuoc,
} from "./lsxBuoc";

// Bước THUÊ NGOÀI (spec gia công ngoài 2026-09-26): nhà gia công lo máy, người, vật tư, thời gian.
// Drawer chỉ còn NHÀ GIA CÔNG (danh mục Nhà cung cấp tích "Nhận gia công") + ĐƠN GIÁ cả lần ở bước
// cuối dải. Mang đi / chốt số làm ở khối Gia công ngoài trên lệnh sau phát hành.
// 07/11/2026: hai loại Nội bộ | Gia công. "Nội bộ" lưu `may`, bước cũ mang `to` vẫn tính là Nội bộ.
const LOAI_BUOC_ORDER: LsxLoaiBuoc[] = ["may", "thue_ngoai"];

/** Gom máy theo `loai_may`.
 *  Xưởng có ~24 máy đủ loại (bế, bồi, UV, cán, in) — đổ phẳng thì gán máy bế cho bước ghi kẽm
 *  cũng trôi. Nhóm KHÔNG chặn: vẫn chọn được máy bất kỳ, chỉ là mắt phải đi qua nhãn loại. */
export function nhomMayTheoLoai(mayRefs: RefRow[]): { ten: string; items: RefRow[] }[] {
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
  // (`toRefs`, `mayRefs` vẫn là prop; drawer thôi chọn tổ, máy từ 07/11/2026.)
  khuonRefs,
  tenSanPham,
  tenKhach,
  onTaoKhuon,
  napGoiY,
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
  // (`onDoiMay` vẫn là prop nhưng drawer thôi chọn máy từ 07/11/2026, máy do bộ phận chọn.)
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
  /** Lượng gợi ý từng món cho bước đã lưu (`row.id`) — hỏi khi mở ngăn, không đi kèm chi tiết lệnh. */
  napGoiY?: (buocId: number) => Promise<EditRow["vat_tu_goi_y"]>;
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
  // Lượng gợi ý từng món: hỏi riêng khi mở ngăn (chi tiết lệnh không mang nữa, 10/11/2026). Bước
  // chưa lưu (`row.id` null) chưa có số vào–ra ở máy chủ nên không hỏi. `napGoiY` đổi khi lệnh vừa
  // lưu ⇒ hỏi lại theo số mới.
  const [goiYNap, setGoiYNap] = useState<{ id: number; ds: EditRow["vat_tu_goi_y"] } | null>(null);
  useEffect(() => {
    const id = row.id;
    if (id == null || !napGoiY) return;
    let huy = false;
    napGoiY(id).then((ds) => { if (!huy) setGoiYNap({ id, ds }); }).catch(() => {});
    return () => { huy = true; };
  }, [row.id, napGoiY]);
  const goiYDs = goiYNap && goiYNap.id === row.id ? goiYNap.ds : row.vat_tu_goi_y;

  // Bảng nhãn đơn vị nạp ở bảng cha rồi, gọi lại ở đây chỉ để drawer TỰ vẽ lại khi bảng về muộn
  // (hook có cache + danh sách người chờ dùng chung, không đẻ thêm request).
  const napDv = useNapTenDonVi();
  // Bước NGOÀI dòng giấy (ghi kẽm, đóng thùng): số không suy được từ chuỗi giấy, cũng không công
  // thức chung nào ở danh mục nói hộ — số bản kẽm đổi theo số màu/số mặt/số bài của TỪNG đơn. Nên
  // đây là chỗ DUY NHẤT khai được, và khai xong thì danh mục thôi kéo lại (`tu_khai_don_vi` ở BE).
  const laNgoaiDong = row.tren_dong_giay === false;
  const khaiTay = laNgoaiDong && canUpdate;
  // Hao THẬT = vào − ra quy về đơn vị vào. `hao_hut` chỉ là phần tờ CỐ ĐỊNH (bậc % cho ra 0 ở đây),
  // in thẳng nó thì bước hao 3% hiện "0 tờ (+3%)" trong khi máy đã cộng 77 tờ vào số vào.
  // Bước ngoài dòng giấy khai tay hai đầu, không qua chuỗi hao ⇒ giữ số khai ở danh mục.
  const haoCoDinh = Number(row.hao_hut || 0);
  const haoPct = Number(row.hao_hut_pct || 0);
  const haoThat = laNgoaiDong
    ? haoCoDinh
    : Math.max(0, Math.round(
        Number(row.so_luong_vao || 0) - Number(row.so_luong_ra || 0) / (Number(row.he_so_quy_doi) || 1),
      ));
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
      const khoGoiY = goiYDs.find((g) => capMon(g.hang_loai, g.vat_tu_id) === capMon("giay", x.id))?.kho_rong;
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
  }, [giayRefs, vatTuRefs, row.vat_tus, row.don_vi_vao, goiYDs]);

  // Việc của bước đã chạy ở bàn tổ ⇒ máy chủ không nhận đổi bộ phận ở lệnh: khoá sẵn ô.
  const khoaToMay = !canUpdate || row.da_bat_dau;

  // Đầu việc khoán của bước (`dsKhoan` / `khoanDaChon`) GỠ 18/09/2026 (mg `0320`).
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

  // Luật dọn khi đổi loại bước ở `patchLoaiBuoc` — dùng chung với ô "Loại" trên bảng công đoạn.
  function doiLoaiBuoc(k: LsxLoaiBuoc) {
    onPatch(patchLoaiBuoc(k));
  }

  const meta = LSX_LOAI_BUOC_LENH[row.loai_buoc];
  const ngoai = row.loai_buoc === "thue_ngoai";

  // Mở drawer từ badge trạng thái ngoài bảng/sơ đồ → nhảy thẳng tới tab đó
  useEffect(() => {
    if (tabDau) {
      setActiveTab(normalizeTab(tabDau));
    }
  }, [row.key, tabDau]);


  // Danh sách Tab chính cho Drawer
  const tabsList = useMemo(() => {
    // Thuê ngoài: nhà gia công lo vật tư + thời gian ⇒ chỉ còn Cấu hình, Nhà gia công, Phụ thuộc.
    const list: { key: MainTab; label: string; badge?: number }[] = ngoai
      ? [
          { key: "cau_hinh", label: "Cấu hình & Số lượng" },
          { key: "phan_cong", label: "Nhà gia công" },
        ]
      : [
          // 07/11/2026: lệnh không chọn tổ, máy, giờ nữa ⇒ gỡ "Phân công & Thiết bị" và
          // "Tiến độ & Thời gian". Bộ phận nhận nằm ở Cấu hình; máy, nhóm, thứ tự do bộ phận chọn.
          { key: "cau_hinh", label: "Cấu hình & Số lượng" },
          { key: "vat_tu", label: "Vật tư", badge: row.vat_tus.length },
        ];
    // CUỐI hàng — badge đếm số bước tiền nhiệm đang chọn, đúng con số trước đây treo ở tab Tiến độ.
    list.push({ key: "phu_thuoc", label: "Phụ thuộc", badge: row.phu_thuoc_step_keys.length });
    return list;
  }, [ngoai, row.vat_tus.length, row.phu_thuoc_step_keys.length]);

  // Đang đứng ở tab vừa biến mất (đổi sang thuê ngoài, hoặc badge ngoài bảng mở thẳng tab đó).
  useEffect(() => {
    if (ngoai && (activeTab === "vat_tu" || activeTab === "tien_do")) setActiveTab("phan_cong");
    if (!ngoai && (activeTab === "phan_cong" || activeTab === "tien_do")) setActiveTab("cau_hinh");
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
                        const m = LSX_LOAI_BUOC_LENH[k];
                        const dang = k === "thue_ngoai" ? ngoai : !ngoai;
                        return (
                          <button
                            key={k}
                            type="button"
                            className={dang ? "is-active" : ""}
                            disabled={!canUpdate}
                            aria-pressed={dang}
                            title={m.hint}
                            onClick={() => { if (!dang) doiLoaiBuoc(k); }}
                          >
                            {m.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* BỘ PHẬN NHẬN (07/11/2026) thay ô tổ + máy: chỉ các bộ phận có nhóm làm được công
                      đoạn, xếp theo số nhóm, bộ phận đầu là chọn sẵn. */}
                  {!ngoai && (
                    <div className="khsx-field khsx-field--wide">
                      <span className="khsx-field__label">BỘ PHẬN NHẬN</span>
                      {buocGhep && deLen ? (
                        <span className="khsx-val-text">
                          {row.department_ten ?? "—"} (chạy chung ở bài ghép {baiGhep?.ma}, đổi ở bài)
                        </span>
                      ) : (
                        <Select
                          options={(row.bo_phan_chon ?? []).map((b, k) => ({
                            value: String(b.id),
                            label: b.ten,
                            hint: `${b.so_nhom} nhóm làm được${k === 0 ? ", chọn sẵn" : ""}`,
                          }))}
                          value={row.department_id != null ? String(row.department_id) : ""}
                          onChange={(v) => onDoiTo(v ? Number(v) : null)}
                          disabled={khoaToMay}
                          ariaLabel="Bộ phận nhận"
                          placeholder={(row.bo_phan_chon?.length ?? 0) === 0
                            ? "Công đoạn chưa tick nhóm nào" : "— chọn bộ phận —"}
                          searchable
                          searchPlaceholder="Gõ tên bộ phận…"
                          portal
                          className="khsx-select-std"
                        />
                      )}
                      <span className="khsx-field__hint">
                        {row.da_bat_dau ? "Việc đã bắt đầu ở xưởng, không đổi bộ phận được nữa."
                          : "Máy, nhóm thợ và thứ tự làm do bộ phận chọn ở Kế hoạch bộ phận."}
                      </span>
                    </div>
                  )}

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
                          {haoThat > 0 || haoPct > 0 ? (
                            <>
                              <strong>{num(haoThat)}</strong> {dvNhan(row.don_vi_vao)}
                              {haoPct > 0 && (haoCoDinh > 0
                                ? ` (${haoPct}% + ${num(haoCoDinh)} ${dvNhan(row.don_vi_vao)})`
                                : ` (${haoPct}%)`)}
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
              {/* Thẻ Khuôn dao của bước (chuyển từ tab Phân công 07/11/2026) */}
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
          )}

          {/* =========================================================================
              TAB 2: PHÂN CÔNG & THIẾT BỊ
             ========================================================================= */}
          {activeTab === "phan_cong" && ngoai && (
            <div className="khsx-tab-pane">
              <div className="khsx-form-stack">
                <NhaGiaCongCard
                  row={row}
                  dai={daiGiaCong}
                  canUpdate={canUpdate}
                  onPatch={onPatch}
                />
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
                          const goiY = goiYDs.find(
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
                                {/* Vật tư khác: khổ TUỲ CHỌN người kế hoạch gõ (27/10/2026) — màng bóng chỉ rộng,
                                    decal hai cạnh, mực/keo để trống. Kế hoạch vật tư, mua hàng, kho tách theo khổ này. */}
                                {v.hang_loai !== "giay" && (canUpdate ? (
                                  <div className="khsx-vattu-kho">
                                    <span className="khsx-vattu-kho__label">Khổ</span>
                                    <KhungKho
                                      ariaLabel={`Khổ ${v.vat_tu_ten}`}
                                      rong={Number(v.kho_rong) || 0}
                                      dai={Number(v.kho_dai) || 0}
                                      onChange={(k) =>
                                        set("vat_tus", row.vat_tus.map((x, j) => (j === i
                                          ? { ...x, kho_rong: k.rong ? String(k.rong) : "", kho_dai: k.dai ? String(k.dai) : "" }
                                          : x)))
                                      }
                                    />
                                  </div>
                                ) : Number(v.kho_rong) > 0 && (
                                  <div className="khsx-vattu-kho">
                                    <span className="khsx-vattu-kho__label">{nhanKho(Number(v.kho_rong), Number(v.kho_dai) || 0)}</span>
                                  </div>
                                ))}
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
                                  const goiY = goiYDs.find(
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
  return (
    <section className="khsx-section-card">
      <div className="khsx-section-card__head">
        <h3 className="khsx-section-card__title">Nhà gia công</h3>
      </div>
      <div className="khsx-assign-grid">
        <label className="khsx-field">
          <span className="khsx-field__label">NHÀ GIA CÔNG</span>
          <ChonNhaGiaCong row={row} canUpdate={canUpdate} onPatch={onPatch} />
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

/** Ô chọn NHÀ GIA CÔNG của bước thuê ngoài — dùng chung cho thẻ trong ngăn và ô "Tổ và máy" trên
 *  bảng công đoạn. Nhà gia công = Nhà cung cấp tích "Nhận gia công". */
export function ChonNhaGiaCong({
  row,
  canUpdate,
  onPatch,
}: {
  row: EditRow;
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
  if (loi) return <span className="khsx-field__hint">{loi}</span>;
  return (
    <>
      {/* Tìm GẦN ĐÚNG như ô Tên công đoạn — gõ không dấu, một mẩu tên. */}
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
      {ds != null && ds.length === 0 && (
        <span className="khsx-field__hint">
          Chưa có nhà cung cấp nào tích “Nhận gia công” — vào màn Nhà cung cấp tích ô đó cho
          nhà gia công rồi chọn lại ở đây.
        </span>
      )}
    </>
  );
}
