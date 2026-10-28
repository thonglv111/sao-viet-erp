// Hộp Thêm hàng / Sửa tồn của màn Tồn kho (28/10/2026, spec `2026-10-28-kho-them-xoa-import-export`).
//
// Một dòng của file nhập tồn — cùng cột, cùng luật, cùng câu lỗi (máy chủ kiểm chung một đường).
// Trùng mã + khổ + đơn vị gốc với dòng đang có = CẬP NHẬT: số tăng thành lô mới theo giá ghi ở đây,
// số giảm thành phiếu xuất trừ lô nhập trước. Vừa gõ vừa hỏi máy chủ bản xem trước (chạy thật rồi
// rollback) nên trước khi Lưu đã thấy dòng là thêm mới hay đổi gì, cũ → mới.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

import { ApiError, api, type DonViDungDuoc, type MatHangOption } from "../../api/client";
import type { ImportExcelOut } from "../../api/rebuildCatalog";
import { Button } from "../../components/Button";
import { ChonNgay } from "../../components/ChonNgay";
import { Select, type SelectOption } from "../../components/Select";
import { OGoDinhDang } from "../../components/OGoDinhDang";

/** Dòng tồn đang có — mở hộp ở dạng Sửa tồn với đúng khoá của dòng. */
export interface DongSuaTon {
  ma: string;
  ten: string;
  khoRong: number;
  khoDai: number;
  /** Mã đơn vị gốc của dòng. */
  dvt: string;
  soLuong: number;
  viTri: string;
}

/** "1234567,5" → "1.234.567,5" — chỉ giữ chữ số và một dấu phẩy thập phân. */
export function dinhDangSo(s: string): string {
  const sach = s.replace(/[^\d,]/g, "");
  const [nguyen, ...le] = sach.split(",");
  const n = nguyen.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return le.length ? `${n},${le.join("").slice(0, 4)}` : n;
}

const soChu = (n: number) => dinhDangSo(String(n).replace(".", ","));

/** Một ô của form: nhãn + ô nhập + lỗi máy chủ trả cho đúng cột này. Đặt NGOÀI hộp — định nghĩa
 *  trong thân hộp thì mỗi phím gõ dựng lại ô và ô mất con trỏ. */
function O({ cot, bat, loi, children }: { cot: string; bat?: boolean; loi: string[]; children: ReactNode }) {
  return (
    <div className="tkh-o">
      <label>{cot}{bat && <em> *</em>}</label>
      {children}
      {loi.map((x) => <p key={x} className="tkh-loi">{x}</p>)}
    </div>
  );
}

type Form = {
  ma: string;
  kho_rong: string;
  kho_dai: string;
  dvt: string;
  so_luong: string;
  don_gia: string;
  vi_tri: string;
  hsd: string;
  ngay_nhap: string;
  ncc: string;
  ghi_chu: string;
};

export function HopThemHang({
  token,
  khoId,
  khoTen,
  dong,
  onSaved,
  onClose,
}: {
  token: string;
  khoId: number;
  khoTen: string;
  /** Có = Sửa tồn của dòng này (khoá mã + khổ + ĐVT gốc đã điền sẵn). */
  dong?: DongSuaTon | null;
  onSaved: (kq: ImportExcelOut) => void;
  onClose: () => void;
}) {
  const [f, setF] = useState<Form>({
    ma: dong?.ma ?? "",
    kho_rong: dong?.khoRong ? String(dong.khoRong) : "",
    kho_dai: dong?.khoDai ? String(dong.khoDai) : "",
    dvt: dong?.dvt ?? "",
    so_luong: dong ? soChu(dong.soLuong) : "",
    don_gia: "",
    vi_tri: dong?.viTri ?? "",
    hsd: "",
    ngay_nhap: "",
    ncc: "",
    ghi_chu: "",
  });
  const dat = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  // Chọn vật tư như ô chọn: nạp cả danh mục giấy + vật tư một lần, gõ trong danh sách lọc gần đúng
  // theo tên hoặc mã (bỏ dấu, tách từ — xem `Select`). Chọn xong thì nạp các ĐVT mặt hàng đó nhận.
  const [dsHang, setDsHang] = useState<MatHangOption[]>([]);
  const [donVi, setDonVi] = useState<DonViDungDuoc[]>([]);
  useEffect(() => {
    let song = true;
    api.matHang
      .tim(token, null, 2000)
      .then((ds) => song && setDsHang(ds.filter((x) => x.nhom !== "Thành phẩm")))
      .catch(() => song && setDsHang([]));
    return () => {
      song = false;
    };
  }, [token]);
  const hang = useMemo(
    () => dsHang.find((x) => x.ma.toLowerCase() === f.ma.trim().toLowerCase()) ?? null,
    [dsHang, f.ma],
  );
  const luaChonHang = useMemo<SelectOption<string>[]>(
    () => [...dsHang]
      .sort((a, b) => a.nhom.localeCompare(b.nhom, "vi") || a.ten.localeCompare(b.ten, "vi"))
      .map((x) => ({ value: `${x.hang_loai}:${x.hang_id}`, label: x.ten, hint: x.ma, search: x.ma, group: x.nhom })),
    [dsHang],
  );
  useEffect(() => {
    if (!hang) {
      setDonVi([]);
      return;
    }
    let song = true;
    api.matHang
      .donVi(token, hang.hang_loai, hang.hang_id)
      .then((r) => {
        if (!song) return;
        // Gộp nhóm có thể lặp tên ⇒ một đơn vị một lần.
        const thay = new Set<string>();
        const ds = r.ds.filter((d) => (thay.has(d.ma) ? false : (thay.add(d.ma), true)));
        setDonVi(ds);
        // Thêm mới mà đổi sang mã khác: ĐVT đang chọn không thuộc mã mới thì bỏ, khỏi giữ "tờ" của giấy
        // cho keo. Sửa tồn giữ nguyên — đó là đơn vị gốc của dòng.
        if (!dong) setF((x) => (ds.some((d) => d.ma === x.dvt) ? x : { ...x, dvt: "" }));
      })
      .catch(() => song && setDonVi([]));
    return () => {
      song = false;
    };
  }, [token, hang, dong]);

  // Xem trước: đủ mã + ĐVT + số lượng thì hỏi máy chủ (chờ 400 ms sau phím cuối). Lượt mới nhất thắng.
  const [xem, setXem] = useState<ImportExcelOut | null>(null);
  const [dangXem, setDangXem] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const luot = useRef(0);
  const duTruong = f.ma.trim() !== "" && f.dvt.trim() !== "" && f.so_luong.trim() !== "";
  const than = () => ({
    ma: f.ma.trim(),
    dvt: f.dvt.trim(),
    so_luong: f.so_luong.trim(),
    don_gia: f.don_gia.trim() || null,
    kho_rong: f.kho_rong.trim() || null,
    kho_dai: f.kho_dai.trim() || null,
    vi_tri: f.vi_tri.trim() || null,
    hsd: f.hsd || null,
    ngay_nhap: f.ngay_nhap || null,
    ncc: f.ncc.trim() || null,
    ghi_chu: f.ghi_chu.trim() || null,
  });
  useEffect(() => {
    if (!duTruong) {
      setXem(null);
      return;
    }
    const l = ++luot.current;
    setDangXem(true);
    const t = setTimeout(() => {
      api.kho.hang
        .them(token, khoId, { ...than(), xem_truoc: true })
        .then((kq) => l === luot.current && (setXem(kq), setLoi(null)))
        .catch((e) => l === luot.current && setLoi(e instanceof ApiError ? e.message : "Không kiểm được dòng này."))
        .finally(() => l === luot.current && setDangXem(false));
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, khoId, f, duTruong]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [busy, onClose]);

  const coDoi = !!xem && xem.hop_le && xem.tao_moi + xem.cap_nhat > 0;
  async function luu() {
    setBusy(true);
    setLoi(null);
    try {
      const kq = await api.kho.hang.them(token, khoId, than());
      if (kq.da_ghi) {
        onSaved(kq);
        onClose();
      } else setXem(kq);
    } catch (e) {
      setLoi(e instanceof ApiError ? e.message : "Không lưu được.");
    } finally {
      setBusy(false);
    }
  }

  const loiO = (cot: string) => xem?.loi.filter((l) => l.cot === cot).map((l) => l.ly_do) ?? [];
  const loiKhac = xem?.loi.filter((l) => !["Mã hàng", "Khổ rộng", "Khổ dài", "ĐVT", "Số lượng", "Đơn giá",
    "Vị trí", "Hạn dùng", "Ngày nhập", "Nhà cung cấp", "Ghi chú"].includes(l.cot)) ?? [];
  const tieuDe = dong ? "Sửa tồn" : "Thêm hàng";

  return (
    <div className="tkh-hop-man" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="tkh-hop tkh-hop--rong" role="dialog" aria-modal="true" aria-labelledby="tkh-them-tieu">
        <div className="tkh-hop__dau">
          <div>
            <h3 id="tkh-them-tieu">{tieuDe}</h3>
            <div className="tkh-bang-sub">
              <span>{dong ? dong.ten : `vào ${khoTen}`}</span>
            </div>
          </div>
          <span className="tkh-sp" />
          <button type="button" className="tkh-x" aria-label="Đóng" onClick={onClose} disabled={busy}><X /></button>
        </div>
        <div className="tkh-hop__than">
          <O cot="Vật tư" loi={loiO("Mã hàng")} bat>
            <Select<string>
              options={luaChonHang}
              value={hang ? `${hang.hang_loai}:${hang.hang_id}` : ""}
              onChange={(v) => {
                const x = dsHang.find((h) => `${h.hang_loai}:${h.hang_id}` === v);
                if (x) dat("ma", x.ma);
              }}
              placeholder={dong ? dong.ten : "Chọn giấy hoặc vật tư"}
              ariaLabel="Vật tư"
              searchable
              searchPlaceholder="Gõ tên hoặc mã…"
              portal
              disabled={!!dong}
              className="rc-input tkh-chon-hang"
            />
          </O>
          <div className="tkh-hai">
            <O cot="Khổ rộng" loi={loiO("Khổ rộng")}>
              <div className="tkh-nhap tkh-nhap--nho">
                <OGoDinhDang inputMode="numeric" value={f.kho_rong} readOnly={!!dong} aria-label="Khổ rộng"
                  onChange={(e) => dat("kho_rong", e.target.value.replace(/\D/g, ""))} />
                <span>mm</span>
              </div>
            </O>
            <O cot="Khổ dài" loi={loiO("Khổ dài")}>
              <div className="tkh-nhap tkh-nhap--nho">
                <OGoDinhDang inputMode="numeric" value={f.kho_dai} readOnly={!!dong} aria-label="Khổ dài"
                  onChange={(e) => dat("kho_dai", e.target.value.replace(/\D/g, ""))} />
                <span>mm</span>
              </div>
            </O>
          </div>
          <div className="tkh-hai">
            <O cot="Số lượng" loi={loiO("Số lượng")} bat>
              <div className="tkh-nhap tkh-nhap--nho">
                <OGoDinhDang inputMode="decimal" value={f.so_luong} aria-label="Số lượng"
                  onChange={(e) => dat("so_luong", dinhDangSo(e.target.value))} />
              </div>
            </O>
            <O cot="ĐVT" loi={loiO("ĐVT")} bat>
              {donVi.length > 0 ? (
                <select className="tkh-nhap tkh-nhap--nho tkh-chon" value={f.dvt} aria-label="ĐVT"
                  onChange={(e) => dat("dvt", e.target.value)}>
                  <option value="">Chọn đơn vị</option>
                  {/* Sửa tồn: ĐVT gốc của dòng có thể không nằm trong danh sách gộp — vẫn giữ. */}
                  {f.dvt && !donVi.some((d) => d.ma === f.dvt) && <option value={f.dvt}>{f.dvt}</option>}
                  {donVi.map((d) => <option key={d.ma} value={d.ma}>{d.ten}</option>)}
                </select>
              ) : (
                <div className="tkh-nhap tkh-nhap--nho">
                  <input value={f.dvt} aria-label="ĐVT" onChange={(e) => dat("dvt", e.target.value)} placeholder="tờ, kg, ram…" />
                </div>
              )}
            </O>
          </div>
          <div className="tkh-hai">
            <O cot="Đơn giá" loi={loiO("Đơn giá")}>
              <div className="tkh-nhap tkh-nhap--nho">
                <OGoDinhDang inputMode="decimal" value={f.don_gia} aria-label="Đơn giá"
                  onChange={(e) => dat("don_gia", dinhDangSo(e.target.value))} />
                <span>đ / {f.dvt ? (donVi.find((d) => d.ma === f.dvt)?.ten ?? f.dvt) : "ĐVT"}</span>
              </div>
            </O>
            <O cot="Vị trí" loi={loiO("Vị trí")}>
              <div className="tkh-nhap tkh-nhap--nho">
                <input value={f.vi_tri} aria-label="Vị trí" onChange={(e) => dat("vi_tri", e.target.value)} />
              </div>
            </O>
          </div>
          <div className="tkh-hai">
            <O cot="Ngày nhập" loi={loiO("Ngày nhập")}>
              <ChonNgay className="tkh-nhap tkh-nhap--nho tkh-ngay" value={f.ngay_nhap} onChange={(v) => dat("ngay_nhap", v)} aria-label="Ngày nhập" placeholder="Hôm nay" />
            </O>
            <O cot="Hạn dùng" loi={loiO("Hạn dùng")}>
              <ChonNgay className="tkh-nhap tkh-nhap--nho tkh-ngay" value={f.hsd} onChange={(v) => dat("hsd", v)} aria-label="Hạn dùng" />
            </O>
          </div>
          <div className="tkh-hai">
            <O cot="Nhà cung cấp" loi={loiO("Nhà cung cấp")}>
              <div className="tkh-nhap tkh-nhap--nho">
                <input value={f.ncc} aria-label="Nhà cung cấp" maxLength={150} onChange={(e) => dat("ncc", e.target.value)} />
              </div>
            </O>
            <O cot="Ghi chú" loi={loiO("Ghi chú")}>
              <div className="tkh-nhap tkh-nhap--nho">
                <input value={f.ghi_chu} aria-label="Ghi chú" maxLength={500} onChange={(e) => dat("ghi_chu", e.target.value)} />
              </div>
            </O>
          </div>

          <div className="tkh-tinh-ho tkh-xem-truoc" role="status" aria-live="polite">
            {!duTruong ? (
              <span>Ghi mã, số lượng và ĐVT để xem dòng này thêm mới hay cập nhật.</span>
            ) : dangXem && !xem ? (
              <span>Đang kiểm…</span>
            ) : !xem ? null : !xem.hop_le ? (
              <span className="tkh-loi">
                {loiKhac.length ? loiKhac.map((l) => l.ly_do).join(" ") : "Còn ô chưa đúng, xem dưới từng ô."}
              </span>
            ) : xem.khong_doi > 0 ? (
              <span>Không đổi gì so với tồn đang có.</span>
            ) : (
              <div className="tkh-xem-truoc__ds">
                <span>{xem.tao_moi > 0 ? "Thêm dòng mới vào kho." : "Cập nhật dòng đang có:"}</span>
                {xem.thay_doi?.map((t, i) => (
                  <span key={i}>{t.cot}: {t.cu ? `${t.cu} → ${t.moi}` : t.moi}</span>
                ))}
                {xem.canh_bao?.map((c, i) => <span key={`c${i}`} className="tkh-canh">{c.noi_dung}</span>)}
              </div>
            )}
          </div>
          {loi && <div className="banner banner--error" role="alert">{loi}</div>}
        </div>
        <div className="tkh-hop__chan">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Huỷ</Button>
          <Button variant="accent" onClick={() => void luu()} loading={busy} disabled={!coDoi || dangXem}>Lưu</Button>
        </div>
      </div>
    </div>
  );
}
