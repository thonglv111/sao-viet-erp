// Hộp "Cách giao" của Xuất hàng — chỉ bản cài bật `giao_hang_hp` (docs/design-giao-hang-ha-phuong.md).
// Dùng chung cho Xuất hàng đơn sản xuất (TienDoDon) và đơn thương mại (DonThuongMai). Bắt buộc chọn
// một trong ba cách; máy chủ kiểm lại y hệt (`services/giao_hang_hp/phuong_thuc.kiem`).
import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { OGoDinhDang } from "../../components/OGoDinhDang";
import {
  giaoHangHpApi, NHAN_CACH_GIAO, type CachGiaoInput, type DonViVc, type LoaiCachGiao, type NguoiGiao,
  type XeGiaoHang,
} from "../../api/giaoHangHp";
import "./chon-cach-giao.css";

export interface CachGiao {
  loai: LoaiCachGiao | "";
  nguoiGiaoId: string;
  xeId: string;
  donViVcId: string;
  tienCuoc: string;
  maVanDon: string;
}

export const CACH_GIAO_TRONG: CachGiao = {
  loai: "", nguoiGiaoId: "", xeId: "", donViVcId: "", tienCuoc: "", maVanDon: "",
};

/** Lý do chưa bấm Xuất được (chân form) — null là đủ. */
export function loiCachGiao(v: CachGiao): string | null {
  if (!v.loai) return "Chọn cách giao";
  if (v.loai === "noi_bo" && !v.nguoiGiaoId) return "Chọn người giao";
  if (v.loai === "dich_vu" && !v.donViVcId) return "Chọn đơn vị vận chuyển";
  if (v.loai === "dich_vu" && v.tienCuoc === "") return "Gõ tiền cước";
  return null;
}

export function boCachGiao(v: CachGiao): CachGiaoInput {
  const so = (s: string) => (s ? Number(s) : null);
  if (v.loai === "noi_bo") return { loai: "noi_bo", nguoi_giao_id: so(v.nguoiGiaoId), xe_id: so(v.xeId) };
  if (v.loai === "dich_vu") {
    return { loai: "dich_vu", don_vi_vc_id: so(v.donViVcId), tien_cuoc: Number(v.tienCuoc || 0),
      ma_van_don: v.maVanDon.trim() || null };
  }
  return { loai: "khong_giao" };
}

const MO_TA: Record<LoaiCachGiao, string> = {
  khong_giao: "Khách tự lấy hàng",
  noi_bo: "Nhân viên giao hàng của mình đi giao",
  dich_vu: "Thuê đơn vị vận chuyển, có tiền cước",
};

const chuSo = (s: string) => s.replace(/\D/g, "");

export function ChonCachGiao({ value, onChange, oInput = "input" }: {
  value: CachGiao;
  onChange: (v: CachGiao) => void;
  /** Lớp CSS của ô nhập theo màn chứa hộp (`input` hoặc `dhb__input`). */
  oInput?: string;
}) {
  const { token } = useAuth();
  const [nguoi, setNguoi] = useState<NguoiGiao[] | null>(null);
  const [xe, setXe] = useState<XeGiaoHang[]>([]);
  const [dvvc, setDvvc] = useState<DonViVc[] | null>(null);
  const [loi, setLoi] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let bo = false;
    Promise.all([giaoHangHpApi.nguoiGiao(token), giaoHangHpApi.xe(token), giaoHangHpApi.donViVc(token)])
      .then(([n, x, d]) => {
        if (bo) return;
        setNguoi(n.items);
        setXe(x.items);
        setDvvc(d.items);
      })
      .catch((e: unknown) => { if (!bo) setLoi(e instanceof Error ? e.message : "Không tải được danh sách"); });
    return () => { bo = true; };
  }, [token]);

  const doi = (p: Partial<CachGiao>) => onChange({ ...value, ...p });
  const chonNguoi = (id: string) => {
    // Chọn người thì ô Xe tự điền xe người đó phụ trách; người không phụ trách xe nào thì giữ ô Xe.
    const n = nguoi?.find((x) => String(x.id) === id);
    doi({ nguoiGiaoId: id, xeId: n?.xe_id != null ? String(n.xe_id) : value.xeId });
  };

  return (
    <fieldset className="ccg">
      <legend className="ccg__nhan">Cách giao <b>*</b></legend>
      <div className="ccg__loai" role="radiogroup" aria-label="Cách giao">
        {(Object.keys(NHAN_CACH_GIAO) as LoaiCachGiao[]).map((k) => (
          <label key={k} className={`ccg__the ${value.loai === k ? "is-on" : ""}`}>
            <input type="radio" name="ccg-loai" value={k} checked={value.loai === k}
              onChange={() => doi({ loai: k })} aria-label={NHAN_CACH_GIAO[k]} />
            <span className="ccg__the-ten">{NHAN_CACH_GIAO[k]}</span>
            <span className="ccg__the-phu">{MO_TA[k]}</span>
          </label>
        ))}
      </div>

      {value.loai === "noi_bo" && (
        <div className="ccg__luoi">
          <label className="ccg__o">
            <span>Người giao <b>*</b></span>
            <select className={oInput} aria-label="Người giao" value={value.nguoiGiaoId}
              onChange={(e) => chonNguoi(e.target.value)}>
              <option value="">Chọn người…</option>
              {(nguoi ?? []).map((n) => (
                <option key={n.id} value={n.id}>{n.bo_phan ? `${n.ten} (${n.bo_phan})` : n.ten}</option>
              ))}
            </select>
            {nguoi && nguoi.length === 0 && (
              <span className="ccg__goi-y">Chưa có ai ở bộ phận giao hàng. Bật cờ Bộ phận giao hàng ở màn Phòng ban.</span>
            )}
          </label>
          <label className="ccg__o">
            <span>Xe</span>
            <select className={oInput} aria-label="Xe" value={value.xeId} onChange={(e) => doi({ xeId: e.target.value })}>
              <option value="">Không dùng xe của công ty</option>
              {xe.map((x) => <option key={x.id} value={x.id}>{`${x.ma} ${x.ten}`}</option>)}
            </select>
          </label>
        </div>
      )}

      {value.loai === "dich_vu" && (
        <div className="ccg__luoi">
          <label className="ccg__o ccg__o--rong">
            <span>Đơn vị vận chuyển <b>*</b></span>
            <select className={oInput} aria-label="Đơn vị vận chuyển" value={value.donViVcId}
              onChange={(e) => doi({ donViVcId: e.target.value })}>
              <option value="">Chọn đơn vị…</option>
              {(dvvc ?? []).map((d) => <option key={d.id} value={d.id}>{d.ten}</option>)}
            </select>
            {dvvc && dvvc.length === 0 && (
              <span className="ccg__goi-y">Chưa có nhà cung cấp nào bật cờ Đơn vị vận chuyển (màn Nhà cung cấp).</span>
            )}
          </label>
          <label className="ccg__o">
            <span>Tiền cước <b>*</b></span>
            <span className="ccg__tien">
              <OGoDinhDang className={oInput} inputMode="numeric" aria-label="Tiền cước"
                value={value.tienCuoc === "" ? "" : Number(value.tienCuoc).toLocaleString("vi-VN")}
                onChange={(e) => doi({ tienCuoc: chuSo(e.target.value) })} />
              <span>đ</span>
            </span>
            <span className="ccg__goi-y">Kế toán thấy khoản này ở Phiếu chi, mục Cước chờ chi.</span>
          </label>
          <label className="ccg__o">
            <span>Mã vận đơn</span>
            <input className={oInput} aria-label="Mã vận đơn" maxLength={100} value={value.maVanDon}
              onChange={(e) => doi({ maVanDon: e.target.value })} />
          </label>
        </div>
      )}

      {loi && <span className="ccg__goi-y is-loi">{loi}</span>}
    </fieldset>
  );
}
