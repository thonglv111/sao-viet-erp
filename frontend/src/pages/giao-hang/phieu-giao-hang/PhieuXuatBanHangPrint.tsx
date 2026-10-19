// In PHIẾU XUẤT KHO BÁN HÀNG (có giá) / PHIẾU XUẤT KHO 02-VT (không giá) của MỘT yêu cầu giao —
// chủ chốt 13/10/2026, dựng Y BỐ CỤC hai mẫu MISA công ty đang dùng (BH03479-26 / XK03479-26): không
// logo, tên công ty góc trái, Nợ/Có góc phải, bảng kẻ ô, ô ký cuối trang. Mở từ nút "In phiếu giao"
// ở ngăn đơn, chỉ sau khi kho ghi sổ phiếu xuất: hai mẫu cùng số phiếu xuất và cùng SỐ THỰC XUẤT.
//
// Giá bán, VAT, tên hàng ghép cụm lấy ở chi tiết đơn đã nạp; máy chủ trả phần đơn chưa có (số phiếu,
// thực xuất + mã hàng theo dòng, MST / địa chỉ khách, kíp xe).
import { useEffect, useState } from "react";
import { ApiError, api } from "../../../api/client";
import type { DonTienDoYeuCau, OrderDetail, PhieuXuatIn } from "../../../api/client";
import { useAuth } from "../../../auth/useAuth";
import { PrintSheet } from "../../../components/PrintSheet";
import { COMPANY } from "../../../constants/company";
import { amountInWords } from "../../../utils/format";
import { gopTheoNhom } from "../../../utils/gop-nhom";
import "./phieu-xuat-ban-hang.css";

type Mau = "co_gia" | "khong_gia";

// Số kiểu MISA: tiền nguyên đồng, số lượng 2 số lẻ, đơn giá 3 số lẻ.
const tien = (n: number): string => Math.round(n || 0).toLocaleString("vi-VN");
const sl2 = (n: number): string => n.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const gia3 = (n: number): string => n.toLocaleString("vi-VN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const slTron = (n: number): string => n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });

/** "Ngày 29 tháng 8 năm 2026" — đúng cách MISA ghi trên đầu phiếu. */
function ngayChu(v: string | null | undefined): string {
  const d = v ? new Date(v) : null;
  if (!d || isNaN(d.getTime())) return "Ngày ..... tháng ..... năm .........";
  return `Ngày ${d.getDate()} tháng ${d.getMonth() + 1} năm ${d.getFullYear()}`;
}

function Ky({ ten }: { ten: string }) {
  return (
    <div>
      <div className="mx-ky__ten">{ten}</div>
      <div className="mx-ky__goi-y">(Ký, họ tên)</div>
    </div>
  );
}

export function PhieuXuatBanHangPrint({
  d,
  yc,
  onClose,
}: {
  d: OrderDetail;
  yc: DonTienDoYeuCau;
  onClose: () => void;
}) {
  const { token } = useAuth();
  const [mau, setMau] = useState<Mau>("co_gia");
  const [px, setPx] = useState<PhieuXuatIn | null>(null);
  const [loi, setLoi] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let huy = false;
    api.orders
      .phieuXuatIn(token, d.id, yc.id)
      .then((r) => { if (!huy) setPx(r); })
      .catch((e) => { if (!huy) setLoi(e instanceof ApiError ? e.message : "Không tải được phiếu xuất."); });
    return () => { huy = true; };
  }, [token, d.id, yc.id]);

  const coGia = mau === "co_gia";
  const chonMau = (
    <div className="ps-chon-mau" role="group" aria-label="Chọn mẫu in">
      <button type="button" aria-pressed={coGia} onClick={() => setMau("co_gia")}>Có giá</button>
      <button type="button" aria-pressed={!coGia} onClick={() => setMau("khong_gia")}>Không giá (02-VT)</button>
    </div>
  );
  const tieuDe = coGia ? "PHIẾU XUẤT KHO BÁN HÀNG" : "PHIẾU XUẤT KHO";

  if (!px) {
    return (
      <PrintSheet title={tieuDe} onClose={onClose} canPrint={false} chonMau={chonMau} boDauTrang>
        <p className="mx-tai">{loi ?? "Đang tải phiếu xuất…"}</p>
      </PrintSheet>
    );
  }

  // Gộp cụm (ruột + bìa) như bản in báo giá; yêu cầu giao và thực xuất chỉ mang dòng ĐẦU cụm.
  const nhom = gopTheoNhom(d.lines, (l) => ({
    nhom: l.nhom,
    ten: l.description,
    soLuong: l.qty,
    donViTinh: l.don_vi_tinh,
    dvtNhom: l.dvt_nhom,
    thanhTien: l.line_total ?? 0,
    tienVat: Math.round(((l.line_total ?? 0) * (l.vat_pct_estimate || 0)) / 100),
    vatPct: l.vat_pct_estimate,
  }));
  const slYc = new Map(yc.dong.map((x) => [x.order_line_id, x.qty]));
  const xuatTheoDong = new Map(px.thuc_xuat.map((x) => [x.order_line_id, x]));
  const dong = nhom
    .map((g) => {
      const ids = g.goc.map((x) => x.id);
      const yeuCau = Math.max(0, ...ids.map((i) => slYc.get(i) ?? 0));
      const tx = ids.map((i) => xuatTheoDong.get(i)).filter((x) => x !== undefined);
      // Có giá là biên bản giao ⇒ số khách thực nhận; 02-VT là chứng từ kho ⇒ số kho thực xuất (#34).
      const xuat = Math.max(0, ...tx.map((x) => (coGia ? x.so_luong : x.so_xuat)));
      const tile = g.soLuong > 0 ? xuat / g.soLuong : 0;
      return {
        ...g, yeuCau, xuat, maHang: tx[0]?.ma_hang ?? "",
        thanhTien: g.thanhTien * tile, tienVat: g.tienVat * tile,
      };
    })
    .filter((g) => g.yeuCau > 0 || g.xuat > 0);
  const tienHang = Math.round(dong.reduce((a, g) => a + g.thanhTien, 0));
  const tienVat = Math.round(dong.reduce((a, g) => a + g.tienVat, 0));
  const tongTien = tienHang + tienVat;
  const tongXuat = dong.reduce((a, g) => a + g.xuat, 0);
  const cacVat = [...new Set(dong.map((g) => g.vatPct))];
  const thueSuat = cacVat.length === 1 && cacVat[0] ? `${cacVat[0]}%` : "";
  const soPhieu = px.so_phieu.join(", ");
  const khach = d.customer_name ?? "";

  const congTy = (
    <div className="mx-cty">
      <div>{COMPANY.name}</div>
      <div>{COMPANY.address}</div>
    </div>
  );

  return (
    <PrintSheet title={tieuDe} docNo={soPhieu} onClose={onClose} chonMau={chonMau} boDauTrang>
      {coGia ? (
        <div className="mx">
          {congTy}
          <div className="mx-tieu-de">
            <h1>PHIẾU XUẤT KHO BÁN HÀNG</h1>
            <div className="mx-ngay">{ngayChu(px.ngay)}</div>
            <div className="mx-so">Số: {soPhieu}</div>
          </div>
          <div className="mx-dau">
            <div className="mx-dong-tt">
              <div><span>Người mua:</span>{px.nguoi_mua ? <span>{px.nguoi_mua}</span> : <span className="mx-cham" />}</div>
              <div><span>Tên khách hàng:</span><span>{khach}</span></div>
              <div><span>Địa chỉ:</span><span>{px.khach_dia_chi ?? ""}</span></div>
              <div><span>Điện thoại:</span>{px.khach_dien_thoai ? <span>{px.khach_dien_thoai}</span> : <span className="mx-cham" />}</div>
              <div><span>Mã số thuế:</span><span>{px.khach_ma_so_thue ?? ""}</span></div>
              <div><span>Diễn giải:</span><span>{d.order_no}{d.customer_po_no ? ` - PO ${d.customer_po_no}` : ""}</span></div>
              <div><span>Nhân viên bán hàng:</span><span>{d.sale_name ?? ""}</span></div>
            </div>
            <div className="mx-no-co">
              <div>Nợ: ..........</div>
              <div>Có: ..........</div>
              <div>Loại tiền: VND</div>
            </div>
          </div>
          <table className="mx-bang">
            <colgroup>
              <col style={{ width: "8%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "17%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>STT</th>
                <th>Mã hàng</th>
                <th>Tên hàng</th>
                <th>Đơn vị tính</th>
                <th>Số lượng</th>
                <th>Đơn giá</th>
                <th>Thành tiền</th>
              </tr>
            </thead>
            <tbody>
              {dong.map((g, i) => (
                <tr key={g.key}>
                  <td className="c">{i + 1}</td>
                  <td>{g.maHang}</td>
                  <td>{g.ten}</td>
                  <td>{g.donViTinh}</td>
                  <td className="r">{sl2(g.xuat)}</td>
                  <td className="r">{gia3(g.xuat > 0 ? g.thanhTien / g.xuat : 0)}</td>
                  <td className="r">{tien(g.thanhTien)}</td>
                </tr>
              ))}
              <tr className="mx-dam">
                <td colSpan={6}>Cộng</td>
                <td className="r">{tien(tienHang)}</td>
              </tr>
              <tr>
                <td colSpan={3} className="mx-trang" />
                <td colSpan={3}>Cộng tiền hàng:</td>
                <td className="r mx-dam">{tien(tienHang)}</td>
              </tr>
              <tr>
                <td colSpan={3}>Thuế suất GTGT: {thueSuat}</td>
                <td colSpan={3}>Tiền thuế GTGT:</td>
                <td className="r mx-dam">{tienVat > 0 ? tien(tienVat) : ""}</td>
              </tr>
              <tr>
                <td colSpan={3} className="mx-trang" />
                <td colSpan={3}>Tổng tiền thanh toán:</td>
                <td className="r mx-dam">{tien(tongTien)}</td>
              </tr>
            </tbody>
          </table>
          <div className="mx-dong">Số tiền viết bằng chữ: <b><i>{amountInWords(tongTien)}.</i></b></div>
          <div className="mx-dong mx-dong--cham"><span>Số chứng từ gốc kèm theo:</span><span className="mx-cham" /></div>
          <div className="mx-ngay-ky">Ngày ..... tháng ..... năm .........</div>
          <div className="mx-ky mx-ky--3">
            <Ky ten="Người Lập" />
            <Ky ten="Người Nhận hàng" />
            <Ky ten="NV Giao hàng" />
          </div>
        </div>
      ) : (
        <div className="mx">
          <div className="mx-dau-02">
            {congTy}
            <div className="mx-mau-so">
              <div><b>Mẫu số: 02-VT</b></div>
              <i>(Ban hành theo QĐ số 15/2006/QĐ-BTC<br />ngày 20/03/2006 của Bộ trưởng BTC)</i>
            </div>
          </div>
          <div className="mx-tieu-de mx-tieu-de--02">
            <h1>PHIẾU XUẤT KHO</h1>
            <div className="mx-ngay">{ngayChu(px.ngay)}</div>
            <div className="mx-so-02">
              <span>Số: {soPhieu}</span>
              <span className="mx-no-co-02">Nợ: ..........<br />Có: ..........</span>
            </div>
          </div>
          <div className="mx-dong-02">
            <div><span>- Họ tên người nhận hàng:</span><span>{khach}</span></div>
            <div><span>- Địa chỉ (bộ phận):</span><span>{px.khach_dia_chi ?? ""}</span></div>
            <div><span>- Lý do xuất kho:</span><span>Xuất kho bán hàng {khach}</span></div>
          </div>
          <table className="mx-bang">
            <colgroup>
              <col style={{ width: "8%" }} />
              <col style={{ width: "26%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "13%" }} />
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2}>STT</th>
                <th rowSpan={2}>Tên, nhãn hiệu, quy cách, phẩm chất vật tư, dụng cụ, sản phẩm, hàng hóa</th>
                <th rowSpan={2}>Đơn vị tính</th>
                <th colSpan={2}>Số lượng</th>
                <th rowSpan={2}>Đơn giá</th>
                <th rowSpan={2}>Thành tiền</th>
                <th rowSpan={2}>Ghi chú</th>
              </tr>
              <tr>
                <th>Thực xuất</th>
                <th>Bù hao</th>
              </tr>
              <tr>
                {["A", "B", "C", "1", "2", "3", "4", "5"].map((k) => <th key={k}>{k}</th>)}
              </tr>
            </thead>
            <tbody>
              {dong.map((g, i) => (
                <tr key={g.key}>
                  <td className="c">{i + 1}</td>
                  <td>{g.ten}</td>
                  <td>{g.donViTinh}</td>
                  <td className="r">{sl2(g.xuat)}</td>
                  <td />
                  <td />
                  <td />
                  <td />
                </tr>
              ))}
              <tr className="mx-dam">
                <td />
                <td className="c">Cộng</td>
                <td />
                <td className="r">{slTron(tongXuat)}</td>
                <td />
                <td />
                <td />
                <td />
              </tr>
            </tbody>
          </table>
          <div className="mx-dong mx-dong--cham"><span>- Tổng số tiền (Viết bằng chữ):</span><span className="mx-cham" /></div>
          <div className="mx-dong mx-dong--cham"><span>- Số chứng từ gốc kèm theo:</span><span className="mx-cham" /></div>
          <div className="mx-ky mx-ky--5">
            <Ky ten="Người lập phiếu" />
            <Ky ten="Người nhận hàng" />
            <Ky ten="Thủ kho" />
            <Ky ten="NV Giao hàng" />
            <Ky ten="NV Bán hàng" />
          </div>
        </div>
      )}
    </PrintSheet>
  );
}
