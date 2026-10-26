// CỘT PHẢI của ngăn công việc phương án B (09/10/2026, mockup `ban-to-ngan-B-day-du.html` hàm `side()`).
//
// Thông tin VIỆC ghim bên phải, tab nào ở cột trái cũng thấy: vướng mắc chặn Bắt đầu, hàng đang tới
// đâu trên tuyến của lệnh, tiến độ, việc (máy, thợ, khuôn, dặn dò), tệp của lệnh.
// Điện thoại: cùng nội dung này thành tab "Tổng quan".
//
// Mọi mặt GHI (giao/rút thợ, nhận/trả khuôn) đi qua callback của ngăn — cột không tự gọi API ghi.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { anhNho } from "../../api/client";
import type { SxNhanVienChon, SxWorkItemChiTiet } from "../../api/client";
import { NHAN_TT_SUA_CHUA, NHAN_TT_YEU_CAU } from "../../api/kyThuatMay";
import { Button } from "../../components/Button";
import { ChipKhuon } from "../../components/ChipBuoc";
import { ChipTT } from "../../components/LuoiDs";
import { Icon } from "../../components/Icons";
import { gioNgan, num } from "../keHoachSxShared";
import { MAU_TT_KTM } from "../KyThuatMayChung";
import { nhanChangLenh } from "../lsxBuoc";
import { conPhaiLam, tienDoThucTe } from "../thsxShared";
import { tinhTrangChon } from "../thsxTinhTrangNguoi";
import { ThsxTepLenh } from "../ThsxTepLenh";
import { cauDuoi, cauViTri, viTriHang } from "../thsxTuyen";

/** Ảnh đại diện của thợ; chưa có ảnh (hoặc ảnh tải hỏng) thì vẽ chữ cái đầu. */
export function AnhNguoi({ ten, url, size }: { ten: string; url?: string | null; size?: number }) {
  const [srcHong, setSrcHong] = useState<string | null>(null);
  const src = anhNho(url);
  const style = size ? { width: size, height: size, fontSize: size / 2 } : undefined;
  return (
    <span className="thsx-roster-avatar-glow" style={style}>
      {src && src !== srcHong
        ? <img src={src} alt="" onError={() => setSrcHong(src)} />
        : (ten ? ten.trim().charAt(0).toUpperCase() : "T")}
    </span>
  );
}

/** Các câu chặn Bắt đầu / Tiếp tục — đúng bốn câu của chân ngăn cũ, chỉ dời vào cột phải. */
export interface VuongMac {
  coNguoi: boolean;
  khuonChoNhan: boolean;
  thieuDauVao: string[];
  /** Câu máy chủ chặn Bắt đầu vì vật tư chưa sẵn sàng (`vat_tu_chua_san_sang`); null = không chặn. */
  vatTu: string | null;
  /** Mã yêu cầu/phiếu sửa ĐANG DỪNG máy của việc (lỗi #27) — máy chủ chặn Bắt đầu. */
  mayDung?: string | null;
}

export function ThsxCotPhai({
  chiTiet, candidates, ungVienHomNay, onMoChonNguoi, busy, canAssign, chuaGiaoChoToi, vuong,
  onGiao, onRut, onNhanKhuon, onTraKhuon, dinhKemDem, hep = false,
}: {
  chiTiet: SxWorkItemChiTiet;
  candidates: SxNhanVienChon[];
  ungVienHomNay: string | null;
  onMoChonNguoi?: () => void;
  busy: boolean;
  canAssign: boolean;
  chuaGiaoChoToi: boolean;
  vuong: VuongMac;
  onGiao: (employeeId: number) => void;
  onRut: (phanCongId: number) => void;
  onNhanKhuon: () => void;
  onTraKhuon: () => void;
  dinhKemDem?: Record<number, number>;
  /** Ngăn hẹp (điện thoại): đầu ngăn ẩn tên khách nên thẻ Việc ghi lại. */
  hep?: boolean;
}) {
  const cv = chiTiet.cong_viec;
  const tt = chiTiet.trang_thai ?? cv.trang_thai;
  const done = tt === "completed";
  const canGiao = canAssign && !done;
  const [giaoOpen, setGiaoOpen] = useState(false);
  const [q, setQ] = useState("");

  const roster = useMemo(() => (chiTiet.phan_cong ?? []).filter((p) => p.trang_thai === "active"), [chiTiet]);
  const activeIds = useMemo(() => new Set(roster.map((p) => p.employee_id)), [roster]);
  // Mỗi người kèm tình trạng (đang chạy việc nào, có tên ở việc nào, nghỉ) — người rảnh lên đầu, người
  // máy chủ sẽ chặn xuống cuối và tắt nút. Việc đang chạy thì giao là mở khoảng tham gia ngay, nên
  // người đang chạy việc khác cũng bị chặn.
  const dsChon = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const ngay = ungVienHomNay ?? "";
    return candidates
      .filter((c) => !activeIds.has(c.id))
      .filter((c) => !kw || c.full_name.toLowerCase().includes(kw) || (c.code ?? "").toLowerCase().includes(kw))
      .map((c) => ({ c, tt: tinhTrangChon(c, { ngay, homNay: ungVienHomNay, viecDangChay: tt === "running" }) }))
      .sort((a, b) => a.tt.hang - b.tt.hang);
  }, [candidates, activeIds, q, ungVienHomNay, tt]);

  // Ô chọn nhỏ đóng khi bấm ra ngoài hoặc Esc — như mọi ô chọn khác của ngăn.
  const giaoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!giaoOpen) return;
    const ngoai = (e: MouseEvent) => { if (!giaoRef.current?.contains(e.target as Node)) setGiaoOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setGiaoOpen(false); } };
    document.addEventListener("mousedown", ngoai);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("mousedown", ngoai); document.removeEventListener("keydown", esc, true); };
  }, [giaoOpen]);

  function moGiao() {
    if (!giaoOpen) onMoChonNguoi?.();
    setGiaoOpen((o) => !o);
  }
  function chon(c: SxNhanVienChon, chan: string | null) {
    if (chan) return;
    onGiao(c.id);
    setGiaoOpen(false);
    setQ("");
  }

  // 1 · Vướng mắc — chỉ khi việc chưa chạy (chờ làm / tạm dừng), như chân ngăn cũ.
  const choLam = !done && tt !== "running";
  const cauVuong: { key: string; noi: ReactNode }[] = [];
  if (choLam) {
    if (!vuong.coNguoi) {
      cauVuong.push({
        key: "nguoi",
        // Cùng chữ máy chủ (`thuc_thi.bat_dau`).
        noi: <>Cần giao ít nhất 1 thợ mới bắt đầu được.{canGiao && (
          <> <button type="button" className="thsx-b-lk" onClick={moGiao} disabled={busy}>Giao người</button></>
        )}</>,
      });
    }
    if (vuong.khuonChoNhan) {
      cauVuong.push({
        key: "khuon",
        // Gọi đúng tên nút + dòng có nút. Thiếu quyền thì nút không có — nói lý do thay vì bảo đi tìm.
        noi: <>Chưa nhận khuôn/khung{cv.khuon?.ma ? ` ${cv.khuon.ma}` : ""} —{" "}
          {canAssign
            ? "bấm “Đã nhận khuôn” ở dòng Khuôn bên dưới rồi mới Bắt đầu."
            : chuaGiaoChoToi
              ? "việc chưa giao cho bạn, mà quyền của bạn ở tổ này là “Của tôi”."
              : "cần quyền Thực hiện lệnh ở tổ này mới xác nhận được."}</>,
      });
    }
    if (vuong.mayDung) {
      cauVuong.push({
        key: "maydung",
        noi: <>Máy đang dừng chờ sửa ({vuong.mayDung}) — sửa xong hoặc đổi máy rồi mới {tt === "paused" ? "Tiếp tục" : "Bắt đầu"} được.</>,
      });
    }
    if (vuong.vatTu) cauVuong.push({ key: "vattu", noi: vuong.vatTu });
    if (vuong.thieuDauVao.length > 0) {
      cauVuong.push({
        key: "dauvao",
        noi: <>Chưa nhận hàng từ {vuong.thieuDauVao.join(", ")} — tổ trước giao sang và tổ mình xác nhận ở tab
          “Giao và nhận” rồi mới {tt === "paused" ? "Tiếp tục" : "Bắt đầu"} được.</>,
      });
    }
  }
  const phienCuoi = chiTiet.phien_chay.length > 0 ? chiTiet.phien_chay[chiTiet.phien_chay.length - 1] : null;
  const dungLuc = tt === "paused" && phienCuoi?.ket_thuc ? phienCuoi.ket_thuc : null;

  // 2 · Hàng đang tới đâu — dải của lệnh (máy chủ dựng), bài ghép / lệnh một bước không có ⇒ ẩn.
  const dai = chiTiet.routing ?? [];
  const viTri = viTriHang(dai, cv.id, cv.step_key);
  // Ô đuôi: làm xong bước cuối thì hàng đi đâu (máy chủ dựng, 11/10/2026).
  const duoi = chiTiet.dai_duoi ? {
    icon: (chiTiet.dai_duoi.loai === "ve_kho" ? "warehouse" : chiTiet.dai_duoi.loai === "giao_khach" ? "truck" : "arrowRight") as "warehouse" | "truck" | "arrowRight",
    ...cauDuoi(chiTiet.dai_duoi, (d) => nhanChangLenh(d, cv.don_vi_tinh), (v) => `${gioNgan(v)} ${v ? new Date(v).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }) : ""}`.trim()),
  } : null;

  // 3 · Tiến độ — CÙNG luật dòng bảng (`tienDoThucTe`): tốt / số cần ra; đã Kết thúc = 100%.
  const tienDo = tienDoThucTe(cv);
  const dvRa = nhanChangLenh(cv.don_vi_ra || (cv.ngoai_dong ? cv.don_vi_vao : null), cv.don_vi_tinh);
  const dvVao = cv.don_vi_vao ? nhanChangLenh(cv.don_vi_vao, cv.don_vi_tinh) : "";
  const tot = cv.da_lam ?? 0;
  const sl = chiTiet.san_luong;
  const buocCuoi = (chiTiet.ban_giao_chang_sau ?? []).length === 0;
  const daGiao = sl?.da_giao ?? 0;
  const choGiao = sl ? Math.max(0, sl.tong_tot - sl.da_giao) : 0;
  // Lỗi KCS bắt tại công đoạn trừ khỏi số tổ còn làm được (10/10/2026, cùng luật trần ghi mẻ).
  const loiKcs = chiTiet.tran_ghi?.loi_kcs ?? 0;
  // Theo số cần ra của bước (lỗi #28), cùng mốc với cột Sản lượng ở danh sách.
  const conLam = done ? null : conPhaiLam(cv);
  const voiDv = (n: number, dv: string) => `${num(n)}${dv ? ` ${dv}` : ""}`;

  return (
    <>
      {(cauVuong.length > 0 || dungLuc) && (
        <div className="thsx-b-vuong">
          {dungLuc && (
            <div className="thsx-b-vuong__dung">
              <div>Tạm dừng lúc {gioNgan(dungLuc)}</div>
              {phienCuoi?.ly_do && <div className="thsx-b-lydo">{phienCuoi.ly_do}</div>}
            </div>
          )}
          {cauVuong.length > 0 && (
            <>
              <div>{tt === "paused" ? "Chưa tiếp tục được vì" : "Chưa bắt đầu được vì"}</div>
              <ul>{cauVuong.map((c) => <li key={c.key}>{c.noi}</li>)}</ul>
            </>
          )}
        </div>
      )}

      {viTri && (
        <section className="thsx-b-blk">
          <h3 className="thsx-b-blk__h">Hàng đang tới đâu</h3>
          <div className="thsx-b-cau">
            <span className={`thsx-b-cau__dot is-${viTri.k}`} aria-hidden="true" />
            <span>
              {/* Mọi bước đã xong mà có ô đuôi: hàng đã rời dải — nói chỗ nó đi tới, đừng nói "đang ở" bước cuối. */}
              {duoi && dai.length > 0 && dai.every((o) => o.trang_thai === "completed")
                ? `Lệnh đã xong cả ${dai.length} bước, hàng đã đi tiếp`
                : cauViTri(viTri, dai, false)}
            </span>
            <span className="thsx-b-mo3">tổ mình ở bước {viTri.m} trên {viTri.tong}</span>
          </div>
          <ol className="thsx-b-vlist">
            {dai.map((o, i) => {
              const laMe = i + 1 === viTri.m;
              const lop = [
                "thsx-b-vs",
                o.trang_thai === "completed" ? "is-xong" : "",
                o.trang_thai === "running" || o.trang_thai === "paused" ? "is-dang" : "",
                laMe ? "is-me" : "",
                o.thue_ngoai ? "is-ngoai" : "",
              ].filter(Boolean).join(" ");
              return (
                <li key={`${o.thu_tu}-${o.step_key ?? i}`} className={lop}>
                  <i className="thsx-b-vs__o" aria-hidden="true" />
                  <div>
                    <div className="thsx-b-vs__nm">{o.ten_cong_doan}</div>
                    <div className="thsx-b-vs__to">
                      {o.thue_ngoai && <span>Thuê ngoài</span>}
                      {o.to_ten && <span>{o.to_ten}</span>}
                      {laMe && <span className="thsx-b-vs__minh">tổ mình</span>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          {duoi && (
            <div className="thsx-b-duoi">
              <Icon name={duoi.icon} size={15} />
              <div>
                <div className="thsx-b-duoi__nm">{duoi.ten}</div>
                {duoi.so.length > 0 && (
                  <div className="thsx-b-vs__to">{duoi.so.map((t) => <span key={t}>{t}</span>)}</div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      <section className="thsx-b-blk">
        <h3 className="thsx-b-blk__h">Tiến độ</h3>
        <div className="thsx-b-pg">
          <div className="thsx-b-pg__dau">
            <span className="thsx-b-pg__so">{num(tot)}</span>
            <span className="thsx-b-mo">
              {tienDo?.nhan != null ? `trên ${voiDv(tienDo.nhan, dvRa)} tốt` : `${dvRa ? `${dvRa} ` : ""}tốt`}
            </span>
            {tienDo && <span className="thsx-b-pg__pct">{tienDo.pct}%</span>}
          </div>
          {tienDo && <div className="thsx-b-pg__bar"><i style={{ width: `${tienDo.pct}%` }} /></div>}
          <dl className="thsx-b-pg__dl">
            <dt>Nhận vào</dt><dd>{cv.nhan != null ? voiDv(cv.nhan, dvVao) : "—"}</dd>
            {loiKcs > 0 && <><dt>KCS bắt lỗi</dt><dd className="is-loi">{voiDv(loiKcs, dvRa)}</dd></>}
            {cv.loi != null && <><dt>Lỗi</dt><dd className={cv.loi > 0 ? "is-loi" : undefined}>{voiDv(cv.loi, dvRa)}</dd></>}
            {!buocCuoi && sl && (
              <>
                <dt>Đã giao đi</dt><dd>{voiDv(daGiao, dvRa)}</dd>
                <dt>Chờ giao</dt><dd className={choGiao > 0 ? "is-canh" : undefined}>{voiDv(choGiao, dvRa)}</dd>
              </>
            )}
            {conLam != null && <><dt>Còn phải làm</dt><dd>{voiDv(conLam, dvRa)}</dd></>}
          </dl>
        </div>
      </section>

      {/* Việc — một thẻ, mỗi dòng một thông tin. Không lặp: dự kiến + chạy máy đã ở khối Kế hoạch (tab
          Quy cách), lệnh + khách đã ở đầu ngăn (điện thoại đầu ngăn ẩn khách nên mới ghi lại ở đây). */}
      <section className="thsx-b-blk">
        <h3 className="thsx-b-blk__h">Việc</h3>
        <div className="thsx-b-viec">
          {cv.may && (
            <div className="thsx-b-viec__d">
              <span className="thsx-b-viec__nh">Máy</span>
              <div>
                <span>{cv.may}</span>
                {/* Báo hỏng chưa xử lý xong của máy này (11/10/2026): tổ sửa chữa nhận / sửa xong / từ
                    chối là dòng tự đổi hoặc rụng, không phải tải lại. Không có link — người bàn tổ
                    thường không có quyền màn Sửa chữa máy. */}
                {(chiTiet.bao_hong_may ?? []).map((b) => (
                  <div key={`${b.loai}-${b.id}`} className="thsx-b-hong">
                    <div className="thsx-b-hong__dong">
                      <span className="thsx-b-hong__ma">{b.ma}</span>
                      {b.may_dung
                        ? <ChipTT mau="do">Máy dừng</ChipTT>
                        : <span className="thsx-b-mo3">vẫn chạy được</span>}
                      <ChipTT mau={MAU_TT_KTM[b.trang_thai] ?? "xam"}>
                        {(b.loai === "phieu" ? NHAN_TT_SUA_CHUA : NHAN_TT_YEU_CAU)[b.trang_thai] ?? b.trang_thai}
                      </ChipTT>
                    </div>
                    {b.trieu_chung && <small>{b.trieu_chung}</small>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="thsx-b-viec__d">
            <span className="thsx-b-viec__nh">Thợ</span>
            <div className="thsx-b-viec__tho" ref={giaoRef}>
              <ul className="thsx-b-tho">
                {roster.length === 0 && <li className="thsx-b-mo3">chưa giao ai</li>}
                {roster.map((p) => (
                  <li key={p.id} className="thsx-b-tho__the">
                    <AnhNguoi ten={p.ho_ten} url={p.avatar_url} size={22} />
                    <span>{p.ho_ten}</span>
                    {canAssign && !done && (
                      <button type="button" className="thsx-b-x" onClick={() => onRut(p.id)} disabled={busy}
                        title="Rút khỏi công việc" aria-label={`Rút ${p.ho_ten} khỏi công việc`}>
                        <Icon name="x" size={12} />
                      </button>
                    )}
                  </li>
                ))}
                {canGiao && (
                  <li>
                    <button type="button" className="thsx-b-tho__them" onClick={moGiao} disabled={busy} aria-expanded={giaoOpen}>
                      + Giao người
                    </button>
                  </li>
                )}
              </ul>
              {canGiao && giaoOpen && (
                <div className="thsx-giao__pop" role="dialog" aria-label="Chọn người để giao">
                  <div className="thsx-giao__search">
                    <Icon name="search" size={14} />
                    <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tên hoặc mã" />
                  </div>
                  <div className="thsx-giao__list">
                    {dsChon.length === 0 ? (
                      <div className="thsx-giao__empty">Không còn ai để giao.</div>
                    ) : dsChon.map(({ c, tt: t }) => (
                      <button key={c.id} type="button" className="thsx-giao__opt"
                        disabled={!!t.chan} aria-disabled={!!t.chan || undefined} onClick={() => chon(c, t.chan)} title={t.chan ?? undefined}>
                        <span className="thsx-giao__dong">
                          <span className="thsx-giao__nm">{c.full_name}</span>
                          {c.code && <span className="thsx-giao__code">{c.code}</span>}
                        </span>
                        {/* Tình trạng LUÔN hiện: chặn · đang chạy việc khác · có tên ở việc chưa xong · rảnh. */}
                        <span className="thsx-giao__tt">
                          <span className={`thsx-giao__tt--${t.muc}`}>{t.tomTat}</span>
                          {t.ghiChu && <span className="thsx-giao__tt--ghi">{t.ghiChu}</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {cv.khuon && (
            <div className="thsx-b-viec__d">
              <span className="thsx-b-viec__nh">Khuôn</span>
              <div>
                <span className="thsx-b-khuon">
                  <ChipKhuon can_khuon khuon={{ ...cv.khuon, da_nhan: cv.khuon_da_nhan }} />
                  {cv.khuon.ten && <span>{cv.khuon.ten}</span>}
                </span>
                {cv.khuon.so_ke && !cv.khuon_da_nhan && <small>Lấy ở {cv.khuon.so_ke}</small>}
                {!cv.khuon_da_nhan && canAssign && (
                  <div className="thsx-b-dd-nut">
                    <Button variant="secondary" onClick={onNhanKhuon} disabled={busy}>Đã nhận khuôn</Button>
                  </div>
                )}
                {/* Thiếu quyền thì nói ra, đừng để dòng trống trơn: người xem tưởng hệ thống không có
                    chỗ tích nhận (16/09/2026). */}
                {!cv.khuon_da_nhan && !canAssign && (
                  <small>
                    {chuaGiaoChoToi
                      ? "Việc này chưa giao cho bạn — quyền Thực hiện lệnh của bạn ở tổ này là “Của tôi”, chỉ áp cho việc được giao."
                      : "Cần quyền Thực hiện lệnh ở tổ này mới xác nhận nhận khuôn được."}
                  </small>
                )}
                {cv.khuon_da_nhan && !cv.khuon_da_tra && done && canAssign && (
                  <div className="thsx-b-dd-nut">
                    <button type="button" className="thsx-b-lk" onClick={onTraKhuon} disabled={busy}>Trả khuôn về kệ</button>
                  </div>
                )}
                {cv.khuon_da_tra && <small>Đã trả về kệ.</small>}
              </div>
            </div>
          )}

          {hep && cv.khach_hang && (
            <div className="thsx-b-viec__d">
              <span className="thsx-b-viec__nh">Khách</span>
              <span>{cv.khach_hang}</span>
            </div>
          )}

          {/* Dặn dò = ô "Ghi chú kỹ thuật cho thợ" của bước. LUÔN có dòng, kể cả trống: thợ phải biết là
              không có dặn dò. Có thì tô vàng cho thợ khỏi bỏ sót. */}
          {cv.ghi_chu?.trim() ? (
            <div className="thsx-b-viec__d is-dando">
              <span className="thsx-b-viec__nh">Dặn dò</span>
              <p className="thsx-b-dando">{cv.ghi_chu}</p>
            </div>
          ) : (
            <div className="thsx-b-viec__d">
              <span className="thsx-b-viec__nh">Dặn dò</span>
              <span className="thsx-b-mo3">không có</span>
            </div>
          )}
        </div>
      </section>

      {/* Tệp của lệnh — maket/bản vẽ Kế hoạch SX đính kèm; tổ xem/tải, không sửa. */}
      <div className="thsx-b-blk thsx-b-tep">
        <ThsxTepLenh congViecId={cv.id} dinhKemDem={dinhKemDem} />
      </div>
    </>
  );
}
