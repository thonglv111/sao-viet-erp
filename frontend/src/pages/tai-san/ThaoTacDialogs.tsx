// Ba thao tác trên MỘT tài sản: Chuyển bộ phận, Sửa chữa lớn, Thôi dùng.
//
//   • Chuyển bộ phận — đổi bộ phận dùng và người giữ. KHÔNG đổi số tiền nào.
//   • Sửa chữa lớn   — (mã `nang_cap`) cộng tiền sửa vào giá rồi chia lại phần còn lại cho số tháng
//                      dùng thêm. Chỉ cho sửa làm máy tốt hơn / dùng lâu hơn (TT45/2013 Điều 7).
//   • Thôi dùng      — bán / thanh lý / hỏng / mất: ngừng khấu hao từ ngày đó, tài sản vẫn còn.
//
// Thiết kế lại 05/10/2026 (spec `2026-10-05-tai-san-ui-ux-tung-man.md`, màn 6–8). Bản đầu mở khung
// ngay trong ngăn chi tiết — chủ xem thật thì chê "bấm vào ui/ux chán": một ô viền xám chen giữa
// ngăn, đẩy hết số xuống. Nay là HỘP GIỮA MÀN (FocusView của Stripe) hai phần: trái là vài ô nhập,
// phải là khung "Sau khi lưu" — số MỚI to, số cũ gạch ngang — đổi theo từng phím gõ. Chuyển bộ
// phận thì khung đó là hai thẻ "Đang ở → Chuyển sang" nằm trên cùng.
// Nút lưu luôn bấm được: thiếu ô nào thì báo ngay dưới ô đó và đưa con trỏ tới (nút mờ đi thì
// người dùng không biết vì sao không bấm được).
import { ChonNgay } from "../../components/ChonNgay";
import { useEffect, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import type { Department } from "../../api/client";
import {
  CCDC_TOI_DA_THANG,
  KIEU_THOI_DUNG,
  taiSanApi,
  type DongDuKien,
  type NhanVienChon,
  type TaiSanChiTiet,
} from "../../api/taiSan";
import { Button } from "../../components/Button";
import { DetailModal } from "../../components/DetailModal";
import { Icon } from "../../components/Icons";
import { Select } from "../../components/Select";
import { homNayVN } from "../../utils/ky";
import {
  BangLoi,
  HOM_NAY,
  LoiO,
  NGAY_MAX,
  OTien,
  SoSanh,
  luaChonBoPhan,
  ngay as inNgay,
  tienDon,
} from "./chung";

interface Chung {
  token: string;
  taiSan: TaiSanChiTiet;
  onClose: () => void;
  /** Đã lưu — ngăn chi tiết nạp lại số và lịch sử. */
  onDone: () => void;
}

/** Gọi API, giữ trạng thái bận + lỗi — ba khung dùng chung. */
function useGui(onDone: () => void) {
  const [ban, setBan] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  async function gui(fn: () => Promise<unknown>) {
    setBan(true);
    setLoi(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setLoi(e instanceof ApiError ? e.message : "Không lưu được. Thử lại.");
    } finally {
      setBan(false);
    }
  }
  return { ban, loi, gui };
}

/** Đưa con trỏ tới ô lỗi đầu tiên (theo thứ tự trong `thuTu`). */
function toiOLoi(loi: Record<string, string>, thuTu: string[]) {
  const dau = thuTu.find((k) => loi[k]);
  if (dau) window.setTimeout(() => document.getElementById(dau)?.focus(), 0);
}

function KhungThaoTac({ tieuDe, taiSan, ghi, onClose, loi, children, xem, xemTren, nut }: {
  tieuDe: string;
  taiSan: TaiSanChiTiet;
  ghi?: string;
  onClose: () => void;
  loi: string | null;
  children: ReactNode;
  /** Khung "Sau khi lưu" — bên phải form, hoặc trên cùng nếu `xemTren`. */
  xem: ReactNode;
  xemTren?: boolean;
  nut: ReactNode;
}) {
  return (
    <DetailModal
      title={tieuDe}
      width={xemTren ? 680 : 860}
      subtitle={<span className="ts-hop__ts"><span className="ts-ma">{taiSan.ma}</span>{taiSan.ten}</span>}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>Hủy</Button>
          {nut}
        </>
      }
    >
      <BangLoi loi={loi} />
      {ghi && <p className="ts-hop__ghi">{ghi}</p>}
      <div className={`ts-hop${xemTren ? " ts-hop--tren" : ""}`}>
        <div className="ts-form ts-hop__form">{children}</div>
        <aside className="ts-hop__xem" aria-live="polite" aria-label="Sau khi lưu">
          {!xemTren && <h4 className="ts-muc__ten">Sau khi lưu</h4>}
          {xem}
        </aside>
      </div>
    </DetailModal>
  );
}

// --- Chuyển bộ phận -------------------------------------------------------------------------

export function ChuyenBoPhanKhung({ token, taiSan, boPhan, onClose, onDone }: Chung & {
  boPhan: Department[];
}) {
  const [ngay, setNgay] = useState(HOM_NAY);
  const [boPhanMoi, setBoPhanMoi] = useState("");
  const [nguoiMoi, setNguoiMoi] = useState("");
  const [lyDo, setLyDo] = useState("");
  const [nhanVien, setNhanVien] = useState<NhanVienChon[]>([]);
  const [loiO, setLoiO] = useState<Record<string, string>>({});
  const { ban, loi, gui } = useGui(onDone);

  // Người giữ mới phải là nhân viên của bộ phận MỚI — đổi bộ phận là nạp lại và bỏ chọn.
  useEffect(() => {
    setNguoiMoi("");
    if (!boPhanMoi) {
      setNhanVien([]);
      return;
    }
    let conDung = true;
    taiSanApi
      .nhanVienBoPhan(token, Number(boPhanMoi))
      .then((ds) => { if (conDung) setNhanVien(ds); })
      .catch(() => { if (conDung) setNhanVien([]); });
    return () => { conDung = false; };
  }, [token, boPhanMoi]);

  const luaChon = luaChonBoPhan(boPhan).filter((o) => o.value !== String(taiSan.bo_phan_id));
  const tenMoi = luaChon.find((o) => o.value === boPhanMoi)?.label;
  const nguoiMoiTen = nhanVien.find((nv) => String(nv.id) === nguoiMoi)?.full_name;

  function luu() {
    const l: Record<string, string> = {};
    if (!boPhanMoi) l["ts-chuyen-bp"] = "Chọn bộ phận mới";
    if (!ngay) l["ts-chuyen-ngay"] = "Chọn ngày chuyển";
    setLoiO(l);
    if (Object.keys(l).length) return toiOLoi(l, ["ts-chuyen-bp", "ts-chuyen-ngay"]);
    void gui(() => taiSanApi.bienDong(token, taiSan.id, {
      loai: "dieu_chuyen", ngay, bo_phan_moi_id: Number(boPhanMoi),
      nguoi_quan_ly_id: nguoiMoi ? Number(nguoiMoi) : null, ly_do: lyDo.trim() || null,
    }));
  }

  return (
    <KhungThaoTac tieuDe="Chuyển bộ phận" taiSan={taiSan} onClose={onClose} loi={loi} xemTren
      xem={
        <>
          <div className="ts-chuyen">
            <div className="ts-chuyen__o">
              <span className="ts-chuyen__nhan">Đang ở</span>
              <strong>{taiSan.bo_phan_ten ?? "Chưa có bộ phận"}</strong>
              <span className="ts-chuyen__nguoi">
                <Icon name="users" size={13} /> {taiSan.nguoi_quan_ly ?? "Chưa có người giữ"}
              </span>
            </div>
            <span className="ts-chuyen__mui"><Icon name="arrowRight" size={18} /></span>
            <div className={`ts-chuyen__o${tenMoi ? " is-moi" : " is-trong"}`}>
              <span className="ts-chuyen__nhan">Chuyển sang</span>
              <strong>{tenMoi ?? "Chọn bộ phận bên dưới"}</strong>
              <span className="ts-chuyen__nguoi">
                <Icon name="users" size={13} /> {nguoiMoiTen ?? "Chưa chọn người giữ"}
              </span>
            </div>
          </div>
          <p className="ts-hop__yen"><Icon name="check" size={14} /> Giá mua, đã khấu hao, mỗi tháng giữ nguyên.</p>
        </>
      }
      nut={<Button variant="accent" type="button" loading={ban} onClick={luu}>Chuyển bộ phận</Button>}>
      <div className="ts-form__hang">
        <div className="rc-field ts-o--rong">
          <span className="rc-field__label">Sang bộ phận <em>*</em></span>
          <div id="ts-chuyen-bp" tabIndex={-1}>
            <Select<string> options={luaChon} value={boPhanMoi} portal searchable
              searchPlaceholder="Gõ để tìm bộ phận" placeholder="Chọn bộ phận"
              ariaLabel="Sang bộ phận"
              onChange={(v) => { setBoPhanMoi(v); setLoiO((l) => ({ ...l, "ts-chuyen-bp": "" })); }} />
          </div>
          <LoiO loi={loiO["ts-chuyen-bp"]} />
        </div>
        <label className="rc-field ts-o--ngay">
          <span className="rc-field__label">Ngày chuyển <em>*</em></span>
          <ChonNgay id="ts-chuyen-ngay" aria-label="Ngày chuyển" className={`rc-input${loiO["ts-chuyen-ngay"] ? " is-loi" : ""}`}
            min={taiSan.ngay_su_dung.slice(0, 10)} max={NGAY_MAX} value={ngay}
            onChange={(v) => setNgay(v)} />
          <LoiO loi={loiO["ts-chuyen-ngay"]} />
        </label>
      </div>
      <div className="ts-form__hang">
        <label className="rc-field">
          <span className="rc-field__label">Người giữ mới</span>
          <select className="rc-input" value={nguoiMoi} disabled={!boPhanMoi}
            onChange={(e) => setNguoiMoi(e.target.value)}>
            <option value="">{boPhanMoi ? "Chưa chọn" : "Chọn bộ phận trước"}</option>
            {nhanVien.map((nv) => <option key={nv.id} value={nv.id}>{nv.full_name}</option>)}
          </select>
        </label>
        <label className="rc-field">
          <span className="rc-field__label">Lý do</span>
          <input className="rc-input" value={lyDo} maxLength={255}
            onChange={(e) => setLyDo(e.target.value)} />
        </label>
      </div>
    </KhungThaoTac>
  );
}

// --- Sửa chữa lớn ---------------------------------------------------------------------------

/** "MM/YYYY" của tháng (nam, thang) cộng thêm `n` tháng. */
function congThang(nam: number, thang: number, n: number): string {
  const t = nam * 12 + (thang - 1) + n;
  return `${String((t % 12) + 1).padStart(2, "0")}/${Math.floor(t / 12)}`;
}

export function SuaChuaLonKhung({ token, taiSan, lich, onClose, onDone }: Chung & {
  lich: DongDuKien[] | null;
}) {
  const [ngay, setNgay] = useState(HOM_NAY);
  const [tienSua, setTienSua] = useState(0);
  const [thangThem, setThangThem] = useState(taiSan.so_thang_con || 0);
  const [lyDo, setLyDo] = useState("");
  const [loiO, setLoiO] = useState<Record<string, string>>({});
  const { ban, loi, gui } = useGui(onDone);

  const laCcdc = taiSan.loai === "ccdc";
  const quaTran = laCcdc && thangThem > CCDC_TOI_DA_THANG;
  // Áp từ đầu tháng sau (đúng ngày 1 thì ngay tháng đó) — y luật máy chủ `_ky_ap_dung`.
  const apTu = (() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ngay)) return null;
    let nam = Number(ngay.slice(0, 4));
    let thang = Number(ngay.slice(5, 7));
    if (Number(ngay.slice(8, 10)) !== 1) {
      thang += 1;
      if (thang > 12) { thang = 1; nam += 1; }
    }
    return { nam, thang };
  })();
  const mucCu = taiSan.so_thang_con > 0 ? Math.floor(taiSan.co_so_trich / taiSan.so_thang_con) : 0;
  // ƯỚC: đã khấu hao tới hết tháng trước + các tháng chen giữa theo mức hiện tại. Số chính xác hiện
  // trong lịch của ngăn chi tiết sau khi lưu.
  const mucMoi = (() => {
    if (!apTu || tienSua <= 0 || thangThem <= 0) return null;
    let da = taiSan.hao_mon_luy_ke;
    const den = taiSan.luy_ke_den;
    if (den) {
      const chen = (apTu.nam - Number(den.slice(0, 4))) * 12 + (apTu.thang - Number(den.slice(5, 7))) - 1;
      da = Math.min(taiSan.nguyen_gia, da + Math.max(0, chen) * mucCu);
    }
    return Math.floor((taiSan.nguyen_gia + tienSua - da) / thangThem);
  })();
  const cuoi = lich && lich.length ? lich[lich.length - 1] : null;
  const hetCu = cuoi ? `${String(cuoi.thang).padStart(2, "0")}/${cuoi.nam}` : null;
  const hetMoi = apTu && thangThem > 0 ? congThang(apTu.nam, apTu.thang, thangThem - 1) : null;

  function luu() {
    const l: Record<string, string> = {};
    if (!(tienSua > 0)) l["ts-sua-tien"] = "Nhập tiền sửa";
    if (!ngay) l["ts-sua-ngay"] = "Chọn ngày sửa xong";
    if (!(thangThem > 0)) l["ts-sua-thang"] = "Nhập số tháng dùng thêm";
    else if (quaTran) l["ts-sua-thang"] = `Công cụ dụng cụ khấu hao tối đa ${CCDC_TOI_DA_THANG} tháng`;
    setLoiO(l);
    if (Object.keys(l).length) return toiOLoi(l, ["ts-sua-tien", "ts-sua-ngay", "ts-sua-thang"]);
    void gui(() => taiSanApi.bienDong(token, taiSan.id, {
      loai: "nang_cap", ngay, so_tien: tienSua, so_thang_con_lai: thangThem,
      ly_do: lyDo.trim() || null,
    }));
  }

  return (
    <KhungThaoTac tieuDe="Sửa chữa lớn" taiSan={taiSan} onClose={onClose} loi={loi}
      ghi="Chỉ nhập khi sửa làm máy tốt hơn hoặc dùng được lâu hơn. Sửa vặt hằng ngày không nhập ở đây."
      xem={
        <>
          <SoSanh nhan="Giá mua" cu={tienDon(taiSan.nguyen_gia)}
            moi={tienSua > 0 ? tienDon(taiSan.nguyen_gia + tienSua) : null} />
          <SoSanh nhan={apTu ? `Mỗi tháng, từ ${String(apTu.thang).padStart(2, "0")}/${apTu.nam}` : "Mỗi tháng"}
            cu={tienDon(mucCu)} moi={mucMoi !== null ? tienDon(mucMoi) : null} />
          {hetCu && (
            <SoSanh nhan="Khấu hao hết vào" cu={hetCu}
              moi={mucMoi !== null && hetMoi && hetMoi !== hetCu ? hetMoi : null} />
          )}
          <p className="ts-hop__chu">
            {mucMoi !== null
              ? "Số ước tính. Số chính xác hiện trong lịch khấu hao sau khi lưu."
              : "Gõ tiền sửa để xem số mới."}
          </p>
        </>
      }
      nut={<Button variant="accent" type="button" loading={ban} onClick={luu}>Lưu sửa chữa lớn</Button>}>
      <div className="ts-form__hang">
        <label className="rc-field ts-o--tien">
          <span className="rc-field__label">Tiền sửa <em>*</em></span>
          <OTien id="ts-sua-tien" value={tienSua} invalid={!!loiO["ts-sua-tien"]} ariaLabel="Tiền sửa"
            autoFocus onChange={(v) => { setTienSua(v); setLoiO((l) => ({ ...l, "ts-sua-tien": "" })); }} />
          <LoiO loi={loiO["ts-sua-tien"]} />
        </label>
        <label className="rc-field ts-o--ngay">
          <span className="rc-field__label">Ngày sửa xong <em>*</em></span>
          <ChonNgay id="ts-sua-ngay" aria-label="Ngày sửa xong" className={`rc-input${loiO["ts-sua-ngay"] ? " is-loi" : ""}`}
            min={taiSan.ngay_su_dung.slice(0, 10)} max={NGAY_MAX} value={ngay}
            onChange={(v) => setNgay(v)} />
          <LoiO loi={loiO["ts-sua-ngay"]} />
        </label>
      </div>
      <label className="rc-field">
        <span className="rc-field__label">Dùng thêm được <em>*</em></span>
        <span className="ts-o--thang">
          <input id="ts-sua-thang" className="rc-input ts-num" type="number" min={1} max={600} step={1}
            value={thangThem || ""} aria-invalid={!!loiO["ts-sua-thang"] || undefined}
            onChange={(e) => {
              setThangThem(Math.max(0, Number(e.target.value) || 0));
              setLoiO((l) => ({ ...l, "ts-sua-thang": "" }));
            }} />
          tháng
        </span>
        {loiO["ts-sua-thang"] ? <LoiO loi={loiO["ts-sua-thang"]} /> : (
          <span className="rc-field__hint">
            Đang còn {taiSan.so_thang_con} tháng. Sửa xong dùng lâu hơn thì gõ số mới.
          </span>
        )}
      </label>
      <label className="rc-field">
        <span className="rc-field__label">Sửa gì</span>
        <input className="rc-input" value={lyDo} maxLength={255} placeholder="Thay đầu máy, đại tu…"
          onChange={(e) => setLyDo(e.target.value)} />
      </label>
    </KhungThaoTac>
  );
}

// --- Thôi dùng ------------------------------------------------------------------------------

export function ThoiDungKhung({ token, taiSan, lich, onClose, onDone }: Chung & {
  lich: DongDuKien[] | null;
}) {
  // Không thôi dùng cho ngày chưa tới (lỗi E2E #44): lưu là thẻ đổi sang "Đã thôi dùng" ngay trong
  // khi máy còn chạy. Hôm nay theo giờ xưởng, không theo giờ máy đang mở trang; máy chủ chặn lại.
  const homNay = homNayVN();
  const [kieu, setKieu] = useState("");
  const [ngay, setNgay] = useState(homNay);
  const [ghiChu, setGhiChu] = useState("");
  const [loiO, setLoiO] = useState<Record<string, string>>({});
  const { ban, loi, gui } = useGui(onDone);

  // Còn lại ƯỚC lúc thôi dùng = giá − đã khấu hao tới hết tháng TRƯỚC tháng thôi dùng (lịch dự
  // kiến); tháng thôi dùng máy chủ còn tính lẻ ngày, số đúng hiện ở ngăn sau khi lưu.
  const conLai = (() => {
    if (!/^\d{4}-\d{2}/.test(ngay)) return null;
    const khoa = ngay.slice(0, 7);
    const truoc = (lich ?? []).filter((d) => `${d.nam}-${String(d.thang).padStart(2, "0")}` < khoa);
    // Chưa có tháng nào trước tháng thôi dùng trong lịch (vd tài sản mang sang từ sổ cũ, thôi
    // ngay tháng đầu tính trên phần mềm) ⇒ lấy số đã khấu hao ĐẦU lịch, không phải 0.
    const dau = lich && lich.length ? lich[0].luy_ke - lich[0].muc_trich : taiSan.hao_mon_luy_ke;
    const da = truoc.length ? truoc[truoc.length - 1].luy_ke : dau;
    return Math.max(taiSan.nguyen_gia - da, 0);
  })();

  function luu() {
    const l: Record<string, string> = {};
    if (!kieu) l["ts-thoi-kieu"] = "Chọn lý do thôi dùng";
    if (!ngay) l["ts-thoi-ngay"] = "Chọn ngày thôi dùng";
    else if (ngay > homNayVN()) l["ts-thoi-ngay"] = "Không chọn được ngày sau hôm nay";
    setLoiO(l);
    if (Object.keys(l).length) return toiOLoi(l, ["ts-thoi-kieu", "ts-thoi-ngay"]);
    void gui(() => taiSanApi.thoiDung(token, taiSan.id, { ngay, kieu, ly_do: ghiChu.trim() || null }));
  }

  return (
    <KhungThaoTac tieuDe="Thôi dùng" taiSan={taiSan} onClose={onClose} loi={loi}
      xem={
        <>
          <SoSanh nhan="Còn lại lúc thôi dùng" cu="—" moi={conLai !== null ? `khoảng ${tienDon(conLai)}` : null}
            ghi="Kế toán ghi giảm số này." />
          <SoSanh nhan="Ngừng khấu hao từ" cu="—" moi={ngay ? inNgay(ngay) : null}
            ghi="Tài sản vẫn còn trong danh sách để xem lại." />
        </>
      }
      nut={<Button variant="danger" type="button" loading={ban} onClick={luu}>Thôi dùng tài sản</Button>}>
      <div className="rc-field">
        <span className="rc-field__label">Lý do <em>*</em></span>
        <div className="ts-chon" role="radiogroup" aria-label="Lý do thôi dùng" id="ts-thoi-kieu"
          tabIndex={-1}>
          {KIEU_THOI_DUNG.map((k) => (
            <button key={k.ma} type="button" role="radio" aria-checked={kieu === k.ma}
              className={`ts-chon__nut${kieu === k.ma ? " is-active" : ""}`}
              onClick={() => { setKieu(k.ma); setLoiO((l) => ({ ...l, "ts-thoi-kieu": "" })); }}>
              {k.nhan}
            </button>
          ))}
        </div>
        <LoiO loi={loiO["ts-thoi-kieu"]} />
      </div>
      <div className="ts-form__hang">
        <label className="rc-field ts-o--ngay">
          <span className="rc-field__label">Ngày thôi dùng <em>*</em></span>
          <ChonNgay id="ts-thoi-ngay" aria-label="Ngày thôi dùng" className={`rc-input${loiO["ts-thoi-ngay"] ? " is-loi" : ""}`}
            min={taiSan.ngay_su_dung.slice(0, 10)} max={homNay} value={ngay}
            onChange={(v) => setNgay(v)} />
          <LoiO loi={loiO["ts-thoi-ngay"]} />
        </label>
        <label className="rc-field">
          <span className="rc-field__label">Ghi chú</span>
          <input className="rc-input" value={ghiChu} maxLength={255}
            placeholder="Bán cho ai, hỏng vì sao…" onChange={(e) => setGhiChu(e.target.value)} />
        </label>
      </div>
    </KhungThaoTac>
  );
}

