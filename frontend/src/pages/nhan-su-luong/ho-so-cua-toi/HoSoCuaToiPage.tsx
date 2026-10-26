// "Hồ sơ của tôi" — nhà chung self-service cho MỌI tài khoản (module không gate `nhan_su`).
// - Nhân viên (có hồ sơ /me): xem hồ sơ của mình, tự sửa liên lạc; định danh/lương do HCNS quản lý.
// - Admin / tài khoản chưa gắn hồ sơ: self-service tài khoản (ảnh · tên · mật khẩu) + xem thông tin tài khoản.
// Gộp từ hộp thoại "Tài khoản" cũ (ProfileDialog) — 1 nhà chung thay cho menu 4 mục ở Topbar.
//
// MỘT TRANG CUỘN, KHÔNG TAB: chip "Đề nghị chờ duyệt" phải CUỘN TỚI khối đề nghị (đổi tab rồi mới
// cuộn là mất ngữ cảnh), và băng "hồ sơ còn thiếu" chỉ có nghĩa khi nhìn được toàn cảnh ô trống.
// (tách từ pages/HoSoCuaToiPage.tsx).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  api,
  assetUrl,
  type EmployeeAttachment,
  type EmployeeDetail,
  type EmployeeEvent,
  type LeaveQuota,
  type Profile,
  type UpdateRequest,
} from "../../../api/client";
import { useAuth } from "../../../auth/useAuth";
import { useCan, useSelfServiceWrite } from "../../../auth/permissions";
import type { NavigateFn } from "../../../components/AppShell";
import { Button } from "../../../components/Button";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { EmptyRow, EmptyState } from "../../../components/EmptyState";
import { Icon } from "../../../components/Icons";
import { trangHopLe } from "../../../components/Pager";
import { PhanTrangDayDu } from "../../../components/PhanTrangDayDu";
import { Timeline, type TimelineEntry } from "../../../components/Timeline";
import { thamSoKy } from "../../thanh-loc/ky-danh-sach";
import { ThanhLoc } from "../../thanh-loc/ThanhLoc";
import { useLocMan } from "../../thanh-loc/useLocMan";
import { ReqRow } from "./components/ReqRow";
import { StatChip } from "./components/StatChip";
import { LockChip, Row } from "./components/info-display";
import { AvatarModal } from "./modals/AvatarModal";
import { ContactModal } from "./modals/ContactModal";
import { NameModal } from "./modals/NameModal";
import { PasswordModal } from "./modals/PasswordModal";
import { ReqDetailModal } from "./modals/ReqDetailModal";
import { RequestModal } from "./modals/RequestModal";
import {
  DANG_TAI,
  DOC_KIND_LABEL,
  EVENT_LABEL,
  GENDER_LABEL,
  PIT_MODE_LABEL,
  REQ_PAGE_SIZE,
  STATUS_LABEL,
} from "./shared/constants";
import {
  fmtDate,
  fmtDateTime,
  fmtSdt,
  fmtSo,
  kieuFile,
  messageFor,
  oThieu,
  thamNien,
} from "./shared/helpers";
import type { SoCong, SoLuong, SoPhep, Tai } from "./shared/types";
import {
  LOC_DE_NGHI_TRONG, MOC_DE_NGHI, dieuKienDeNghi, locDeNghiLenUrl, locDeNghiTuUrl, type LocManDeNghi,
} from "./shared/dieu-kien-de-nghi";
import "../../nhan-su.css";
import "../../ho-so-cua-toi.css";

export function HoSoCuaToiPage({ navigate, eventTick }: {
  navigate?: NavigateFn;
  /** Nhảy theo sự kiện nhóm nhân sự — có `phieu_luong_cong_bo` / `_thu_hoi` (L-SX-46). */
  eventTick?: number;
}) {
  const { token, user } = useAuth();
  // Ô TỰ PHỤC VỤ (đợt 3) — quản trị TẮT ĐƯỢC. Không hỏi thì tắt xong nút Sửa / Gửi đề nghị
  // vẫn bày ra, bấm mới ăn 403.
  // Màn này CHỈ có nút ghi (Sửa liên hệ · Gửi đề nghị), phần xem đi theo chính ô `self_service`
  // đã gác ở máy chủ — nên chỉ cần hỏi ô THAO TÁC (tách khỏi ô Xem ngày 11/08/2026).
  const tuPhucVuGhi = useSelfServiceWrite();
  // Nút "Chấm công" ở khung tên (10/10/2026): mở app trên điện thoại là vào màn này, bấm một
  // phát sang màn Chấm công. Chỉ hiện khi có ô Xem của màn Chấm công — không thì bấm vào ăn màn chặn.
  const coChamCong = useCan()("cham_cong", "read");
  const [emp, setEmp] = useState<EmployeeDetail | null>(null);
  const [hasEmp, setHasEmp] = useState<boolean | null>(null);
  // Lỗi đọc hồ sơ (mạng / máy chủ). TÁCH khỏi `hasEmp`: trước đây lỗi gán `hasEmp = false` ⇒ nhân
  // viên có hồ sơ đọc thấy nhánh "tài khoản chưa gắn hồ sơ" — nói sai sự thật, họ đi hỏi HCNS.
  const [loiHoSo, setLoiHoSo] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [events, setEvents] = useState<EmployeeEvent[]>([]);
  const [files, setFiles] = useState<Tai<EmployeeAttachment[]>>(DANG_TAI);
  const [editing, setEditing] = useState(false);
  const [reqs, setReqs] = useState<Tai<UpdateRequest[]>>(DANG_TAI);
  const [requesting, setRequesting] = useState(false);
  const [huyReq, setHuyReq] = useState<UpdateRequest | null>(null);
  const [huyBusy, setHuyBusy] = useState(false);
  const [huyErr, setHuyErr] = useState<string | null>(null);
  // Đề nghị cập nhật: CẮT TRANG + LỌC Ở MÁY CHỦ. `reqDem` là số đếm theo trạng thái trên TOÀN BỘ
  // hồ sơ (chip "chờ duyệt" đầu màn đọc ô này); `reqDemKy` = trong kỳ đang xem, cho thẻ lọc
  // Trạng thái. KHÔNG đếm lại từ trang đang xem.
  const [reqTotal, setReqTotal] = useState(0);
  const [reqDem, setReqDem] = useState<Record<string, number>>({});
  const [reqDemKy, setReqDemKy] = useState<Record<string, number>>({});
  // Kỳ (Ngày tạo) + Trạng thái — ghi lên URL `?man=ho-so-cua-toi`, nhớ theo màn (06/10/2026).
  const [locReq, setLocReqGoc] = useLocMan("ho-so-cua-toi", LOC_DE_NGHI_TRONG, locDeNghiTuUrl, locDeNghiLenUrl);
  const khoaReq = JSON.stringify({ status: locReq.loc.trang_thai, loc: thamSoKy(locReq.ky) });
  const [reqPage, setReqPage] = useState(1);
  const [reqSize, setReqSize] = useState(REQ_PAGE_SIZE);
  const [xemReq, setXemReq] = useState<UpdateRequest | null>(null);
  // Số liệu "của tôi" — mỗi nguồn tải/thử lại ĐỘC LẬP, hỏng một chip không kéo sập cả màn.
  const [phep, setPhep] = useState<Tai<SoPhep>>(DANG_TAI);
  const [cong, setCong] = useState<Tai<SoCong>>(DANG_TAI);
  const [luong, setLuong] = useState<Tai<SoLuong>>(DANG_TAI);
  // Self-service tài khoản (gộp từ ProfileDialog): ảnh · mật khẩu · tên (tên chỉ cho tài khoản không hồ sơ).
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  const reqRef = useRef<HTMLDivElement>(null);
  const [nhayReq, setNhayReq] = useState(false);

  const loadReqs = useCallback(() => {
    if (!token) return;
    api.employees.myRequests(token, { ...JSON.parse(khoaReq), page: reqPage, size: reqSize })
      .then((r) => {
        setReqs({ tt: "ok", du: r.items });
        setReqTotal(r.total);
        setReqDem(r.dem ?? {});
        setReqDemKy(r.dem_theo_tab ?? {});
        // Rút lại đề nghị cuối của trang cuối ⇒ tổng co lại, trang này rỗng trơn: lùi về trang có thật.
        const ve = trangHopLe(reqPage, r.total, reqSize);
        if (ve !== null) setReqPage(ve);
      })
      .catch(() => setReqs({ tt: "loi" }));
  }, [token, khoaReq, reqPage, reqSize]);

  const load = useCallback(() => {
    if (!token) return;
    setLoiHoSo(null);
    api.employees.me(token)
      .then((r) => { setHasEmp(r.has_employee); setEmp(r.employee); })
      .catch((e: unknown) => setLoiHoSo(e instanceof ApiError ? e.message : "Không đọc được hồ sơ."));
    api.profile(token).then(setProfile).catch(() => setProfile(null));
    api.employees.myEvents(token).then((r) => setEvents(r.items)).catch(() => setEvents([]));
    api.employees.myAttachments(token)
      .then((r) => setFiles({ tt: "ok", du: r.items }))
      .catch(() => setFiles({ tt: "loi" }));
  }, [token]);
  useEffect(() => { load(); }, [load]);
  // Danh sách đề nghị tải RIÊNG: đổi pill lọc hay lật trang chỉ gọi lại đúng nó, không kéo theo
  // hồ sơ · giấy tờ · quá trình công tác chạy lại cả loạt.
  useEffect(() => { loadReqs(); }, [loadReqs]);
  const setLocReq = (t: LocManDeNghi) => { setLocReqGoc(t); setReqPage(1); };
  const dangLocReq = khoaReq !== JSON.stringify({ status: [], loc: {} });

  // --- 3 nguồn số liệu "của tôi" (chỉ nhánh nhân viên) ---------------------
  const napPhep = useCallback(() => {
    if (!token) return;
    setPhep(DANG_TAI);
    api.leaves.me(token, { size: 1 })
      .then((r) => {
        const qs: LeaveQuota[] = (r.quotas ?? []).filter((q) => q.annual_quota > 0);
        if (!r.has_employee || qs.length === 0) { setPhep({ tt: "rong", vi_sao: "Chưa khai quỹ phép năm" }); return; }
        // Loại phép chính = hạn mức lớn nhất (phép năm); các loại còn lại gộp thành "+N loại khác".
        const chinh = qs.reduce((a, b) => (b.annual_quota > a.annual_quota ? b : a));
        setPhep({ tt: "ok", du: { con_lai: chinh.remaining, da_dung: chinh.used, han_muc: chinh.annual_quota, ten: chinh.name, them: qs.length - 1 } });
      })
      // 403 (vai không có quyền đọc nghỉ phép) cũng rơi vào đây — coi như chưa có số, không dọa lỗi.
      .catch((e) => setPhep(e instanceof ApiError && e.status === 403
        ? { tt: "rong", vi_sao: "Bạn không xem được mục nghỉ phép" } : { tt: "loi" }));
  }, [token]);

  const napCong = useCallback((employeeId: number) => {
    if (!token) return;
    setCong(DANG_TAI);
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth() + 1;
    api.attendance.myTimesheet(token, y, m)
      .then((r) => {
        // `rows` có thể chứa nhiều người (tổ trưởng có scope) — phải tìm ĐÚNG dòng của mình,
        // không lấy rows[0]. `standard_cong` nằm ở cấp bảng, không ở dòng.
        const row = r.rows.find((x) => x.employee_id === employeeId);
        if (!row) { setCong({ tt: "rong", vi_sao: "Chưa có dữ liệu công tháng này" }); return; }
        setCong({ tt: "ok", du: { cong: row.total_cong ?? 0, chuan: r.standard_cong ?? null, ngay: row.total_days, thang: m } });
      })
      .catch(() => setCong({ tt: "loi" }));
  }, [token]);

  const napLuong = useCallback(() => {
    if (!token) return;
    setLuong(DANG_TAI);
    api.luong.myPayslip(token)
      .then((r) => {
        if (!r.has_employee || !r.line || !r.period) {
          // Nói ĐÚNG lý do thay vì gộp mọi thứ vào "Chưa có kỳ lương nào" — chốt xong mà chưa
          // phát thì thợ đọc câu cũ là tưởng bị sót lương rồi đi hỏi HCNS (tháng nào cũng lặp).
          const cp = r.cho_phat;
          const ky = cp ? `tháng ${String(cp.month).padStart(2, "0")}/${cp.year}` : "";
          setLuong({ tt: "rong", vi_sao: !cp ? "Chưa có kỳ lương nào"
            : cp.tinh_trang === "hen_gio" ? `Phiếu ${ky} sắp được phát`
            : cp.tinh_trang === "da_dong" ? `Phiếu ${ky} đã hết hạn xem`
            : `Phiếu ${ky} chưa được phát` });
          return;
        }
        setLuong({ tt: "ok", du: { ky: r.period, dong: r.line } });
      })
      .catch((e) => setLuong(e instanceof ApiError && e.status === 403
        ? { tt: "rong", vi_sao: "Bạn không xem được phiếu lương" } : { tt: "loi" }));
  }, [token]);

  useEffect(() => {
    if (!emp) return;
    napPhep();
    napCong(emp.id);
    napLuong();
  }, [emp, napPhep, napCong, napLuong]);

  // Công bố / thu hồi phiếu tới thì thẻ "Phiếu lương gần nhất" tự đổi, không chờ mở lại màn. HCNS
  // duyệt / từ chối đề nghị thì khối Đề nghị cập nhật cũng tự đổi (L-VAI-21).
  useEffect(() => {
    if (emp && eventTick) { napLuong(); loadReqs(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventTick]);

  const tl: TimelineEntry[] = events.map((ev) => {
    const tone: TimelineEntry["tone"] | undefined =
      ev.event_type === "hired" ? "rust"
      : ["confirmed", "promoted", "leave_end", "unsuspended", "reinstated"].includes(ev.event_type) ? "moss"
      : ev.event_type === "transferred" ? "steel"
      : ["resigned", "suspended", "leave_start"].includes(ev.event_type) ? "signal" : undefined;
    return {
      // Mốc đổi bậc tay nghề cũ (bậc gỡ 17/09/2026) — đừng để hiện thành "Đổi chức danh".
      title: ev.event_type === "promoted" && ev.field === "job_grade"
        ? "Đổi bậc tay nghề (đã gỡ)"
        : (EVENT_LABEL[ev.event_type] ?? ev.event_type),
      meta: [fmtDate(ev.effective_date), ev.note || null].filter(Boolean).join(" · "),
      accent: tone === "moss" || tone === "rust", tone,
    };
  });

  const dsReq = reqs.tt === "ok" ? reqs.du : [];
  const soCho = reqDem.pending ?? 0;
  /** Bỏ lọc · trang 1 rồi tải lại — dùng sau khi GỬI đề nghị mới: đang lọc "Từ chối" trang 3 thì
   *  cái vừa gửi nằm ngoài tầm mắt, người ta tưởng bấm hụt. */
  const veDauDsReq = useCallback(() => {
    if (dangLocReq) setLocReqGoc(LOC_DE_NGHI_TRONG);
    if (reqPage !== 1) setReqPage(1);
    if (!dangLocReq && reqPage === 1) loadReqs();
  }, [dangLocReq, setLocReqGoc, reqPage, loadReqs]);
  // Ô còn trống — tách hai nhóm vì hai nhóm dẫn tới HAI việc khác nhau: tự điền vs gửi đề nghị.
  const thieu = useMemo(() => oThieu(emp), [emp]);

  const cuonToiReq = useCallback(() => {
    reqRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setNhayReq(true);
    setTimeout(() => setNhayReq(false), 1800);
  }, []);

  async function xacNhanHuy() {
    if (!huyReq || !token) return;
    setHuyBusy(true); setHuyErr(null);
    try {
      await api.employees.cancelMyRequest(token, huyReq.id);
      // Đóng luôn popup: dòng đang xem vừa đổi trạng thái, để nguyên là hiện dữ liệu đã cũ.
      setHuyReq(null); setXemReq(null); setHuyBusy(false);
      loadReqs();
    } catch (e) { setHuyErr(messageFor(e)); setHuyBusy(false); }
  }

  if (hasEmp === null && loiHoSo) {
    return (
      <main className="ns">
        <EmptyState trangThai="loi" loi={loiHoSo} onThuLai={load} />
      </main>
    );
  }
  if (hasEmp === null) return <main className="ns"><EmptyState trangThai="dang-tai" /></main>;

  // Nút ✎ overlay trên avatar → mở AvatarModal (dùng chung 2 nhánh).
  const avatarEditBtn = (
    <button type="button" className="mine__avatar-edit" aria-label="Đổi ảnh đại diện" onClick={() => setAvatarOpen(true)}>
      <Icon name="pencil" size={15} />
    </button>
  );
  // Các modal self-service (mount cuối mỗi nhánh). AvatarModal cập nhật KÉP (topbar + hero) qua updateUser+load.
  const accountModals = (
    <>
      {avatarOpen && <AvatarModal onClose={() => setAvatarOpen(false)} onSaved={() => { setAvatarOpen(false); load(); }} />}
      {pwOpen && <PasswordModal onClose={() => setPwOpen(false)} />}
      {nameOpen && <NameModal onClose={() => setNameOpen(false)} onSaved={() => { setNameOpen(false); load(); }} />}
    </>
  );
  // Khối "Tài khoản & bảo mật" — DÙNG CHUNG hai nhánh (trước đây nhánh NV chỉ có dòng
  // "Mật khẩu ••••••••" không mang thông tin gì, còn thông tin tài khoản thật thì chỉ nhánh admin có).
  const accountCard = (
    <div className="mine__card mine__wide">
      <div className="mine__reqhead">
        <h4 className="ns-info-card__title" style={{ border: 0, margin: 0, padding: 0 }}>
          <Icon name="shield" size={14} /> Tài khoản &amp; bảo mật
        </h4>
        <Button variant="ghost" onClick={() => setPwOpen(true)}>Đổi mật khẩu</Button>
      </div>
      <div className="mine__acct-grid">
        <Row k="Tên đăng nhập" v={profile?.username} />
        <Row k="Vai trò" v={profile?.role_name} rong="Chưa gán" />
        <Row k="Phòng ban" v={profile?.department_name} rong="Chưa gán" />
        <Row k="Ngày tạo tài khoản" v={profile ? fmtDateTime(profile.created_at) : null} />
      </div>
      <p className="cc-note mine__acct-note">
        Mật khẩu không hiển thị được. Đổi ngay nếu bạn nghi có người khác biết.
      </p>
    </div>
  );

  // === NHÁNH ADMIN / TÀI KHOẢN CHƯA GẮN HỒ SƠ: self-service tài khoản ===
  if (!hasEmp || !emp) {
    const display = user?.name?.trim() || user?.username || "—";
    const avatarSrc = assetUrl(user?.avatar_url);
    const initials = display.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
    return (
      <main className="ns mine">
        <div className="mine__hero">
          <div className="mine__avatar-wrap">
            <div className="ns-avatar ns-avatar--xl">{avatarSrc ? <img src={avatarSrc} alt="" /> : initials}</div>
            {avatarEditBtn}
          </div>
          <div className="mine__heroid">
            <h1>
              {display}
              <button type="button" className="mine__name-edit" aria-label="Đổi tên hiển thị" onClick={() => setNameOpen(true)}>
                <Icon name="pencil" size={14} />
              </button>
            </h1>
            <p className="mine__herosub">{user?.username ?? ""}</p>
          </div>
        </div>

        {accountCard}
        {accountModals}
      </main>
    );
  }

  // === NHÁNH NHÂN VIÊN: hồ sơ của tôi ===
  const tn = thamNien(emp.prior_seniority_months, emp.hire_date);
  // Ngày hết thử việc nằm ở ô "Vào làm" ngay dưới — badge chỉ nói trạng thái.
  const badgeTrangThai = STATUS_LABEL[emp.status] ?? emp.status;

  // Mỗi trạng thái một sắc (nền tối của hero): Đã nghỉ mới là xám.
  const HERO_SAC: Record<string, string> = {
    active: "ok", probation: "warn", probation_ended: "due", on_leave: "tim", suspended: "danger",
  };
  const statusBadgeClass = `mine__hero-badge--${HERO_SAC[emp.status] ?? "muted"}`;
  const statusDotClass = emp.status === "active" ? "mine__status-dot--active"
    : emp.status === "probation" ? "mine__status-dot--probation" : "";

  return (
    <main className="ns mine">
      <div className="mine__hero">
        <div className="mine__avatar-wrap">
          <div className="ns-avatar ns-avatar--xl">
            {assetUrl(emp.photo_url) ? <img src={assetUrl(emp.photo_url)!} alt="" /> : emp.full_name.slice(0, 1)}
          </div>
          {statusDotClass && <span className={`mine__status-dot ${statusDotClass}`} title={STATUS_LABEL[emp.status]} />}
          {avatarEditBtn}
        </div>
        <div className="mine__heroid">
          <h1>
            {emp.full_name}
            {/* Họ tên do HCNS quản: ✎ mở thẳng form đề nghị, chú thích nói rõ vì sao không sửa tại chỗ. */}
            {tuPhucVuGhi && (
              <button
                type="button" className="mine__name-edit mine__name-req"
                aria-label="Họ tên do HCNS quản lý — bấm để gửi đề nghị sửa"
                onClick={() => setRequesting(true)}
              >
                <Icon name="pencil" size={14} />
                <span className="mine__tip" aria-hidden="true">Họ tên do HCNS quản lý — bấm để gửi đề nghị sửa</span>
              </button>
            )}
            <span className={`mine__hero-badge ${statusBadgeClass}`}>
              {badgeTrangThai}
            </span>
          </h1>
          {emp.position && emp.position !== emp.department_name && (
            <p className="mine__herotitle">{emp.position}</p>
          )}
          <div className="mine__herotags">
            {emp.department_name && (
              <span className="mine__herotag"><Icon name="building" size={13} />{emp.department_name}</span>
            )}
            <span className="mine__herotag" title="Mã nhân viên"><Icon name="clipboard" size={13} />{emp.code}</span>
            {/* Nút đứng cùng hàng thẻ, dạt mép phải; điện thoại thì xuống dòng thành nút rộng. */}
            {coChamCong && navigate && (
              <Button variant="accent" className="mine__chamcong" onClick={() => navigate("cham-cong")}>
                <Icon name="clock" size={16} />
                Chấm công
              </Button>
            )}
          </div>
          <div className="mine__facts">
            <div className="mine__fact">
              <Icon name="calendar" size={16} />
              <div>
                <p className="mine__lab">Vào làm</p>
                <p className="mine__val">{emp.hire_date ? fmtDate(emp.hire_date) : "Chưa khai"}</p>
                {emp.status === "probation" && emp.probation_end_date ? (
                  <p className="mine__sub mine__sub--warn">Hết thử việc {fmtDate(emp.probation_end_date)}</p>
                ) : tn ? (
                  <p className="mine__sub">Thâm niên {tn}</p>
                ) : null}
              </div>
            </div>
            <div className="mine__fact">
              <Icon name="clock" size={16} />
              <div>
                <p className="mine__lab">Ca làm việc</p>
                <p className="mine__val">{emp.current_shift_name ?? "Chưa gán"}</p>
                {emp.current_shift_hours && <p className="mine__sub">{emp.current_shift_hours}</p>}
                {/* Lưới phân ca đổi riêng hôm nay — không nói thì người ta đi làm theo ca nền. */}
                {emp.today_shift_off ? (
                  <p className="mine__sub mine__sub--warn">Hôm nay: nghỉ theo lịch</p>
                ) : emp.today_shift_name ? (
                  <p className="mine__sub mine__sub--warn">
                    Hôm nay: {emp.today_shift_name}{emp.today_shift_hours ? ` ${emp.today_shift_hours}` : ""}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="mine__fact">
              <Icon name="shield" size={16} />
              <div>
                <p className="mine__lab">Tài khoản</p>
                <p className="mine__val">{emp.account_username ?? profile?.username ?? "—"}</p>
                {profile?.role_name && <p className="mine__sub">Vai trò {profile.role_name}</p>}
              </div>
            </div>
          </div>
        </div>
        <aside className="mine__heroside">
          <div>
            <p className="mine__lab">Quản lý trực tiếp</p>
            {emp.department_head_name ? (
              <div className="mine__mgr">
                <span className="mine__mgr-av">
                  {assetUrl(emp.department_head_avatar_url)
                    ? <img src={assetUrl(emp.department_head_avatar_url)!} alt="" />
                    : vietTat(emp.department_head_name)}
                </span>
                <div>
                  <p className="mine__val">{emp.department_head_name}</p>
                  <p className="mine__sub">Đứng đầu {emp.department_head_dept_name}</p>
                  {emp.department_head_inherited && emp.department_name && (
                    <p className="mine__sub mine__sub--muted">{emp.department_name} chưa chỉ định người đứng đầu</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="mine__sub">Chưa có người đứng đầu ở phòng bạn và các phòng cấp trên</p>
            )}
          </div>
          <div>
            <p className="mine__lab">Liên hệ</p>
            <p className="mine__ct"><Icon name="phone" size={15} />
              {emp.phone ? fmtSdt(emp.phone) : <ThemLienHe onClick={tuPhucVuGhi ? () => setEditing(true) : undefined}>Chưa có SĐT</ThemLienHe>}
            </p>
            <p className="mine__ct"><Icon name="mail" size={15} />
              {emp.email ?? <ThemLienHe onClick={tuPhucVuGhi ? () => setEditing(true) : undefined}>Chưa có email</ThemLienHe>}
            </p>
          </div>
        </aside>
      </div>

      {/* Số liệu "của tôi" — kéo từ 3 màn nguồn về đây, bấm là sang đúng màn đó. */}
      <section className="mine__stats" aria-label="Số liệu của tôi">
        <StatChip
          nhan="Phép năm còn lại" icon="calendar" tt={phep}
          giaTri={(d) => ({ so: fmtSo(d.con_lai), donVi: "ngày" })}
          phu={(d) => `Đã dùng ${fmtSo(d.da_dung)}/${fmtSo(d.han_muc)} ngày${d.them > 0 ? ` · +${d.them} loại khác` : ""}`}
          tone={(d) => (d.con_lai >= 3 ? "ok" : d.con_lai >= 0.5 ? "warn" : "low")}
          doc={(d) => `Phép năm còn lại ${d.con_lai} ngày, đã dùng ${d.da_dung} trên ${d.han_muc}. Mở màn Nghỉ phép.`}
          onGo={() => navigate?.("nghi-phep")} onThuLai={napPhep} moTaGo="Mở màn Nghỉ phép"
        />
        <StatChip
          nhan={`Công tháng ${new Date().getMonth() + 1}`} icon="clock" tt={cong}
          giaTri={(d) => ({ so: fmtSo(d.cong), donVi: "công" })}
          phu={(d) => `${d.chuan != null ? `Chuẩn ${fmtSo(d.chuan)} công · ` : ""}${fmtSo(d.ngay)} ngày có mặt`}
          tone={() => "info"}
          doc={(d) => `Công tháng ${d.thang}: ${d.cong} công, ${d.ngay} ngày có mặt. Mở màn Chấm công.`}
          onGo={() => navigate?.("cham-cong")} onThuLai={() => napCong(emp.id)} moTaGo="Mở màn Chấm công"
        />
        <StatChip
          nhan="Phiếu lương gần nhất" icon="calculator" tt={luong}
          giaTri={(d) => ({ so: `${fmtSo(Math.round(d.dong.net_pay))} đ`, donVi: null, tien: true })}
          phu={(d) => `Kỳ ${d.ky.month}/${d.ky.year}${d.ky.status === "paid" ? " đã chi" : d.ky.status === "draft" ? " đang tính" : ""}`}
          tone={() => "money"}
          doc={(d) => `Phiếu lương kỳ ${d.ky.month} năm ${d.ky.year}, thực nhận ${Math.round(d.dong.net_pay)} đồng. Mở màn Lương.`}
          onGo={() => navigate?.("luong")} onThuLai={napLuong} moTaGo="Mở màn Lương"
        />
        {/* Số ở đây đọc `reqDem` (máy chủ đếm trên TOÀN BỘ), không đếm từ trang đang xem. "Gửi gần
            nhất" đã bỏ: với danh sách cắt trang thì không còn biết chắc, in ra là bịa. */}
        <StatChip
          nhan="Đề nghị chờ duyệt" icon="send"
          tt={reqs.tt === "ok" ? { tt: "ok", du: dsReq } : reqs.tt === "loi" ? { tt: "loi" } : DANG_TAI}
          giaTri={() => ({ so: fmtSo(soCho), donVi: "đề nghị" })}
          phu={() => (soCho > 0 ? "Đang chờ HCNS xử lý" : "Không có đề nghị nào đang chờ")}
          tone={() => (soCho > 0 ? "warn" : "none")}
          doc={() => `${soCho} đề nghị đang chờ duyệt. Xem khối Đề nghị cập nhật.`}
          onGo={cuonToiReq} onThuLai={loadReqs} moTaGo="Xem khối Đề nghị cập nhật"
        />
      </section>

      {(thieu.tu.length > 0 || thieu.hcns.length > 0) && (() => {
        const totalFields = 15;
        const missingCount = thieu.tu.length + thieu.hcns.length;
        const pct = Math.max(0, Math.round(((totalFields - missingCount) / totalFields) * 100));
        return (
          <div className="mine__nudge">
            <div className="mine__nudge-left">
              <div className="mine__nudge-icon"><Icon name="shield" size={18} /></div>
              <div className="mine__nudge-text">
                <div className="mine__nudge-head">
                  <span className="mine__nudge-title">Hoàn thiện hồ sơ</span>
                  <span className="mine__nudge-badge">{pct}% đã hoàn thành</span>
                </div>
                <div className="mine__nudge-bar-wrap">
                  <div className="mine__nudge-bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="mine__nudge-sub">
                  Còn {missingCount} mục chưa khai
                  {thieu.tu.length > 0 ? ` (${thieu.tu.length} mục bạn tự sửa` : ""}
                  {thieu.hcns.length > 0 ? `${thieu.tu.length > 0 ? " · " : " ("}${thieu.hcns.length} mục do HCNS)` : ")"}
                </span>
              </div>
            </div>
            <div className="mine__nudge__acts">
              {thieu.tu.length > 0 && tuPhucVuGhi && (
                <button type="button" className="mine__nudge-btn-main" onClick={() => setEditing(true)}>
                  Điền {thieu.tu.length} mục bạn tự sửa
                </button>
              )}
              {thieu.hcns.length > 0 && (
                <button type="button" className="mine__nudge-btn-sub" onClick={() => setRequesting(true)}>
                  Đề nghị HCNS bổ sung {thieu.hcns.length} mục
                </button>
              )}
            </div>
          </div>
        );
      })()}

      <div className="mine__cards">
        <div className="mine__card">
          <div className="mine__reqhead">
            <h4 className="ns-info-card__title mine__cardtitle">
              <span className="mine__card-icon"><Icon name="users" size={14} /></span>
              Thông tin liên hệ
              <span className="mine__ownchip">Bạn tự sửa</span>
            </h4>
            {tuPhucVuGhi && (
              <button className="btn btn--ghost" onClick={() => setEditing(true)}>Sửa</button>
            )}
          </div>
          <Row k="SĐT" v={emp.phone ? fmtSdt(emp.phone) : null} />
          <Row k="Email" v={emp.email} />
          <Row k="Chỗ ở hiện tại" v={emp.current_address} />
          <Row k="Liên hệ khẩn (tên)" v={emp.emergency_contact_name} />
          <Row k="Liên hệ khẩn (SĐT)" v={emp.emergency_contact_phone ? fmtSdt(emp.emergency_contact_phone) : null} />
          {tuPhucVuGhi && (
            <button className="btn btn--ghost mine__editbtn" onClick={() => setEditing(true)}>Sửa</button>
          )}
        </div>

        <div className="mine__card">
          <h4 className="ns-info-card__title mine__cardtitle">
            <span className="mine__card-icon"><Icon name="fileCheck" size={14} /></span>
            Cá nhân
            <LockChip onClick={() => setRequesting(true)} />
          </h4>
          <Row k="Ngày sinh" v={emp.date_of_birth ? fmtDate(emp.date_of_birth) : null} />
          <Row k="Giới tính" v={emp.gender ? GENDER_LABEL[emp.gender] : null} />
          <Row k="CCCD" v={emp.national_id} />
          {/* Ngày/nơi cấp chỉ có nghĩa khi đã có số CCCD — chưa có số thì hai dòng này là nhiễu. */}
          {emp.national_id && <Row k="Ngày cấp CCCD" v={emp.national_id_date ? fmtDate(emp.national_id_date) : null} />}
          {emp.national_id && <Row k="Nơi cấp CCCD" v={emp.national_id_place} />}
          <Row k="Hộ khẩu" v={emp.permanent_address} />
        </div>

        <div className="mine__card">
          <h4 className="ns-info-card__title mine__cardtitle">
            <span className="mine__card-icon"><Icon name="calculator" size={14} /></span>
            Ngân hàng · Thuế · BHXH
            <LockChip onClick={() => setRequesting(true)} />
          </h4>
          <Row k="Số tài khoản" v={emp.bank_account} />
          <Row k="Ngân hàng" v={emp.bank_name} />
          <Row k="Số sổ BHXH" v={emp.social_insurance_no} />
          <Row k="MST cá nhân" v={emp.pit_tax_code} />
          {/* pit_mode = null nghĩa là BỊ CHE theo quyền, KHÔNG phải "chưa khai" → ẩn hẳn dòng,
              in "Chưa khai" ở đây là nói sai sự thật. */}
          {emp.pit_mode && <Row k="Cách tính thuế TNCN" v={PIT_MODE_LABEL[emp.pit_mode] ?? emp.pit_mode} />}
          <Row k="Người phụ thuộc" v={String(emp.dependents_count)} />
        </div>

        <div className="mine__card">
          <h4 className="ns-info-card__title mine__cardtitle">
            <span className="mine__card-icon"><Icon name="clipboard" size={14} /></span>
            Công việc
          </h4>
          <Row
            k="Ca hiện tại"
            v={emp.current_shift_name
              ? `${emp.current_shift_name}${emp.current_shift_hours ? ` (${emp.current_shift_hours})` : ""}`
              : null}
            hint="Ca do HCNS gán ở màn Chấm công"
          />
          {emp.department_head_name && <Row k="Quản lý trực tiếp" v={emp.department_head_name} />}
          {emp.status === "probation" && (
            <Row k="Hết thử việc" v={emp.probation_end_date ? fmtDate(emp.probation_end_date) : null} />
          )}
        </div>
      </div>

      {accountCard}

      <div
        className={`mine__card mine__wide${nhayReq ? " mine__flash" : ""}`}
        id="mine-requests"
        ref={reqRef}
      >
        <div className="mine__reqhead">
          <h4 className="ns-info-card__title mine__cardtitle">
            <span className="mine__card-icon"><Icon name="send" size={14} /></span>
            Đề nghị cập nhật hồ sơ
          </h4>
          {tuPhucVuGhi && (
            <Button variant="accent" onClick={() => setRequesting(true)}>
              <Icon name="send" size={13} /> Gửi đề nghị
            </Button>
          )}
        </div>
        <div className="mine__req-notice">
          <Icon name="help" size={14} className="mine__req-notice-icon" />
          <span>Các mục do HCNS quản lý (tên, CCCD, hộ khẩu, số tài khoản…) bạn gửi đề nghị sửa để HCNS xét duyệt.</span>
        </div>

        {/* Thanh lọc chung: kỳ theo Ngày tạo + Trạng thái (số đếm máy chủ theo kỳ đang xem). */}
        <div className="mine__reqfilter tl-thanh">
          <ThanhLoc
            ky={locReq.ky}
            moc={MOC_DE_NGHI}
            onKy={(ky) => setLocReq({ ...locReq, ky })}
            dieuKien={dieuKienDeNghi(reqDemKy)}
            loc={locReq.loc}
            onLoc={(loc) => setLocReq({ ...locReq, loc })}
          />
        </div>

        <div className="ns__tablewrap mine__reqtable">
          <table className="ns__table">
            <thead>
              <tr>
                <th className="mine__reqcol-date">Ngày tạo</th>
                <th className="mine__reqcol-st">Trạng thái</th>
                <th>Nội dung đề nghị</th>
                <th className="mine__reqcol-who">Người xử lý</th>
                <th className="mine__reqcol-act"><span className="mine__vh">Thao tác</span></th>
              </tr>
            </thead>
            <tbody>
              {reqs.tt === "dang-tai" ? (
                Array.from({ length: 3 }, (_, i) => (
                  <tr key={`skel-${i}`}>
                    <td colSpan={5}><span className="mine__skel mine__skel--dong" /></td>
                  </tr>
                ))
              ) : reqs.tt === "loi" ? (
                <EmptyRow colSpan={5} trangThai="loi" onThuLai={loadReqs} />
              ) : dsReq.length === 0 && dangLocReq ? (
                <EmptyRow
                  colSpan={5} icon="search"
                  title="Không có đề nghị nào khớp bộ lọc."
                  action={<Button variant="ghost" onClick={() => setLocReq(LOC_DE_NGHI_TRONG)}>Xem tất cả</Button>}
                />
              ) : dsReq.length === 0 ? (
                <EmptyRow
                  colSpan={5} icon="send" title="Chưa gửi đề nghị nào."
                  sub="Các mục do HCNS quản lý (CCCD, hộ khẩu, số tài khoản…) sửa qua đề nghị."
                  action={<Button variant="ghost" onClick={() => setRequesting(true)}>Gửi đề nghị đầu tiên</Button>}
                />
              ) : (
                dsReq.map((r) => (
                  <ReqRow
                    key={r.id} req={r}
                    onXem={() => setXemReq(r)}
                    onHuy={() => { setHuyErr(null); setHuyReq(r); }}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
        {reqs.tt === "ok" && reqTotal > 0 && (
          <PhanTrangDayDu
            trang={reqPage} size={reqSize} tong={reqTotal} soDong={dsReq.length}
            onTrang={setReqPage}
            onSize={(n) => { setReqSize(n); setReqPage(1); }}
            donVi="đề nghị" ariaLabel="Phân trang đề nghị của tôi"
          />
        )}
      </div>

      <div className="mine__card mine__wide">
        <h4 className="ns-info-card__title mine__cardtitle">
          <Icon name="fileText" size={14} /> Giấy tờ của tôi
        </h4>
        {files.tt !== "ok" ? (
          <EmptyState trangThai={files.tt === "loi" ? "loi" : "dang-tai"} inline onThuLai={load} />
        ) : files.du.length === 0 ? (
          <EmptyState
            inline icon="fileText" title="Chưa có giấy tờ nào."
            sub="Hợp đồng, CCCD, bằng cấp do HCNS tải lên hồ sơ của bạn."
          />
        ) : (
          <ul className="ns-filelist-v2">
            {files.du.map((a) => (
              <li key={a.id} className="ns-fileitem">
                <span className={`ns-fileitem__icon ns-fileitem__icon--${kieuFile(a.file_name)}`}>
                  <Icon name="fileText" size={16} />
                </span>
                <span className="ns-fileitem__main">
                  <span className="ns-fileitem__name-group">
                    <a className="ns-fileitem__name" href={assetUrl(a.file_url) ?? "#"} target="_blank" rel="noreferrer">
                      {a.file_name}
                    </a>
                    <span className="ns-fileitem__badge">{DOC_KIND_LABEL[a.doc_kind] ?? a.doc_kind}</span>
                  </span>
                  <span className="ns-fileitem__sub">Tải lên {fmtDate(a.uploaded_at)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mine__card mine__wide">
        <h4 className="ns-info-card__title mine__cardtitle">
          <Icon name="activity" size={14} /> Quá trình công tác
        </h4>
        <Timeline items={tl} emptyText="Chưa có mốc quá trình công tác." />
      </div>

      {editing && <ContactModal token={token!} emp={emp} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />}
      {requesting && <RequestModal token={token!} emp={emp} onClose={() => setRequesting(false)} onSaved={() => { setRequesting(false); veDauDsReq(); }} />}
      {xemReq && (
        <ReqDetailModal req={xemReq} emp={emp} onClose={() => setXemReq(null)}
                        onHuy={() => { setHuyErr(null); setHuyReq(xemReq); }} />
      )}
      <ConfirmDialog
        open={huyReq !== null}
        title="Hủy đề nghị này?"
        message="Đề nghị sẽ được rút lại, HCNS không xử lý nữa. Bạn có thể gửi lại bất cứ lúc nào."
        confirmLabel="Hủy đề nghị" cancelLabel="Giữ lại" danger
        busy={huyBusy} error={huyErr}
        onConfirm={xacNhanHuy} onCancel={() => { setHuyReq(null); setHuyErr(null); }}
      />
      {accountModals}
    </main>
  );
}

/** "Bùi Thị Hoa" → "BH" (chữ đầu của từ đầu + từ cuối) cho ô ảnh người quản lý chưa có ảnh. */
function vietTat(ten: string): string {
  const w = ten.trim().split(/\s+/);
  return ((w[0]?.[0] ?? "") + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase();
}

/** Ô liên hệ còn trống ở hero: có quyền tự sửa thì bấm mở thẳng form liên hệ, không thì chỉ nói thiếu. */
function ThemLienHe({ children, onClick }: { children: string; onClick?: () => void }) {
  if (!onClick) return <span className="mine__ct-thieu">{children}</span>;
  return (
    <button type="button" className="mine__ct-them" onClick={onClick}>
      {children} — thêm
    </button>
  );
}
