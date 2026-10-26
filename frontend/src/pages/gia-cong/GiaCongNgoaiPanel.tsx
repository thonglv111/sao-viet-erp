// Khối "Gia công ngoài" trên hồ sơ lệnh (spec 2026-09-26 §7). MỘT cửa ghi duy nhất của lần gia
// công: Đã mang đi · Chốt số · Mở lại · Chọn giấy (đề nghị xuất giấy) · Huỷ trọn gói. Bàn tổ /
// Xếp lịch / KCS chỉ nhìn. Tự nạp lại theo tick SSE — khối không có ô nhập dở dang nào ngoài
// mini-form đang mở, mà state của mini-form nằm riêng, nạp lại không xoá nó.
//
// Bố cục (07/10/2026, phương án B của mockup gia-cong-ngoai-gon-3-phuong-an, khối Details của
// Stripe): đầu thẻ (việc + chip trạng thái + dãy chấm mốc bên trái, nút bên phải) → danh sách chi
// tiết hai cột, nhãn xám thẳng cột, chữ 13px (nhà gia công, mốc lúc nào/ai, số lượng, giấy, kho,
// chi tiền) → hàng chân Lịch sử + Đã huỷ. Thanh ba đoạn cũ bỏ vì nói trùng chip. Số đặt / số tờ
// xin xuất chỉ hiện khi khác băng KPI của hồ sơ lệnh (`daHien`). Luật:
// mỗi thông tin nói ĐÚNG MỘT lần — lượt đầu lặp "trọn gói" 3 lần, "5.000 cái" 3 lần, mốc vẽ bằng
// chấm + đường kẻ tuyệt đối nên đè chữ, ô thông tin đóng hộp cao thấp lệch nhau.
//
// Nguồn lệnh HOẶC bài ghép (spec 2026-09-27 §4): lần của bước CHUNG bài ghép thao tác ở màn bài
// ghép; màn từng lệnh thành viên chỉ hiện một dòng chỉ đọc bấm sang bài ghép.
import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  api,
  type GiaCongCapGiay,
  type GiaCongNgoaiLan,
  type GiaCongNoiVe,
} from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import { useCan } from "../../auth/permissions";
import { ChungTuKhoNoi, type ChungTuKho } from "./ChungTuKhoNoi";
import { Button } from "../../components/Button";
import { ChonNgay } from "../../components/ChonNgay";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Icon } from "../../components/Icons";
import { nhanDonVi } from "../lsxBuoc";
import { useNapTenDonVi } from "../tenDonVi";
import { OGoDinhDang } from "../../components/OGoDinhDang";
import {
  NHAN_NOI_VE, NHAN_TRANG_THAI, NHAN_XUAT_GIAY, chonGiayBanDau, chuanSoGo, goiYChot, hienSoGo,
  mocCuaLan, nhanKhoCap, nutCuaLan, soNhanChia, thieuTo,
} from "./giaCong";
import "./giaCong.css";

/** `nhan` = ngày khách nhận (yyyy-mm-dd) khi nhà gia công giao thẳng — theo biên bản gửi về. */
type FormChot = { sl: string; noiVe: GiaCongNoiVe | null; dich: number | null; nhan: string };
/** Phần "Chọn giấy" đang mở: khổ chọn (`"rộngxdài"`) + số tờ gõ. */
type FormGiay = { kho: string | null; so: string };

/** "2026-10-06" theo giờ VN — giá trị của ô ngày. */
function ngayIsoVn(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
}

const so = (n: number) => n.toLocaleString("vi-VN");
/** "11:11 06/10" — năm chỉ hiện khi khác năm nay. */
function gio(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const cungNam = d.getFullYear() === new Date().getFullYear();
  const hm = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  const nt = d.toLocaleDateString("vi-VN", cungNam
    ? { day: "2-digit", month: "2-digit" }
    : { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${hm} ${nt}`;
}

export function GiaCongNgoaiPanel({
  lsxId,
  baiGhepId,
  eventTick = 0,
  canUpdate,
  onChanged,
  onMoBaiGhep,
  onLans,
  lansDau,
  lansDauTick,
  daHien,
}: {
  /** Đúng MỘT trong hai: khối trên hồ sơ lệnh, hoặc khối trên màn bài ghép. */
  lsxId?: number;
  baiGhepId?: number;
  eventTick?: number;
  canUpdate: boolean;
  /** Lệnh đổi trạng thái (huỷ trọn gói về Nháp, chốt về kho làm nhóm đóng…) — màn cha nạp lại. */
  onChanged: () => void;
  /** Dòng chỉ đọc (lần của bài ghép trên màn lệnh) bấm sang màn bài ghép. */
  onMoBaiGhep?: (baiGhepId: number) => void;
  /** Báo màn cha danh sách lần mỗi lần nạp — hồ sơ lệnh dùng để biết lệnh đang trọn gói. */
  onLans?: (lans: GiaCongNgoaiLan[]) => void;
  /** Danh sách lần màn cha đã nạp SONG SONG với chính nó (hồ sơ lệnh) cùng tick SSE lúc nạp —
   *  khối vẽ ngay từ đó, không gọi lại tới khi có tick mới. */
  lansDau?: GiaCongNgoaiLan[];
  lansDauTick?: number;
  /** Số băng KPI của hồ sơ lệnh ĐÃ in (SL đặt, giấy nguyên). Khối chỉ nói lại số đặt / số tờ xin
   *  xuất khi chúng KHÁC con số ở băng trên — mỗi thông tin nói một lần. */
  daHien?: { slDat?: number | null; toNguyen?: number | null };
}) {
  const { token } = useAuth();
  const [lans, setLans] = useState<GiaCongNgoaiLan[] | null>(lansDau ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [chot, setChot] = useState<Record<number, FormChot>>({});
  const [slGui, setSlGui] = useState<Record<number, string>>({});
  const [huy, setHuy] = useState<{ lan: GiaCongNgoaiLan; lyDo: string } | null>(null);
  const [giay, setGiay] = useState<Record<number, FormGiay>>({});
  // Đề nghị xuất giấy / phiếu xuất kho đang mở xem. Máy chủ gate đọc chứng từ bằng ô quyền Kho ⇒
  // không có ô đó thì mã chỉ là chữ, khỏi mở ra ngăn báo lỗi.
  const [chungTu, setChungTu] = useState<ChungTuKho | null>(null);
  const xemKho = useCan()("kho", "read");
  // Mở thẳng màn Bài ghép (chưa màn nào nạp bảng đơn vị) thì `nhanDonVi` in mã trần "2.660 to".
  useNapTenDonVi();

  const load = useCallback(() => {
    if (!token) return;
    const req = baiGhepId != null
      ? api.giaCongNgoai.cuaBaiGhep(token, baiGhepId)
      : lsxId != null ? api.giaCongNgoai.cuaLenh(token, lsxId) : null;
    req
      ?.then((ds) => { setLans(ds); onLans?.(ds); })
      .catch((e: unknown) => setErr(e instanceof ApiError ? e.message : String(e)));
    // `onLans` là callback của màn cha — không đưa vào deps để mỗi lần cha vẽ lại không nạp lại.
  }, [token, lsxId, baiGhepId]);
  useEffect(() => {
    if (lansDau && eventTick === lansDauTick) return;   // màn cha vừa nạp đúng tick này rồi
    load();
    // `lansDau` chỉ là dữ liệu mở màn — không nạp lại khi nó đổi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, eventTick]);

  async function chay(id: number, fn: () => Promise<unknown>) {
    setBusy(id);
    setErr(null);
    try {
      await fn();
      load();
      onChanged();
      return true;
    } catch (e: unknown) {
      setErr(e instanceof ApiError ? e.message : String(e));
      // Lỗi (đặc biệt 409 lệch version) vẫn nạp lại — version hiển thị phải khớp máy chủ, không
      // thì bấm lần nữa lại 409 tiếp dù đã có version mới.
      load();
      return false;
    } finally {
      setBusy(null);
    }
  }

  /** Gửi đề nghị xuất giấy: lần MỚI lấy thẳng từ phản hồi POST thay vào danh sách — không nạp lại
   *  khối, không bắt màn cha nạp lại (lệnh không đổi trạng thái). Tab khác / bảng lệnh tự cập nhật
   *  theo tin SSE `gia_cong_ngoai_changed` máy chủ phát. */
  async function guiGiay(l: GiaCongNgoaiLan, f: FormGiay) {
    if (!token || !f.kho) return;
    const [r, d] = f.kho.split("x").map(Number);
    setBusy(l.id);
    setErr(null);
    try {
      const moi = await api.giaCongNgoai.xuatGiay(token, l.id, {
        version: l.version, kho_rong: r, kho_dai: d, so_to: Number(f.so),
      });
      const ds = (lans ?? []).map((x) => (x.id === moi.id ? { ...moi, chi_xem: x.chi_xem } : x));
      setLans(ds);
      onLans?.(ds);
      setGiay((m) => { const n = { ...m }; delete n[l.id]; return n; });
    } catch (e: unknown) {
      setErr(e instanceof ApiError ? e.message : String(e));
      load();
    } finally {
      setBusy(null);
    }
  }

  if (!lans || lans.length === 0) return err ? <div className="banner banner--error">{err}</div> : null;
  const dvTen = (ma: string | null) => (ma ? nhanDonVi(ma) : "");
  const boChot = (id: number) => setChot((m) => { const n = { ...m }; delete n[id]; return n; });
  // Lần đã huỷ là chuyện đã qua: không bày ngang hàng (và đứng TRÊN) lần đang chạy với đủ thanh
  // tiến độ + lịch sử — gom xuống cuối, mỗi lần một dòng, gập sẵn khi còn lần đang chạy.
  const song = lans.filter((l) => l.trang_thai !== "da_huy");
  const daHuy = lans.filter((l) => l.trang_thai === "da_huy");
  const cuoiSong = song.length > 0 ? song[song.length - 1].id : null;
  const khoiHuy = daHuy.length > 0 ? (
    <details className={`gcn__da-huy${song.length === 0 ? " gcn__da-huy--mot-minh" : ""}`} open={song.length === 0}>
      <summary>Đã huỷ {daHuy.length} lần</summary>
      <ol>
        {daHuy.map((l) => (
          <li key={l.id}>
            <span className="gcn__luc">{gio(l.huy_luc)}</span>
            <span className="gcn__ls-viec">
              <span className="gcn__huy-dong">
                <b>{l.nha_cung_cap_ten}</b>
                <span className="gcn__the">{l.kieu === "tron_goi" ? "Trọn gói" : l.ten_viec}</span>
                {l.sl_dat != null && (
                  <span className="gcn__phu">{so(l.sl_dat)} {dvTen(l.don_vi)}</span>
                )}
              </span>
              <span className="gcn__phu">
                {l.huy_boi_ten ? `${l.huy_boi_ten} huỷ` : "Đã huỷ"}
                {l.ly_do_huy ? ` vì “${l.ly_do_huy}”` : ""}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </details>
  ) : null;

  return (
    <section className="gcn" aria-label="Gia công ngoài">
      {/* Nhãn khối nói MỘT lần ở đầu khối, không lặp trên từng lần. */}
      <h3 className="gcn__ten-khoi">Gia công ngoài</h3>
      {err && <div className="banner banner--error" role="alert">{err}</div>}
      {song.map((l) => {
        if (l.chi_xem && l.bai_ghep_id != null && baiGhepId == null) {
          // Lần của bước chung bài ghép trên màn LỆNH: một dòng chỉ đọc, thao tác ở màn bài ghép.
          return (
            <article key={l.id} className="gcn__lan">
              <header className="gcn__dau">
                <div className="gcn__tieu-de">
                    <div className="gcn__tieu-de-dong">
                    <strong className="gcn__viec">{l.ten_viec}</strong>
                    <span className={`gcn__tt gcn__tt--${l.trang_thai}`}>{NHAN_TRANG_THAI[l.trang_thai]}</span>
                  </div>
                  <span className="gcn__phu-dong">
                    <span className="gcn__the">Bài ghép {l.bai_ghep_ma}</span>
                    <span className="gcn__phu">{l.nha_cung_cap_ten}</span>
                  </span>
                </div>
                {onMoBaiGhep && (
                  <div className="gcn__dau-nut">
                    <Button variant="secondary" onClick={() => onMoBaiGhep(l.bai_ghep_id!)}>
                      Mở bài ghép
                    </Button>
                  </div>
                )}
              </header>
              {l.id === cuoiSong && khoiHuy && <div className="gcn__chan">{khoiHuy}</div>}
            </article>
          );
        }
        const nut = nutCuaLan(l);
        const f = chot[l.id];
        const dangBan = busy === l.id;
        const thaoTac = canUpdate && !l.chi_xem;
        const chia = l.chia_theo_lenh ?? [];
        const tronGoi = l.kieu === "tron_goi";
        const moc = mocCuaLan(l, dvTen);
        const canGoSoMangDi = nut.mangDi && !l.co_buoc_truoc && l.trang_thai === "cho_mang_di";
        const cg = l.cap_giay ?? null;
        const g = giay[l.id];
        const xg = l.xuat_giay;
        return (
          <article key={l.id} className={`gcn__lan gcn__lan--${l.trang_thai}`}>
            {/* Đầu thẻ: việc + chip trạng thái + dãy chấm mốc bên trái, nút bên phải (khối Details của
                Stripe, phương án B 07/10/2026). Lúc nào, ai của từng mốc nằm ở hàng thông tin bên dưới. */}
            <header className="gcn__dau">
              <div className="gcn__tieu-de">
                <div className="gcn__tieu-de-dong">
                  <strong className="gcn__viec">{tronGoi ? "Trọn gói" : l.ten_viec}</strong>
                  <span className={`gcn__tt gcn__tt--${l.trang_thai}`}>{NHAN_TRANG_THAI[l.trang_thai]}</span>
                  <ol className="gcn__moc" aria-label={`Tiến độ: ${moc.map((m) => m.nhan).join(" rồi ")}`}>
                    {moc.map((m) => (
                      <li key={m.nhan} className={`gcn__moc-cham gcn__moc-cham--${m.muc}`} />
                    ))}
                  </ol>
                </div>
                {l.bai_ghep_id != null && (
                  <span className="gcn__phu-dong">
                    <span className="gcn__the">Bài ghép {l.bai_ghep_ma}</span>
                    {(l.lenh ?? []).map((x) => <span key={x.id} className="gcn__the">{x.ma}</span>)}
                  </span>
                )}
              </div>

              {thaoTac && !f && (
                <div className="gcn__dau-nut">
                  {nut.huyTronGoi && (
                    <Button variant="ghost" className="gcn__nut-huy" onClick={() => setHuy({ lan: l, lyDo: "" })}>
                      Huỷ gia công
                    </Button>
                  )}
                  {nut.moLai && (
                    <Button
                      variant="secondary"
                      loading={dangBan}
                      disabled={!!l.ly_do_khong_mo_lai}
                      title={l.ly_do_khong_mo_lai ?? "Mở lại để sửa số đã chốt"}
                      onClick={() => chay(l.id, () => api.giaCongNgoai.moLai(token!, l.id, l.version))}
                    >
                      Mở lại
                    </Button>
                  )}
                  {nut.mangDi && (
                    <>
                      {canGoSoMangDi && (
                        <input
                          className="gcn__o-so"
                          inputMode="decimal"
                          placeholder={`Số mang đi (${dvTen(l.don_vi_gui)})`}
                          aria-label={`Số mang đi (${dvTen(l.don_vi_gui)})`}
                          value={slGui[l.id] ?? ""}
                          onChange={(e) => setSlGui((m) => ({ ...m, [l.id]: e.target.value }))}
                        />
                      )}
                      <Button
                        variant={nut.chot ? "secondary" : "accent"}
                        loading={dangBan}
                        onClick={() => chay(l.id, () => api.giaCongNgoai.mangDi(token!, l.id, {
                          version: l.version,
                          sl_gui: l.co_buoc_truoc ? null : Number(slGui[l.id] || 0) || null,
                        }))}
                      >
                        {l.trang_thai === "dang_o_ngoai" ? "Mang thêm" : "Đã mang đi"}
                      </Button>
                    </>
                  )}
                  {nut.chot && (
                    <Button
                      variant="accent"
                      disabled={!!l.ly_do_khong_nhan_ve}
                      title={l.ly_do_khong_nhan_ve ?? undefined}
                      onClick={() => setChot((m) => ({ ...m, [l.id]: { ...goiYChot(l), nhan: ngayIsoVn() } }))}
                    >
                      Nhận hàng về
                    </Button>
                  )}
                </div>
              )}
            </header>

            {/* Trọn gói xưởng cấp giấy chưa gửi đề nghị xuất: dải hổ phách nói việc còn treo + nút mở
                phần chọn giấy NGAY TẠI CHỖ (mockup tron-goi-cap-giay-C, phương án C1). Dữ liệu chọn
                (khổ trong kho, tồn, đề xuất) máy chủ gửi sẵn trong `cap_giay` — bấm là mở, không chờ. */}
            {nut.chonGiay && !g && (
              <div className="gcn__cap-dai" role="status">
                <span className="gcn__cap-dau" aria-hidden="true">!</span>
                <span className="gcn__cap-chu">
                  <b>Chưa cấp giấy cho nhà gia công</b>
                  <span>Nhà gia công đang chờ giấy để làm</span>
                </span>
                {thaoTac && cg && (
                  <Button variant="accent" onClick={() => setGiay((m) => ({ ...m, [l.id]: chonGiayBanDau(cg) }))}>
                    Chọn giấy
                  </Button>
                )}
              </div>
            )}
            {nut.chonGiay && g && thaoTac && cg && (
              <PhanChonGiay
                lanId={l.id}
                cg={cg}
                f={g}
                dangBan={dangBan}
                onDoi={(f2) => setGiay((m) => ({ ...m, [l.id]: f2 }))}
                onDeSau={() => setGiay((m) => { const n = { ...m }; delete n[l.id]; return n; })}
                onGui={() => guiGiay(l, g)}
              />
            )}

            {/* Danh sách chi tiết hai cột, nhãn xám thẳng cột (khối Details của Stripe). Số đặt và số
                tờ xin xuất chỉ hiện khi khác băng KPI phía trên. */}
            <dl className="gcn__dl">
              <div className="gcn__dl-o">
                <dt>Nhà gia công</dt>
                <dd>
                  <span className="gcn__gt">{l.nha_cung_cap_ten}</span>
                  {l.nha_cung_cap_sdt && (
                    <a className="gcn__goi" href={`tel:${l.nha_cung_cap_sdt.replace(/\s+/g, "")}`}>
                      <Icon name="phone" size={12} />
                      {l.nha_cung_cap_sdt}
                    </a>
                  )}
                </dd>
              </div>

              {(moc[0].luc || moc[0].ai) && (
                <div className="gcn__dl-o">
                  <dt>{moc[0].nhan}</dt>
                  <dd>
                    {moc[0].luc && <span className="gcn__gt">{gio(moc[0].luc)}</span>}
                    {moc[0].ai && <span className="gcn__phu">{moc[0].ai}</span>}
                  </dd>
                </div>
              )}

              {tronGoi ? (
                l.sl_dat != null && l.sl_dat !== daHien?.slDat && (
                  <div className="gcn__dl-o">
                    <dt>Số đặt</dt>
                    <dd><span className="gcn__gt">{so(l.sl_dat)} <small>{dvTen(l.don_vi)}</small></span></dd>
                  </div>
                )
              ) : (
                <div className="gcn__dl-o">
                  <dt>{l.sl_gui != null ? "Đã mang đi" : "Chờ mang đi"}</dt>
                  <dd>
                    <span className="gcn__gt">
                      {l.sl_gui != null
                        ? <>{so(l.sl_gui)} <small>{dvTen(l.don_vi_gui)}</small></>
                        : l.sl_cho_mang_di > 0
                          ? <>{so(l.sl_cho_mang_di)} <small>{dvTen(l.don_vi_gui)}</small></>
                          : "—"}
                    </span>
                    {l.sl_gui != null && l.mang_di_luc && <span className="gcn__phu">{gio(l.mang_di_luc)}</span>}
                    {l.sl_gui != null && l.mang_di_boi_ten && <span className="gcn__phu">{l.mang_di_boi_ten}</span>}
                    {l.trang_thai === "dang_o_ngoai" && l.sl_cho_mang_di > 0 && (
                      <span className="gcn__phu gcn__phu--chu-y">
                        Còn {so(l.sl_cho_mang_di)} {dvTen(l.don_vi_gui)} mới bàn giao, chưa mang
                      </span>
                    )}
                    {l.trang_thai === "cho_mang_di" && l.sl_cho_mang_di === 0 && l.co_buoc_truoc && (
                      <span className="gcn__phu">Chờ bước trước bàn giao sang</span>
                    )}
                  </dd>
                </div>
              )}

              {l.sl_cuoi != null && (
                <div className="gcn__dl-o">
                  <dt>Nhận về</dt>
                  <dd>
                    <span className="gcn__gt">{so(l.sl_cuoi)} <small>{dvTen(l.don_vi)}</small></span>
                    {l.noi_ve && <span className="gcn__the">{NHAN_NOI_VE[l.noi_ve]}</span>}
                    {l.chot_luc && <span className="gcn__phu">{gio(l.chot_luc)}</span>}
                    {l.chot_boi_ten && <span className="gcn__phu">{l.chot_boi_ten}</span>}
                  </dd>
                </div>
              )}

              {tronGoi && (
                <div className="gcn__dl-o">
                  <dt>Giấy</dt>
                  <dd>
                    <span className="gcn__gt">{l.xuong_cap_giay ? "Xưởng cấp" : "Nhà gia công tự lo"}</span>
                    {l.xuong_cap_giay && xg?.kho_rong ? (
                      <span className="gcn__the">{nhanKhoCap(xg.kho_rong, xg.kho_dai ?? 0)}</span>
                    ) : null}
                    {l.xuong_cap_giay && xg && xg.so_to != null && xg.so_to !== daHien?.toNguyen && (
                      <span className="gcn__the">{so(xg.so_to)} {dvTen(xg.don_vi ?? null)}</span>
                    )}
                    {l.xuong_cap_giay && !xg && l.trang_thai === "dang_gia_cong" && (
                      <span className="gcn__phu">Chưa chọn khổ</span>
                    )}
                  </dd>
                </div>
              )}

              {tronGoi && l.xuong_cap_giay && xg && (
                <div className="gcn__dl-o">
                  <dt>Kho</dt>
                  <dd>
                    <span className="gcn__tt gcn__tt--kho">{NHAN_XUAT_GIAY[xg.trang_thai] ?? xg.trang_thai}</span>
                    {xemKho ? (
                      <button type="button" className="gcn__goi" title="Mở đề nghị xuất giấy"
                        onClick={() => setChungTu({ loai: "de_nghi", id: xg.id })}>
                        {xg.ma}
                      </button>
                    ) : <span className="gcn__phu">{xg.ma}</span>}
                    {(xg.phieu ?? []).map((p) => (
                      <span key={p.id} className="gcn__phu-dong">
                        {xemKho ? (
                          <button type="button" className="gcn__goi" title="Mở phiếu xuất kho"
                            onClick={() => setChungTu({ loai: "phieu", id: p.id })}>
                            {p.ma}
                          </button>
                        ) : <span className="gcn__phu">{p.ma}</span>}
                        {p.trang_thai === "draft" && <span className="gcn__the">Chờ ghi sổ</span>}
                      </span>
                    ))}
                  </dd>
                </div>
              )}

              {l.trang_thai === "da_xong" && (
                <div className="gcn__dl-o">
                  <dt>Chi tiền</dt>
                  <dd>
                    <span className="gcn__gt">
                      {l.phieu_chi ? `Phiếu chi ${l.phieu_chi.code}` : "Chờ kế toán chi"}
                    </span>
                  </dd>
                </div>
              )}
            </dl>

            {canUpdate && l.chi_xem && (
              <p className="gcn__phu">
                Chỉ xem — bài ghép có lệnh ngoài phạm vi của bạn. Nhờ người phụ trách các lệnh còn lại thao tác.
              </p>
            )}
            {/* Chưa chọn giấy thì dải "Chưa cấp giấy" đã nói rồi — chỉ nói thêm khi đề nghị đã gửi mà
                kho chưa xuất, để biết vì sao nút Nhận hàng về đang khoá. */}
            {nut.chot && l.ly_do_khong_nhan_ve && xg && thaoTac && (
              <p className="gcn__phu">Chưa nhận hàng về được: {l.ly_do_khong_nhan_ve}</p>
            )}
            {nut.moLai && l.ly_do_khong_mo_lai && thaoTac && (
              <p className="gcn__phu">Không mở lại được: {l.ly_do_khong_mo_lai}</p>
            )}

            {thaoTac && f && (
              <div className="gcn__chot">
                <label className="gcn__chot-o">
                  <span className="gcn__chot-nhan">Số nhận về</span>
                  <span className="gcn__chot-so">
                    <input
                      inputMode="decimal"
                      value={f.sl}
                      autoFocus
                      onChange={(e) => setChot((m) => ({ ...m, [l.id]: { ...f, sl: e.target.value } }))}
                    />
                    <small>{dvTen(l.don_vi)}</small>
                  </span>
                </label>
                <div className="gcn__chot-o" role="radiogroup" aria-label="Hàng về đâu">
                  <span className="gcn__chot-nhan">Hàng về đâu</span>
                  <span className="gcn__chon">
                    {l.noi_ve_hop_le.map((nv) => (
                      <label key={nv} className={`gcn__chon-muc ${f.noiVe === nv ? "is-chon" : ""}`}>
                        <input
                          type="radio"
                          name={`gcn-noive-${l.id}`}
                          checked={f.noiVe === nv}
                          onChange={() => setChot((m) => ({ ...m, [l.id]: { ...f, noiVe: nv } }))}
                        />
                        {NHAN_NOI_VE[nv]}
                      </label>
                    ))}
                  </span>
                </div>
                {f.noiVe === "khach" && (
                  <label className="gcn__chot-o">
                    <span className="gcn__chot-nhan">Khách nhận ngày</span>
                    <ChonNgay
                      aria-label="Khách nhận ngày"
                      value={f.nhan}
                      min={l.tao_luc ? ngayIsoVn(new Date(l.tao_luc)) : undefined}
                      max={ngayIsoVn()}
                      onChange={(v) => setChot((m) => ({ ...m, [l.id]: { ...f, nhan: v } }))}
                    />
                    <small className="gcn__phu">Theo biên bản khách ký mà nhà gia công gửi về.</small>
                  </label>
                )}
                {f.noiVe === "xuong" && l.chang_sau.length > 1 && chia.length === 0 && (
                  <label className="gcn__chot-o">
                    <span className="gcn__chot-nhan">Bước nhận hàng</span>
                    <select
                      value={f.dich ?? ""}
                      onChange={(e) => setChot((m) => ({
                        ...m, [l.id]: { ...f, dich: e.target.value ? Number(e.target.value) : null },
                      }))}
                    >
                      <option value="">Chọn bước</option>
                      {l.chang_sau.map((c) => <option key={c.id} value={c.id}>{c.ten}</option>)}
                    </select>
                  </label>
                )}
                <div className="gcn__chot-nut">
                  <Button variant="ghost" onClick={() => boChot(l.id)}>Thôi</Button>
                  <Button
                    variant="accent"
                    loading={dangBan}
                    disabled={!(Number(f.sl) > 0) || !f.noiVe || (f.noiVe === "khach" && !f.nhan)}
                    onClick={async () => {
                      const xong = await chay(l.id, () => api.giaCongNgoai.chot(token!, l.id, {
                        version: l.version, sl_cuoi: Number(f.sl), noi_ve: f.noiVe!,
                        dich_cong_viec_id: f.dich,
                        ngay_khach_nhan: f.noiVe === "khach" ? f.nhan : null,
                      }));
                      if (xong) boChot(l.id);
                    }}
                  >
                    Chốt số nhận về
                  </Button>
                </div>
                {chia.length > 0 && (
                  // Số chốt là tờ ghép. Bước nhận ăn tờ (Cắt, Bế) thì nhận NGUYÊN số tờ rồi tự ra
                  // con; ăn con thì nhận số tờ × con/tờ — máy chủ trả hệ số đó (`he_so_nhan`).
                  <table className="gcn__chia">
                    <caption>Chia về từng lệnh</caption>
                    <thead>
                      <tr><th>Lệnh</th><th>Số con/tờ</th><th>Nhận</th><th>Bước nhận</th></tr>
                    </thead>
                    <tbody>
                      {chia.map((c) => (
                        <tr key={c.lsx_id}>
                          <td>{c.lsx_ma}</td>
                          <td>{c.so_con.toLocaleString("vi-VN")}</td>
                          <td>
                            {Number(f.sl) > 0 ? soNhanChia(Number(f.sl), c, dvTen) : "—"}
                          </td>
                          <td>{c.buoc_nhan ?? "Nhập kho"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {(l.lich_su.length > 0 || (l.id === cuoiSong && khoiHuy)) && (
              <div className="gcn__chan">
            {l.lich_su.length > 0 && (
              <details className="gcn__lichsu">
                <summary>Lịch sử ({l.lich_su.length})</summary>
                <ol>
                  {l.lich_su.map((h, i) => (
                    <li key={i}>
                      <span className="gcn__luc">{gio(h.luc)}</span>
                      <span className="gcn__ls-viec">
                        <span><b>{h.ai}</b> {h.viec.charAt(0).toLowerCase() + h.viec.slice(1)}</span>
                        {h.chi_tiet && <span className="gcn__phu">{h.chi_tiet}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
            )}
                {/* Các lần đã huỷ nằm chung hàng chân với Lịch sử của lần cuối, khỏi thêm hàng kẻ. */}
                {l.id === cuoiSong && khoiHuy}
              </div>
            )}
          </article>
        );
      })}

      {song.length === 0 && khoiHuy}

      <ConfirmDialog
        open={huy != null}
        title={`Huỷ gia công trọn gói — ${huy?.lan.lsx_ma ?? ""}?`}
        message="Lệnh về Nháp, gói phát hành thu hồi. Đề nghị xuất giấy chưa xuất sẽ huỷ theo."
        confirmLabel="Huỷ trọn gói"
        danger
        busy={huy != null && busy === huy.lan.id}
        confirmDisabled={(huy?.lyDo.trim().length ?? 0) < 3}
        onConfirm={async () => {
          if (!huy) return;
          const xong = await chay(huy.lan.id, () => api.giaCongNgoai.huyTronGoi(token!, huy.lan.id, {
            version: huy.lan.version, ly_do: huy.lyDo.trim(),
          }));
          if (xong) setHuy(null);
        }}
        onCancel={() => setHuy(null)}
      >
        <label className="gcn__o">
          <span>Lý do huỷ</span>
          <textarea
            rows={2}
            value={huy?.lyDo ?? ""}
            onChange={(e) => setHuy((h) => (h ? { ...h, lyDo: e.target.value } : h))}
          />
        </label>
      </ConfirmDialog>
      {chungTu && token && (
        <ChungTuKhoNoi mo={chungTu} token={token} onClose={() => setChungTu(null)} />
      )}
    </section>
  );
}

/** Phần "Chọn giấy" mở tại chỗ (C1): khổ trong kho kèm tồn (radio) — tờ theo khổ, cuộn theo rộng
 *  tính kg (24/10/2026) —, số xin xuất theo đơn vị của khổ đang chọn, cảnh báo khi kho thiếu (vẫn
 *  cho gửi), hai nút "Để sau" / "Gửi đề nghị xuất giấy". Mỗi lần gia công một đề nghị, một khổ. */
function PhanChonGiay({
  lanId, cg, f, dangBan, onDoi, onDeSau, onGui,
}: {
  lanId: number;
  cg: GiaCongCapGiay;
  f: FormGiay;
  dangBan: boolean;
  onDoi: (f: FormGiay) => void;
  onDeSau: () => void;
  onGui: () => void;
}) {
  const dx = cg.de_xuat;
  const keyDx = dx ? `${dx.kho_rong}x${dx.kho_dai}` : null;
  const soTo = Number(f.so);
  const thieu = thieuTo(cg, f.kho, soTo);
  const dang = cg.kho.find((k) => `${k.kho_rong}x${k.kho_dai}` === f.kho);
  // Đơn vị theo khổ đang chọn: cuộn ⇒ kg (gõ được phần lẻ), tờ ⇒ tờ.
  const dvChon = dang?.don_vi ?? dx?.don_vi ?? cg.don_vi;
  const dv = nhanDonVi(dvChon);
  const kg = dvChon === "kg";
  // Khổ khác CÙNG đơn vị còn đủ — gợi ý đổi khi khổ đang chọn thiếu (tờ và kg không so được).
  const khoDu = thieu != null
    ? cg.kho.find((k) => `${k.kho_rong}x${k.kho_dai}` !== f.kho && k.don_vi === dvChon
      && k.ton >= soTo) : undefined;
  const theoDeXuat = dx != null && f.kho === keyDx && dx.so_to != null && soTo === dx.so_to;
  const hoaDau = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const nguonHoa = hoaDau(cg.nguon);

  return (
    <div className="gcn__cap-mo">
      <div className="gcn__cap-tieu">
        <b>Cấp giấy {cg.giay_ten ?? cg.giay_ma ?? ""}</b>
        {dx && dx.so_to != null && (
          <span className="gcn__phu">
            {nguonHoa} cần {so(dx.so_to)} {nhanDonVi(dx.don_vi)} {nhanKhoCap(dx.kho_rong, dx.kho_dai)}
          </span>
        )}
      </div>
      {cg.ly_do ? (
        <p className="gcn__phu gcn__phu--chu-y">{cg.ly_do}</p>
      ) : (
        <div className="gcn__cap-hang">
          <div className="gcn__cap-cot" role="radiogroup" aria-label="Khổ trong kho">
            <span className="gcn__chot-nhan">Khổ trong kho</span>
            {cg.kho.length === 0 ? (
              <p className="gcn__phu">Kho chưa có giấy này.</p>
            ) : (
              <div className="gcn__kho-ds">
                {cg.kho.map((k) => {
                  const key = `${k.kho_rong}x${k.kho_dai}`;
                  const on = f.kho === key;
                  const het = k.ton <= 0;
                  return (
                    <label key={key} className={`gcn__kho-h${on ? " is-chon" : ""}${het ? " is-het" : ""}`}>
                      <input
                        type="radio"
                        name={`gcn-kho-giay-${lanId}`}
                        checked={on}
                        onChange={() => onDoi({
                          kho: key,
                          // Khổ đề xuất ⇒ điền lại số đề xuất; khổ khác ⇒ để trống, bắt gõ.
                          so: key === keyDx && dx?.so_to != null ? String(dx.so_to) : "",
                        })}
                      />
                      <span className="gcn__kho-ra" aria-hidden="true" />
                      <span className="gcn__kho-ten">
                        <b>{nhanKhoCap(k.kho_rong, k.kho_dai)}</b>
                        {k.dung_de_xuat && <span className="gcn__the">đúng {cg.nguon}</span>}
                        {het && <span className="gcn__the">hết</span>}
                      </span>
                      <span className="gcn__kho-ton">
                        <b>{so(k.ton)} {nhanDonVi(k.don_vi)}</b>
                        <small>tồn</small>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <label className="gcn__cap-cot">
            <span className="gcn__chot-nhan">Số {dv} xin xuất</span>
            <span className="gcn__cap-o">
              <OGoDinhDang
                inputMode={kg ? "decimal" : "numeric"}
                value={hienSoGo(f.so, kg)}
                onChange={(e) => onDoi({ ...f, so: chuanSoGo(e.target.value, kg) })}
                placeholder={`Nhập số ${dv}`}
                aria-label={`Số ${dv} xin xuất`}
              />
              <small>{dv}</small>
            </span>
            {theoDeXuat && <small className="gcn__phu">Điền theo {cg.nguon}</small>}
          </label>
        </div>
      )}
      {thieu != null && dang && (
        <div className="gcn__cap-bao" role="note">
          <span className="gcn__cap-dau" aria-hidden="true">!</span>
          <span>
            {hoaDau(nhanKhoCap(dang.kho_rong, dang.kho_dai))} còn <b>{so(dang.ton)} {dv}</b>, thiếu{" "}
            <b>{so(thieu)} {dv}</b>. Vẫn gửi được — kho xuất trước phần đang có.
            {khoDu && <> Hoặc chọn {nhanKhoCap(khoDu.kho_rong, khoDu.kho_dai)}.</>}
          </span>
        </div>
      )}
      <div className="gcn__chot-nut">
        <Button variant="ghost" onClick={onDeSau}>Để sau</Button>
        <Button
          variant="accent"
          loading={dangBan}
          disabled={!!cg.ly_do || !f.kho || !(soTo > 0)}
          onClick={onGui}
        >
          Gửi đề nghị xuất giấy
        </Button>
      </div>
    </div>
  );
}
