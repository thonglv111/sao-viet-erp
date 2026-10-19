// Màn NHÀ CUNG CẤP — shell (tách từ pages/SuppliersPage.tsx).
// Giữ ở đây: state + `load()`/`loadAll()` + handlers (`taiFile` · `nhapExcel` · `openCreate` ·
// `openEdit` · `closeDrawer` · `setSupplierItem` · `ghiQuyDoiDong` · `save` · `toggle`) + KHUNG
// ngăn `NganPhai` kiểu 3 (tên · 3 tab · <form> · cột thuộc tính · chân) và chỗ mount ba tab.
// Lọc (06/10/2026): thanh lọc chung `ThanhLoc` — kỳ theo Ngày tạo + Trạng thái / Nhóm NCC / Số sao /
// Nhận gia công, lọc ở máy chủ, ghi lên URL `?man=nha-cung-cap`. Dải pill nhóm cũ đã gỡ.
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
  type PurchaseRequestRow,
  type SupplierInput,
  type SupplierItemImportError,
  type SupplierItemInput,
  type SupplierRow,
  type SupplierTongQuan,
} from "../../../api/client";
import { useDebounced } from "../../../utils/useDebounced";
import { RayThuocTinh } from "../../ke-toan/shared/LuoiGon";
import { NganPhai, useDongNgan } from "../../ke-toan/shared/NganPhai";
import { useAuth } from "../../../auth/useAuth";
import { useKhiTickDoi } from "../../../hooks/useKhiTickDoi";
import { useCan } from "../../../auth/permissions";
import { Button } from "../../../components/Button";
import { ChipTT, ChonCot, useCauHinhLuoi } from "../../../components/LuoiDs";
import { Star } from "lucide-react";
import { COT_NCC, SuppliersTable } from "./components/SuppliersTable";
import { ttNcc } from "./shared/trang-thai-ncc";
import { SuppliersToolbar, type TrangThaiNcc } from "./components/SuppliersToolbar";
import { SupplierHistoryTab } from "./tabs/SupplierHistoryTab";
import { SupplierInfoTab } from "./tabs/SupplierInfoTab";
import { SupplierItemsTab } from "./tabs/SupplierItemsTab";
import { PAGE_SIZE, REQUIRED_SUPPLIER_FIELDS } from "./shared/constants";
import type { SortNcc } from "./shared/types";
import {
  LOC_NCC_TRONG,
  dieuKienNcc,
  locNccLenUrl,
  locNccTuUrl,
  thamSoLocNcc,
  type LocNcc,
} from "./shared/dieu-kien-ncc";
import { ThanhLoc } from "../../thanh-loc/ThanhLoc";
import { kyLenUrl, kyTuUrl, thamSoKy, type KyDS } from "../../thanh-loc/ky-danh-sach";
import { useLocMan } from "../../thanh-loc/useLocMan";
import {
  cleanSupplier,
  cleanSupplierItems,
  emptySupplier,
  emptySupplierItem,
  fromSupplier,
  gopVatTu,
  soNgayVi,
} from "./shared/helpers";
import "../../master-data.css";
import "../../purchase.css";
import "../trang-thai-mua.css";
import { moTaHanTra } from "../don-mua-chung/hanTra";
// Vỏ `NganPhai` + cột thuộc tính `kt-ray` sống ở ke-toan.css — thiếu dòng này thì vào thẳng màn NCC
// (chưa ghé màn kế toán nào) ngăn hiện trơ không kiểu.
import "../../ke-toan/ke-toan.css";
import "./tabs/ncc-form.css";

const MOC_NCC: [string, string][] = [["tao", "Ngày tạo"]];
type LocManNcc = { ky: KyDS; loc: LocNcc };
const LOC_MAN_NCC_TRONG: LocManNcc = { ky: { loai: "tat_ca", moc: "tao" }, loc: LOC_NCC_TRONG };
const docLocManNcc = (p: URLSearchParams): LocManNcc => ({
  ky: kyTuUrl(p, MOC_NCC.map(([m]) => m), "tao"),
  loc: locNccTuUrl(p),
});
const ghiLocManNcc = (t: LocManNcc) => ({ ...kyLenUrl(t.ky, "tao"), ...locNccLenUrl(t.loc) });

export function SuppliersPage({
  eventTick = 0,
  openSupplierId = null,
}: {
  eventTick?: number;
  /** Liên thông (vd "Hồ sơ nhà cung cấp" ở Công nợ phải trả): vào màn là mở sẵn hồ sơ NCC này. */
  openSupplierId?: number | null;
}) {
  const { token } = useAuth();
  const can = useCan();
  // Khoá RIÊNG của màn Nhà cung cấp (tách 10/08/2026) — không mượn quyền màn Mua hàng nữa.
  const canCreate = can("nha_cung_cap", "create");
  const canUpdate = can("nha_cung_cap", "update");

  const [tongQuan, setTongQuan] = useState<SupplierTongQuan | null>(null);
  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(PAGE_SIZE);
  const [q, setQ] = useState("");
  // Kỳ + điều kiện lọc — ghi lên URL, nhớ theo màn. Lọc và sắp xếp chạy ở SERVER: bảng có phân
  // trang, lọc/xếp tại chỗ thì trang 2 vô nghĩa.
  const [locMan, setLocManGoc] = useLocMan("nha-cung-cap", LOC_MAN_NCC_TRONG, docLocManNcc, ghiLocManNcc);
  const setLocMan = (t: LocManNcc) => {
    setLocManGoc(t);
    setPage(1);
  };
  const khoaLoc = JSON.stringify({ ...thamSoKy(locMan.ky), ...thamSoLocNcc(locMan.loc) });
  const [sort, setSort] = useState<SortNcc>("name");
  // Cột ẩn/hiện và thứ tự cột người xem đã kéo — nhớ theo màn trên trình duyệt này.
  const luoi = useCauHinhLuoi("nha-cung-cap");
  const cotHien = luoi.rongHien(luoi.xep(COT_NCC).filter((c) => !luoi.an.has(c.key)));

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Lỗi TẢI DANH SÁCH — tách hẳn khỏi `error` (lỗi THAO TÁC).
   *
   *  Vì sao phải hai ô nhớ riêng: `error` bị hàng chục handler thao tác ghi vào (huỷ phiếu, ghi
   *  đợt giao, gán hoá đơn, thậm chí trình duyệt chặn cửa sổ in). Nếu ô rỗng của bảng đọc chung
   *  `error` thì chỉ cần bấm "In phiếu" mà bị chặn pop-up là CẢ BẢNG biến mất, thay bằng "Không
   *  đọc được dữ liệu" — dữ liệu còn nguyên trên máy chủ, chỉ là bảng tự xoá mình vì một lỗi in.
   *  Ô này CHỈ được ghi trong `catch` của hàm tải danh sách. */
  const [listError, setListError] = useState<string | null>(null);
  // Ô nhập vẫn bám state gốc (gõ tới đâu hiện tới đó); chỉ lời gọi máy chủ đọc bản đã
  // chậm 300ms — xem `utils/useDebounced`.
  const qDebounced = useDebounced(q);
  const [forbidden, setForbidden] = useState(false);

  // Side Drawer State
  const [mode, setMode] = useState<null | "create" | "edit">(null);
  const [selected, setSelected] = useState<SupplierRow | null>(null);
  const [form, setForm] = useState<SupplierInput>(emptySupplier());
  // Bản lúc mở ngăn — khác bản đang gõ thì đóng ngăn phải hỏi trước (Esc, bấm ra ngoài, nút Huỷ).
  const [formGoc, setFormGoc] = useState<SupplierInput | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"info" | "items" | "history">(
    "info",
  );

  // Tab 2 internal item search filter
  const [itemSearchQ, setItemSearchQ] = useState("");

  // Gợi ý tên vật tư gộp-mọi-NCC (`api.suppliers.itemCatalog`) ĐÃ BỎ: ô Tên vật tư giờ chọn từ
  // DANH MỤC GỐC qua `MaterialCombobox`, nên tên không còn cơ hội trượt ("Couche 150" vs
  // "Couché 150") — thứ mà gợi ý kia sinh ra để chữa.
  // Nhập / xuất Excel bảng giá vật tư.
  //
  // File ĐỌC XONG chỉ nạp vào form, CHƯA vào DB — bảng giá được lưu bằng chính cú "Lưu nhà cung
  // cấp". Nhập thẳng DB thì cú lưu form đó (đang giữ danh sách cũ) sẽ xoá mất phần vừa nhập.
  const fileVatTuRef = useRef<HTMLInputElement | null>(null);
  const [nhapDang, setNhapDang] = useState(false);
  const [nhapKetQua, setNhapKetQua] = useState<
    { them: number; capNhat: number; errors: SupplierItemImportError[] } | null
  >(null);

  async function taiFile(lay: () => Promise<string>, ten: string) {
    if (!token) return;
    try {
      const url = await lay();
      const a = document.createElement("a");
      a.href = url;
      a.download = ten;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Không tải được file Excel.",
      );
    }
  }

  async function nhapExcel(file: File) {
    if (!token) return;
    setNhapDang(true);
    setFormError(null);
    try {
      const res = await api.suppliers.itemsImport(token, file);
      const gop = gopVatTu(
        form.items ?? [],
        res.items.map((r) => ({
          item_name: r.item_name,
          unit: r.unit,
          unit_price: r.unit_price,
          vat_percent: r.vat_percent,
          note: r.note,
        })),
      );
      setForm((current) => ({ ...current, items: gop.items }));
      setNhapKetQua({
        them: gop.them,
        capNhat: gop.capNhat,
        errors: res.errors,
      });
    } catch (err) {
      setNhapKetQua(null);
      setFormError(
        err instanceof ApiError ? err.message : "Không đọc được file Excel.",
      );
    } finally {
      setNhapDang(false);
    }
  }

  // Tab 3 Purchase Orders History State
  const [poList, setPoList] = useState<PurchaseRequestRow[]>([]);
  const [poLoading, setPoLoading] = useState(false);
  const [poError, setPoError] = useState<string | null>(null);
  // Tổng số PMH máy chủ đếm — bảng chỉ lấy 50 phiếu mới nhất, số trên tab phải là số THẬT.
  const [poTotal, setPoTotal] = useState(0);

  // Thanh đếm + dải nhóm: đếm ở MÁY CHỦ cho toàn danh mục (`/api/suppliers/tong-quan`). Trước
  // 27/09/2026 là hai lượt danh sách size=500 kéo cả bảng giá về chỉ để đếm — vượt trần size ≤ 200
  // nên bị 422 và lặng lẽ rơi về đếm trên trang hiện tại.
  const loadAll = useCallback(() => {
    if (!token) return;
    api.suppliers
      .tongQuan(token)
      .then(setTongQuan)
      .catch(() => {
        // non-blocking; thanh đếm fallback về trang hiện tại
      });
  }, [token]);

  // Load paginated list with search and filters
  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    setListError(null);
    api.suppliers
      .list(token, {
        q: qDebounced.trim() || undefined,
        loc: JSON.parse(khoaLoc),
        sort,
        page,
        size,
      })
      .then((res) => {
        setRows(res.items);
        setTotal(res.total);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.isForbidden) setForbidden(true);
        else setListError("Không tải được danh sách nhà cung cấp.");
      })
      .finally(() => setLoading(false));
  }, [token, qDebounced, khoaLoc, sort, page, size]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    load();
  }, [load]);

  useKhiTickDoi(eventTick, () => {
    loadAll();
    load();
  });

  // Dynamic Supplier Group Pills — chỉ lấy từ data thực, KHÔNG hardcode
  const groupPills = useMemo(() => {
    if (tongQuan) {
      return tongQuan.nhom
        .map((n) => ({ group: n.supplier_group, count: n.so_ncc }))
        .sort((a, b) => a.group.localeCompare(b.group, "vi"));
    }
    const fromData = Array.from(
      new Set(rows.map((s) => s.supplier_group).filter(Boolean)),
    ) as string[];
    fromData.sort((a, b) => a.localeCompare(b, "vi"));
    return fromData.map((grp) => ({
      group: grp,
      count: rows.filter((s) => s.supplier_group === grp).length,
    }));
  }, [tongQuan, rows]);

  const dieuKien = useMemo(() => dieuKienNcc(tongQuan), [tongQuan]);

  // Số trên dải lọc nhanh trạng thái — toàn danh mục, đếm ở máy chủ.
  const dem = tongQuan
    ? { tong: tongQuan.tong, dangHopTac: tongQuan.dang_hop_tac, tamNgung: tongQuan.tam_ngung }
    : null;

  // Lịch sử PMH của NCC đang mở — nạp NGAY khi mở drawer, MỘT lần cho mỗi NCC (theo `id`).
  // Trước 27/09/2026 chỉ nạp khi bấm vào tab và nạp lại MỖI lần quay lại tab ⇒ lần nào cũng thấy
  // vòng "đang tải" rồi bảng mới hiện; số trên tab lại là `poList.length` không được xoá ⇒ mở NCC
  // khác vẫn hiện số của NCC trước cho tới khi bấm vào tab.
  const selectedId = selected?.id ?? null;
  useEffect(() => {
    setPoList([]);
    setPoTotal(0);
    setPoError(null);
    if (selectedId == null || !token) {
      setPoLoading(false);
      return;
    }
    let alive = true;
    setPoLoading(true);
    api.purchaseRequests
      .list(token, { supplier_id: selectedId, size: 50 })
      .then((res) => {
        if (!alive) return;
        setPoList(res.items);
        setPoTotal(res.total);
      })
      .catch((err) => {
        if (!alive) return;
        if (err instanceof ApiError) setPoError(err.message);
        else setPoError("Không tải được lịch sử mua hàng của nhà cung cấp này.");
      })
      .finally(() => {
        if (alive) setPoLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selectedId, token]);

  function openCreate() {
    setSelected(null);
    const moi = emptySupplier();
    setForm(moi);
    setFormGoc(moi);
    setFormError(null);
    // Hệ số theo CHỈ SỐ dòng của NCC trước — không xoá là dòng i của NCC mới mượn số của NCC cũ.
    setQuyDoiDong({});
    setActiveTab("info");
    setItemSearchQ("");
    setNhapKetQua(null);
    setPoList([]);
    setMode("create");
  }

  function openEdit(row: SupplierRow, initialTab: "info" | "items" | "history" = "info") {
    setSelected(row);
    const goc = fromSupplier(row);
    setForm(goc);
    setFormGoc(goc);
    setFormError(null);
    // Hệ số theo CHỈ SỐ dòng của NCC trước — không xoá là dòng i của NCC mới mượn số của NCC cũ.
    setQuyDoiDong({});
    setActiveTab(initialTab);
    setItemSearchQ("");
    setNhapKetQua(null);
    setPoList([]);
    setMode("edit");
  }

  // NCC có thể không nằm ở trang đang xem ⇒ đọc riêng theo mã rồi mở hồ sơ.
  useEffect(() => {
    if (!token || openSupplierId == null) return;
    let alive = true;
    api.suppliers
      .get(token, openSupplierId)
      .then((row) => alive && openEdit(row))
      .catch(() => alive && setListError("Không mở được hồ sơ nhà cung cấp này."));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, openSupplierId]);

  function closeDrawer() {
    setMode(null);
    setSelected(null);
    setNhapKetQua(null);
  }

  function setSupplierItem(index: number, patch: Partial<SupplierItemInput>) {
    setForm((current) => ({
      ...current,
      items: (current.items ?? [emptySupplierItem()]).map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    }));
  }

  // Hệ số quy đổi về đơn vị gốc của TỪNG DÒNG bảng giá (server trả theo mặt hàng + đơn vị đã
  // chọn). Chỉ để HIỂN THỊ cột "Quy về gốc" — không lưu, không gửi lên: hệ số là dữ liệu sống,
  // đóng băng nó vào bảng giá NCC là mời sai số vào giữa việc so giá.
  //
  // Gỡ 28/08 khi ĐVT còn bị khoá (cột đó luôn bằng đơn giá), trả lại 29/08 khi mở khoá ĐVT.
  const [quyDoiDong, setQuyDoiDong] = useState<
    Record<number, { donViGocTen: string; heSoVeGoc: number } | null>
  >({});

  function ghiQuyDoiDong(
    index: number,
    info: { donViGocTen: string; heSoVeGoc: number } | null,
  ) {
    setQuyDoiDong((cur) =>
      cur[index]?.donViGocTen === info?.donViGocTen &&
      cur[index]?.heSoVeGoc === info?.heSoVeGoc
        ? cur
        : { ...cur, [index]: info },
    );
  }


  async function save(e: FormEvent) {
    e.preventDefault();
    if (!token || saving) return;
    const payload = cleanSupplier(form);
    const missing = REQUIRED_SUPPLIER_FIELDS.filter(
      ([key]) => !String(payload[key] ?? "").trim(),
    ).map(([, label]) => label);
    if (missing.length > 0) {
      setFormError(`Vui lòng nhập đầy đủ: ${missing.join(", ")}.`);
      setActiveTab("info");
      return;
    }
    // Điện thoại 10 số · email có @ (chủ chốt 15/08/2026). Chặn Ở ĐÂY chỉ để báo SỚM và trỏ đúng
    // ô sai — luật thật nằm ở `_clean_supplier_values` bên máy chủ, gọi thẳng API vẫn bị chặn.
    const soDT = String(payload.phone ?? "").replace(/[\s.\-()]/g, "");
    if (!/^\d{10}$/.test(soDT)) {
      setFormError(
        `Số điện thoại phải đủ 10 chữ số (ví dụ 0901234567) — đang nhập ${soDT.length} số.`,
      );
      setActiveTab("info");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(payload.email ?? "").trim())) {
      setFormError(
        "Email phải có dạng ten@tencongty.vn — thiếu @ hoặc thiếu phần đuôi thì thư gửi đi không tới nơi.",
      );
      setActiveTab("info");
      return;
    }
    if (
      (payload.items ?? []).some(
        (item) => !item.item_name || !item.unit || item.unit_price <= 0,
      )
    ) {
      setFormError(
        "Mỗi mặt hàng nhà cung cấp cần nhập đủ tên, ĐVT và đơn giá lớn hơn 0.",
      );
      setActiveTab("items");
      return;
    }
    if (
      (payload.items ?? []).some(
        (item) => (item.vat_percent ?? 0) < 0 || (item.vat_percent ?? 0) > 100,
      )
    ) {
      setFormError("VAT mặt hàng nhà cung cấp phải từ 0 đến 100.");
      setActiveTab("items");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (mode === "edit" && selected) {
        await api.suppliers.update(token, selected.id, payload);
      } else {
        await api.suppliers.create(token, payload);
      }
      closeDrawer();
      loadAll();
      load();
    } catch (err) {
      if (err instanceof ApiError) setFormError(err.message);
      else setFormError("Không lưu được nhà cung cấp.");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(row: SupplierRow) {
    if (!token || !canUpdate) return;
    try {
      await api.suppliers.toggleActive(token, row.id);
      // Drawer đang mở CÙNG NCC này thì lật trạng thái tại chỗ luôn — badge ở đầu drawer +
      // nhãn nút phải đổi NGAY, không chờ `load()` (nút này nay nằm TRONG bản ghi).
      setSelected((cur) =>
        cur && cur.id === row.id
          ? { ...cur, status: cur.status === "active" ? "inactive" : "active" }
          : cur,
      );
      loadAll();
      load();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Không đổi được trạng thái nhà cung cấp.");
    }
  }

  if (forbidden) {
    return (
      <main className="md-page">
        <div className="banner banner--error" role="alert">
          Bạn không có quyền truy cập Nhà cung cấp (403).
        </div>
      </main>
    );
  }

  // Đổi cỡ trang thì trang đang đứng có thể không còn tồn tại — về trang 1.
  const doiCoTrang = (n: number) => {
    setSize(n);
    setPage(1);
  };

  // Items displayed in Tab 2 with internal search filter
  const itemsInForm = form.items ?? [emptySupplierItem()];
  // Số món ĐÃ KHAI — đếm đúng theo luật lưu (`cleanSupplierItems` bỏ dòng trống). Form luôn mồi sẵn
  // một dòng trống để gõ, đếm thẳng `itemsInForm` thì NCC mới chưa có món nào vẫn hiện badge "1".
  const soMonDaKhai = cleanSupplierItems(itemsInForm).length;
  const filteredFormItems = itemsInForm
    .map((item, originalIndex) => ({ item, originalIndex }))
    .filter(({ item }) => {
      if (!itemSearchQ.trim()) return true;
      const qLower = itemSearchQ.trim().toLowerCase();
      return (
        item.item_name.toLowerCase().includes(qLower) ||
        item.unit.toLowerCase().includes(qLower) ||
        (item.note ?? "").toLowerCase().includes(qLower)
      );
    });

  const coLoc = q.trim() !== "" || khoaLoc !== JSON.stringify({ ...thamSoKy(LOC_MAN_NCC_TRONG.ky), ...thamSoLocNcc(LOC_NCC_TRONG) });

  return (
    <main className="md-page mh-trang lds">
      <SuppliersToolbar
        q={q}
        onQ={(v) => {
          setQ(v);
          setPage(1);
        }}
        trangThai={(locMan.loc.trang_thai ?? "") as TrangThaiNcc}
        onTrangThai={(v) => setLocMan({ ...locMan, loc: { ...locMan.loc, trang_thai: v || undefined } })}
        dem={dem}
        boLoc={
          <ThanhLoc
            ky={locMan.ky}
            moc={MOC_NCC}
            onKy={(ky) => setLocMan({ ...locMan, ky })}
            dieuKien={dieuKien}
            loc={locMan.loc}
            onLoc={(loc) => setLocMan({ ...locMan, loc })}
          />
        }
        chonCot={<ChonCot cot={COT_NCC} {...luoi.chonCot} />}
        canCreate={canCreate}
        openCreate={openCreate}
        banner={
          error && (
            <div className="banner banner--error" role="alert">
              {error}
            </div>
          )
        }
      />

      <SuppliersTable
        loading={loading}
        listError={listError}
        load={load}
        rows={rows}
        openEdit={openEdit}
        chonId={mode === "edit" ? (selected?.id ?? null) : null}
        sort={sort}
        setSort={setSort}
        coLoc={coLoc}
        onXoaLoc={() => {
          setQ("");
          setLocMan(LOC_MAN_NCC_TRONG);
        }}
        total={total}
        page={page}
        setPage={setPage}
        size={size}
        onSize={doiCoTrang}
        cotHien={cotHien}
        luoi={luoi}
      />

      {/* Ngăn kiểu 3 (08/10/2026, khuôn ngăn Phiếu thu): vỏ `NganPhai` chung — tên + nhãn trạng thái +
          nhãn sao ở đầu, tab gạch dưới, thân trái là tab đang mở, cột phải là các số hay nhìn nhất
          (trước là dải số liệu dưới tên). Cột phải đọc từ bản ĐÃ LƯU (`selected`), không chạy theo ô
          đang gõ. NCC tạo mới chưa có gì để tóm ⇒ không có cột phải. */}
      {mode && (
        <NganPhai
          duongDan="Nhà cung cấp"
          tieuDe={<span className="ncc-k3-ten">{mode === "edit" ? selected?.name : "Thêm nhà cung cấp mới"}</span>}
          the={mode === "edit" && selected ? (
            <>
              <ChipTT mau={ttNcc(selected.status).mau}>{ttNcc(selected.status).label}</ChipTT>
              <span
                className={`ncc-a-dau__nhan${selected.rating === null ? "" : " is-co"}`}
                title={
                  selected.rating === null
                    ? "Điểm và tỷ lệ đúng hẹn tự tính sau khi đơn mua đầu tiên hoàn tất."
                    : `Chấm trên ${selected.rating_count} đơn`
                }
              >
                <Star size={13} strokeWidth={1.8} aria-hidden="true" />
                {selected.rating === null
                  ? "Chưa chấm sao"
                  : selected.rating.toLocaleString("vi-VN", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}
              </span>
            </>
          ) : undefined}
          // Tab không mang số đếm (luật chung): số mặt hàng ở cột phải, số đơn ở đầu tab Đơn mua.
          tabs={[
            { id: "info", nhan: "Thông tin chung" },
            { id: "items", nhan: "Bảng giá vật tư" },
            ...(mode === "edit" ? [{ id: "history", nhan: "Đơn mua" }] : []),
          ]}
          tab={activeTab}
          onTab={(id) => setActiveTab(id as "info" | "items" | "history")}
          onDong={closeDrawer}
          chanDong={() => !saving && formGoc != null && JSON.stringify(form) !== JSON.stringify(formGoc)}
          cot={mode === "edit" && selected ? (
            <RayThuocTinh o={[
              { nhan: "Nhóm hàng", giaTri: selected.supplier_group || <span className="kt-mo">Chưa khai</span> },
              { nhan: "Liên hệ", giaTri: selected.contact_name || <span className="kt-mo">Chưa khai</span> },
              { nhan: "Điện thoại", giaTri: selected.phone
                  ? <a className="kt-lk" href={`tel:${selected.phone.replace(/\s+/g, "")}`}>{selected.phone}</a>
                  : <span className="kt-mo">Chưa khai</span> },
              { nhan: "Cho nợ", giaTri: selected.credit_days != null
                  ? moTaHanTra(selected.credit_days, selected.debt_cutoff_day).chinh
                  : <span className="kt-mo">Chưa thỏa thuận</span> },
              { nhan: "Mặt hàng báo giá", giaTri: String(soMonDaKhai) },
              { nhan: "Đúng hẹn", giaTri: selected.rating !== null && selected.rating_count > 0
                  ? `${Math.round((selected.on_time_count / selected.rating_count) * 100)}% trên ${selected.rating_count} đơn`
                  : null },
              { nhan: "Đơn trễ hạn", giaTri: selected.late_count > 0 ? `${selected.late_count} đơn` : null },
              { nhan: "Trễ trung bình", giaTri: selected.late_count > 0 ? `${soNgayVi(selected.avg_late_days)} ngày` : null },
            ]} />
          ) : undefined}
          // Chân ngăn — đổi trạng thái hợp tác đứng TRÁI, tách khỏi cặp Huỷ/Lưu; chỉ hiện khi đang sửa
          // một NCC có sẵn. Chữ đỏ chứ không phải khối đỏ đặc: Ngừng hợp tác cắt NCC khỏi mọi ô chọn
          // phiếu mua nên vẫn phải đỏ, nhưng không được nổi hơn nút Lưu. Nút Lưu nằm ngoài <form>
          // (chân ngăn là khối riêng của vỏ) nên gắn vào form bằng thuộc tính `form`.
          chan={
            <>
              {mode === "edit" && selected && (
                <Button
                  type="button"
                  variant="ghost"
                  className={`ncc-a-chan__trang-thai${selected.status === "active" ? "" : " ncc-a-chan__trang-thai--mo"}`}
                  onClick={() => toggle(selected)}
                  disabled={saving}
                  style={{ marginRight: "auto" }}
                >
                  {selected.status === "active" ? "Ngừng hợp tác" : "Mở lại hợp tác"}
                </Button>
              )}
              <NutHuyNgan disabled={saving} />
              <Button type="submit" form="ncc-form" variant="accent" loading={saving}>
                Lưu
              </Button>
            </>
          }
        >
          <form id="ncc-form" className="ncc-k3-form" onSubmit={save}>
            {formError && (
              <div className="banner banner--error" role="alert">
                {formError}
              </div>
            )}

            {activeTab === "info" && (
              <SupplierInfoTab
                form={form}
                setForm={setForm}
                nhomGoiY={groupPills.map((g) => g.group)}
                goc={mode === "edit" ? formGoc : null}
              />
            )}

            {activeTab === "items" && (
              <SupplierItemsTab
                mode={mode}
                selected={selected}
                setForm={setForm}
                itemsInForm={itemsInForm}
                soMonDaKhai={soMonDaKhai}
                filteredFormItems={filteredFormItems}
                itemSearchQ={itemSearchQ}
                setItemSearchQ={setItemSearchQ}
                setSupplierItem={setSupplierItem}
                quyDoiDong={quyDoiDong}
                ghiQuyDoiDong={ghiQuyDoiDong}
                fileVatTuRef={fileVatTuRef}
                nhapDang={nhapDang}
                nhapKetQua={nhapKetQua}
                setNhapKetQua={setNhapKetQua}
                nhapExcel={nhapExcel}
                taiFile={taiFile}
              />
            )}

            {activeTab === "history" && (
              <SupplierHistoryTab
                mode={mode}
                selected={selected}
                poList={poList}
                poTotal={poTotal}
                poLoading={poLoading}
                poError={poError}
              />
            )}
          </form>
        </NganPhai>
      )}
    </main>
  );
}

/** Nút Huỷ ở chân ngăn: đóng qua vỏ ngăn — đang gõ dở thì vỏ hỏi trước khi bỏ. */
function NutHuyNgan({ disabled }: { disabled: boolean }) {
  const dong = useDongNgan();
  return (
    <button type="button" className="btn btn--ghost" onClick={dong} disabled={disabled}
      style={{ marginLeft: "auto" }}>
      Huỷ
    </button>
  );
}
