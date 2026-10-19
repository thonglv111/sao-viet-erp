// Màn ĐƠN MUA HÀNG (Kế toán) — shell (tách từ pages/AccountingPurchaseInboxPage.tsx).
// Giữ ở đây: state + `load()` + effects + `approve()`/`reject()`. Từ 17/10/2026 màn này CHỈ DUYỆT —
// lập phiếu chi theo đơn mua dời hẳn sang Phiếu chi → "Mua hàng chờ chi" (docs/prd-mua-hang-cho-chi-o-
// phieu-chi.md); ngăn đơn chỉ còn link chỉ sang đó.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  api,
  type NhomTien,
  type PurchaseRequestRow,
  type SupplierCredit,
} from "../../../api/client";
import { useAuth } from "../../../auth/useAuth";
import { useCan } from "../../../auth/permissions";
import type { NavigateFn } from "../../../components/AppShell";
import { InboxDrawer } from "./components/InboxDrawer";
import { BangDonMua, COT_DON } from "../../mua-hang/don-mua-chung/BangDonMua";
import { ChonCotBang, useCotBang } from "../../mua-hang/luoi-mua-hang";
import { useMoLenh } from "../../mua-hang/mua-cho/OMuaCho";
import { ThanhCongCuMuaHang, tabCoSo } from "../../mua-hang/loc-mua-hang/ThanhCongCuMuaHang";
import { tabTien } from "../../mua-hang/phieu-mua-hang/tabs/PhieuListTab";
import { TT_HANG_LOC } from "../../mua-hang/trang-thai-mua";
import { useDebounced } from "../../../utils/useDebounced";
import { DaiDuyet } from "./components/DaiDuyet";
import { useNapTenDonVi } from "../../tenDonVi";
import { PAGE_SIZE } from "./shared/constants";
import {
  LOC_MAN_DON_MUA_TRONG,
  MAN_DON_MUA,
  MOC_DON_MUA,
  locManDonMuaLenUrl,
  locManDonMuaTuUrl,
  thamSoLocDonMua,
  useDieuKienDonMua,
  type LocManDonMua,
  type ThamSoLocDonMua,
} from "./shared/dieuKienDonMua";
import { thamSoKy } from "../../thanh-loc/ky-danh-sach";
import { useLocMan } from "../../thanh-loc/useLocMan";
import "../../master-data.css";
import "../../accounting.css";
import "../../purchase.css";

/** Chip Hàng luôn hiện ở hộp Kế toán — không có Nháp: đơn nháp chưa gửi duyệt, không thuộc hộp này. */
const TAB_HANG_KT = ["pending_approval", "approved", "purchased", "partially_received", "cho_gui_kho", "kho_chua_nhap", "da_nhap_kho"];

export function AccountingPurchaseInboxPage({
  navigate,
  eventTick = 0,
  focusRequestCode,
  onDataRefreshed,
}: {
  navigate: NavigateFn;
  eventTick?: number;
  /** Mã PMH cần mở sẵn — màn Công nợ phải trả nhảy sang đây để lập phiếu chi cho đúng đơn đó.
      Không có nó thì bấm "Lập phiếu chi" chỉ đổ ra danh sách trắng, người dùng phải tự đi tìm. */
  focusRequestCode?: string | null;
  onDataRefreshed?: () => void;
}) {
  const { token } = useAuth();
  const can = useCan();
  // Nạp danh mục Đơn vị MỘT lần cho cả phiên: bảng dòng hàng và bảng đợt giao hiện TÊN đơn vị
  // ("cái", "tờ") chứ không phải mã (`cai`, `to`). Thiếu dòng này thì `tenDonVi()` luôn rỗng và
  // hai bảng đó lặng lẽ rơi về mã trần — không lỗi, chỉ xấu.
  useNapTenDonVi();
  // DUYỆT đơn mua = quyết định CHI TIỀN ⇒ gác bằng `thu_mua:approve`, KHÔNG phải `ke_toan:approve`.
  // Sáng 04/08/2026 đã gỡ ô này khỏi bộ phận Mua hàng nên giờ chỉ giám đốc và người được trao
  // quyền còn. Để `ke_toan:approve` thì kế toán tự duyệt khoản chi rồi tự viết phiếu chi — đúng
  // lỗi tách vai vừa vá bên thu mua.
  // Ô này DỜI sang khoá `ke_toan` ngày 11/08/2026 (nút Duyệt / Từ chối chỉ có ở màn này nên ô
  // quyền cũng về đây). Lần dời trước sửa máy chủ mà QUÊN dòng này ⇒ quản trị tick ô mới, giao
  // diện vẫn hỏi ô cũ, nút không hiện — "cấp quyền rồi mà không thấy nút".
  const canApprove = can("ke_toan", "approve");
  // Link "Phiếu chi → Mua hàng chờ chi" ở tab Thanh toán ⇒ cần ô Xem của chính màn Phiếu chi.
  const coXemPhieuChi = can("phieu_chi", "read");
  // Mã YCMH chỉ bấm được khi có ô Xem của màn đó — không thì bấm vào là ăn màn chặn.
  const openYcmh = can("yeu_cau_mua_hang", "read")
    ? (code: string) => navigate("yeu-cau-mua-hang", { focusRequestCode: code })
    : undefined;
  // Chip lệnh ở cột "Mua cho" chỉ bấm được khi có ô Xem của Sản xuất.
  const moLenh = useMoLenh(can("san_xuat", "read") ? navigate : undefined);
  const [rows, setRows] = useState<PurchaseRequestRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(PAGE_SIZE);
  const [q, setQ] = useState(focusRequestCode ?? "");
  // Mới vào hiện TẤT CẢ (chủ 04/08/2026). Trước đây mặc định lọc "chờ duyệt" nên mở màn ra là
  // giấu mất đơn đã duyệt, đã mua, đã nhận — kế toán tưởng chưa có gì để lập phiếu chi.
  const [statusFilter, setStatusFilter] = useState<string>("all");
  /** Nhóm cột Tiền (phương án 3) — độc lập với trạng thái Hàng. "" = không lọc tiền.
   *  Mặc định KHÔNG lọc: màn này còn là chỗ DUYỆT đơn, lọc sẵn "Chưa trả" là giấu đơn chờ duyệt
   *  (chủ chốt 04/08/2026: mới vào hiện tất cả). */
  const [tien, setTien] = useState<NhomTien | "">("");
  const [demTien, setDemTien] = useState<Record<string, number> | null>(null);
  const qDebounced = useDebounced(q);
  // Kỳ + điều kiện (Nhà cung cấp, Tiền cọc) — ghi lên URL, nhớ theo màn; đổi là về trang 1.
  const [locMan, setLocManGoc] = useLocMan(MAN_DON_MUA, LOC_MAN_DON_MUA_TRONG, locManDonMuaTuUrl, locManDonMuaLenUrl);
  const setLocMan = (t: LocManDonMua) => {
    setLocManGoc(t);
    setPage(1);
  };
  const dieuKien = useDieuKienDonMua();
  // Cột của lưới — nhớ riêng cho màn Kế toán (Mua hàng › Đơn mua nhớ khoá khác).
  const cot = useCotBang("kt-don-mua", COT_DON);
  const khoaLoc = JSON.stringify({ ...thamSoKy(locMan.ky), ...thamSoLocDonMua(locMan.loc) });
  const [demTheoTab, setDemTheoTab] = useState<Record<string, number> | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    api.accounting
      .inbox(token, {
        q: qDebounced.trim() || undefined,
        status: statusFilter === "all" ? null : statusFilter,
        tien: tien || null,
        ...(JSON.parse(khoaLoc) as { tu_ngay?: string; den_ngay?: string; moc?: string } & ThamSoLocDonMua),
        sort: "-created_at",
        page,
        size,
      })
      .then((response) => {
        setRows(response.items);
        setTotal(response.total);
        setDemTheoTab(response.dem_theo_tab ?? null);
        setDemTien(response.dem_theo_tien ?? null);
        setSelectedId((current) =>
          current != null && response.items.some((row) => row.id === current)
            ? current
            : null,
        );
        onDataRefreshed?.();
      })
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : "Không tải được yêu cầu Kế toán.",
        ),
      )
      .finally(() => setLoading(false));
  }, [
    token,
    qDebounced,
    statusFilter,
    tien,
    khoaLoc,
    page,
    size,
    onDataRefreshed,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (eventTick <= 0) return;
    load();
  }, [eventTick, load]);

  // Sang màn này từ nơi khác kèm mã PMH ⇒ nhét luôn vào ô tìm, bỏ kỳ + điều kiện đang nhớ (đơn có thể
  // đã tạo từ lâu) và về trang 1.
  useEffect(() => {
    if (!focusRequestCode) return;
    setQ(focusRequestCode);
    setStatusFilter("all");
    setLocManGoc(LOC_MAN_DON_MUA_TRONG);
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequestCode]);

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

  // HẠN MỨC CÔNG NỢ của NCC trên đơn đang mở — CẢNH BÁO MỀM (Đ6): chỉ nhắc, KHÔNG chặn duyệt.
  // Chặn cứng ở đây là đúng lúc gấp nhất (hết giấy, phải mua ngay) thì hệ khoá đường mua.
  // Gọi riêng chứ không nhét vào danh sách: một lần một đơn, chỉ khi người ta thật sự mở ra xem.
  const [credit, setCredit] = useState<SupplierCredit | null>(null);
  useEffect(() => {
    if (!token || selected == null) {
      setCredit(null);
      return;
    }
    let bo = false;
    api.purchaseRequests
      .supplierCredit(token, selected.id)
      .then((data) => {
        if (!bo) setCredit(data);
      })
      // Nuốt lỗi có chủ đích: đây là cảnh báo phụ, hỏng nó không được chặn màn chi tiết.
      .catch(() => {
        if (!bo) setCredit(null);
      });
    return () => {
      bo = true;
    };
  }, [token, selected]);

  // Đổi cỡ trang thì trang đang đứng có thể không còn tồn tại — về trang 1.
  const doiCoTrang = (n: number) => {
    setSize(n);
    setPage(1);
  };
  /** DUYỆT đơn mua — một bước riêng, không kèm lập phiếu chi.
   *
   * Gọi thẳng API của Thu mua (`/purchase-requests/{id}/approve`) chứ không đẻ endpoint kế toán
   * riêng: thứ đang duyệt là PHIẾU MUA, chỉ khác chỗ đứng bấm — một đường duy nhất thì luật
   * trạng thái và nhật ký cũng chỉ có một chỗ để sai. Người lập TỰ DUYỆT được phiếu của mình
   * (chủ chốt 20/09/2026); ai bấm được nút này là do phân quyền quyết. */
  async function approve(row: PurchaseRequestRow) {
    if (!token) return;
    setBusy(`approve-${row.id}`);
    setError(null);
    try {
      await api.purchaseRequests.approve(token, row.id);
      load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Không duyệt được đơn mua hàng.",
      );
    } finally {
      setBusy(null);
    }
  }

  /** TỪ CHỐI từ bong bóng ở dải Chờ duyệt — lỗi trả về để hiện ngay dưới ô lý do. */
  async function reject(row: PurchaseRequestRow, lyDo: string): Promise<string | null> {
    if (!token) return null;
    try {
      await api.purchaseRequests.reject(token, row.id, lyDo);
      load();
      return null;
    } catch (err) {
      return err instanceof ApiError ? err.message : "Không từ chối được đơn mua hàng.";
    }
  }

  return (
    <main className="md-page acct-dmh mh-trang lds">
      <header className="lds-dau">
        {/* Tên cũ "Yêu cầu mua hàng" SAI: màn này hiển thị PHIẾU MUA HÀNG (PMH), không phải YCMH. */}
        <h1 className="lds-dau__ten">Đơn mua hàng</h1>
      </header>

      {error && (
        <div className="banner banner--error" role="alert">
          {error}
        </div>
      )}

      <ThanhCongCuMuaHang
        tabs={tabCoSo(TAB_HANG_KT, TT_HANG_LOC, demTheoTab, statusFilter)}
        tab={statusFilter}
        ariaTabs="Lọc trạng thái hàng của đơn"
        nhanNhom="Hàng"
        onTab={(v) => {
          setStatusFilter(v);
          setPage(1);
        }}
        nhomPhu={{
          nhan: "Tiền",
          tabs: tabTien(demTien),
          tab: tien,
          boChon: "",
          aria: "Lọc tình trạng tiền của đơn",
          onTab: (v) => {
            setTien(v as NhomTien | "");
            setPage(1);
          },
        }}
        q={q}
        onQ={(v) => {
          setQ(v);
          setPage(1);
        }}
        placeholder="Tìm mã đơn, nhà cung cấp, mã yêu cầu…"
        ky={locMan.ky}
        moc={MOC_DON_MUA}
        onKy={(ky) => setLocMan({ ...locMan, ky })}
        dieuKien={dieuKien}
        loc={locMan.loc}
        onLoc={(loc) => setLocMan({ ...locMan, loc })}
        chonCot={<ChonCotBang b={cot} />}
      />

      <BangDonMua
        cot={cot}
        rows={rows}
        loading={loading}
        loi={error && rows.length === 0 ? error : null}
        onThuLai={load}
        chonId={selected?.id ?? null}
        onChon={(id) => setSelectedId(id)}
        openYcmh={openYcmh}
        onMoLenh={moLenh}
        coLoc={q.trim() !== "" || statusFilter !== "all" || tien !== "" || khoaLoc !== "{}"}
        onXoaLoc={() => {
          setQ("");
          setStatusFilter("all");
          setTien("");
          setLocMan(LOC_MAN_DON_MUA_TRONG);
        }}
        goiYTrong="Đơn mua hiện ở đây khi Thu mua gửi duyệt."
        total={total}
        page={page}
        size={size}
        onPage={setPage}
        onSize={doiCoTrang}
      />

      {selected && (
        <InboxDrawer
          selected={selected}
          setSelectedId={setSelectedId}
          credit={credit}
          openYcmh={openYcmh}
          onMoLenh={moLenh}
          tiepTheo={
            canApprove && selected.status === "pending_approval" ? (
              <DaiDuyet
                row={selected}
                credit={credit}
                duyetBusy={busy === `approve-${selected.id}`}
                onDuyet={() => void approve(selected)}
                onTuChoi={(lyDo) => reject(selected, lyDo)}
              />
            ) : undefined
          }
          onMoChoChi={
            coXemPhieuChi
              ? () => navigate("ke-toan-phieu-chi", { focusChoChiCode: selected.code })
              : undefined
          }
          onDoi={(next) => setRows((cu) => cu.map((r) => (r.id === next.id ? next : r)))}
          onLoi={setError}
        />
      )}

    </main>
  );
}
