// Trang Tạo đơn thương mại — chỉ In Hà Phương (docs/design-hang-thuong-mai-ha-phuong.md §6, phương án C).
// Khuôn trang Tạo đơn hàng của Sapo: trái là Mặt hàng + Xuất hàng, phải là Khách hàng + Thanh toán kiểu
// quầy + Ghi chú. Một lần bấm: tạo, chốt, xuất hết hàng, lập phiếu thu theo đơn (`POST /api/thuong-mai/ban-nhanh`).
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, type OrderDetail } from "../../api/client";
import { duKienCua, thuongMaiApi, type DongThuongMaiInput, type KhoXuat } from "../../api/thuongMai";
import { useAuth } from "../../auth/useAuth";
import { useCan, useTat } from "../../auth/permissions";
import { OGoDinhDang } from "../../components/OGoDinhDang";
import { OChonKhach } from "../../components/ChonKhachHang";
import { OChonGon } from "../../components/OChonGon";
import { soVN } from "../../components/LuoiDs";
import { boCachGiao, CACH_GIAO_TRONG, ChonCachGiao, loiCachGiao, type CachGiao } from "../giao-hang-hp/ChonCachGiao";
import { useTaiKhoanNhan } from "../ke-toan/phieu-thu/shared/taiKhoanNhan";
import {
  CHUA_CO_KHO_TM, ChonHang, chuCk, chuSo, daNho, dongMoi, dvtCua, giaKhai, goCk, goiNho, loi, soCk, thanhTienDong, tongGomVat,
  useTenDvt, type Dong, type KhachChon,
} from "./DonThuongMai";
import "./don-thuong-mai.css";
import "./tao-don-thuong-mai.css";

type CachNhan = "cash" | "bank_transfer";

const soLe = (v: number) => Number(v.toFixed(3)).toLocaleString("vi-VN");
const tienO = (s: string) => (s ? Number(s).toLocaleString("vi-VN") : "");

/** Mức gợi ý tiền khách đưa: đúng số, làm tròn lên chục nghìn, trăm nghìn, năm trăm nghìn. */
export function mucGoiY(tong: number): number[] {
  if (tong <= 0) return [];
  const len = (b: number) => Math.ceil(tong / b) * b;
  return [tong, len(10_000), len(100_000), len(500_000)].filter((v, i, a) => a.indexOf(v) === i);
}

/** Chữ nút chính theo hai lựa chọn Thanh toán và Xuất hàng. */
export function nhanNutChinh(traNgay: boolean, xuatNgay: boolean): string {
  if (traNgay && xuatNgay) return "Tạo, chốt, xuất hàng và thu tiền";
  if (traNgay) return "Tạo, chốt và thu tiền";
  if (xuatNgay) return "Tạo, chốt và xuất hàng";
  return "Tạo và chốt đơn";
}

/** Tải một Blob về máy với tên cho trước. */
function taiVe(blob: Blob, ten: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = ten;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TaoDonThuongMai({ order, onClose, onSaved, onDoDang, navigate }: {
  /** Có = "Sửa đơn" của đơn nháp: mở lại đúng trang này, sửa được mọi ô; nút chính chốt / xuất / thu trên
   *  chính đơn đó (14/11/2026). */
  order?: OrderDetail;
  onClose: () => void;
  /** Lưu xong (nháp hoặc đã chốt) — mở ngăn đơn. */
  onSaved: (d: OrderDetail) => void;
  /** Đơn đã tạo nhưng bước sau hỏng — nạp lại danh sách để thấy đơn. */
  onDoDang: () => void;
  /** Mở màn khác (Tạo yêu cầu mua điền sẵn phần thiếu). Vắng thì không có nút đó. */
  navigate?: (id: string, params?: Record<string, unknown>) => void;
}) {
  const { token } = useAuth();
  const can = useCan();
  const tat = useTat();
  const tenDvt = useTenDvt();
  const thuDuoc = can("phieu_thu", "create");
  // Lập yêu cầu mua = đúng ô của màn Yêu cầu mua hàng, như ngăn mặt hàng và màn Tồn kho.
  const coTheMua = !!navigate && can("yeu_cau_mua_hang", "read") && can("yeu_cau_mua_hang", "create");
  const oFile = useRef<HTMLInputElement>(null);
  const coCachGiao = !tat("giao_hang_hp");
  // Sửa đơn nháp: mở lại đúng Xuất hàng + Thanh toán đã chọn lúc Lưu nháp (14/11/2026).
  const dk = order ? duKienCua(order) : null;
  const ptDk = dk?.phuong_thuc;

  const [khach, setKhach] = useState<KhachChon | null>(
    order?.customer_id ? { id: order.customer_id, name: order.customer_name ?? "" } : null);
  const [dong, setDong] = useState<Dong[]>([dongMoi()]);
  const [ghiChu, setGhiChu] = useState(order?.delivery_note ?? "");
  // Thanh toán
  const [traNgay, setTraNgay] = useState(dk ? dk.tra_ngay && thuDuoc : thuDuoc);
  const [cachNhan, setCachNhan] = useState<CachNhan>(dk?.cach_nhan ?? "cash");
  const [dua, setDua] = useState("");
  const [duaSua, setDuaSua] = useState(false);
  const [tkId, setTkId] = useState<number | null>(dk?.company_bank_account_id ?? null);
  const [maGd, setMaGd] = useState("");
  const [coc, setCoc] = useState(order?.deposit_amount ? String(order.deposit_amount) : "");
  const { taiKhoan, dangTai, loiTai } = useTaiKhoanNhan("VND");
  // Xuất hàng
  const [xuatNgay, setXuatNgay] = useState(dk ? dk.xuat_ngay : true);
  // Danh sách kho đã gọi trước từ màn Đơn hàng bán (`napTruocThuongMai`) ⇒ ô Kho xuất có ngay.
  const [khos, setKhos] = useState<KhoXuat[]>(() => daNho<KhoXuat[]>("kho-xuat") ?? []);
  const [khoId, setKhoId] = useState<number | null>(() => dk?.kho_id ?? daNho<KhoXuat[]>("kho-xuat")?.[0]?.id ?? null);
  const [khoDaTai, setKhoDaTai] = useState(() => daNho<KhoXuat[]>("kho-xuat") !== undefined);
  // Bán tại tiệm: mặc định khách tự lấy hàng, cần giao thì người bán chọn lại.
  const [cach, setCach] = useState<CachGiao>(() => ptDk?.loai ? {
    loai: ptDk.loai, nguoiGiaoId: ptDk.nguoi_giao_id ? String(ptDk.nguoi_giao_id) : "",
    xeId: ptDk.xe_id ? String(ptDk.xe_id) : "", donViVcId: ptDk.don_vi_vc_id ? String(ptDk.don_vi_vc_id) : "",
    tienCuoc: ptDk.tien_cuoc != null ? String(ptDk.tien_cuoc) : "", maVanDon: ptDk.ma_van_don ?? "",
  } : { ...CACH_GIAO_TRONG, loai: "khong_giao" });
  const kho = khos.find((k) => k.id === khoId) ?? null;
  // Tồn từng dòng theo ĐVT của dòng: khoá `${hang_id}|${dvt}`. Nhớ kèm kho đã hỏi để
  // lúc vừa đổi kho không hiện tên kho mới với số của kho cũ.
  const [tonHoi, setTonHoi] = useState<{ kho: number | null; so: Record<string, number> }>({ kho: null, so: {} });

  const [luu, setLuu] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    goiNho("kho-xuat", () => thuongMaiApi.khoXuat(token))
      .then((ds) => { setKhos(ds); setKhoDaTai(true); setKhoId((cu) => cu ?? ds[0]?.id ?? null); })
      .catch((e) => setErr(loi(e, "Không tải được danh sách kho.")));
  }, [token]);

  const khoaTon = dong.filter((d) => d.hang && d.dvt).map((d) => `${d.hang!.id}|${d.dvt}`).sort().join(",");
  const khoTon = xuatNgay ? khoId : null;
  useEffect(() => {
    if (!token || !khoaTon) { setTonHoi({ kho: khoTon, so: {} }); return; }
    const lines = khoaTon.split(",").map((k) => { const [id, dvt] = k.split("|"); return { hang_id: Number(id), dvt, qty: 1 }; });
    let bo = false;
    const t = window.setTimeout(() => {
      thuongMaiApi.ton(token, khoTon, lines)
        .then((r) => { if (!bo) setTonHoi({ kho: khoTon, so: Object.fromEntries(r.map((x) => [`${x.hang_id}|${x.dvt}`, x.ton])) }); })
        .catch(() => { if (!bo) setTonHoi({ kho: khoTon, so: {} }); });
    }, 200);
    return () => { bo = true; window.clearTimeout(t); };
  }, [token, khoaTon, khoTon]);
  const ton = tonHoi.kho === khoTon ? tonHoi.so : {};
  // Thiếu = số lượng vượt tồn (kho xuất đang chọn, hoặc cộng mọi kho khi Xuất sau).
  const thieuCua = (d: Dong) => {
    const t = d.hang && d.dvt ? ton[`${d.hang.id}|${d.dvt}`] : undefined;
    const sl = Number(d.qty) || 0;
    return t != null && t < sl ? sl - t : 0;
  };
  const dongThieu = dong.filter((d) => d.hang && thieuCua(d) > 0);

  // Sửa đơn: nạp lại mặt hàng của từng dòng từ danh mục (cần ĐVT + giá khai).
  useEffect(() => {
    if (!token || !order) return;
    thuongMaiApi.hang(token, "").then((r) => {
      const theoId = new Map(r.items.map((h) => [h.id, h]));
      setDong(order.lines.map((l) => {
        const h = l.hang_thuong_mai_id != null ? theoId.get(l.hang_thuong_mai_id) ?? null : null;
        const ten = (l.don_vi_tinh ?? "").toLowerCase();
        const dvt = h ? (dvtCua(h).find((m) => m === ten || tenDvt(m).toLowerCase() === ten) ?? h.don_vi_gia) : "";
        return { ...dongMoi(), hang: h, dvt, qty: String(l.qty),
          gia: l.unit_price_snapshot != null ? String(l.unit_price_snapshot) : "", vat: String(l.vat_pct_estimate ?? 0),
          ck: chuCk(l.ck_pct) };
      }));
    }).catch((e) => setErr(loi(e, "Không tải được mặt hàng của đơn.")));
  }, [token, order, tenDvt]);

  const sua = (k: number, p: Partial<Dong>) => setDong((ds) => ds.map((d) => (d.khoa === k ? { ...d, ...p } : d)));
  // Luôn chừa đúng một dòng trống cuối bảng để gõ món tiếp (thay nút "Thêm mặt hàng").
  useEffect(() => {
    if (dong.length === 0 || dong[dong.length - 1].hang) setDong((ds) => [...ds, dongMoi()]);
  }, [dong]);
  const giaDong = (d: Dong) => (d.gia !== "" ? Number(d.gia) : giaKhai(d));
  const tong = useMemo(() => tongGomVat(dong.filter((d) => d.hang).map((d) => ({
    g: d.gia !== "" ? Number(d.gia) : giaKhai(d), sl: Number(d.qty) || 0, ck: d.ck, vat: d.vat }))), [dong]);

  // Tiền khách đưa bám theo tổng cho tới khi người bán tự gõ.
  useEffect(() => { if (!duaSua) setDua(tong > 0 ? String(tong) : ""); }, [tong, duaSua]);
  const soDua = Number(dua || 0);
  const phieuGhi = Math.min(soDua, tong);
  const traLai = cachNhan === "cash" ? Math.max(0, soDua - tong) : 0;
  const conPhaiThu = Math.max(0, tong - phieuGhi);
  // Sửa đơn nháp: đơn đã có nên nút nói "Lưu" thay cho "Tạo".
  const nutChinh = order ? nhanNutChinh(traNgay, xuatNgay).replace(/^Tạo/, "Lưu") : nhanNutChinh(traNgay, xuatNgay);

  function dongGui(): DongThuongMaiInput[] | null {
    if (!khach) { setErr("Chọn khách hàng cho đơn."); return null; }
    const lines: DongThuongMaiInput[] = [];
    for (const d of dong) {
      if (!d.hang) continue; // dòng trống cuối bảng để gõ món tiếp
      const sl = Number(d.qty);
      if (!Number.isInteger(sl) || sl <= 0) { setErr(`Số lượng của «${d.hang.ten}» phải là số nguyên lớn hơn 0.`); return null; }
      if (giaDong(d) == null) { setErr(`«${d.hang.ten}» chưa có giá bán theo đơn vị này, gõ đơn giá.`); return null; }
      lines.push({ hang_id: d.hang.id, dvt: d.dvt, qty: sl, don_gia: d.gia !== "" ? Number(d.gia) : null, vat_pct: Number(d.vat) || 0,
        ck_pct: soCk(d.ck) });
    }
    if (lines.length === 0) { setErr("Chọn ít nhất một mặt hàng."); return null; }
    return lines;
  }

  /** Lưu nháp; trả đơn vừa lưu (null khi lỗi, lỗi đã hiện ở chân trang). */
  async function ghiNhap(): Promise<OrderDetail | null> {
    if (!token || luu) return null;
    const lines = dongGui();
    if (!lines || !khach) return null;
    setLuu(true);
    setErr(null);
    try {
      const body = { customer_id: khach.id, lines,
        deposit_amount: !traNgay && coc ? Number(coc) : null, ghi_chu: ghiChu.trim() || null,
        // Giữ Xuất hàng + Thanh toán đang chọn để mở Sửa thấy đúng, ngăn đơn hiện ra (14/11/2026).
        du_kien: {
          xuat_ngay: xuatNgay, kho_id: xuatNgay ? khoId : null,
          phuong_thuc: xuatNgay && coCachGiao && cach.loai ? boCachGiao(cach) : null,
          tra_ngay: traNgay, cach_nhan: traNgay ? cachNhan : null,
          company_bank_account_id: traNgay && cachNhan === "bank_transfer" ? tkId : null,
        } };
      return order ? await thuongMaiApi.suaDon(token, order.id, body) : await thuongMaiApi.taoDon(token, body);
    } catch (e) {
      setErr(loi(e, "Không lưu được đơn."));
      return null;
    } finally {
      setLuu(false);
    }
  }

  async function luuNhap() {
    const d = await ghiNhap();
    if (d) onSaved(d);
  }

  // Thiếu tồn (16/11/2026): lưu nháp để đơn có mã, rồi mở form Tạo yêu cầu mua điền sẵn đúng phần thiếu
  // của từng dòng, gắn mã đơn ở ô Chứng từ liên quan. Ngày cần hàng để người lập gõ.
  async function muaPhanThieu() {
    if (!navigate || dongThieu.length === 0) return;
    const thieu = dongThieu.map((d) => ({ d, sl: thieuCua(d) }));
    const o = await ghiNhap();
    if (!o) return;
    navigate("yeu-cau-mua-hang", {
      purchaseSeedLines: thieu.map(({ d, sl }) => ({
        hang_loai: "vat_tu", hang_id: d.hang!.id, item_name: d.hang!.ten, unit: d.dvt, quantity: sl, note: null,
      })),
      purchaseSeedPurpose: `Mua hàng cho đơn ${o.order_no}`,
      purchaseSeedHeader: {
        source_type: "kinh_doanh", loai_mua: "theo_yeu_cau", needed_date: null,
        related_document_type: "don_hang_ban", related_document_code: o.order_no,
      },
    });
  }

  // Excel dòng hàng (16/11/2026), không có cột đơn giá (giá lấy giá khai, chưa khai thì gõ trên trang): Tải mẫu = file
  // kẻ sẵn dòng kèm trang Danh mục hàng; Xuất = các dòng đang có trên trang;
  // Nhập = máy chủ đọc và kiểm file rồi trả dòng, trang thêm các dòng đó vào bảng (chưa lưu gì).
  const [dangExcel, setDangExcel] = useState(false);
  async function xuatExcel(mau: boolean) {
    if (!token || dangExcel) return;
    setDangExcel(true);
    setErr(null);
    try {
      const lines = mau ? [] : dong.filter((d) => d.hang).map((d) => ({
        hang_id: d.hang!.id, dvt: d.dvt, qty: Number(d.qty) || 0, vat_pct: Number(d.vat) || 0, ck_pct: soCk(d.ck) }));
      taiVe(await thuongMaiApi.xuatExcelDong(token, lines),
        mau ? "mau-dong-don-thuong-mai.xlsx" : `${order?.order_no ?? "don-thuong-mai"}.xlsx`);
    } catch (e) {
      setErr(loi(e, "Không tải được file."));
    } finally {
      setDangExcel(false);
    }
  }
  async function nhapExcel(f: File) {
    if (!token || dangExcel) return;
    setDangExcel(true);
    setErr(null);
    try {
      const ds = await thuongMaiApi.nhapExcelDong(token, f);
      setDong((cu) => [...cu.filter((d) => d.hang), ...ds.map((x) => ({
        ...dongMoi(), hang: x.hang, dvt: x.dvt, qty: String(x.qty), vat: String(x.vat_pct), ck: chuCk(x.ck_pct) }))]);
    } catch (e) {
      setErr(loi(e, "Không nhập được file."));
    } finally {
      setDangExcel(false);
      if (oFile.current) oFile.current.value = "";
    }
  }

  async function taoVaChot() {
    if (!token || luu) return;
    const lines = dongGui();
    if (!lines || !khach) return;
    if (traNgay) {
      if (phieuGhi <= 0) { setErr(cachNhan === "cash" ? "Gõ số tiền khách đưa." : "Gõ số tiền nhận."); return; }
      if (cachNhan === "bank_transfer" && !tkId) { setErr("Chọn tài khoản nhận tiền."); return; }
      if (cachNhan === "bank_transfer" && !maGd.trim()) { setErr("Nhập mã giao dịch chuyển khoản."); return; }
    }
    if (xuatNgay) {
      if (!khoId) { setErr("Chọn kho xuất."); return; }
      const thieuCach = coCachGiao ? loiCachGiao(cach) : null;
      if (thieuCach) { setErr(thieuCach); return; }
    }
    setLuu(true);
    setErr(null);
    try {
      onSaved(await thuongMaiApi.banNhanh(token, {
        customer_id: khach.id, lines, ghi_chu: ghiChu.trim() || null,
        deposit_amount: !traNgay && coc ? Number(coc) : null,
        thu: traNgay ? { receipt_method: cachNhan, amount: phieuGhi,
          company_bank_account_id: cachNhan === "bank_transfer" ? tkId : null,
          bank_reference: cachNhan === "bank_transfer" ? maGd.trim() : null } : null,
        xuat: xuatNgay && khoId ? { kho_id: khoId, ghi_so: !!kho?.ghi_so_duoc,
          ...(coCachGiao ? { phuong_thuc: boCachGiao(cach) } : {}) } : null,
      }, order?.id));
    } catch (e) {
      setErr(loi(e, order ? "Không lưu được đơn." : "Không tạo được đơn."));
      if (e instanceof ApiError && e.status === 409) onDoDang();
    } finally {
      setLuu(false);
    }
  }

  const nut = (
    <>
      <button type="button" className="btn btn--secondary" onClick={onClose} disabled={luu}>Hủy</button>
      <button type="button" className="btn btn--secondary" onClick={luuNhap} disabled={luu}>Lưu nháp</button>
      <button type="button" className="btn btn--primary" onClick={taoVaChot} disabled={luu}>{luu ? "Đang lưu…" : nutChinh}</button>
    </>
  );

  return (
    <main className="tdtm" aria-label={order ? `Sửa đơn ${order.order_no}` : "Tạo đơn thương mại"}>
      <header className="tdtm__dau">
        <button type="button" className="tdtm__lui" onClick={onClose} disabled={luu}>← Đơn hàng bán</button>
        <h1 className="tdtm__ten">{order ? `Sửa đơn ${order.order_no}` : "Tạo đơn thương mại"}</h1>
      </header>

      <div className="tdtm__than">
        <div className="tdtm__cot">
          <section className="tdtm__the" aria-label="Mặt hàng">
            <div className="tdtm__tieu-hang">
              <h2 className="tdtm__tieu">Mặt hàng</h2>
              <div className="tdtm__excel">
                <button type="button" className="btn btn--ghost" disabled={dangExcel} onClick={() => void xuatExcel(true)}
                  title="File Excel kẻ sẵn cột Mã hàng, Tên hàng, Đơn vị, Số lượng, VAT %, CK % và trang Danh mục hàng để chọn mã">
                  Tải mẫu
                </button>
                <button type="button" className="btn btn--ghost" disabled={dangExcel} onClick={() => oFile.current?.click()}
                  title="Mỗi dòng một mặt hàng. Đơn vị bỏ trống là đơn vị chính. Đơn giá lấy giá bán đã khai. Dòng nhập thêm vào sau các dòng đang có.">
                  Nhập Excel
                </button>
                <button type="button" className="btn btn--ghost" disabled={dangExcel || !dong.some((d) => d.hang)}
                  onClick={() => void xuatExcel(false)}>
                  Xuất Excel
                </button>
                <input ref={oFile} type="file" hidden accept=".xlsx" aria-label="Chọn file Excel dòng hàng"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void nhapExcel(f); }} />
              </div>
            </div>
            <div className="tdtm__cuon">
              <table className="dtm__bang tdtm__luoi">
                <thead>
                  <tr>
                    <th>Mặt hàng</th>
                    <th>Đơn vị</th>
                    <th className="dhb__text-right" title={xuatNgay && kho ? `Số còn ở kho xuất ${kho.ten}` : "Số còn cộng mọi kho"}>
                      Tồn
                    </th>
                    <th className="dhb__text-right">Số lượng</th>
                    <th className="dhb__text-right">Đơn giá</th>
                    <th className="dhb__text-right" title="Chiết khấu % trừ thẳng vào thành tiền, VAT tính sau chiết khấu">CK %</th>
                    <th className="dhb__text-right">VAT %</th>
                    <th className="dhb__text-right">Thành tiền</th>
                    <th aria-label="Xoá dòng" />
                  </tr>
                </thead>
                <tbody>
                  {dong.map((d) => {
                    // Dòng trống cuối bảng chỉ có ô tìm hàng: chọn hàng ở đây là thêm dòng.
                    if (!d.hang) {
                      return (
                        <tr key={d.khoa} className="tdtm__dong-moi">
                          <td className="dtm__c-hang" data-khong-goi-y="">
                            <ChonHang value={null} tonKho={{ khoId: khoTon }} goiY="Gõ mã hoặc tên để thêm hàng"
                              onChange={(h, dvt) => sua(d.khoa, { hang: h, dvt, gia: "" })} />
                          </td>
                          <td colSpan={8} />
                        </tr>
                      );
                    }
                    const g = giaDong(d);
                    const sl = Number(d.qty) || 0;
                    const t = d.dvt ? ton[`${d.hang.id}|${d.dvt}`] : undefined;
                    const thieu = thieuCua(d);
                    return (
                      <tr key={d.khoa}>
                        <td className="dtm__c-hang" data-khong-goi-y="">
                          <ChonHang value={d.hang} tonKho={{ khoId: khoTon }}
                            onChange={(h, dvt) => sua(d.khoa, { hang: h, dvt, gia: "" })} />
                        </td>
                        <td>
                          <select className="dhb__input" aria-label="Đơn vị" value={d.dvt}
                            onChange={(e) => sua(d.khoa, { dvt: e.target.value, gia: "" })}>
                            {dvtCua(d.hang).map((m) => <option key={m} value={m}>{tenDvt(m)}</option>)}
                          </select>
                        </td>
                        <td className="tdtm__chu dhb__text-right tdtm__ton">{t == null ? "—" : soLe(t)}</td>
                        <td className={thieu > 0 ? "is-thieu" : undefined}
                          title={thieu > 0 ? `Thiếu ${soLe(thieu)} ${tenDvt(d.dvt)}` : undefined}>
                          <input className="dhb__input dhb__text-right" inputMode="numeric" aria-label="Số lượng" value={d.qty}
                            onChange={(e) => sua(d.khoa, { qty: chuSo(e.target.value) })} />
                        </td>
                        <td>
                          <OGoDinhDang className="dhb__input dhb__text-right" inputMode="numeric" aria-label="Đơn giá"
                            placeholder={giaKhai(d) != null ? soVN(giaKhai(d)!) : "Gõ giá"}
                            value={tienO(d.gia)} onChange={(e) => sua(d.khoa, { gia: chuSo(e.target.value) })} />
                        </td>
                        <td>
                          <input className="dhb__input dhb__text-right" inputMode="decimal" aria-label="CK %" value={d.ck} placeholder="0"
                            onChange={(e) => sua(d.khoa, { ck: goCk(e.target.value) })} />
                        </td>
                        <td>
                          <input className="dhb__input dhb__text-right" inputMode="numeric" aria-label="VAT" value={d.vat}
                            onChange={(e) => sua(d.khoa, { vat: chuSo(e.target.value).slice(0, 3) })} />
                        </td>
                        <td className="tdtm__chu dhb__text-right tdtm__so">{g == null ? "—" : soVN(thanhTienDong(g, sl, d.ck))}</td>
                        <td className="tdtm__chu">
                          <button type="button" className="tdtm__xoa" aria-label="Xoá dòng" title="Xoá dòng"
                            onClick={() => setDong((ds) => ds.filter((x) => x.khoa !== d.khoa))}>×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {dongThieu.length > 0 && (
              <div className="tdtm__thieu" role="status">
                <span>
                  {dongThieu.length} mặt hàng thiếu tồn {xuatNgay && kho ? `ở kho ${kho.ten}` : "ở mọi kho"}
                </span>
                {coTheMua && (
                  <button type="button" className="btn btn--secondary" disabled={luu} onClick={() => void muaPhanThieu()}
                    title="Lưu nháp đơn rồi mở form Tạo yêu cầu mua đã điền sẵn phần thiếu của từng mặt hàng">
                    Lưu nháp và tạo yêu cầu mua
                  </button>
                )}
              </div>
            )}
            <div className="tdtm__tong"><span>Tổng gồm VAT</span><span>{soVN(tong)}</span></div>
          </section>

          <section className="tdtm__the" aria-label="Xuất hàng">
            <h2 className="tdtm__tieu">Xuất hàng</h2>
            <div className="tdtm__hai-chon" role="radiogroup" aria-label="Xuất hàng">
              <ThePhai on={xuatNgay} onChon={() => setXuatNgay(true)} ten="Xuất ngay" mo="Khách lấy hàng hoặc giao ngay" />
              <ThePhai on={!xuatNgay} onChon={() => setXuatNgay(false)} ten="Xuất sau" mo="Chốt đơn, xuất ở ngăn đơn khi có hàng" />
            </div>
            {xuatNgay && (
              <>
                <div className="tdtm__hang">
                  <div className="dtm__o">
                    <span>Kho xuất <b>*</b></span>
                    <OChonGon nhan="Kho xuất" value={khoId == null ? "" : String(khoId)} onChange={(v) => setKhoId(Number(v) || null)}
                      ds={khos.map((k) => ({ value: String(k.id), ten: k.ten }))} />
                  </div>
                  {/* Có quyền ghi sổ kho thì luôn ghi sổ ngay, không hỏi (13/11/2026). */}
                  {kho && !kho.ghi_so_duoc && (
                    <p className="dtm__lead tdtm__ghi-so">Yêu cầu xuất sẽ gửi tới người giữ kho {kho.ten}.</p>
                  )}
                  {khoDaTai && khos.length === 0 && (
                    <p className="dtm__lead tdtm__ghi-so">{CHUA_CO_KHO_TM}</p>
                  )}
                </div>
                {coCachGiao && <ChonCachGiao value={cach} onChange={setCach} oInput="dhb__input" />}
                <p className="dtm__lead">Xuất ngay là xuất hết số lượng của đơn. Muốn xuất một phần thì chọn Xuất sau.</p>
              </>
            )}
          </section>
        </div>

        <div className="tdtm__cot">
          {/* Ô tự làm thẻ, nhãn Khách hàng nằm trong ô nên không thêm tiêu đề thẻ. */}
          <OChonKhach value={khach} onChange={(k) => { setKhach(k); setErr(null); }} />

          <section className="tdtm__the" aria-label="Thanh toán">
            <h2 className="tdtm__tieu">Thanh toán</h2>
            {thuDuoc && (
              <div className="tdtm__hai-chon" role="radiogroup" aria-label="Thanh toán">
                <ThePhai on={traNgay} onChon={() => setTraNgay(true)} ten="Khách trả ngay" />
                <ThePhai on={!traNgay} onChon={() => setTraNgay(false)} ten="Thanh toán sau" />
              </div>
            )}
            {traNgay ? (
              <>
                <div className="tdtm__tong"><span>Khách phải trả</span><span>{soVN(tong)}</span></div>
                <div className="tdtm__nhan" role="radiogroup" aria-label="Nhận bằng">
                  {(["cash", "bank_transfer"] as const).map((c) => (
                    <button key={c} type="button" role="radio" aria-checked={cachNhan === c}
                      className={cachNhan === c ? "is-on" : ""} onClick={() => setCachNhan(c)}>
                      {c === "cash" ? "Tiền mặt" : "Chuyển khoản"}
                    </button>
                  ))}
                </div>
                <label className="dtm__o">
                  <span>{cachNhan === "cash" ? "Tiền khách đưa" : "Số tiền nhận"}</span>
                  <OGoDinhDang className="dhb__input tdtm__dua" inputMode="numeric"
                    aria-label={cachNhan === "cash" ? "Tiền khách đưa" : "Số tiền nhận"}
                    value={tienO(dua)} onChange={(e) => { setDuaSua(true); setDua(chuSo(e.target.value)); }} />
                </label>
                {cachNhan === "cash" ? (
                  <div className="tdtm__goi-y" aria-label="Mức gợi ý">
                    {mucGoiY(tong).map((m) => (
                      <button key={m} type="button" onClick={() => { setDuaSua(true); setDua(String(m)); }}>{soVN(m)}</button>
                    ))}
                  </div>
                ) : (
                  <>
                    <label className="dtm__o">
                      <span>Tài khoản nhận <b>*</b></span>
                      <select className="dhb__input" value={tkId ?? ""} disabled={dangTai || taiKhoan.length === 0}
                        onChange={(e) => setTkId(Number(e.target.value) || null)}>
                        <option value="">{dangTai ? "Đang tải…" : taiKhoan.length === 0 ? "Chưa có tài khoản nhận" : "Chọn tài khoản…"}</option>
                        {taiKhoan.map((t) => <option key={t.id} value={t.id}>{`${t.account_number} ${t.bank_name}`}</option>)}
                      </select>
                      {loiTai && <small className="tdtm__goi">{loiTai}</small>}
                    </label>
                    <label className="dtm__o">
                      <span>Mã giao dịch <b>*</b></span>
                      <input className="dhb__input" maxLength={64} value={maGd} placeholder="Mã trên sao kê hoặc tin nhắn báo có"
                        onChange={(e) => setMaGd(e.target.value)} />
                    </label>
                  </>
                )}
                <div className="tdtm__tom">
                  {cachNhan === "cash" && <div><span>Trả lại khách</span><span>{soVN(traLai)}</span></div>}
                  <div><span>Phiếu thu ghi</span><span>{soVN(phieuGhi)}</span></div>
                  <div className="is-tong"><span>Còn phải thu</span><span>{soVN(conPhaiThu)}</span></div>
                </div>
                <p className="dtm__lead">
                  Người nộp là tên khách, ngày thu hôm nay. Phần còn thiếu thu sau ở chặng Thu tiền của đơn.
                </p>
              </>
            ) : (
              <label className="dtm__o">
                <span>Tiền cọc</span>
                <OGoDinhDang className="dhb__input" inputMode="numeric" aria-label="Tiền cọc" placeholder="Không cọc"
                  value={tienO(coc)} onChange={(e) => setCoc(chuSo(e.target.value))} />
              </label>
            )}
          </section>

          <section className="tdtm__the" aria-label="Ghi chú">
            <h2 className="tdtm__tieu">Ghi chú</h2>
            <textarea className="dhb__input tdtm__ghi-chu" maxLength={1000} aria-label="Ghi chú" value={ghiChu}
              onChange={(e) => setGhiChu(e.target.value)} />
          </section>
        </div>
      </div>

      {/* Một bộ nút duy nhất, dính đáy màn hình; lỗi hiện ngay cạnh nút vừa bấm. */}
      <footer className="tdtm__chan">
        {err && <span className="tdtm__loi" role="alert">{err}</span>}
        {nut}
      </footer>
    </main>
  );
}

function ThePhai({ on, onChon, ten, mo }: { on: boolean; onChon: () => void; ten: string; mo?: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} aria-label={ten} className={`tdtm__chon${on ? " is-on" : ""}`}
      onClick={onChon}>
      <span>{ten}</span>
      {mo && <small>{mo}</small>}
    </button>
  );
}
