// Ngăn chi tiết Hàng thương mại (chỉ In Hà Phương, 09/11/2026) — theo khung "Ngăn chi tiết rộng hai
// cột" của docs/mockups/hang-thuong-mai-3-phuong-an.html, tham khảo trang thêm sản phẩm của Sapo:
// cột trái để khai (Mã, Tên, bảng Đơn vị bán và giá, Ghi chú), cột phải để xem nhanh (thẻ Trạng thái
// có công tắc Đang bán, thẻ Tồn hiện có). Đang sửa thì có thêm tab Tồn theo kho và Lịch sử.
//
// Dữ liệu và luật y như form chung: ghi `don_vi_gia` / `don_vi_them` / `gia_ban_theo_dvt` / `ghi_chu`
// / `active` vào cùng đường `PUT /hang-thuong-mai/{id}`; máy chủ vẫn là cửa chặn (bỏ đơn vị còn tồn,
// đơn vị cùng nhóm quy đổi, giá của người không có ô Xem giá).
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { useCan } from "../../auth/permissions";
import { useAuth } from "../../auth/useAuth";
import { ApiError, authed } from "../../api/client";
import { crud, type Row } from "../../api/rebuildCatalog";
import { Button } from "../../components/Button";
import { DiscardChangesDialog } from "../../components/DiscardChangesDialog";
import { useTre } from "../../lib/useTre";
import { tenDonVi, useNapTenDonVi } from "../tenDonVi";
import { Drawer } from "./components/Drawer";
import { NhatKyTab } from "./nhat-ky/NhatKyTab";
import { ODonViBanGia } from "./ODonViBanGia";
import { chuan } from "./ODonViNhieu";
import type { NganDanhMucProps } from "./types";

type Tab = "thong-tin" | "ton-kho" | "lich-su";
type TonKho = { kho_id: number; kho_ma: string; kho_ten: string; don_vi: string; sl: number };

const so = (n: number) => n.toLocaleString("vi-VN");
const bangSo = (v: unknown): Record<string, number> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, number>) : {};

/** Đơn vị đã khai của form: chính trước, thêm sau, bỏ trùng. */
const dvKhai = (f: Record<string, unknown>) => {
  const ds = [chuan(String(f.don_vi_gia ?? "")),
    ...(Array.isArray(f.don_vi_them) ? (f.don_vi_them as unknown[]).map((m) => chuan(String(m))) : [])];
  return ds.filter((m, i) => m && ds.indexOf(m) === i);
};

export function NganHangThuongMai({ config, existing, onClose, onSaved }: NganDanhMucProps) {
  const { token } = useAuth();
  const can = useCan();
  useNapTenDonVi();
  const api = useMemo(() => crud(config.prefix), [config.prefix]);
  const isEdit = existing != null;
  const coGia = config.moduleQuyen ? can(config.moduleQuyen, "view_cost") : true;

  const [form, setForm] = useState<Record<string, unknown>>(() => ({
    ma: existing?.ma ?? "",
    ten: existing?.ten ?? "",
    don_vi_gia: existing?.don_vi_gia ?? "",
    don_vi_them: Array.isArray(existing?.don_vi_them) ? existing.don_vi_them : [],
    gia_ban_theo_dvt: existing?.gia_ban_theo_dvt ?? {},
    ghi_chu: existing?.ghi_chu ?? "",
    active: existing ? existing.active !== false : true,
  }));
  const set = (k: string, v: unknown) => setForm((p) => ({ ...p, [k]: v }));
  const [tab, setTab] = useState<Tab>("thong-tin");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Hỏi "bỏ thay đổi?" khi đóng mà form lệch bản lúc mở — cùng khuôn với `CatalogDrawer`.
  const mocBanDau = useRef(form);
  const formMoiNhat = useRef(form);
  formMoiNhat.current = form;
  const [hoiBo, setHoiBo] = useState(false);
  const yeuCauDong = useCallback(() => {
    if (hoiBo) return;
    if (JSON.stringify(formMoiNhat.current) !== JSON.stringify(mocBanDau.current)) { setHoiBo(true); return; }
    onClose();
  }, [hoiBo, onClose]);

  // Danh mục Đơn vị cho ô chọn — bỏ mục ngừng dùng, trừ mục mặt hàng đang dùng.
  const [donVi, setDonVi] = useState<Row[]>(() => (token ? crud("/api/don-vi").daNho(token) ?? [] : []));
  useEffect(() => {
    if (!token) return;
    let song = true;
    const { nho, moi } = crud("/api/don-vi").thamChieu(token);
    if (nho) setDonVi(nho);
    moi.then((r) => { if (song) setDonVi(r); }).catch(() => {});
    return () => { song = false; };
  }, [token]);
  const dangDung = useMemo(() => new Set(dvKhai(form)), [form]);
  const donViChon = useMemo(
    () => donVi.filter((d) => d.active !== false || dangDung.has(chuan(String(d.ma)))),
    [donVi, dangDung],
  );

  // Cảnh báo trùng mã sớm (máy chủ vẫn chặn thật) — chỉ khi tạo mới.
  const maGo = String(form.ma ?? "").trim().toUpperCase();
  const maTre = useTre(maGo, 400);
  const [maTrung, setMaTrung] = useState(false);
  useEffect(() => {
    if (isEdit || !maTre || !token) { setMaTrung(false); return; }
    let huy = false;
    api.list(token, { q: maTre, size: 50 })
      .then((r) => { if (!huy) setMaTrung(r.items.some((x) => String(x.ma).trim().toUpperCase() === maTre)); })
      .catch(() => { if (!huy) setMaTrung(false); });
    return () => { huy = true; };
  }, [isEdit, maTre, token, api]);

  // Tab Tồn theo kho: hỏi máy chủ khi mở tab lần đầu.
  const [tonKho, setTonKho] = useState<TonKho[] | null>(null);
  const [loiTonKho, setLoiTonKho] = useState<string | null>(null);
  useEffect(() => {
    if (tab !== "ton-kho" || !isEdit || !token || tonKho) return;
    let song = true;
    authed<TonKho[]>(`${config.prefix}/${existing!.id}/ton-theo-kho`, token)
      .then((r) => { if (song) setTonKho(r); })
      .catch((e) => { if (song) setLoiTonKho(e instanceof ApiError ? e.message : "Không tải được tồn theo kho."); });
    return () => { song = false; };
  }, [tab, isEdit, token, tonKho, config.prefix, existing]);

  async function luu(e?: FormEvent) {
    e?.preventDefault();
    if (!token || maTrung) return;
    if (!maGo || !String(form.ten ?? "").trim()) { setErr("Nhập đủ Mã và Tên hàng."); setTab("thong-tin"); return; }
    setSaving(true); setErr(null);
    const body: Record<string, unknown> = {
      ma: form.ma,
      ten: form.ten,
      don_vi_them: Array.isArray(form.don_vi_them) ? form.don_vi_them : [],
      ghi_chu: String(form.ghi_chu ?? "").trim() || null,
      active: form.active !== false,
    };
    if (form.don_vi_gia) body.don_vi_gia = form.don_vi_gia;
    // Không có ô Xem giá thì không gửi giá: máy chủ giữ giá cũ, khỏi gửi `{}` xoá trắng giá người khác đặt.
    if (coGia) body.gia_ban_theo_dvt = bangSo(form.gia_ban_theo_dvt);
    try {
      const moi = isEdit && existing ? await api.update(token, existing.id, body) : await api.create(token, body);
      mocBanDau.current = form;
      onSaved(moi);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Lưu thất bại.");
      setTab("thong-tin");
    } finally {
      setSaving(false);
    }
  }

  // Tồn hiện có: đơn vị đã khai trước (theo thứ tự bảng), rồi đơn vị lạ còn tồn từ lô cũ.
  const ton = bangSo(existing?.ton_theo_dvt);
  const dongTon = useMemo(() => {
    const thuTu = [...dvKhai(form), ...Object.keys(ton).map(chuan)];
    return thuTu.filter((m, i) => thuTu.indexOf(m) === i && (ton[m] ?? 0) > 0);
  }, [form, ton]);
  const tenDv = (ma: string) => {
    const d = donVi.find((x) => chuan(String(x.ma)) === ma);
    return d ? String(d.ten || d.ma) : tenDonVi(ma) ?? ma;
  };

  const tabs = isEdit && (
    <div className="htm-tabs" role="tablist" aria-label="Phần của ngăn">
      {([["thong-tin", "Thông tin"], ["ton-kho", "Tồn theo kho"], ["lich-su", "Lịch sử"]] as [Tab, string][])
        .map(([id, nhan]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id}
            className={`htm-tab${tab === id ? " is-on" : ""}`} onClick={() => setTab(id)}>{nhan}</button>
        ))}
    </div>
  );

  return (
    <Drawer
      lop="htm-ngan"
      kicker={isEdit ? String(existing!.ma) : "Thêm mới"}
      title={isEdit ? String(existing!.ten) : config.title}
      duoiDau={tabs}
      onClose={yeuCauDong}
      foot={
        <>
          <Button type="button" variant="ghost" onClick={yeuCauDong}>Huỷ</Button>
          <Button type="button" variant="primary" loading={saving} disabled={maTrung} onClick={() => luu()}>
            {isEdit ? "Lưu" : "Tạo mới"}
          </Button>
        </>
      }
    >
      <form className="rc-drawer__body htm-than" onSubmit={luu}>
        {err && <div className="banner banner--error">{err}</div>}

        {tab === "thong-tin" && (
          <div className="htm-ben">
            <div className="htm-trai">
              <section className="htm-nhom">
                <h3>Thông tin chung</h3>
                <label className="htm-dong">
                  <span>Mã <em>*</em></span>
                  <span>
                    <input className="rc-input rc-mono" aria-label="Mã" value={String(form.ma ?? "")} disabled={isEdit}
                      onChange={(e) => set("ma", e.target.value.toUpperCase())} />
                    {maTrung && <span className="htm-loi">Mã đã tồn tại.</span>}
                  </span>
                </label>
                <label className="htm-dong">
                  <span>Tên hàng <em>*</em></span>
                  <input className="rc-input" aria-label="Tên hàng" value={String(form.ten ?? "")} onChange={(e) => set("ten", e.target.value)} />
                </label>
              </section>

              <section className="htm-nhom">
                <h3>Đơn vị bán và giá</h3>
                <ODonViBanGia
                  chinh={String(form.don_vi_gia ?? "")}
                  them={Array.isArray(form.don_vi_them) ? (form.don_vi_them as string[]) : []}
                  gia={form.gia_ban_theo_dvt}
                  giaNhap={isEdit ? (existing!.gia_nhap_gan_nhat as Record<string, number> | null) ?? {} : undefined}
                  donVi={donViChon}
                  coGia={coGia}
                  onChange={(v) => setForm((p) => ({ ...p, ...v }))}
                />
              </section>

              <section className="htm-nhom">
                <h3>Ghi chú</h3>
                <input className="rc-input" aria-label="Ghi chú" placeholder="Ghi chú thêm"
                  value={String(form.ghi_chu ?? "")} onChange={(e) => set("ghi_chu", e.target.value)} />
              </section>
            </div>

            <aside className="htm-phai">
              <section className="htm-the">
                <h3>Trạng thái</h3>
                <div className="htm-gat">
                  <span>{form.active !== false ? "Đang bán" : "Ngừng bán"}</span>
                  <button type="button" role="switch" aria-checked={form.active !== false} aria-label="Đang bán"
                    className={`htm-cong-tac${form.active !== false ? " is-on" : ""}`}
                    onClick={() => set("active", form.active === false)} />
                </div>
                <p className="htm-nho">Ngừng bán thì không chọn được trên đơn thương mại.</p>
              </section>
              {isEdit && (
                <section className="htm-the">
                  <h3>Tồn hiện có</h3>
                  {dongTon.length === 0 ? (
                    <div className="htm-gat"><span className="htm-cam">Hết hàng</span></div>
                  ) : dongTon.map((m) => (
                    <div className="htm-gat" key={m}><span>{tenDv(m)}</span><span className="htm-so-to">{so(ton[m])}</span></div>
                  ))}
                  <p className="htm-nho">Cộng mọi kho. Xem từng kho ở tab Tồn theo kho.</p>
                </section>
              )}
            </aside>
          </div>
        )}

        {tab === "ton-kho" && isEdit && (
          loiTonKho ? <div className="banner banner--error">{loiTonKho}</div>
          : !tonKho ? <p className="htm-nho">Đang tải…</p>
          : tonKho.length === 0 ? <p className="htm-nho">Chưa có lô tồn ở kho nào.</p>
          : (
            <table className="rc-dvbg__bang htm-ton-kho">
              <thead><tr><th>Kho</th><th>Đơn vị</th><th className="rc-dvbg__so">Tồn</th></tr></thead>
              <tbody>
                {tonKho.map((d) => (
                  <tr key={`${d.kho_id}-${d.don_vi}`}>
                    <td>{d.kho_ten}</td>
                    <td>{tenDv(chuan(d.don_vi))}</td>
                    <td className="rc-dvbg__so">{so(d.sl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {tab === "lich-su" && isEdit && config.nhatKyLoai && (
          <NhatKyTab loai={config.nhatKyLoai} id={Number(existing!.id)} />
        )}
      </form>

      <DiscardChangesDialog
        open={hoiBo}
        onDiscard={() => { setHoiBo(false); onClose(); }}
        onKeepEditing={() => setHoiBo(false)}
      />
    </Drawer>
  );
}
