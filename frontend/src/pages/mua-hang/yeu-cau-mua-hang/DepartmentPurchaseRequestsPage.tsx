// Màn YÊU CẦU MUA HÀNG (bộ phận lập) — shell (tách từ pages/DepartmentPurchaseRequestsPage.tsx).
// Giữ ở đây: state + `load()` + effects liên thông (focus mã · seed từ Kho/Kế hoạch vật tư) +
// handlers (`openCreate` · `openEdit` · `closeForm` · `setLine` · `save` · `confirmBoMon` ·
// `confirmCancel`) + chỗ mount.
// Phương án 3 (07/10/2026): bảng `BangYeuCau` và chế độ "Xem theo: Từng món" dùng CHUNG với Mua hàng ›
// Yêu cầu chờ xử lý; chữ + màu trạng thái lấy từ `trang-thai-mua.tsx`.
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  ApiError,
  api,
  type DepartmentPurchaseRequestInput,
  type DepartmentPurchaseRequestLineInput,
  type DepartmentPurchaseRequestRow,
} from "../../../api/client";
import { useCan } from "../../../auth/permissions";
import { useDebounced } from "../../../utils/useDebounced";
import { useAuth } from "../../../auth/useAuth";
import { useKhiTickDoi } from "../../../hooks/useKhiTickDoi";
import { RequestDetailDrawer } from "./components/RequestDetailDrawer";
import { RequestFormDrawer } from "./components/RequestFormDrawer";
import { RequestModals } from "./components/RequestModals";
import { RequestsToolbar } from "./components/RequestsToolbar";
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
import { tabCoSo } from "../loc-mua-hang/ThanhCongCuMuaHang";
import { TAB_CHINH_YEU_CAU } from "../loc-mua-hang/dieu-kien-yeu-cau";
import { TT_YEU_CAU } from "../trang-thai-mua";
import { useMoLenh } from "../mua-cho/OMuaCho";
import { ChonCotBang, useCotBang } from "../luoi-mua-hang";
import { BangMonYeuCau, COT_MON } from "../yeu-cau-chung/BangMonYeuCau";
import { BangYeuCau, COT_YEU_CAU } from "../yeu-cau-chung/BangYeuCau";
import { NutXemTheo, tabMon, useMonYeuCau, useXemTheo } from "../yeu-cau-chung/xem-theo";
import { PAGE_SIZE } from "./shared/constants";
import { cleanRequest, emptyRequest, noiDungCu, todayInputValue } from "./shared/helpers";
import type {
  BoMonState,
  DepartmentPurchaseRequestsPageProps,
  StatusFilter,
} from "./shared/types";
import "../../master-data.css";
// Bảng tình trạng từng dòng trong hộp thoại mượn bộ lớp `.pay-*` của màn Công nợ (payables.css).
import "../../payables.css";
import "../../purchase.css";

export function DepartmentPurchaseRequestsPage({
  navigate,
  eventTick = 0,
  focusRequestCode = null,
  seedLines = null,
  seedPurpose = null,
  seedHeader = null,
  seedNguon = null,
}: DepartmentPurchaseRequestsPageProps) {
  const { token, user } = useAuth();
  const can = useCan();
  const moLenh = useMoLenh(can("san_xuat", "read") ? navigate : undefined);
  // Nạp danh mục Đơn vị MỘT lần — bảng dòng hàng trong drawer chi tiết hiện TÊN, không hiện mã.
  useNapTenDonVi();
  // Huỷ HỘ người khác = ô THAO TÁC của chính màn này (05/10/2026) — máy chủ còn chặn yêu cầu nằm
  // ngoài phạm vi người huỷ (`purchase_service._can_view_department_request`).
  const canAdminCancel = can("yeu_cau_mua_hang", "update");
  // Sửa / huỷ yêu cầu CỦA CHÍNH MÌNH — máy chủ gác `yeu_cau_mua_hang:update`.
  const canUpdate = can("yeu_cau_mua_hang", "update");
  const [canCreate, setCanCreate] = useState(false);
  const [departmentName, setDepartmentName] = useState<string | null>(null);

  const [rows, setRows] = useState<DepartmentPurchaseRequestRow[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(PAGE_SIZE);
  // Ô nhập vẫn bám `q` (gõ tới đâu hiện tới đó); chỉ lời gọi máy chủ đọc bản đã chậm 300ms.
  const qDebounced = useDebounced(q);
  // Kỳ + điều kiện (Phòng ban, Người yêu cầu, Mặt hàng) — ghi lên URL, nhớ theo màn; đổi là về trang 1.
  const [locMan, setLocManGoc] = useLocMan(
    "yeu-cau-mua-hang",
    LOC_MAN_YC_TRONG,
    locManYeuCauTuUrl,
    locManYeuCauLenUrl,
  );
  const setLocMan = (t: LocManYeuCau) => {
    setLocManGoc(t);
    setPage(1);
    setMonPage(1);
  };
  const dieuKien = useDieuKienYeuCau();
  // Cột hiện/ẩn/đổi chỗ của hai lưới — nhớ riêng cho màn này (cùng lưới ở Mua hàng nhớ khoá khác).
  const cotYc = useCotBang("yc-yeu-cau", COT_YEU_CAU);
  const cotMon = useCotBang("yc-mon", COT_MON);
  const khoaLoc = JSON.stringify({ ...thamSoKy(locMan.ky), ...thamSoLocYeuCau(locMan.loc) });
  /** Số yêu cầu theo trạng thái hiển thị — máy chủ đếm sau lọc, trước tab (`tat_ca` = tab Tất cả). */
  const [demTheoTab, setDemTheoTab] = useState<Record<string, number> | null>(null);
  // "Xem theo: Từng món" — bộ phận theo dõi món nào đã có đơn, đã về, đã nhập kho. Cùng ô tìm, kỳ và
  // điều kiện với chế độ Yêu cầu; chip đổi sang tình trạng món, trang tính riêng.
  const [xemTheo, setXemTheo] = useXemTheo("svn.yeu-cau-mua-hang.xem-theo", "yc");
  const [tinhTrang, setTinhTrang] = useState("all");
  const [monPage, setMonPage] = useState(1);
  const mon = useMonYeuCau({
    bat: xemTheo === "mon",
    q: qDebounced,
    tinhTrang,
    page: monPage,
    size,
    khoaLoc,
    tick: eventTick,
  });
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
  const [forbidden, setForbidden] = useState(false);
  const [mode, setMode] = useState(false);
  const [form, setForm] = useState<DepartmentPurchaseRequestInput>(
    emptyRequest(),
  );
  const [editing, setEditing] = useState<DepartmentPurchaseRequestRow | null>(
    null,
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [canceling, setCanceling] = useState<DepartmentPurchaseRequestRow | null>(
    null,
  );
  // Lý do huỷ cả yêu cầu — mở hộp cho phiếu khác thì xoá chữ của lần trước.
  const [lyDoHuy, setLyDoHuy] = useState("");
  useEffect(() => setLyDoHuy(""), [canceling?.id]);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  /** Đang hỏi bỏ MỘT MÓN khỏi yêu cầu (mg 0233). Lý do bắt buộc — máy chủ trả 422 nếu trống, nên
   *  khoá luôn nút Xác nhận ở đây để người dùng không phải bấm mới biết. */
  const [boMon, setBoMon] = useState<BoMonState | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drawerTab, setDrawerTab] = useState<"items" | "orders" | "history">("items");
  const minNeededDate = useMemo(() => todayInputValue(), []);

  // Lấy lại từ `rows` (không lưu cả object) để sau khi Hủy cập nhật `rows` thì
  // popup đang mở tự thấy trạng thái mới.
  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );
  /** Có bày cột "Bỏ món" trong bảng chi tiết không. Cùng luật với nút Huỷ yêu cầu: người tạo VÀ
   *  có ô Thao tác, hoặc có quyền huỷ. Từng dòng còn bị máy chủ chặn tiếp qua `can_cancel`. */
  const boMonDuoc = useMemo(() => {
    if (!selected || selected.status === "cancelled") return false;
    return (
      canAdminCancel || (canUpdate && selected.requested_by_user_id === user?.id)
    );
  }, [selected, canAdminCancel, canUpdate, user?.id]);

  // Đổi cỡ trang thì trang đang đứng có thể không còn tồn tại — về trang 1.
  const doiCoTrang = (n: number) => {
    setSize(n);
    setPage(1);
    setMonPage(1);
  };

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    setListError(null);
    api.departmentPurchaseRequests
      .list(
        token,
        {
          q: qDebounced.trim() || undefined,
          status: status === "all" ? null : status,
          sort: "-created_at",
          page,
          size,
        },
        JSON.parse(khoaLoc),
      )
      .then((res) => {
        setRows(res.items);
        setTotal(res.total);
        setDemTheoTab(res.dem_theo_tab ?? null);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.isForbidden) setForbidden(true);
        else setListError("Không tải được danh sách yêu cầu mua hàng.");
      })
      .finally(() => setLoading(false));
  }, [token, qDebounced, status, page, size, khoaLoc]);

  useEffect(() => {
    load();
  }, [load]);

  useKhiTickDoi(eventTick, load);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    api.departmentPurchaseRequests
      .canCreate(token)
      .then((res) => {
        if (alive) setCanCreate(res.can_create);
      })
      .catch(() => {
        if (alive) setCanCreate(false);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    api
      .profile(token)
      .then((profile) => {
        if (alive) setDepartmentName(profile.department_name);
      })
      .catch(() => {
        if (alive) setDepartmentName(null);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  // Liên thông: đổ mã YCMH cần truy vết vào ô tìm kiếm → load() tự chạy lại
  // (q đổi làm useCallback tạo lại), danh sách chỉ còn đúng phiếu đó.
  useEffect(() => {
    if (!focusRequestCode) return;
    setQ(focusRequestCode);
    setStatus("all");
    setXemTheo("yc");
    // Bỏ kỳ + điều kiện đang nhớ: yêu cầu cần soi có thể nằm ngoài kỳ / ngoài phòng đang lọc.
    setLocManGoc(LOC_MAN_YC_TRONG);
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequestCode]);

  // Liên thông từ Kho / Kế hoạch vật tư: mở form tạo với dòng vật tư điền sẵn. `seedLines` là
  // object MỚI mỗi lần điều hướng nên effect chạy đúng 1 lần / lượt bấm "Tạo yêu cầu mua".
  //
  // KHÔNG tự lưu hộ. Form mở ra đã đủ chữ đủ số, nhưng cái bấm Lưu vẫn là người — số máy tính ra
  // (số lượng thiếu) là ĐỀ XUẤT, người lo vật tư còn phải làm tròn theo ram / kiện, cộng phòng hao,
  // hoặc bỏ bớt một món đã hỏi mượn được ở xưởng khác. NGÀY CẦN HÀNG thì máy không điền: người lập
  // gõ, và chính ngày đó quay về làm "Ngày cần" của các lệnh trong `seedNguon`.
  useEffect(() => {
    if (!seedLines || seedLines.length === 0) return;
    setEditing(null);
    setForm({
      ...emptyRequest(seedHeader?.source_type ?? "kho"),
      loai_mua: seedNguon?.length ? "cho_lsx" : (seedHeader?.loai_mua ?? "theo_yeu_cau"),
      related_document_type: seedHeader?.related_document_type ?? null,
      related_document_code: seedHeader?.related_document_code ?? null,
      needed_date: seedHeader?.needed_date ?? "",
      content: seedPurpose ?? "",
      lines: seedLines,
      nguon_lenh: seedNguon ?? undefined,
    });
    setFormError(null);
    setMode(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedLines]);

  function openCreate() {
    setEditing(null);
    setForm(emptyRequest());
    setFormError(null);
    setMode(true);
  }

  function openEdit(row: DepartmentPurchaseRequestRow) {
    setEditing(row);
    setForm({
      source_type: row.source_type,
      loai_mua: row.loai_mua,
      related_document_type: row.related_document_type,
      related_document_code: row.related_document_code,
      content: row.content ?? noiDungCu(row.purpose, row.note),
      needed_date: row.needed_date,
      note: null,
      // Món ĐÃ BỎ không vào form sửa: nó là vết đã đóng, sửa lại là mở một cuộc huỷ đã kết thúc.
      // Máy chủ giữ nguyên các dòng đó khi nhận PUT (xem `purchase_repo.update`), nên không gửi
      // lên không có nghĩa là xoá.
      lines: row.lines
        .filter((line) => !line.cancelled_at)
        .map((line) => ({
          hang_loai: line.hang_loai,
          hang_id: line.hang_id,
          item_name: line.item_name,
          unit: line.unit,
          quantity: line.quantity,
          note: line.note,
          kho_rong: line.kho_rong,
          kho_dai: line.kho_dai,
        })),
    });
    setFormError(null);
    setMode(true);
  }

  function closeForm() {
    setMode(false);
    setEditing(null);
    setFormError(null);
  }

  function setLine(
    index: number,
    patch: Partial<DepartmentPurchaseRequestLineInput>,
  ) {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line, i) =>
        i === index ? { ...line, ...patch } : line,
      ),
    }));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!token || saving) return;
    const payload = cleanRequest(form);
    const missingHeader = [
      !payload.needed_date ? "Ngày cần hàng" : "",
      !payload.content ? "Nội dung / mục đích" : "",
    ].filter(Boolean);
    if (missingHeader.length > 0) {
      setFormError(`Vui lòng nhập đầy đủ: ${missingHeader.join(", ")}.`);
      return;
    }
    if (payload.needed_date && payload.needed_date < minNeededDate) {
      setFormError("Ngày cần hàng không được nhỏ hơn hôm nay.");
      return;
    }
    if (
      !payload.lines.length ||
      payload.lines.some((line) => !line.item_name || !line.unit)
    ) {
      setFormError(
        "Yêu cầu cần ít nhất một dòng vật tư; tên vật tư và đơn vị tính không được trống.",
      );
      return;
    }
    // Phải là mặt hàng CÓ THẬT trong danh mục Giấy / Vật tư khác. Dòng cũ (lập trước khi ô chọn
    // này ra đời) mở ra sửa cũng phải chọn lại — tên chuỗi không nối được về đâu cả.
    if (payload.lines.some((line) => !line.hang_loai || !line.hang_id)) {
      setFormError(
        "Mỗi dòng phải chọn vật tư từ danh mục (Giấy / Vật tư khác) — gõ tên để tìm.",
      );
      return;
    }
    if (payload.lines.some((line) => line.quantity <= 0)) {
      setFormError("Số lượng phải lớn hơn 0.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const saved = editing
        ? await api.departmentPurchaseRequests.update(token, editing.id, payload)
        : await api.departmentPurchaseRequests.create(token, payload);
      setRows((current) =>
        editing
          ? current.map((row) => (row.id === saved.id ? saved : row))
          : [saved, ...current],
      );
      if (!editing) setTotal((current) => current + 1);
      closeForm();
      mon.nap();
    } catch (err) {
      if (err instanceof ApiError) setFormError(err.message);
      else setFormError("Không tạo được yêu cầu mua hàng.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmBoMon() {
    if (!token || !boMon || !selected) return;
    const ly_do = boMon.reason.trim();
    if (!ly_do) {
      setBoMon({ ...boMon, error: "Nhập lý do bỏ món này khỏi yêu cầu." });
      return;
    }
    setActionBusy(`line-cancel:${boMon.line.id}`);
    try {
      const saved = await api.departmentPurchaseRequests.cancelLine(
        token,
        selected.id,
        boMon.line.id,
        ly_do,
      );
      // Máy chủ trả về CẢ yêu cầu sau khi tính lại (trạng thái phiếu có thể đổi theo, vd món cuối
      // bị bỏ ⇒ phiếu thành Đã hủy) — thay nguyên dòng, đừng vá tay từng ô.
      setRows((current) => current.map((row) => (row.id === saved.id ? saved : row)));
      setBoMon(null);
      mon.nap();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Không bỏ được món này khỏi yêu cầu.";
      setBoMon((current) => (current ? { ...current, error: message } : current));
    } finally {
      setActionBusy(null);
    }
  }

  async function confirmCancel() {
    if (!token || !canceling) return;
    setActionBusy(`cancel:${canceling.id}`);
    try {
      const saved = await api.departmentPurchaseRequests.cancel(
        token,
        canceling.id,
        lyDoHuy.trim(),
      );
      setRows((current) =>
        current.map((row) => (row.id === saved.id ? saved : row)),
      );
      setCanceling(null);
      mon.nap();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Không hủy được yêu cầu mua hàng.");
      setCanceling(null);
    } finally {
      setActionBusy(null);
    }
  }

  /** Bấm mã yêu cầu ở chế độ Từng món: yêu cầu có thể không nằm trong trang đang nạp ⇒ hỏi riêng
   *  rồi ghép vào `rows` để ngăn chi tiết (và mọi thao tác trong đó) dùng chung một nguồn. */
  async function moYeuCau(r: { request_id: number }) {
    if (!token) return;
    try {
      const row = await api.departmentPurchaseRequests.get(token, r.request_id);
      setRows((cu) => (cu.some((x) => x.id === row.id) ? cu.map((x) => (x.id === row.id ? row : x)) : [...cu, row]));
      setSelectedId(row.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không mở được yêu cầu này.");
    }
  }

  if (forbidden) {
    return (
      <main className="md-page">
        <div className="banner banner--error" role="alert">
          Bạn không có quyền truy cập Yêu cầu mua hàng (403).
        </div>
      </main>
    );
  }

  return (
    <main className="md-page mh-trang lds">
      <RequestsToolbar
        tabs={
          xemTheo === "yc"
            ? tabCoSo(TAB_CHINH_YEU_CAU, TT_YEU_CAU, demTheoTab, status)
            : tabMon(mon.data?.dem_theo_tab, tinhTrang)
        }
        tab={xemTheo === "yc" ? status : tinhTrang}
        onTab={(v) => {
          if (xemTheo === "yc") {
            setStatus(v as StatusFilter);
            setPage(1);
          } else {
            setTinhTrang(v);
            setMonPage(1);
          }
        }}
        ariaTabs={xemTheo === "yc" ? "Lọc trạng thái yêu cầu" : "Lọc tình trạng món"}
        q={q}
        onQ={(v) => {
          setQ(v);
          setPage(1);
          setMonPage(1);
        }}
        canCreate={canCreate}
        openCreate={openCreate}
        ky={locMan.ky}
        onKy={(ky) => setLocMan({ ...locMan, ky })}
        dieuKien={dieuKien}
        loc={locMan.loc}
        onLoc={(loc) => setLocMan({ ...locMan, loc })}
        ben={<NutXemTheo v={xemTheo} onDoi={setXemTheo} />}
        chonCot={<ChonCotBang b={xemTheo === "yc" ? cotYc : cotMon} />}
        banner={
          error && (
            <div className="banner banner--error" role="alert">
              {error}
            </div>
          )
        }
      />

      {xemTheo === "yc" ? (
        <BangYeuCau
          cot={cotYc}
          rows={rows}
          loading={loading}
          loi={listError}
          onThuLai={load}
          chonId={selectedId}
          onChon={(row) => setSelectedId(row.id)}
          coLoc={q.trim() !== "" || status !== "all" || khoaLoc !== "{}"}
          onXoaLoc={() => {
            setQ("");
            setStatus("all");
            setLocMan(LOC_MAN_YC_TRONG);
          }}
          goiYTrong="Bộ phận gửi yêu cầu vật tư sang Thu mua tại đây."
          total={total}
          page={page}
          size={size}
          onPage={setPage}
          onSize={doiCoTrang}
          onMoLenh={moLenh}
        />
      ) : (
        <BangMonYeuCau
          cot={cotMon}
          rows={mon.data?.items ?? []}
          loading={mon.loading}
          loi={mon.loi}
          onThuLai={mon.nap}
          coLoc={q.trim() !== "" || tinhTrang !== "all" || khoaLoc !== "{}"}
          onXoaLoc={() => {
            setQ("");
            setTinhTrang("all");
            setLocMan(LOC_MAN_YC_TRONG);
          }}
          goiYTrong="Món trong các yêu cầu của bộ phận hiện ở đây, kèm đơn mua và tiến độ."
          total={mon.data?.total ?? 0}
          page={monPage}
          size={size}
          onPage={setMonPage}
          onSize={doiCoTrang}
          onMoYeuCau={moYeuCau}
          onMoLenh={moLenh}
        />
      )}

      {selected && (
        <RequestDetailDrawer
          selected={selected}
          setSelectedId={setSelectedId}
          drawerTab={drawerTab}
          setDrawerTab={setDrawerTab}
          boMonDuoc={boMonDuoc}
          setBoMon={setBoMon}
          canAdminCancel={canAdminCancel}
          canUpdate={canUpdate}
          openEdit={openEdit}
          setCanceling={setCanceling}
          onMoLenh={moLenh}
          onLapDon={
            navigate && can("thu_mua", "create")
              ? (code) => navigate("mua-hang", { focusRequestCode: code, lapDonTuYeuCau: true })
              : undefined
          }
        />
      )}

      {mode && (
        <RequestFormDrawer
          editing={editing}
          departmentName={departmentName}
          form={form}
          setForm={setForm}
          setLine={setLine}
          formError={formError}
          minNeededDate={minNeededDate}
          saving={saving}
          save={save}
          closeForm={closeForm}
        />
      )}

      <RequestModals
        selected={selected}
        canceling={canceling}
        setCanceling={setCanceling}
        confirmCancel={confirmCancel}
        lyDoHuy={lyDoHuy}
        setLyDoHuy={setLyDoHuy}
        boMon={boMon}
        setBoMon={setBoMon}
        confirmBoMon={confirmBoMon}
        actionBusy={actionBusy}
      />
    </main>
  );
}
