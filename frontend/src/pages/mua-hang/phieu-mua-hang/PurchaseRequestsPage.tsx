// Màn MUA HÀNG — shell (tách từ pages/PurchaseRequestsPage.tsx).
// Giữ ở đây: state + fetch + effects + handlers (`save` / `runAction` / 4×`confirm*`) + chỗ mount.
// ⚠️ XƯƠNG SỐNG RELOAD là cặp `updateRow(next)` + `loadSources()`: mọi mutator phải gọi ĐỦ CẢ HAI,
// và component con nhận đủ cả hai qua props. `save` CỐ Ý ở lại đây (nó chạm `rows`/`tab`/
// `loadSuppliers` + cụm FormState) — drawer form chỉ nhận nó làm handler của <form>.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ApiError,
  api,
  type DepartmentPurchaseRequestRow,
  type DonViDungDuoc,
  type HangLoai,
  type NhomTien,
  type PurchaseDeliveryRow,
  type PurchaseRequestRow,
  type SupplierRow,
} from "../../../api/client";
import { coDonViGoc } from "../../../lib/khoGiay";
import { useDebounced } from "../../../utils/useDebounced";
import { useAuth } from "../../../auth/useAuth";
import { useKhiTickDoi } from "../../../hooks/useKhiTickDoi";
import { useMoLenh } from "../mua-cho/OMuaCho";
import { useCan } from "../../../auth/permissions";
import type { NavigateFn } from "../../../components/AppShell";
import type { SeedLine } from "../../KhoDeNghiPage";
import { PurchaseDetailDrawer } from "./components/PurchaseDetailDrawer";
import { PurchaseFormDrawer } from "./components/PurchaseFormDrawer";
import { PurchaseModals } from "./components/PurchaseModals";
import { PhieuListTab } from "./tabs/PhieuListTab";
import { YeuCauInboxTab } from "./tabs/YeuCauInboxTab";
import { useNapTenDonVi } from "../../tenDonVi";
import { thamSoKy } from "../../thanh-loc/ky-danh-sach";
import { useLocMan } from "../../thanh-loc/useLocMan";
import {
  LOC_MAN_YC_TRONG,
  locManYeuCauLenUrl,
  locManYeuCauTuUrl,
  thamSoLocYeuCau,
  useDieuKienYeuCau,
  type LocManYeuCau,
} from "../loc-mua-hang/dieu-kien-yeu-cau";
import {
  LOC_MAN_DMH_TRONG,
  locManDonMuaHangLenUrl,
  locManDonMuaHangTuUrl,
  thamSoLocDonMuaHang,
  useDieuKienDonMuaHang,
  type LocManDonMuaHang,
} from "../loc-mua-hang/dieu-kien-don-mua";
import { PAGE_SIZE, SOURCE_PAGE_SIZE } from "./shared/constants";
import {
  chaoGiaChoMatHang,
  emptyLine,
  emptyRequest,
  fromRequest,
  khoNhapTuDongMua,
  lineTotal,
  todayInputValue,
} from "./shared/helpers";
import { dongDuocChon } from "./shared/types";
import type {
  FormLine,
  FormState,
  PurchaseTab,
  SourceStatusFilter,
  StatusFilter,
} from "./shared/types";
import "../../master-data.css";
import "../../accounting.css";
// Các hộp thoại của phiếu (số thực nhận, gán hoá đơn) vẽ bảng bằng lưới `lds-g`; payables.css còn
// cấp các lớp khác của hộp (vd `.pay-block__hint`).
import "../../payables.css";
import "../../purchase.css";
import "./phieu-mua-hang-chuan.css";

type LocManMuaHang = { dmh: LocManDonMuaHang; yc: LocManYeuCau };
const LOC_MAN_MUA_HANG_TRONG: LocManMuaHang = { dmh: LOC_MAN_DMH_TRONG, yc: LOC_MAN_YC_TRONG };
const TIEN_TO_YC = "yc_";
const docLocMuaHang = (p: URLSearchParams): LocManMuaHang => ({
  dmh: locManDonMuaHangTuUrl(p),
  yc: locManYeuCauTuUrl(p, TIEN_TO_YC),
});
const ghiLocMuaHang = (t: LocManMuaHang) => ({
  ...locManDonMuaHangLenUrl(t.dmh),
  ...locManYeuCauLenUrl(t.yc, TIEN_TO_YC),
});

export function PurchaseRequestsPage({
  navigate,
  eventTick = 0,
  focusRequestCode = null,
  lapDonTuYeuCau = false,
  onDataRefreshed,
}: {
  navigate: NavigateFn;
  eventTick?: number;
  /** Liên thông từ màn khác (Công nợ / Kế toán thu mua / Phiếu chi): mã tài liệu cần soi.
   *  Mã `PMH-…` = phiếu mua → tab "phieu"; mã `YCMH-…` = yêu cầu → tab "yeu-cau".
   *  Xem effect "BẪY LIÊN THÔNG" bên dưới trước khi đụng vào. */
  focusRequestCode?: string | null;
  /** Kèm mã YCMH: mở luôn form lập đơn cho yêu cầu đó khi nó nạp xong (nút ở chi tiết yêu cầu). */
  lapDonTuYeuCau?: boolean;
  onDataRefreshed?: () => void;
}) {
  const { token } = useAuth();
  const can = useCan();
  const moLenh = useMoLenh(can("san_xuat", "read") ? navigate : undefined);
  // Nạp danh mục Đơn vị MỘT lần: mọi chỗ hiện số lượng ở màn này (dòng hàng, đợt giao, hộp ghi
  // đợt, phiếu in) đọc TÊN đơn vị qua `tenDonVi()`. Thiếu dòng này là tất cả rơi về mã trần.
  useNapTenDonVi();
  const canCreate = can("thu_mua", "create");
  // Mã YCMH chỉ bấm được khi có ô Xem của màn đó — ô Mua hàng đọc được dữ liệu YCMH nhưng KHÔNG
  // mở màn (Sidebar.tsx), bấm vào là ăn màn chặn.
  const openYcmh = can("yeu_cau_mua_hang", "read")
    ? (code: string) => navigate("yeu-cau-mua-hang", { focusRequestCode: code })
    : undefined;
  // Đợt giao ↔ phiếu nhập kho = CÙNG sự kiện hàng về: bấm "Nhập kho" ở một đợt → nhảy sang màn
  // Yêu cầu kho, mở sẵn form NHẬP điền theo hàng đã nhận. Ghi chú trỏ về mã đơn mua + số đợt.
  //
  // MẶT HÀNG auto-điền từ liên kết danh mục gốc của dòng đơn mua (mg 0174), khớp qua
  // `purchase_request_line_id`. Dòng đơn mua chỉ có tên chữ (không link danh mục) → hang null →
  // kho tự chọn (ô chọn vẫn mở dù dòng khoá). Tên hàng vẫn đẩy vào ghi chú để đối chiếu.
  const nhapKhoTuDot = (row: PurchaseRequestRow, dot: PurchaseDeliveryRow) => {
    // Khớp dòng giao → dòng đơn mua (đơn giá + mặt hàng gốc) qua purchase_request_line_id.
    const dongTheoId = new Map(row.lines.map((pl) => [pl.id, pl]));
    const seed: SeedLine[] = dot.lines.map((dl) => {
      const pl = dongTheoId.get(dl.purchase_request_line_id);
      // MUA CHO LỆNH NÀO (11/10/2026): dòng đơn mua cho đúng MỘT lệnh / bài thì dòng nhập mang lệnh
      // đó. Thiếu nó thì đơn có cùng một vật tư ở hai dòng (một cho lệnh, một theo yêu cầu) lên máy
      // chủ thành hai dòng y hệt ⇒ bị chặn "gộp số lượng lại" mà form khoá không gộp được. Dòng gom
      // cho nhiều lệnh thì để trống như cũ.
      const lenh = pl?.mua_cho.length === 1 ? pl.mua_cho[0] : null;
      return {
        lsx_id: lenh?.loai === "lsx" ? lenh.id : null,
        bai_ghep_id: lenh?.loai === "bai" ? lenh.id : null,
        lsx_ma: lenh?.loai === "lsx" ? lenh.ma : null,
        bai_ghep_ma: lenh?.loai === "bai" ? lenh.ma : null,
        hang_loai: pl?.hang_loai ?? null,
        hang_id: pl?.hang_id ?? null,
        hang_ma: pl?.hang_ma ?? null,
        hang_ten: pl?.hang_ten ?? null,
        dvt: dl.unit,
        he_so_ve_goc: null,
        sl_de_nghi: dl.quantity,
        don_gia: pl?.expected_unit_price ?? null,
        ghi_chu: [dl.item_name, dl.note].filter(Boolean).join(" — ") || null,
        // Giấy: nhập đúng dạng + khổ của dòng giao (form khoá ⇒ thủ kho không phải khai lại). Khổ
        // THỰC NHẬN (07/10/2026): NCC giao khác khổ đặt thì hàng vào tồn theo khổ nhận — dòng giao
        // đã trả về khổ nhận, không ghi thì là khổ đặt.
        ...khoNhapTuDongMua(pl ? { ...pl, kho_rong: dl.kho_rong, kho_dai: dl.kho_dai } : pl),
      };
    });
    navigate("kho-main", {
      khoNhapSeed: {
        seed,
        ngay_can: (dot.delivery_date || "").slice(0, 10),   // ngày nhập = ngày giao của đợt
        ghi_chu: `Nhập từ đơn mua ${row.code} — đợt ${dot.seq_no}`,
        locked: true,   // số liệu từ đơn mua → khoá, không cho sửa dòng
        deliveryId: dot.id,   // gắn nguồn đợt → yêu cầu chặn nhập trùng
        don_mua_ma: row.code,   // hiện rõ mã đơn mua ở THÔNG TIN CHUNG của form nhập
        dot_so: dot.seq_no,
        ncc_ten: row.supplier_name || undefined,
        hoa_don: dot.invoice_number || undefined,
      },
    });
  };
  // Đợt ĐÃ nhập → mở đúng yêu cầu nhập đã tạo (màn Kho, tab Yêu cầu) thay vì seed lại.
  const xemYeuCauNhap = (dot: PurchaseDeliveryRow) => {
    if (dot.stock_request_id == null) return;
    navigate("kho-main", { khoOpenRequest: { id: dot.stock_request_id, view: "denghi" } });
  };
  const canUpdate = can("thu_mua", "update");
  // Ba nút "Sửa số nhận · Mở lại đơn · Đóng đơn" gác bằng ô "Thao tác" (`update`) — gộp lại
  // ngày 12/08/2026 sau khi chủ chốt test ô riêng `manage_status` và kết luận nó không đáng có.
  const canApprovePurchase = can("thu_mua", "update");
  // KHÔNG còn `canApprove` ở màn này: duyệt đơn mua đã chuyển sang Kế toán thu mua (04/08/2026).
  //
  // ⚠️ Hộp "Lý do từ chối" (`reasonModal.kind === "reject"`) vẫn còn trong file nhưng KHÔNG CÒN AI
  // BẤM — chỉ nhánh `cancel` còn chạy. Giữ tạm để chép sang màn Đơn mua hàng; chép xong thì dọn,
  // đừng để nó nằm lại làm người đọc sau tưởng màn này vẫn từ chối được.
  // Tab đang mở. CỐ Ý mở màn ở "yeu-cau" và CỐ Ý không nhớ qua lần vào (không localStorage,
  // không nâng lên URL): hai người mở cùng màn phải thấy giống nhau, và việc của Thu mua luôn
  // bắt đầu từ hộp yêu cầu. Đừng "cải tiến" thành ghi nhớ lựa chọn.
  const [tab, setTab] = useState<PurchaseTab>("yeu-cau");
  const [rows, setRows] = useState<PurchaseRequestRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(PAGE_SIZE);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  /** Nhóm cột Tiền — độc lập với `status` (Hàng). "" = không lọc tiền. */
  const [tien, setTien] = useState<NhomTien | "">("");
  // Thanh lọc chung của HAI danh sách (06/10/2026), ghi lên URL dưới cùng dấu `?man=mua-hang`: khoá
  // của danh sách đơn không tiền tố (`ky`, `ncc`, `coc`…), của danh sách yêu cầu mang `yc_`. Chỉ lọc
  // lên URL — tab đang mở thì KHÔNG (xem ghi chú `tab` ở trên).
  const [locMan, setLocManGoc] = useLocMan("mua-hang", LOC_MAN_MUA_HANG_TRONG, docLocMuaHang, ghiLocMuaHang);
  const setLocDon = (dmh: LocManDonMuaHang) => {
    setLocManGoc({ ...locMan, dmh });
    setPage(1);
  };
  const setLocYeuCau = (yc: LocManYeuCau) => {
    setLocManGoc({ ...locMan, yc });
    setSourcePage(1);
    setMonPage(1);
  };
  const dieuKienDon = useDieuKienDonMuaHang();
  const dieuKienYeuCau = useDieuKienYeuCau();
  const khoaLocDon = JSON.stringify({ ...thamSoKy(locMan.dmh.ky), ...thamSoLocDonMuaHang(locMan.dmh.loc) });
  const khoaLocYeuCau = JSON.stringify({ ...thamSoKy(locMan.yc.ky), ...thamSoLocYeuCau(locMan.yc.loc) });
  /** Số theo trạng thái của từng danh sách — máy chủ đếm sau lọc, trước tab (`tat_ca` = Tất cả). */
  const [demDon, setDemDon] = useState<Record<string, number> | null>(null);
  const [demTien, setDemTien] = useState<Record<string, number> | null>(null);
  const [demYeuCau, setDemYeuCau] = useState<Record<string, number> | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [sourceRows, setSourceRows] = useState<DepartmentPurchaseRequestRow[]>(
    [],
  );
  const [sourceTotal, setSourceTotal] = useState(0);
  // Số đếm trên TAB — CỐ Ý KHÁC số dòng của bảng bên trong, đừng "sửa cho khớp".
  //
  // Bảng yêu cầu mặc định lọc "Tất cả" (chủ chốt 08/08/2026) nên `sourceTotal` gồm cả phiếu đã
  // Hoàn tất / Đã huỷ. Con số trên tab là TÍN HIỆU CÓ VIỆC, nên nó chỉ đếm yêu cầu đang `open`
  // (chờ Thu mua xử lý). `somNhat` = ngày cần hàng sớm nhất trong nhóm đó — dùng cho dải nhắc và
  // cho tone đỏ của tab.
  const [choMua, setChoMua] = useState<{ soLuong: number; somNhat: string | null }>({
    soLuong: 0,
    somNhat: null,
  });
  const [sourceQ, setSourceQ] = useState("");
  // Mặc định "Chờ Thu mua xử lý": tab tên "Yêu cầu chờ xử lý" và con số trên tab đếm đúng nhóm này —
  // mở ra mà lẫn cả Hoàn tất, Đã huỷ thì tên tab nói một đằng bảng hiện một nẻo (07/10/2026).
  // Lối mở thẳng một yêu cầu (`focusRequestCode`) vẫn tự trả về "Tất cả" để tìm thấy dòng đó.
  const [sourceStatus, setSourceStatus] = useState<SourceStatusFilter>("open");
  // Chế độ "Xem theo: Từng món" (phương án 3): mặc định chip Chờ lập đơn — món Thu mua còn phải gom.
  const [tinhTrangMon, setTinhTrangMon] = useState("cho_lap");
  const [monPage, setMonPage] = useState(1);
  /** Tăng sau mỗi thao tác chạm yêu cầu — bảng Từng món nạp lại (xem `napLaiYeuCau`). */
  const [monTick, setMonTick] = useState(0);
  const [sourceLoading, setSourceLoading] = useState(true);
  // Ô nhập vẫn bám state gốc (gõ tới đâu hiện tới đó); chỉ lời gọi máy chủ đọc bản đã
  // chậm 300ms — xem `utils/useDebounced`.
  const qDebounced = useDebounced(q);
  const sourceQDebounced = useDebounced(sourceQ);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourcePage, setSourcePage] = useState(1);
  const [sourceSize, setSourceSize] = useState(SOURCE_PAGE_SIZE);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  // Đã nạp xong danh sách NCC (kể cả lỗi) — form tự mở từ yêu cầu phải chờ cái này, không thì
  // bước "gán sẵn NCC bán đúng dạng + khổ" chạy trên danh sách rỗng và mọi dòng ra "Chưa chọn".
  const [nccDaNap, setNccDaNap] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Lỗi TẢI DANH SÁCH — tách hẳn khỏi `error` (lỗi THAO TÁC).
   *
   *  Vì sao phải hai ô nhớ riêng: `error` bị hàng chục handler thao tác ghi vào (huỷ phiếu, ghi
   *  đợt giao, gán hoá đơn, thậm chí trình duyệt chặn cửa sổ in). Nếu ô rỗng của bảng đọc chung
   *  `error` thì chỉ cần bấm "In phiếu" mà bị chặn pop-up là CẢ BẢNG biến mất, thay bằng "Không
   *  đọc được dữ liệu" — dữ liệu còn nguyên trên máy chủ, chỉ là bảng tự xoá mình vì một lỗi in.
   *  Ô này CHỈ được ghi trong `catch` của hàm tải danh sách. */
  const [listError, setListError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [mode, setMode] = useState<null | "create" | "edit">(null);
  const [editing, setEditing] = useState<PurchaseRequestRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyRequest());
  const [formError, setFormError] = useState<string | null>(null);
  // Gom dòng theo NCC để nói trước "sẽ tạo mấy phiếu". Giữ THỨ TỰ NCC xuất hiện lần đầu — khớp
  // đúng cách backend nhóm, để bảng xem trước không nói một đằng, phiếu ra một nẻo.
  const phieuSeTao = useMemo(() => {
    const theoNcc = new Map<number, { ten: string; soDong: number; tien: number }>();
    for (const line of form.lines) {
      if (!line.supplier_id || !dongDuocChon(line)) continue;
      const cu = theoNcc.get(line.supplier_id) ?? {
        ten:
          suppliers.find((s) => s.id === line.supplier_id)?.name ??
          `NCC #${line.supplier_id}`,
        soDong: 0,
        tien: 0,
      };
      cu.soDong += 1;
      cu.tien += lineTotal(line);
      theoNcc.set(line.supplier_id, cu);
    }
    return [...theoNcc.values()];
  }, [form.lines, suppliers]);
  const minPurchaseDate = useMemo(() => todayInputValue(), []);
  // Ngày dự kiến nhận chỉ bị chặn bởi HÔM NAY, KHÔNG bởi ngày cần hàng (chủ 03/08/2026):
  // nhận hàng sớm hơn ngày cần là trường hợp mong muốn, chặn nó là cấm đúng cái tốt.
  const expectedReceiptMinDate = minPurchaseDate;
  const [deleting, setDeleting] = useState<PurchaseRequestRow | null>(null);
  // Dùng CHUNG một hộp "nhập lý do" cho cả huỷ / từ chối / lùi đã nhận — không dựng hộp thứ ba.
  const [reasonModal, setReasonModal] = useState<null | {
    // Chỉ còn "cancel" — HUỶ PHIẾU. Nhánh "undo_received" (nút "Mở lại đơn") đã gỡ 12/08/2026
    // theo chủ chốt; "reject" chuyển sang màn Đơn mua hàng (Kế toán) từ 11/08.
    kind: "cancel";
    row: PurchaseRequestRow;
    reason: string;
    error: string | null;
  }>(null);
  // Hộp khai SỐ THỰC NHẬN: mở khi bấm "Đã nhận" (mode `receive`) hoặc khi sửa lại sau (`edit`).
  const [receiveModal, setReceiveModal] = useState<null | {
    row: PurchaseRequestRow;
    mode: "receive" | "edit";
  }>(null);
  // --- Đợt giao: bốn hộp thoại, mỗi hộp một việc ---
  // `delivery: null` = ghi đợt MỚI, khác null = sửa đợt đó.
  const [deliveryModal, setDeliveryModal] = useState<null | {
    row: PurchaseRequestRow;
    delivery: PurchaseDeliveryRow | null;
  }>(null);
  const [invoiceModal, setInvoiceModal] = useState<PurchaseRequestRow | null>(
    null,
  );
  const [deletingDelivery, setDeletingDelivery] = useState<null | {
    row: PurchaseRequestRow;
    delivery: PurchaseDeliveryRow;
  }>(null);
  // "Đóng đơn (không giao nữa)" — cắt phần hàng chưa về ra khỏi công nợ nên BẮT lý do.
  const [closeModal, setCloseModal] = useState<null | {
    row: PurchaseRequestRow;
    reason: string;
    error: string | null;
  }>(null);

  const loadSuppliers = useCallback(() => {
    if (!token) return;
    api.suppliers
      .list(token, { status: "active", sort: "name", page: 1, size: 200 })
      .then((res) => setSuppliers(res.items))
      .catch(() => setSuppliers([]))
      .finally(() => setNccDaNap(true));
  }, [token]);

  /** Đếm yêu cầu ĐANG CHỜ MUA + ngày cần sớm nhất của nhóm đó.
   *
   * Phải hỏi riêng chứ không suy từ `sourceRows`: bảng đang lọc "Tất cả" và chỉ giữ 1 trang, nên
   * đếm tại chỗ sẽ ra số của trang hiện tại. `size: 1` + `sort: needed_date` là đủ: `total` cho số
   * lượng, dòng đầu cho ngày sớm nhất — không kéo cả danh sách về chỉ để lấy hai con số. */
  const loadChoMua = useCallback(() => {
    if (!token) return;
    api.departmentPurchaseRequests
      .list(token, { status: "open", sort: "needed_date", page: 1, size: 1 })
      .then((res) =>
        setChoMua({
          soLuong: res.total,
          somNhat: res.items[0]?.needed_date ?? null,
        }),
      )
      .catch(() => setChoMua({ soLuong: 0, somNhat: null }));
  }, [token]);

  const loadSources = useCallback(() => {
    if (!token) return;
    // Bám theo mọi lần nạp lại danh sách yêu cầu (mọi thao tác chạm YCMH đều gọi `loadSources`)
    // ⇒ số trên tab và dải nhắc không bao giờ đứng hình sau khi lập phiếu / huỷ / đóng đơn.
    loadChoMua();
    setSourceLoading(true);
    setSourceError(null);
    api.departmentPurchaseRequests
      .list(
        token,
        {
          q: sourceQDebounced.trim() || undefined,
          status: sourceStatus === "all" ? null : sourceStatus,
          sort: "-created_at",
          page: sourcePage,
          size: sourceSize,
        },
        JSON.parse(khoaLocYeuCau),
      )
      .then((res) => {
        setSourceRows(res.items);
        setSourceTotal(res.total);
        setDemYeuCau(res.dem_theo_tab ?? null);
      })
      .catch(() => {
        setSourceRows([]);
        setSourceTotal(0);
        setDemYeuCau(null);
        setSourceError("Không tải được danh sách yêu cầu mua hàng.");
      })
      .finally(() => setSourceLoading(false));
  }, [token, loadChoMua, sourceQDebounced, sourceStatus, sourcePage, sourceSize, khoaLocYeuCau]);

  // Lượt gọi mới nhất — response về muộn của lượt cũ (vd lượt chưa có mã khi nhảy từ màn khác
  // sang kèm mã đơn) không được đè lên kết quả đã lọc.
  const luotNap = useRef(0);
  const load = useCallback(() => {
    if (!token) return;
    const luot = ++luotNap.current;
    setLoading(true);
    setError(null);
    setListError(null);
    api.purchaseRequests
      .list(
        token,
        {
          q: qDebounced.trim() || undefined,
          status: status === "all" ? null : status,
          tien: tien || null,
          sort: "-created_at",
          page,
          size,
        },
        JSON.parse(khoaLocDon),
      )
      .then((res) => {
        if (luot !== luotNap.current) return;
        setRows(res.items);
        setTotal(res.total);
        setDemDon(res.dem_theo_tab ?? null);
        setDemTien(res.dem_theo_tien ?? null);
        setSelectedId((current) =>
          current != null && res.items.some((row) => row.id === current)
            ? current
            : null,
        );
        onDataRefreshed?.();
      })
      .catch((err) => {
        if (luot !== luotNap.current) return;
        if (err instanceof ApiError && err.isForbidden) setForbidden(true);
        else setListError("Không tải được danh sách đơn mua hàng.");
      })
      .finally(() => {
        if (luot === luotNap.current) setLoading(false);
      });
  }, [
    token,
    qDebounced,
    status,
    tien,
    khoaLocDon,
    page,
    size,
    onDataRefreshed,
  ]);

  useEffect(() => {
    loadSuppliers();
  }, [loadSuppliers]);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  useEffect(() => {
    load();
  }, [load]);

  useKhiTickDoi(eventTick, () => {
    loadSuppliers();
    loadSources();
    load();
  });

  // ⚠️ ĐƯỜNG PHÒNG THỦ — HIỆN CHƯA CÓ AI GỌI, ĐỪNG GỠ.
  //
  // Tình trạng thật (kiểm 08/08/2026): KHÔNG màn nào đang `navigate("mua-hang", …)` kèm mã. Các
  // màn Kế toán / Công nợ bấm mã thì nhảy sang `ke-toan-don-mua-hang` hoặc `yeu-cau-mua-hang`,
  // không vào đây. Nên đoạn dưới CHƯA chạy lần nào.
  //
  // Vì sao vẫn giữ: từ 08/08/2026 màn này mở mặc định ở tab "Yêu cầu chờ xử lý". Ngày nào có
  // người nối một đường nhảy vào đây kèm mã phiếu mà thiếu đoạn này, người dùng sẽ rơi vào tab
  // yêu cầu và KHÔNG THẤY GÌ — trông y hệt như phiếu đã bị xoá. Mã yêu cầu là `YCMH-…`, mã phiếu
  // mua là `PMH-…` (xem `purchase_service.py`), nên phân nhánh theo tiền tố.
  useEffect(() => {
    const code = (focusRequestCode ?? "").trim();
    if (!code) return;
    // Bỏ kỳ + điều kiện đang nhớ của danh sách đó: phiếu cần soi có thể nằm ngoài kỳ đang lọc.
    if (code.toUpperCase().startsWith("YCMH")) {
      setSourceQ(code);
      setSourceStatus("all");
      setTinhTrangMon("all");
      setLocManGoc({ ...locMan, yc: LOC_MAN_YC_TRONG });
      setSourcePage(1);
      setTab("yeu-cau");
    } else {
      setQ(code);
      setStatus("all");
      setLocManGoc({ ...locMan, dmh: LOC_MAN_DMH_TRONG });
      setPage(1);
      setTab("phieu");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequestCode]);

  // "Lập đơn mua cho N món" ở chi tiết yêu cầu: danh sách yêu cầu đã lọc theo mã (effect trên),
  // nạp xong là mở form một lần. Ref giữ mã đã mở để nạp lại danh sách không bật form lần nữa.
  const daMoLapDon = useRef<string | null>(null);
  /** Yêu cầu nguồn của form lập đơn đang mở — thẻ "Từ YCMH-…" cạnh tiêu đề + "Yêu cầu cần …". */
  const [nguonLapDon, setNguonLapDon] = useState<{ code: string; bo_phan: string | null; needed_date: string }[]>([]);
  useEffect(() => {
    const code = (focusRequestCode ?? "").trim();
    if (!lapDonTuYeuCau || !code || !nccDaNap || daMoLapDon.current === code) return;
    const src = sourceRows.find((r) => r.code === code);
    if (!src) return;
    daMoLapDon.current = code;
    void openCreatePurchaseRequest(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lapDonTuYeuCau, focusRequestCode, sourceRows, nccDaNap]);

  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

  // Drawer chi tiết đơn: Esc để đóng (trước đây do DetailModal lo, nay drawer tự nghe).
  useEffect(() => {
    if (selectedId == null) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedId(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedId]);

  // Đổi cỡ trang thì trang đang đứng có thể không còn tồn tại — về trang 1.
  const doiCoTrang = (n: number) => {
    setSize(n);
    setPage(1);
  };
  const doiCoTrangYeuCau = (n: number) => {
    setSourceSize(n);
    setSourcePage(1);
    setMonPage(1);
  };
  /** Nạp lại CẢ hai cách xem yêu cầu sau một thao tác (lập đơn, huỷ, đóng đơn…). */
  function napLaiYeuCau() {
    loadSources();
    setMonTick((t) => t + 1);
  }
  // CÓ YÊU CẦU QUÁ HẠN chưa? — điều kiện DUY NHẤT bật tone đỏ ở tab và bật dải nhắc ở tab phiếu.
  // Ngày thường (còn hạn) thì không tô đỏ, không render dải nhắc: không tốn một pixel nào.
  // `minPurchaseDate` chính là HÔM NAY dạng yyyy-mm-dd (memo 1 lần) — dùng lại để khỏi có hai
  // cách tính "hôm nay" trong cùng một file.
  const coYcQuaHan =
    choMua.somNhat !== null && choMua.somNhat < minPurchaseDate;
  // Chỉ thay dòng trong danh sách, KHÔNG đụng selectedId: các nút thao tác nằm ở
  // bảng, chọn dòng ở đây sẽ tự bung popup chi tiết. Popup đang mở thì `selected`
  // tự lấy lại dòng mới từ `rows`.
  function updateRow(next: PurchaseRequestRow) {
    setRows((current) =>
      current.map((row) => (row.id === next.id ? next : row)),
    );
  }

  /** Món đã tick (của MỘT hay NHIỀU yêu cầu, 08/10/2026) ⇒ hỏi lại các yêu cầu mới nhất cùng lúc rồi
   *  mở MỘT form chỉ tick sẵn đúng các món đó. Món chờ lập đơn khác của các yêu cầu này vẫn nằm trong
   *  form, bỏ tick. Form tự chia đơn theo nhà cung cấp lúc lưu. */
  async function lapDonTuMon(theoYeuCau: Map<number, number[]>) {
    if (!token || theoYeuCau.size === 0) return;
    try {
      const srcs = await Promise.all([...theoYeuCau.keys()].map((id) => api.departmentPurchaseRequests.get(token, id)));
      await openCreatePurchaseRequest(srcs, new Set([...theoYeuCau.values()].flat()));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không mở được yêu cầu để lập đơn.");
    }
  }

  async function openCreatePurchaseRequest(
    picked: DepartmentPurchaseRequestRow | DepartmentPurchaseRequestRow[],
    chiDong?: Set<number>,
  ) {
    const tat = Array.isArray(picked) ? picked : [picked];
    const sources = tat.filter((s) => s.status === "open");
    if (sources.length === 0) {
      setError("Chỉ lập đơn mua hàng từ yêu cầu đang chờ Thu mua xử lý.");
      return;
    }
    setNguonLapDon(sources.map((s) => ({
      code: s.code,
      bo_phan: s.requesting_department_name,
      needed_date: s.needed_date,
    })));
    // Chỉ món CÒN CHỜ LẬP ĐƠN: chưa huỷ, chưa nằm trong đơn còn sống (đơn bị trả vẫn giữ món — sửa
    // đơn đó). Thu mua bỏ tick món không mua ở đơn này; món đó vẫn chờ ở yêu cầu.
    const lines = sources.flatMap((source) => source.lines
      .filter((line) => !line.cancelled_at && (!line.fulfilment || line.fulfilment.purchase_status === "cancelled"))
      .map((line) => ({
        chon: !chiDong || chiDong.has(line.id),
        hang_loai: line.hang_loai,
        hang_id: line.hang_id,
        // Khổ MUA mặc định = khổ CẦN; thu mua sửa được (vd mua 80×109 thay 79×109 rồi tề).
        kho_rong: line.kho_rong,
        kho_dai: line.kho_dai,
        item_name: line.item_name,
        unit: line.unit,
        quantity: line.quantity,
        expected_unit_price: line.expected_unit_price,
        discount_percent: 0,
        vat_percent: 0,
        note: line.note ?? `Từ ${source.code}`,
        // Nối DÒNG ↔ DÒNG. Form dựng từ chính các dòng của yêu cầu nên id có sẵn ngay đây; không
        // gửi lên thì chi tiết yêu cầu không hiện được tình trạng từng sản phẩm, mà ghép bù theo
        // tên hàng thì trượt (thu mua sửa được tên cho khớp danh mục NCC).
        department_request_line_id: line.id,
        // Chỉ để HIỆN (không gửi): món này của yêu cầu nào, mua cho lệnh nào / tồn kho.
        yeu_cau_ma: source.code,
        loai_mua: source.loai_mua,
        mua_cho: line.mua_cho,
      })));
    // Máy gán sẵn NCC RẺ NHẤT cho TỪNG DÒNG (không phải một NCC cho cả phiếu): phần lớn dòng chỉ
    // có một nơi bán nên tự khớp, người thu mua chỉ phải xử lý mấy chỗ có nhiều lựa chọn.
    // Dòng nào chưa ai bán thì để trống — ô chọn sẽ nói rõ, không im lặng.
    //
    // Giấy (10/10/2026): chỉ gán NCC bán CÙNG khổ + CÙNG HỌ đơn vị với dòng, giá QUY về ĐVT dòng;
    // vật tư khác khai nhiều đơn vị cũng theo nhóm đơn vị (không có khổ). Trước đây lấy `unit_price`
    // thô của dòng giá đầu tiên — NCC báo đ/kg mà dòng tính tờ là đơn giá sai cả trăm lần. Cần danh
    // sách đơn vị của mã để biết họ ⇒ nạp trước (gộp một request). Khoá `loai:id` — giấy và vật tư
    // đánh số độc lập.
    const dsDonVi = new Map<string, DonViDungDuoc[]>();
    const maHang = [...new Set(lines
      .filter((l) => coDonViGoc(l.hang_loai) && l.hang_id)
      .map((l) => `${l.hang_loai}:${l.hang_id}`))];
    if (token && maHang.length) {
      await Promise.all(maHang.map((k) => {
        const [hl, id] = k.split(":");
        return api.matHang.donVi(token, hl as HangLoai, Number(id))
          .then((r) => { dsDonVi.set(k, r.ds); })
          // Không nạp được: dòng khác ĐVT coi là khác họ ⇒ không tự gán, người lập tự chọn.
          .catch(() => undefined);
      }));
    }
    const daGan: FormLine[] = lines.map((line) => {
      const ds = coDonViGoc(line.hang_loai) && line.hang_id ? dsDonVi.get(`${line.hang_loai}:${line.hang_id}`) : undefined;
      // Rẻ nhất trong nhóm cùng họ đã có giá quy được; không quy được thì không gán đại.
      const re = chaoGiaChoMatHang(line, suppliers, ds).find((c) => c.cung_ho && c.gia_dong != null);
      if (!re) return { ...line, supplier_id: null };
      return {
        ...line,
        supplier_id: re.supplier_id,
        unit: line.unit || re.unit,
        expected_unit_price: re.gia_dong ?? 0,
        vat_percent: re.vat_percent,
      };
    });
    // Ngày cần = sớm nhất trong các yêu cầu (đơn gom phải về kịp yêu cầu gấp nhất), nhưng không
    // sớm hơn hôm nay — yêu cầu đã quá hạn thì ô ngày bị chặn ngay khi lưu.
    const somNhat = sources.map((s) => s.needed_date).filter(Boolean).sort()[0] ?? "";
    const canSomNhat = somNhat && somNhat < minPurchaseDate ? minPurchaseDate : somNhat;
    // Câu tự điền khi gom nhiều yêu cầu: nói mua cho bộ phận nào, KHÔNG ghi số yêu cầu — form có
    // thể tách ra nhiều đơn theo NCC, mỗi đơn gom số yêu cầu khác nhau.
    const boPhan = [...new Set(sources.map((s) => s.requesting_department_name).filter(Boolean))] as string[];
    // Tên bộ phận đã mang sẵn "Tổ", "Nhóm", "Ban"… nên không chêm chữ "bộ phận" trước tên.
    const noiDungGom = boPhan.length === 0
      ? "Mua vật tư theo yêu cầu của các bộ phận."
      : boPhan.length === 1
        ? `Mua vật tư theo yêu cầu của ${boPhan[0]}.`
        : `Mua vật tư theo yêu cầu của ${boPhan.slice(0, -1).join(", ")} và ${boPhan[boPhan.length - 1]}.`;
    setEditing(null);
    setForm({
      supplier_id: null,
      // Gửi CẢ tập; máy chủ gắn mỗi đơn đúng các yêu cầu có món nằm trong đơn đó.
      source_request_ids: sources.map((s) => s.id),
      content: sources.length === 1
        ? (sources[0].content ?? sources[0].purpose ?? "")
        : noiDungGom,
      needed_date: canSomNhat,
      expected_receipt_date: "",
      note: null,
      lines: daGan.length ? daGan : [emptyLine()],
    });
    setFormError(null);
    setMode("create");
  }

  function openEdit(row: PurchaseRequestRow) {
    setEditing(row);
    setForm(fromRequest(row));
    setFormError(null);
    setMode("edit");
  }

  function cleanRequest(input: FormState): FormState {
    const trimOptional = (v?: string | null) => {
      const s = (v ?? "").trim();
      return s || null;
    };
    return {
      supplier_id: input.supplier_id ?? null,
      source_request_ids: input.source_request_ids
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0),
      content: (input.content ?? "").trim(),
      needed_date: (input.needed_date ?? "").trim(),
      expected_receipt_date: trimOptional(input.expected_receipt_date),
      note: null,
      lines: input.lines.map((line) => ({
        item_name: (line.item_name ?? "").trim(),
        unit: (line.unit ?? "").trim(),
        quantity: Number(line.quantity),
        expected_unit_price: Math.round(Number(line.expected_unit_price) || 0),
        discount_percent: Number(line.discount_percent) || 0,
        vat_percent: Number(line.vat_percent) || 0,
        note: trimOptional(line.note),
        supplier_id: line.supplier_id ?? null,
        department_request_line_id: line.department_request_line_id ?? null,
        hang_loai: line.hang_loai ?? null,
        hang_id: line.hang_id ?? null,
        kho_rong: line.kho_rong ?? null,
        kho_dai: line.kho_dai ?? null,
        chon: dongDuocChon(line),
      })),
    };
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!token || saving) return;
    const payload = cleanRequest(form);
    // Chỉ dòng được tick mới vào đơn (lúc sửa, mọi dòng đều tick).
    payload.lines = payload.lines.filter(dongDuocChon);
    if (payload.lines.length === 0) {
      setFormError("Chọn ít nhất một dòng.");
      return;
    }
    // Chế độ TẠO: NCC gán ở từng DÒNG (kiểm ở dưới), không có ô NCC ở đầu phiếu.
    // Chế độ SỬA: phiếu đã thuộc về một NCC, giữ nguyên ô đầu phiếu.
    const missingHeader = [
      mode === "edit" && !payload.supplier_id ? "Nhà cung cấp" : "",
      !payload.needed_date ? "Ngày cần hàng" : "",
      !payload.content ? "Nội dung / mục đích" : "",
    ].filter(Boolean);
    if (missingHeader.length > 0) {
      setFormError(`Vui lòng nhập đầy đủ: ${missingHeader.join(", ")}.`);
      return;
    }
    if (payload.needed_date && payload.needed_date < minPurchaseDate) {
      setFormError("Ngày cần hàng không được nhỏ hơn hôm nay.");
      return;
    }
    if (
      payload.expected_receipt_date &&
      payload.expected_receipt_date < minPurchaseDate
    ) {
      setFormError("Ngày dự kiến nhận hàng không được nhỏ hơn hôm nay.");
      return;
    }
    if (payload.source_request_ids.length === 0) {
      setFormError("Đơn mua hàng phải lập từ ít nhất một yêu cầu mua hàng.");
      return;
    }
    if (
      !payload.lines.length ||
      payload.lines.some((line) => !line.item_name || !line.unit)
    ) {
      setFormError(
        "Mỗi phiếu cần ít nhất một dòng hàng; tên vật tư và đơn vị tính không được trống.",
      );
      return;
    }
    if (
      payload.lines.some(
        (line) => line.quantity <= 0 || line.expected_unit_price <= 0,
      )
    ) {
      setFormError("Số lượng và đơn giá dự kiến phải lớn hơn 0.");
      return;
    }
    if (
      payload.lines.some(
        (line) =>
          line.discount_percent < 0 ||
          line.discount_percent > 100 ||
          line.vat_percent < 0 ||
          line.vat_percent > 100,
      )
    ) {
      setFormError(
        "Giảm giá (%) và Thuế GTGT (%) phải trong khoảng 0 đến 100.",
      );
      return;
    }
    // Mỗi dòng phải biết mua của ai — không thì backend không nhóm được thành phiếu.
    if (mode !== "edit") {
      const chuaGan = payload.lines.filter((line) => !line.supplier_id);
      if (chuaGan.length > 0) {
        setFormError(
          `Chưa chọn nhà cung cấp cho: ${chuaGan
            .map((line) => line.item_name || "(dòng trống)")
            .join(", ")}.`,
        );
        return;
      }
    }
    setSaving(true);
    setFormError(null);
    try {
      if (mode === "edit" && editing) {
        const saved = await api.purchaseRequests.update(token, editing.id, {
          ...payload,
          lines: payload.lines.map(({ supplier_id: _bo, chon: _chon, ...line }) => line),
        });
        updateRow(saved);
      } else {
        // Tách phiếu theo NCC trong MỘT lời gọi — gọi `create` nhiều lần sẽ bị chặn từ lần thứ
        // hai vì phiếu đầu đã giữ chỗ yêu cầu nguồn.
        const { items } = await api.purchaseRequests.createBatch(token, {
          source_request_ids: payload.source_request_ids,
          content: payload.content,
          needed_date: payload.needed_date,
          // KHÔNG gửi `expected_receipt_date`: lô này đẻ ra N đơn theo NCC và server đóng cùng
          // một ngày lên tất cả. Ngày giao khai riêng cho từng đơn ở màn Sửa (28/08/2026).
          note: payload.note,
          lines: payload.lines.map((line) => ({
            item_name: line.item_name,
            unit: line.unit,
            quantity: line.quantity,
            expected_unit_price: line.expected_unit_price,
            discount_percent: line.discount_percent,
            vat_percent: line.vat_percent,
            note: line.note,
            supplier_id: line.supplier_id as number,
            department_request_line_id: line.department_request_line_id,
            // Mặt hàng gốc: máy chủ kiểm "NCC có bán không" theo mã này. Thiếu nó thì chỉ còn so
            // TÊN — danh mục đổi tên mà bảng giá NCC giữ tên cũ là báo "không bán" oan (14/10/2026).
            hang_loai: line.hang_loai ?? null,
            hang_id: line.hang_id ?? null,
            // Khổ MUA chỉ gửi cho giấy; hàng khác để server ép 0.
            ...(line.hang_loai === "giay"
              ? { kho_rong: line.kho_rong ?? 0, kho_dai: line.kho_dai ?? 0 }
              : {}),
          })),
        });
        setRows((current) => [...items, ...current]);
        setTotal((t) => t + items.length);
        // ⚠️ BẪY THỨ HAI — ĐỪNG GỠ. Nút "Tạo phiếu" nằm ở tab YÊU CẦU; lưu xong mà đứng nguyên
        // tại đó thì người dùng không thấy phiếu vừa lập (nó nằm ở tab kia), tưởng bấm hụt và bấm
        // lại — lần hai bị server chặn vì yêu cầu nguồn đã bị giữ chỗ. Kể cả đường tách nhiều
        // phiếu theo NCC cũng đi qua đây, nên một chỗ này là đủ cho cả hai.
        setTab("phieu");
      }
      setMode(null);
      loadSuppliers();
      napLaiYeuCau();
    } catch (err) {
      if (err instanceof ApiError) setFormError(err.message);
      else setFormError("Không lưu được đơn mua hàng.");
    } finally {
      setSaving(false);
    }
  }

  async function runAction(
    row: PurchaseRequestRow,
    key: string,
    fn: () => Promise<PurchaseRequestRow>,
  ) {
    if (!token) return;
    setActionBusy(`${key}:${row.id}`);
    setError(null);
    try {
      updateRow(await fn());
      napLaiYeuCau();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Không thực hiện được thao tác.");
    } finally {
      setActionBusy(null);
    }
  }

  async function confirmDelete() {
    if (!token || !deleting) return;
    setActionBusy(`delete:${deleting.id}`);
    try {
      await api.purchaseRequests.remove(token, deleting.id);
      setRows((current) => current.filter((row) => row.id !== deleting.id));
      setTotal((t) => Math.max(0, t - 1));
      setSelectedId(null);
      setDeleting(null);
      napLaiYeuCau();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Không xóa được phiếu.");
      setDeleting(null);
    } finally {
      setActionBusy(null);
    }
  }

  async function confirmReason() {
    if (!token || !reasonModal) return;
    const { row, kind, reason } = reasonModal;
    // Huỷ phiếu là DỪNG HẲN một đề nghị chi tiền ⇒ bắt buộc ghi lý do để nhật ký còn truy được.
    if (!reason.trim()) {
      setReasonModal({ ...reasonModal, error: "Vui lòng nhập lý do huỷ phiếu." });
      return;
    }
    setActionBusy(`${kind}:${row.id}`);
    setReasonModal({ ...reasonModal, error: null });
    try {
      // HUỶ PHIẾU (12/08/2026). Đường này đã có ở máy chủ từ lâu — 5 test giữ hành vi thật —
      // nhưng CHƯA TỪNG có nút, nên chủ chốt test thấy "chả có gì". Nay nối nút vào.
      const next = await api.purchaseRequests.cancel(token, row.id, reason.trim());
      updateRow(next);
      setReasonModal(null);
      napLaiYeuCau();
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Không thực hiện được thao tác.";
      setReasonModal((current) =>
        current ? { ...current, error: message } : current,
      );
    } finally {
      setActionBusy(null);
    }
  }

  async function confirmXoaDot() {
    if (!token || !deletingDelivery) return;
    const { row, delivery } = deletingDelivery;
    setActionBusy(`del-dot:${delivery.id}`);
    setError(null);
    try {
      updateRow(
        await api.purchaseRequests.deleteDelivery(token, row.id, delivery.id),
      );
      setDeletingDelivery(null);
      napLaiYeuCau();
    } catch (err) {
      // Ca hay gặp: đợt đã có phiếu chi gắn vào ⇒ server chặn. Câu báo của server nói rõ phiếu
      // nào, nên đừng nuốt nó bằng câu chung chung.
      setError(err instanceof ApiError ? err.message : "Không xóa được đợt giao.");
      setDeletingDelivery(null);
    } finally {
      setActionBusy(null);
    }
  }

  async function confirmDongDon() {
    if (!token || !closeModal) return;
    const { row, reason } = closeModal;
    if (!reason.trim()) {
      setCloseModal({ ...closeModal, error: "Vui lòng nhập lý do đóng đơn." });
      return;
    }
    setActionBusy(`close:${row.id}`);
    setCloseModal({ ...closeModal, error: null });
    try {
      updateRow(await api.purchaseRequests.close(token, row.id, reason.trim()));
      setCloseModal(null);
      napLaiYeuCau();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Không đóng được đơn.";
      setCloseModal((current) =>
        current ? { ...current, error: message } : current,
      );
    } finally {
      setActionBusy(null);
    }
  }

  function setLine(index: number, patch: Partial<FormLine>) {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line, i) =>
        i === index ? { ...line, ...patch } : line,
      ),
    }));
  }

  if (forbidden) {
    return (
      <main className="md-page">
        <div className="banner banner--error" role="alert">
          Bạn không có quyền truy cập Mua hàng (403).
        </div>
      </main>
    );
  }

  // Banner lỗi dùng CHUNG cho cả hai tab, vì `error` là MỘT state và cả hai tab đều ghi vào nó:
  // tab yêu cầu ghi khi lập phiếu từ một yêu cầu không còn chờ xử lý, tab phiếu ghi khi thao tác
  // trên phiếu / in phiếu hỏng. Nếu chỉ treo banner ở một tab thì lời báo lỗi của tab kia biến mất
  // trong im lặng — người dùng bấm mà không hiểu vì sao không có gì xảy ra.
  const bannerLoi = error ? (
    <div className="banner banner--error" role="alert">
      {error}
    </div>
  ) : null;

  return (
    <main className="md-page acct-std pmh mh-trang lds">
      {/* Đầu màn theo khuôn danh sách Kinh doanh (`lds-dau`): tên màn + hai tab dạng nút đoạn. Tab
          không mang số đếm (luật chung) — số nằm ở dải lọc nhanh bên dưới; còn yêu cầu đã quá ngày
          cần hàng thì một chấm đỏ trên tab Yêu cầu chờ xử lý. */}
      <header className="lds-dau">
        <h1 className="lds-dau__ten">Mua hàng</h1>
        <div className="mh-tab" role="tablist" aria-label="Mua hàng">
          {(
            [
              { key: "yeu-cau", label: "Yêu cầu chờ xử lý", cham: coYcQuaHan },
              { key: "phieu", label: "Đơn mua hàng", cham: false },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {t.cham && <span className="mh-tab__cham" aria-label="Có yêu cầu đã quá ngày cần hàng" />}
            </button>
          ))}
        </div>
      </header>

      {/* Chỉ dựng nội dung của tab ĐANG MỞ (bảng kia không nằm dưới mép màn nữa, nó không tồn tại).
          Nhưng DỮ LIỆU vẫn tải cả hai ngay từ đầu — số đếm trên tab kia phải đúng ngay. */}
      {tab === "yeu-cau" && (
        <YeuCauInboxTab
          bannerLoi={bannerLoi}
          sourceQ={sourceQ}
          setSourceQ={setSourceQ}
          sourceQDebounced={sourceQDebounced}
          tinhTrang={tinhTrangMon}
          setTinhTrang={setTinhTrangMon}
          khoaLoc={khoaLocYeuCau}
          monTick={monTick + eventTick}
          monPage={monPage}
          setMonPage={setMonPage}
          lapDonTuMon={lapDonTuMon}
          openYcmh={openYcmh}
          onMoLenh={moLenh}
          sourceStatus={sourceStatus}
          setSourceStatus={setSourceStatus}
          demTheoTab={demYeuCau}
          ky={locMan.yc.ky}
          onKy={(ky) => setLocYeuCau({ ...locMan.yc, ky })}
          dieuKien={dieuKienYeuCau}
          loc={locMan.yc.loc}
          onLoc={(loc) => setLocYeuCau({ ...locMan.yc, loc })}
          xoaLocThem={() => setLocYeuCau(LOC_MAN_YC_TRONG)}
          coLocThem={khoaLocYeuCau !== "{}"}
          sourcePage={sourcePage}
          setSourcePage={setSourcePage}
          sourceLoading={sourceLoading}
          sourceError={sourceError}
          sourceRows={sourceRows}
          sourceTotal={sourceTotal}
          sourceSize={sourceSize}
          onSourceSize={doiCoTrangYeuCau}
          loadSources={loadSources}
          canCreate={canCreate}
          openCreatePurchaseRequest={openCreatePurchaseRequest}
        />
      )}

      {tab === "phieu" && (
        <PhieuListTab
          onMoLenh={moLenh}
          coYcQuaHan={coYcQuaHan}
          choMua={choMua}
          setTab={setTab}
          q={q}
          setQ={setQ}
          page={page}
          setPage={setPage}
          status={status}
          setStatus={setStatus}
          tien={tien}
          setTien={setTien}
          demTheoTab={demDon}
          demTien={demTien}
          ky={locMan.dmh.ky}
          onKy={(ky) => setLocDon({ ...locMan.dmh, ky })}
          dieuKien={dieuKienDon}
          loc={locMan.dmh.loc}
          onLoc={(loc) => setLocDon({ ...locMan.dmh, loc })}
          xoaLocThem={() => setLocDon(LOC_MAN_DMH_TRONG)}
          coLocThem={khoaLocDon !== "{}"}
          loading={loading}
          listError={listError}
          load={load}
          rows={rows}
          selected={selected}
          setSelectedId={setSelectedId}
          openYcmh={openYcmh}
          total={total}
          size={size}
          onSize={doiCoTrang}
        />
      )}

      {/* Hộp thoại nằm NGOÀI hai tab: mở từ tab nào cũng phải sống tiếp khi tab đổi (lập phiếu
          xong là màn tự nhảy sang tab phiếu — kéo hộp vào trong tab thì nó bị gỡ giữa chừng). */}
      {selected && (
        <PurchaseDetailDrawer
          onMoLenh={moLenh}
          onMoNcc={can("nha_cung_cap", "read") ? (id) => navigate("nha-cung-cap", { openSupplierId: id }) : undefined}
          selected={selected}
          setSelectedId={setSelectedId}
          openYcmh={openYcmh}
          canUpdate={canUpdate}
          canApprovePurchase={canApprovePurchase}
          updateRow={updateRow}
          setError={setError}
          actionBusy={actionBusy}
          runAction={runAction}
          openEdit={openEdit}
          nhapKhoTuDot={nhapKhoTuDot}
          xemYeuCauNhap={xemYeuCauNhap}
          setReceiveModal={setReceiveModal}
          setReasonModal={setReasonModal}
          setDeliveryModal={setDeliveryModal}
          setInvoiceModal={setInvoiceModal}
          setDeletingDelivery={setDeletingDelivery}
          setCloseModal={setCloseModal}
        />
      )}

      {mode && (
        <PurchaseFormDrawer
          mode={mode}
          setMode={setMode}
          editing={editing}
          form={form}
          setForm={setForm}
          setLine={setLine}
          save={save}
          saving={saving}
          formError={formError}
          suppliers={suppliers}
          minPurchaseDate={minPurchaseDate}
          expectedReceiptMinDate={expectedReceiptMinDate}
          phieuSeTao={phieuSeTao}
          nguon={mode === "create" ? nguonLapDon : []}
        />
      )}

      <PurchaseModals
        actionBusy={actionBusy}
        updateRow={updateRow}
        loadSources={napLaiYeuCau}
        deleting={deleting}
        setDeleting={setDeleting}
        confirmDelete={confirmDelete}
        reasonModal={reasonModal}
        setReasonModal={setReasonModal}
        confirmReason={confirmReason}
        receiveModal={receiveModal}
        setReceiveModal={setReceiveModal}
        deliveryModal={deliveryModal}
        setDeliveryModal={setDeliveryModal}
        invoiceModal={invoiceModal}
        setInvoiceModal={setInvoiceModal}
        deletingDelivery={deletingDelivery}
        setDeletingDelivery={setDeletingDelivery}
        confirmXoaDot={confirmXoaDot}
        closeModal={closeModal}
        setCloseModal={setCloseModal}
        confirmDongDon={confirmDongDon}
      />
    </main>
  );
}
