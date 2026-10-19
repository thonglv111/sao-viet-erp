// Tiến độ đơn cho Kinh doanh — Sản xuất → Nhập kho → Giao hàng (19/09/2026).
// Thiết kế: docs/superpowers/plans/2026-09-19-giao-hang-tien-do-don.md.
//
// Số liệu do máy chủ tính (`GET /api/orders/{id}/tien-do`) — FE chỉ vẽ, không tự suy "giao được".
// Luật chốt: KHÔNG lập yêu cầu giao cho phần chưa nhập kho ⇒ ô số lượng trần = `giao_duoc`.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  api,
  type DonTienDo,
  type DonTienDoCum,
  type DonTienDoYeuCau,
  type OrderDetail,
} from "../../../api/client";
import { useAuth } from "../../../auth/useAuth";
import { useCan } from "../../../auth/permissions";
import { Button } from "../../../components/Button";
import { ChonNgay } from "../../../components/ChonNgay";
import { DetailModal } from "../../../components/DetailModal";
import { EmptyState } from "../../../components/EmptyState";
import { fmtDate, fmtDateTime } from "../../../utils/format";
import { NHAN_TRANG_THAI_YC } from "../giao-hang/shared/constants";
import { CHUYEN_THAT_BAI, nhanChuyen, TONE_YC } from "../giao-hang/shared/helpers";
import { ChipTT, type MauTT } from "../../../components/LuoiDs";

// Lời gọi tiến độ bắn SẴN lúc bấm mở đơn, chạy SONG SONG với lời gọi chi tiết đơn. Trước 06/10/2026
// ngăn đơn chỉ hỏi tiến độ sau khi chi tiết đơn về (ngăn mới mount) ⇒ ô Sản xuất / Giao hiện trễ
// thêm nguyên một vòng chi tiết đơn. Hook lấy lại đúng lời gọi đó ở lần nạp đầu. Lấy KHÔNG xoá: dev
// chạy StrictMode, hiệu ứng mount hai lần — xoá ở lần đầu thì lần hai bắn thêm một lời gọi thừa. Quá
// 15 giây thì bỏ để không vẽ số cũ; mỗi lần bấm mở đơn ghi đè (hoặc xoá, với đơn nháp / không rõ
// trạng thái) nên mở lại sau đó không ăn nhầm bản cũ.
const napTruoc = new Map<number, { luc: number; hua: Promise<DonTienDo> }>();

export function napTruocTienDo(token: string, orderId: number, bat: boolean) {
  if (!bat) {
    napTruoc.delete(orderId);
    return;
  }
  const hua = api.orders.tienDo(token, orderId);
  hua.catch(() => undefined);
  napTruoc.set(orderId, { luc: Date.now(), hua });
}

function layNapTruoc(orderId: number): Promise<DonTienDo> | null {
  const x = napTruoc.get(orderId);
  return x && Date.now() - x.luc < 15_000 ? x.hua : null;
}

/** Tải tiến độ + tự tươi khi giao hàng / kho / bàn tổ đổi (SSE, không bắt F5).
 *
 *  `eventTick` = tick nhóm sự kiện (sản xuất · kho · giao hàng) từ kênh SSE CHUNG của AppShell, nơi
 *  gọi truyền xuống. Trước 28/09/2026 hook tự mở một kênh SSE riêng mỗi lần mở drawer đơn. */
export function useTienDoDon(orderId: number, bat: boolean, eventTick?: number) {
  const { token } = useAuth();
  const [td, setTd] = useState<DonTienDo | null>(null);
  const tai = useCallback((dungNapTruoc = false) => {
    if (!token || !bat) return;
    const hua = (dungNapTruoc && layNapTruoc(orderId)) || api.orders.tienDo(token, orderId);
    hua.then(setTd).catch(() => setTd(null));
  }, [token, orderId, bat]);
  useEffect(() => {
    setTd(null);
    tai(true);
  }, [tai]);
  const tickDaNap = useRef(eventTick);
  useEffect(() => {
    if (tickDaNap.current === eventTick) return;
    tickDaNap.current = eventTick;
    tai();
  }, [eventTick, tai]);
  const taiLai = useCallback(() => tai(), [tai]);
  return { td, taiLai };
}

const so = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });

export const NHAN_LY_DO_TRE: Record<string, string> = {
  su_co: "máy sự cố",
  tam_dung: "lệnh tạm dừng",
  tre_han: "trễ hạn công đoạn",
  kcs_khong_dat: "KCS không đạt",
  thieu_vat_tu: "thiếu vật tư",
  chua_xuong_xuong: "có lệnh chưa xuống xưởng",
};

/** Phần hàng của sản phẩm ĐÃ CÓ cho đơn = đã giao (kể cả giao thẳng) + đang giữ cho yêu cầu + còn
 *  giao được từ tồn của mã — ĐÚNG luật `don_hang_san_xuat` ở máy chủ. Từ mg 0394 tồn của mã là hàng
 *  của khách, nên món có lệnh cũng đủ hàng nhờ hàng làm dư của đơn trước. Trước 12/10/2026 món có
 *  lệnh chỉ đếm hàng KCS nhập từ lệnh của chính đơn ⇒ tab Sản xuất báo "0/1.000, chờ KCS" trong khi
 *  danh sách và tab Giao báo đủ hàng, giao được ngay. */
export function coHangCum(c: DonTienDoCum): number {
  return Math.max(0, Math.min(c.dat, c.da_giao + c.dang_giu + c.giao_duoc));
}

/** Trong phần đã có, phần KHÔNG đến từ lệnh của chính đơn (tồn có sẵn của mã). Lệnh của đơn được
 *  tính trước: kho đã nhận từ KCS + nhà gia công giao thẳng. */
export function coTuTonCum(c: DonTienDoCum): number {
  const co = coHangCum(c);
  return Math.max(0, co - Math.min(co, c.kho_da_nhan + c.giao_thang));
}

/** Sản phẩm KHÔNG có lệnh sản xuất mà tồn kho không đủ ⇒ không có đường nào về đủ hàng. */
export function thieuNguonCum(c: DonTienDoCum): number {
  return c.co_lenh ? 0 : Math.max(0, c.dat - coHangCum(c));
}

/** Tổng hợp cho ba chấm SX / Nhập kho / Giao trên thanh vòng đời. */
export function tomTatTienDo(td: DonTienDo | null) {
  const cum = td?.cum ?? [];
  const coLenh = cum.filter((c) => c.co_lenh);
  const lenh = coLenh.flatMap((c) => c.lenh);
  const sxPct = lenh.length ? lenh.reduce((a, l) => a + l.pct, 0) / lenh.length : 0;
  const sxXong = coLenh.length > 0 && coLenh.every((c) => c.sx_xong);
  // Nhập kho tính trên MỌI sản phẩm (kể cả hàng lấy từ tồn), bình quân tỉ lệ từng món — cộng
  // thẳng số lượng thì hộp với tờ lẫn đơn vị, món 20.000 tờ nuốt mất món 500 hộp.
  const khoPct = cum.length ? cum.reduce((a, c) => a + coHangCum(c) / (c.dat || 1), 0) / cum.length * 100 : 0;
  const soMonDuHang = cum.filter((c) => coHangCum(c) >= c.dat).length;
  const khoXong = cum.length > 0 && soMonDuHang === cum.length;
  const thieuNguon = cum.filter((c) => thieuNguonCum(c) > 0);
  const dat = cum.reduce((a, c) => a + c.dat, 0);
  const daGiao = cum.reduce((a, c) => a + Math.min(c.dat, c.da_giao), 0);
  const giaoPct = dat > 0 ? (daGiao / dat) * 100 : 0;
  const giaoXong = cum.length > 0 && cum.every((c) => c.khach_nhan_du ?? c.da_giao >= c.dat);
  return {
    soLenh: lenh.length,
    lenhXong: lenh.filter((l) => l.xong).length,
    sxPct, sxXong, khoPct, khoXong, giaoPct, giaoXong,
    soMon: cum.length, soMonDuHang, thieuNguon,
    coLenh: coLenh.length > 0,
    soYeuCauMo: (td?.yeu_cau ?? []).filter((y) => y.trang_thai === "cho_len_ke_hoach" || y.trang_thai === "dang_thuc_hien").length,
  };
}

/** Băng cảnh báo trễ: CHỈ khi dự kiến xong SX trễ so với hạn giao cam kết. "Kịp hạn" và "chưa ước
 *  được ngày xong" là thẻ nhỏ ở câu "việc tiếp theo" (05/10/2026) — băng đỏ chỉ dành cho việc trễ thật. */
export function CanhBaoTre({ td }: { td: DonTienDo | null }) {
  if (!td || td.tre_ngay == null || td.tre_ngay <= 0) return null;
  const lyDo = td.ly_do.map((k) => NHAN_LY_DO_TRE[k] ?? k).join(", ");
  return (
    <div className="banner banner--error dhb__td-tre" role="alert">
      Dự kiến xong sản xuất {fmtDate(td.du_kien_xong)} — <b>trễ {td.tre_ngay} ngày</b> so với hạn
      giao {fmtDate(td.han_cam_ket)}.{lyDo ? ` Lý do: ${lyDo}.` : ""}
    </div>
  );
}

/** "HH:mm dd/mm" giờ xưởng — đủ để biết đơn chờ từ lúc nào, khỏi năm. */
function gioNgay(iso: string): string {
  const d = new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso) || !iso.includes("T") ? iso : `${iso}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const p = d.toLocaleString("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", hour12: false,
  });
  // en-GB ⇒ "05/10, 13:54"
  const [ngay, gio] = p.split(", ");
  return gio ? `${gio} ${ngay}` : p;
}

function soNgayToi(han: string, homNay: Date): number {
  const [y, m, d] = han.slice(0, 10).split("-").map(Number);
  const moc = Date.UTC(y, m - 1, d);
  const nay = Date.UTC(homNay.getFullYear(), homNay.getMonth(), homNay.getDate());
  return Math.round((moc - nay) / 86_400_000);
}

/** `loai: "han"` = thẻ số ngày tới hạn giao — thẻ tóm tắt đơn vẽ nó ở cột hạn giao bên phải, không
 *  lặp trong hàng thẻ (10/10/2026). */
export type TheViec = { nhan: string; tone?: "ok" | "warn" | "bad"; loai?: "han" };
export type ViecTiepTheo = {
  cau: string;
  the: TheViec[];
  /** Nút đi kèm: mở bàn Kế hoạch SX, hoặc chọn một chặng trong vòng đời. */
  nut?: { nhan: string; toi: "ke-hoach-sx" | "coc" | "giao" | "hoadon" };
};

/** Câu "việc tiếp theo" đầu khối Vòng đời đơn (05/10/2026, phương án A): đơn đang chờ AI làm gì, từ
 *  bao giờ. Suy hoàn toàn từ dữ liệu đã có — không lưu gì thêm. Thứ tự là thứ tự chặn: món chưa có
 *  nguồn chặn mọi thứ sau nó, rồi tới hàng KCS gửi mà kho chưa nhận, lệnh chưa xuống xưởng, lệnh đang chạy. */
export function viecTiepTheo(o: {
  trangThai: string;
  canCoc: boolean;
  duCoc: boolean;
  thieuCoc: number;
  chuyenSxLuc: string | null;
  gap: boolean;
  hanGiao: string | null;
  td: DonTienDo | null;
  hoaDon: "none" | "partial" | "full";
  homNay?: Date;
}): ViecTiepTheo | null {
  if (o.trangThai === "cancelled") return null;
  if (o.trangThai === "draft") {
    return { cau: "Chốt đơn để chuyển sang thu cọc và sản xuất", the: [] };
  }
  const the: TheViec[] = [];
  const td = o.td;
  const tt = tomTatTienDo(td);
  const giaoXong = td != null && tt.giaoXong;
  if (o.hanGiao && !giaoXong) {
    const n = soNgayToi(o.hanGiao, o.homNay ?? new Date());
    the.push(n > 0 ? { nhan: `còn ${n} ngày tới hạn giao`, loai: "han" }
      : n === 0 ? { nhan: "hôm nay là hạn giao", tone: "warn", loai: "han" }
      : { nhan: `quá hạn giao ${-n} ngày`, tone: "bad", loai: "han" });
  }
  if (o.gap) the.unshift({ nhan: "đơn gấp", tone: "warn" });

  if (o.canCoc && !o.duCoc) {
    return { cau: `Chờ kế toán thu cọc, còn thiếu ${so(o.thieuCoc)} đ`, the, nut: { nhan: "Xem cọc", toi: "coc" } };
  }
  if (!o.chuyenSxLuc) return { cau: "Đang chuyển xuống Kế hoạch sản xuất", the };
  if (!td) return { cau: "Đang tải tiến độ…", the: [] };

  const cum = td.cum;
  const lenh = cum.flatMap((c) => c.lenh);
  const chuaNguon = cum.filter((c) => !c.co_lenh && coHangCum(c) < c.dat);
  if (chuaNguon.length > 0) {
    const cau = lenh.length === 0
      ? "Chờ Kế hoạch lên lệnh sản xuất"
      : `Chờ Kế hoạch lên lệnh cho ${chuaNguon.length === 1 ? chuaNguon[0].ten : `${chuaNguon.length} món`}`;
    return {
      cau,
      the: [{ nhan: `chuyển xuống ${gioNgay(o.chuyenSxLuc)}` }, ...the],
      nut: { nhan: "Mở Kế hoạch SX", toi: "ke-hoach-sx" },
    };
  }
  // Mốc dự kiến xong SX so với hạn giao: trễ là băng đỏ riêng (`CanhBaoTre`), ở đây chỉ thẻ nhỏ.
  const theSx: TheViec[] = td.du_kien_xong
    ? [{ nhan: `dự kiến xong ${fmtDate(td.du_kien_xong).replace(/\/\d{4}$/, "")}` },
      td.tre_ngay ? { nhan: `trễ ${td.tre_ngay} ngày`, tone: "bad" } : { nhan: "kịp hạn giao", tone: "ok" }]
    : td.chua_du_du_lieu ? [{ nhan: "chưa ước được ngày xong" }] : [];

  // Đủ hàng (kể cả nhờ tồn có sẵn của mã) thì việc kế tiếp là GIAO — không còn chờ xưởng hay KCS.
  // Lệnh của đơn mà vẫn chạy thì chạy xong sẽ ra hàng dư: nhắc một thẻ, không tự huỷ (12/10/2026).
  const thua = tt.khoXong ? lenh.filter((l) => !l.xong) : [];
  const theThua: TheViec[] = thua.length === 0 ? []
    : [{ nhan: thua.length === 1 ? `${thua[0].ma} vẫn chạy dù đã đủ hàng` : `${thua.length} lệnh vẫn chạy dù đã đủ hàng`, tone: "warn" }];

  const choKho = tt.khoXong ? [] : cum.filter((c) => c.cho_kho > 0);
  if (choKho.length > 0) {
    const c = choKho[0];
    const cau = choKho.length === 1
      ? `Kho chưa nhận ${so(c.cho_kho)} ${c.don_vi ?? ""} ${c.ten} KCS đã gửi`.replace(/\s+/g, " ")
      : `Kho chưa nhận hàng KCS đã gửi ở ${choKho.length} món`;
    return { cau, the: [...theSx, ...the] };
  }
  const chuaXuong = tt.khoXong ? [] : lenh.filter((l) => !l.xong && !l.da_xuong_xuong);
  if (chuaXuong.length > 0) {
    return {
      cau: chuaXuong.length === 1 ? `${chuaXuong[0].ma} chưa xuống xưởng` : `${chuaXuong.length} lệnh chưa xuống xưởng`,
      the,
      nut: { nhan: "Mở Kế hoạch SX", toi: "ke-hoach-sx" },
    };
  }
  const dangChay = tt.khoXong ? [] : lenh.filter((l) => !l.xong);
  if (dangChay.length > 0) {
    const l = dangChay[0];
    const cau = dangChay.length === 1
      ? `Xưởng đang chạy ${l.ma}${l.buoc_hien_tai ? `, đang ${l.buoc_hien_tai}` : ""}`
      : `Xưởng đang chạy ${dangChay.length} lệnh`;
    return { cau, the: [...theSx, ...the] };
  }
  // Lệnh đã đóng mà chưa đủ hàng: không còn gì đang tới — nói thẳng thiếu bao nhiêu và lối đi tiếp
  // (làm bù ở Kế hoạch SX, hoặc thỏa thuận giao thiếu), thay vì "chờ KCS" chẳng bao giờ tới (11/10/2026).
  const dongThieu = cum.filter((c) => c.o === "dong_thieu");
  if (dongThieu.length > 0) {
    const c = dongThieu[0];
    const co = Math.min(c.dat, coHangCum(c));
    const dv = c.don_vi ? ` ${c.don_vi}` : "";
    const cau = dongThieu.length === 1
      ? `Đã đóng lệnh khi ${c.ten} mới có ${so(co)}/${so(c.dat)}${dv}, thiếu ${so(c.dat - co)}${dv}`
      : `Đã đóng lệnh khi ${dongThieu.length} món chưa đủ hàng`;
    return {
      cau,
      the: [{ nhan: "làm bù hoặc thỏa thuận giao thiếu với khách", tone: "bad" }, ...the],
      nut: { nhan: "Mở Kế hoạch SX", toi: "ke-hoach-sx" },
    };
  }
  if (!tt.khoXong) return { cau: "Chờ KCS gửi thành phẩm sang kho", the };
  if (!giaoXong) {
    const giaoDuoc = cum.reduce((a, c) => a + c.giao_duoc, 0);
    const cau = tt.soYeuCauMo > 0 ? `Giao hàng đang xử lý ${tt.soYeuCauMo} yêu cầu`
      : giaoDuoc > 0 ? "Lập yêu cầu giao hàng" : "Chờ giao hàng";
    return { cau, the: [...theThua, ...the], nut: { nhan: "Xem giao hàng", toi: "giao" } };
  }
  if (o.hoaDon !== "full") {
    return { cau: "Kế toán ghi hóa đơn", the: [], nut: { nhan: "Xem hóa đơn", toi: "hoadon" } };
  }
  return { cau: "Đơn đã hoàn tất", the: [] };
}

/** Tách số đặt của một sản phẩm thành 5 khúc: đã giao / trong kho / chờ kho nhận / đang SX / chưa làm. */
function khucCum(c: DonTienDoCum) {
  const dat = Math.max(c.dat, 0);
  const giao = Math.min(dat, c.da_giao);
  // Hàng ĐÃ CÓ cho đơn = phần yêu cầu giao đang giữ + phần giao được ngay (11/10/2026: tồn của mã
  // là hàng của khách, kể cả phần đơn trước làm dư) — khớp `don_hang_san_xuat` ở máy chủ. Đếm theo
  // hàng lệnh của đơn đã nhập kho thì đơn có lệnh mà kho sẵn hàng vẫn báo "chưa có hàng".
  const kho = Math.max(0, Math.min(dat - giao, c.dang_giu + c.giao_duoc));
  const choKho = Math.max(0, Math.min(dat - giao - kho, c.cho_kho));
  const conLai = Math.max(0, dat - giao - kho - choKho);
  const dangChay = c.lenh.some((l) => l.da_xuong_xuong && !l.xong);
  return { dat, giao, kho, choKho, sx: dangChay ? conLai : 0, chua: dangChay ? 0 : conLai };
}

/** Một ô của dải số đầu mỗi chặng (phương án 2, 10/10/2026). `tone`: "chu" = ô cần để mắt (viền
 *  cam), "ok" = đã xong (viền xanh). `vua` = giá trị là chữ / ngày, cỡ nhỏ hơn số. */
/** `dv` là đơn vị đứng NGAY sau số (cùng dòng) — ô chỉ có dòng phụ khi thật sự có điều cần nói. */
export type OSo = { nhan: string; so: ReactNode; dv?: string; phu?: ReactNode; tone?: "chu" | "ok"; vua?: boolean };

export function DaiSo({ o }: { o: OSo[] }) {
  return (
    <div className="dhb__so4">
      {o.map((x) => (
        <div key={x.nhan} className={`dhb__so4-o${x.tone ? ` is-${x.tone}` : ""}`}>
          <small>{x.nhan}</small>
          <span className={x.vua ? "is-vua" : undefined}>{x.so}{x.dv && <i className="dhb__so4-dv">{x.dv}</i>}</span>
          {x.phu && <em>{x.phu}</em>}
        </div>
      ))}
    </div>
  );
}

/** Dòng tóm tắt của khung chặng kiểu "Order summary" của Shopify (12/10/2026): nhãn | diễn giải xám |
 *  số canh phải. `tong` = dòng cộng, có vạch trên. `tone`: "chu" = số cần để mắt, "ok" = đã xong. */
export type DongTT = { nhan: ReactNode; so: ReactNode; dien?: ReactNode; tone?: "chu" | "ok" | "mo"; tong?: boolean; khoa?: string };

export function TomTat({ d }: { d: DongTT[] }) {
  return (
    <div className="dhb__tt">
      {d.map((x, i) => (
        <div key={x.khoa ?? i} className={`dhb__tt-r${x.tong ? " is-tong" : ""}`}>
          <span className="dhb__tt-nhan">{x.nhan}</span>
          <span className="dhb__tt-dien">{x.dien}</span>
          <span className={`dhb__tt-so${x.tone ? ` is-${x.tone}` : ""}`}>{x.so}</span>
        </div>
      ))}
    </div>
  );
}

/** Dải chân xám của khung chặng: câu nhắc bên trái, nút bên phải. */
export function ChanKhung({ chu, children }: { chu?: ReactNode; children?: ReactNode }) {
  return (
    <div className="dhb__the-chan">
      <span className="dhb__the-chan-chu">{chu}</span>
      {children && <span className="dhb__the-chan-nut">{children}</span>}
    </div>
  );
}

/** Lệnh đang chạy đầu tiên của món: "Cắt tờ 3%". */
function buocDangChay(c: DonTienDoCum): string | null {
  const l = c.lenh.find((x) => x.da_xuong_xuong && !x.xong && x.buoc_hien_tai);
  return l ? `${l.buoc_hien_tai} ${so(Math.round(l.pct))}%` : null;
}

/** Từng sản phẩm của chặng GIAO (phương án A + khuôn phương án 2, 10/10/2026): dải bốn ô số rồi bảng
 *  hàng đang nằm ở KHO NÀO. Từ 11/10/2026 thành phẩm thuộc về khách: tồn của mã là hàng của khách,
 *  đơn nào của khách cũng giao được — trừ phần đơn khác của khách đang giữ (dòng chân bảng). */
export function BangCum({ td }: { td: DonTienDo | null }) {
  if (!td) return <EmptyState trangThai="dang-tai" gon nhanTai="Đang tải tiến độ…" />;
  if (td.cum.length === 0) return <p className="dhb__td-note">Đơn chưa có sản phẩm.</p>;
  return (
    <div className="dhb__td-cums">
      {td.cum.map((c) => {
        const k = khucCum(c);
        const dv = c.don_vi ?? "";
        const conLai = k.choKho + k.sx + k.chua;
        const dangChay = k.sx > 0;
        const ton = c.ton_kho ?? [];
        const buoc = buocDangChay(c);
        return (
          <div key={c.khoa} className="dhb__td-cum">
            <div className="dhb__td-cum-head">
              <span className="dhb__td-cum-ten">{c.ten}</span>
              <span className="dhb__td-cum-dat">khách đặt {so(c.dat)} {dv}</span>
            </div>
            <DaiSo o={[
              { nhan: "Đã giao", so: so(c.da_giao), dv, phu: c.khach_nhan_du ? "khách đã nhận đủ" : undefined,
                tone: c.khach_nhan_du ? "ok" : undefined },
              { nhan: "Còn phải giao", so: so(c.con_phai_giao), dv,
                phu: c.dang_giu > 0 ? `đã trừ ${so(c.dang_giu)} đang giữ cho yêu cầu` : undefined },
              { nhan: "Giao được ngay", so: so(c.giao_duoc), dv, tone: c.con_phai_giao > 0 ? "chu" : undefined,
                phu: c.giao_duoc > 0 ? `ở ${ton.length} kho`
                  : (c.giu_don_khac ?? 0) > 0 ? "đơn khác của khách đang giữ"
                  : c.co_lenh ? "kho chưa nhận hàng" : "kho không còn hàng" },
              conLai === 0
                ? { nhan: "Còn phải làm", so: "0", dv, phu: "đã đủ hàng" }
                : { nhan: dangChay ? "Đang làm ở xưởng" : k.choKho > 0 ? "Chờ kho nhận" : "Chưa có hàng",
                    so: so(conLai), dv,
                    phu: k.choKho > 0 && dangChay ? `${so(k.choKho)} chờ kho nhận` : buoc ?? undefined },
            ]} />
            <BangTonKho ton={ton} dv={dv} giuDonKhac={c.giu_don_khac ?? 0} ten={c.ten} />
          </div>
        );
      })}
    </div>
  );
}

function BangTonKho({ ton, dv, giuDonKhac, ten }: {
  ton: NonNullable<DonTienDoCum["ton_kho"]>; dv: string; giuDonKhac: number; ten: string;
}) {
  if (ton.length === 0) return <p className="dhb__td-note">Không kho nào đang có {ten}.</p>;
  return (
    <div className="dhb__td-kho">
      <table>
        <thead>
          <tr><th>Kho</th><th className="dhb__text-right">Đang có</th></tr>
        </thead>
        <tbody>
          {ton.map((r) => (
            <tr key={r.kho_id}>
              <td>{r.kho_ten}</td>
              <td className="dhb__text-right dhb__mono">{so(r.so_luong)}</td>
            </tr>
          ))}
        </tbody>
        {giuDonKhac > 0 && (
          <tfoot>
            <tr><td colSpan={2}>
              {so(giuDonKhac)} {dv} đang giữ cho đơn khác của khách, chưa tính vào giao được.
            </td></tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function homNay(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Bước "Giao hàng" (khuôn Shopify 12/10/2026, mockup docs/mockups/ngan-don-hang-ban-3-phuong-an.html):
 *  dòng tóm tắt số giao của đơn, bảng yêu cầu giao + chuyến, dải chân có nút lập yêu cầu (trần theo
 *  `giao_duoc`). Chỉ nói chuyện giao — hàng đang làm ở xưởng thuộc khung Sản xuất. */
export function BuocGiaoHang({
  order, td, taiLai, onIn, navigate,
}: {
  order: OrderDetail;
  td: DonTienDo | null;
  taiLai: () => void;
  onIn: (yc: DonTienDoYeuCau) => void;
  navigate?: (id: string, params?: Record<string, unknown>) => void;
}) {
  const { token } = useAuth();
  const can = useCan();
  const canRead = can("giao_hang", "read");
  const canWrite = can("giao_hang", "create");
  const [mo, setMo] = useState(false);
  const [sua, setSua] = useState<DonTienDoYeuCau | null>(null);
  const [huy, setHuy] = useState<DonTienDoYeuCau | null>(null);
  const [lyDoHuy, setLyDoHuy] = useState("");
  const [loi, setLoi] = useState<string | null>(null);

  if (!canRead) return <ChanKhung chu="Vai của bạn chưa được xem màn Giao hàng." />;
  if (!td) return <div className="dhb__the-than"><EmptyState trangThai="dang-tai" gon /></div>;
  if (order.status !== "ordered" && td.yeu_cau.length === 0) {
    return <ChanKhung chu="Đơn phải chốt trước mới lập yêu cầu giao được." />;
  }
  const tongGiaoDuoc = td.cum.reduce((a, c) => a + c.giao_duoc, 0);
  const conPhai = td.cum.some((c) => c.con_phai_giao > 0);
  const lenhCho = td.cum.filter((c) => c.con_phai_giao > 0).flatMap((c) => c.lenh.map((l) => l.ma))
    .filter((m, i, a) => a.indexOf(m) === i);
  const motDv = td.cum.length === 1 && td.cum[0].don_vi ? ` ${td.cum[0].don_vi}` : "";

  const huyYc = () => {
    if (!token || !huy) return;
    setLoi(null);
    api.giaoHang.cancelRequest(token, huy.id, lyDoHuy.trim())
      .then(() => { setHuy(null); setLyDoHuy(""); taiLai(); })
      .catch((e: unknown) => setLoi(e instanceof Error ? e.message : "Không huỷ được yêu cầu"));
  };

  // Vì sao "giao được ngay" ít hơn tồn: phần tồn đơn khác của khách đang giữ (11/10/2026).
  const lyDoGiaoDuoc = (c: DonTienDoCum) => {
    const ton = (c.ton_kho ?? []).reduce((a, r) => a + r.so_luong, 0);
    const giu = c.giu_don_khac ?? 0;
    // Chỉ nói chuyện hàng giữ cho đơn khác khi chính nó làm giao được thấp hơn phần còn phải giao —
    // tồn dư đủ cho phần còn lại thì câu đó là nhiễu (13/10/2026).
    if (giu > 0 && c.giao_duoc < c.con_phai_giao) return `${so(giu)} trong ${so(ton)}${c.don_vi ? ` ${c.don_vi}` : ""} ở kho đang giữ cho đơn khác`;
    if (c.giao_duoc > 0) return (c.ton_kho ?? []).map((r) => r.kho_ten).join(" và ");
    if (c.con_phai_giao <= 0) return undefined;
    return c.co_lenh ? "kho chưa nhận hàng" : "kho không còn hàng";
  };
  const dv = (c: DonTienDoCum) => (c.don_vi ? ` ${c.don_vi}` : "");
  const soYcMo = (c: DonTienDoCum) => td.yeu_cau.filter((y) => y.trang_thai === "cho_len_ke_hoach" || y.trang_thai === "dang_thuc_hien")
    .filter((y) => y.dong.some((d) => c.order_line_ids.includes(d.order_line_id))).length;

  return (
    <>
      {td.cum.length === 1 ? (() => {
        const c = td.cum[0];
        return (
          <TomTat d={[
            { nhan: "Khách đặt", so: `${so(c.dat)}${dv(c)}` },
            { nhan: "Đã giao", so: `${so(c.da_giao)}${dv(c)}`, dien: c.khach_nhan_du ? "khách đã nhận đủ" : undefined,
              tone: c.khach_nhan_du ? "ok" : undefined },
            ...(c.dang_giu > 0 ? [{ nhan: "Đang chờ giao", so: `${so(c.dang_giu)}${dv(c)}`,
              dien: soYcMo(c) > 0 ? `${soYcMo(c)} yêu cầu` : undefined }] : []),
            { nhan: "Còn phải giao", so: `${so(c.con_phai_giao)}${dv(c)}`, tong: true },
            { nhan: "Giao được ngay", so: `${so(c.giao_duoc)}${dv(c)}`, dien: lyDoGiaoDuoc(c) },
          ]} />
        );
      })() : (
        <div className="dhb__the-bang">
          <table className="dhb__g">
            <thead>
              <tr>
                <th>Mặt hàng</th><th className="dhb__text-right">Khách đặt</th><th className="dhb__text-right">Đã giao</th>
                <th className="dhb__text-right">Đang chờ giao</th><th className="dhb__text-right">Còn phải giao</th>
                <th className="dhb__text-right">Giao được ngay</th>
              </tr>
            </thead>
            <tbody>
              {td.cum.map((c) => (
                <tr key={c.khoa}>
                  <td>{c.ten}</td>
                  <td className="dhb__text-right dhb__mono">{so(c.dat)}{dv(c)}</td>
                  <td className="dhb__text-right dhb__mono">{so(c.da_giao)}</td>
                  <td className="dhb__text-right dhb__mono">{so(c.dang_giu)}</td>
                  <td className="dhb__text-right dhb__mono">{so(c.con_phai_giao)}</td>
                  <td className="dhb__text-right dhb__mono" title={lyDoGiaoDuoc(c)}>{so(c.giao_duoc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loi && <div className="banner banner--error" role="alert" style={{ margin: "0 20px 8px" }}>{loi}</div>}

      {td.yeu_cau.length > 0 && (
        <div className="dhb__the-bang">
          <table className="dhb__g">
            <thead>
              <tr>
                <th>Yêu cầu giao</th><th>Cần giao</th><th className="dhb__text-right">Số lượng</th>
                <th>Chuyến</th><th>Trạng thái</th><th />
              </tr>
            </thead>
            <tbody>
              {td.yeu_cau.flatMap((y) => {
                const ch = y.chuyen;
                const suaDuoc = canWrite && y.trang_thai === "cho_len_ke_hoach" && !ch;
                const huyDuoc = canWrite && (y.trang_thai === "cho_len_ke_hoach" || y.trang_thai === "chuyen_da_huy");
                const khacDiaChi = y.dia_chi && y.dia_chi !== order.delivery_address;
                return [
                  <tr key={y.id}>
                    <td className="dhb__g-hai">
                      <span className="dhb__mono">{y.code}</span>
                      {khacDiaChi && <small>{y.dia_chi}</small>}
                      {y.trang_thai === "da_huy" && y.ly_do_huy && <small>Lý do huỷ: {y.ly_do_huy}</small>}
                    </td>
                    <td className="dhb__mono">{fmtDate(y.ngay_can_giao)}</td>
                    <td className="dhb__text-right dhb__g-hai">
                      {y.dong.map((d) => (
                        <span key={d.order_line_id} className="dhb__mono">
                          {td.cum.length > 1 ? `${d.ten || "Hàng"} ` : ""}{so(d.qty)}{motDv}
                          {d.da_giao > 0 && d.da_giao !== d.qty && <small>đã giao {so(d.da_giao)}</small>}
                        </span>
                      ))}
                    </td>
                    <td className="dhb__g-hai">
                      {ch ? (
                        <>
                          <span>{nhanChuyen(ch)}</span>
                          <small className="dhb__g-cach">
                            {ch.tai_xe && <span>{ch.tai_xe}</span>}
                            {ch.xe && <span>{ch.xe}</span>}
                            {ch.thoi_gian_ket_thuc && <span>xong {fmtDateTime(ch.thoi_gian_ket_thuc)}</span>}
                            {ch.nguoi_nhan_thuc_te && <span>{ch.nguoi_nhan_thuc_te} nhận</span>}
                            {ch.so_anh > 0 && <span>{ch.so_anh} ảnh</span>}
                          </small>
                          {ch.ly_do_that_bai && <small>Lý do: {ch.ly_do_that_bai}</small>}
                          {ch.tra_hang_ma && <small>Trả hàng {ch.tra_hang_ma} {ch.tra_hang_xong ? "kho đã nhận lại" : "chờ kho nhận lại"}</small>}
                        </>
                      ) : y.trang_thai === "cho_len_ke_hoach" ? <span className="dhb__muted">chờ điều phối</span> : <span className="dhb__muted">—</span>}
                    </td>
                    <td><ChipTT mau={(TONE_YC[y.trang_thai] ?? "slate") as MauTT}>{NHAN_TRANG_THAI_YC[y.trang_thai] ?? y.trang_thai}</ChipTT></td>
                    <td className="dhb__text-right dhb__g-nut">
                      {/* In theo số phiếu xuất ⇒ kho ghi sổ xong mới mở (13/10/2026). Chuyến thất bại thì
                          khách không nhận gì để ký ⇒ không có phiếu giao (#34, 18/10/2026). */}
                      {y.chuyen?.kho_da_xuat && !CHUYEN_THAT_BAI.includes(y.chuyen.trang_thai)
                        ? <button type="button" className="dhb__td-link" onClick={() => onIn(y)}>In phiếu giao</button>
                        : (y.chuyen?.trang_thai === "da_len_ke_hoach" || y.chuyen?.trang_thai === "dang_chuan_bi")
                          && <span className="dhb__muted">chờ kho xuất mới in</span>}
                      {suaDuoc && <button type="button" className="dhb__td-link" onClick={() => { setSua(y); setMo(false); }}>Sửa</button>}
                      {huyDuoc && <button type="button" className="dhb__td-link dhb__td-link--do" onClick={() => { setHuy(y); setLyDoHuy(""); }}>Huỷ</button>}
                    </td>
                  </tr>,
                  ...(huy?.id === y.id ? [
                    <tr key={`${y.id}-huy`}>
                      <td colSpan={6}>
                        <div className="dhb__td-yc-huy">
                          <input className="input" placeholder="Lý do huỷ yêu cầu…" value={lyDoHuy}
                            aria-label={`Lý do huỷ ${y.code}`} onChange={(e) => setLyDoHuy(e.target.value)} />
                          <Button variant="accent" disabled={!lyDoHuy.trim()} onClick={huyYc}>Xác nhận huỷ</Button>
                          <Button variant="ghost" onClick={() => setHuy(null)}>Bỏ</Button>
                        </div>
                      </td>
                    </tr>,
                  ] : []),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}

      {order.status === "ordered" && conPhai ? (
        <ChanKhung chu={!canWrite ? "Chỉ xem: vai của bạn chưa được bật ô Thao tác ở màn Giao hàng."
          : tongGiaoDuoc > 0 ? `Giao được tối đa ${so(tongGiaoDuoc)}${motDv}.`
          : lenhCho.length > 0 ? `Chưa có hàng của đơn này ở kho nào. Kho nhận hàng từ ${lenhCho.join(" và ")} xong là giao được.`
          : "Chưa có hàng của đơn này ở kho nào."}>
          {canWrite && (
            <Button variant="accent" disabled={tongGiaoDuoc <= 0} onClick={() => setMo(true)}>
              Tạo yêu cầu giao hàng
            </Button>
          )}
        </ChanKhung>
      ) : td.yeu_cau.length === 0 ? (
        <ChanKhung chu="Chưa có yêu cầu giao hàng nào." />
      ) : null}
      {mo && (
        <FormYeuCau order={order} td={td} navigate={navigate}
          onXong={() => { setMo(false); taiLai(); }} onBo={() => setMo(false)} />
      )}
      {sua && (
        <FormYeuCau order={order} td={td} sua={sua} navigate={navigate}
          onXong={() => { setSua(null); taiLai(); }} onBo={() => setSua(null)} />
      )}
    </>
  );
}

/** Lập mới (không có `sua`) hoặc sửa yêu cầu chưa lên chuyến. Hàng + số lượng của yêu cầu đã lập
 *  KHÔNG sửa — muốn đổi thì huỷ rồi lập lại (giữ vết đúng một chỗ).
 *
 *  NƠI NHẬN KHÔNG GÕ TAY (chủ chốt 19/09/2026): chỉ CHỌN — mặc định nơi nhận của đơn (đơn kế thừa từ
 *  báo giá, báo giá chọn từ khách), đổi thì chọn trong sổ địa chỉ / người liên hệ của khách. Thiếu thì
 *  bổ sung ở hồ sơ khách hàng, một chỗ, mọi nơi khác tự lấy theo. */
function FormYeuCau({
  order, td, sua, onXong, onBo, navigate,
}: {
  order: OrderDetail;
  td: DonTienDo;
  sua?: DonTienDoYeuCau;
  onXong: () => void;
  onBo: () => void;
  navigate?: (id: string, params?: Record<string, unknown>) => void;
}) {
  const { token } = useAuth();
  const HOM_NAY = homNay();
  const nn = td.noi_nhan;
  const coTheoDon = Boolean(nn.dia_chi?.trim());
  // "" = theo đơn. Đơn không có địa chỉ ⇒ mặc định địa chỉ mặc định của khách (hoặc cái đầu sổ).
  const dcMacDinh = (): string => {
    if (sua) {
      const trung = nn.so_dia_chi.find((x) => x.dia_chi === sua.dia_chi);
      if (trung && sua.dia_chi !== nn.dia_chi) return String(trung.id);
      return coTheoDon ? "" : trung ? String(trung.id) : "";
    }
    if (coTheoDon) return "";
    const d = nn.so_dia_chi.find((x) => x.mac_dinh) ?? nn.so_dia_chi[0];
    return d ? String(d.id) : "";
  };
  const lhMacDinh = (): string => {
    if (sua && sua.nguoi_nhan && sua.nguoi_nhan !== nn.nguoi_nhan) {
      const trung = nn.lien_he.find((x) => x.ten === sua.nguoi_nhan);
      if (trung) return String(trung.id);
    }
    if (nn.nguoi_nhan) return "";
    const c = nn.lien_he.find((x) => x.chinh) ?? nn.lien_he[0];
    return c ? String(c.id) : "";
  };
  // Yêu cầu mới mặc định giao HÔM NAY — sửa thì giữ ngày đã gửi.
  const [ngay, setNgay] = useState(sua ? sua.ngay_can_giao.slice(0, 10) : HOM_NAY);
  const [dcId, setDcId] = useState(dcMacDinh);
  const [lhId, setLhId] = useState(lhMacDinh);
  const coHang = td.cum.filter((c) => c.giao_duoc > 0);
  // Điền sẵn TOÀN BỘ phần giao được — ca hay gặp nhất; ai muốn giao ít hơn thì sửa số.
  const [soLuong, setSoLuong] = useState<Record<string, string>>(
    () => Object.fromEntries(coHang.map((c) => [c.khoa, String(c.giao_duoc)])),
  );
  const [loi, setLoi] = useState<string | null>(null);
  const [dangGui, setDangGui] = useState(false);
  const ngayQuaKhu = ngay !== "" && ngay < HOM_NAY;
  const khongCoDiaChi = !coTheoDon && nn.so_dia_chi.length === 0;

  const dong = coHang
    .map((c) => ({ c, qty: Number(soLuong[c.khoa] ?? 0) }))
    .filter((x) => x.qty > 0);
  const vuot = dong.find((x) => x.qty > x.c.giao_duoc);
  const noiNhan = {
    dia_chi_id: dcId ? Number(dcId) : null,
    lien_he_id: lhId ? Number(lhId) : null,
  };

  const gui = () => {
    if (!token) return;
    setLoi(null);
    setDangGui(true);
    const p = sua
      ? api.giaoHang.updateRequest(token, sua.id, { ngay_can_giao: ngay, ...noiNhan })
      : api.giaoHang.createRequest(token, {
          order_id: order.id,
          ngay_can_giao: ngay,
          // Một cụm gửi MỘT dòng (dòng đầu) — máy chủ bung ra mọi dòng của cụm cùng số.
          lines: dong.map((x) => ({ order_line_id: x.c.order_line_ids[0], qty: x.qty })),
          ...noiNhan,
        });
    p.then(onXong)
      .catch((e: unknown) => setLoi(e instanceof Error ? e.message : "Không lưu được yêu cầu"))
      .finally(() => setDangGui(false));
  };

  const chuaCoHang = td.cum.filter((c) => c.giao_duoc <= 0 && c.con_phai_giao > 0);
  const luuY = nn.luu_y?.trim();
  // Chân popup: nút khoá thì nói lý do ngay cạnh nút, không bắt người dùng đoán.
  const lyDoKhoa = khongCoDiaChi ? "Khách chưa có địa chỉ giao"
    : !sua && dong.length === 0 ? "Chưa có hàng nào để giao"
    : vuot ? "Số lượng vượt phần giao được"
    : !ngay ? "Chọn ngày cần giao"
    : ngayQuaKhu ? "Ngày cần giao đã qua"
    : null;
  const tomTat = sua ? "Chỉ sửa ngày và nơi nhận — số lượng giữ như lúc lập" : `Giao ${dong.length} sản phẩm`;

  return (
    <DetailModal
      kicker="Giao hàng"
      title={sua ? `Sửa yêu cầu ${sua.code}` : "Tạo yêu cầu giao hàng"}
      // Mã đơn và khách là hai mẩu riêng — khoảng cách tách, không nối bằng dấu chấm giữa.
      subtitle={<span className="dhb__yc-phude">
        {order.order_no && <span>{order.order_no}</span>}
        {order.customer_name && <span>{order.customer_name}</span>}
      </span>}
      width={620}
      onClose={onBo}
      footer={
        <>
          <span className={`dmodal__foot-note ${lyDoKhoa ? "is-warn" : ""}`}>{lyDoKhoa ?? tomTat}</span>
          <Button variant="ghost" onClick={onBo}>Bỏ</Button>
          <Button variant="accent" disabled={dangGui || lyDoKhoa !== null} onClick={gui}>
            {sua ? "Lưu thay đổi" : "Gửi yêu cầu"}
          </Button>
        </>
      }
    >
      <div className="pform">
        {!sua && (
          <section>
            <h3 className="pform__section-title">Hàng giao đợt này</h3>
            <div className="pform__items">
              {coHang.length === 0 && (
                <div className="pform__item"><span className="pform__item-name">Kho chưa nhận hàng nào của đơn này.</span></div>
              )}
              {coHang.map((c) => {
                const qty = Number(soLuong[c.khoa] ?? 0);
                return (
                  <div key={c.khoa} className="pform__item">
                    <span className="pform__item-name">
                      {c.ten}
                      <small className={qty > c.giao_duoc ? "pform__hint is-error" : undefined}>
                        {qty > c.giao_duoc ? "Vượt — " : ""}giao được tối đa {so(c.giao_duoc)} {c.don_vi ?? ""}
                      </small>
                    </span>
                    <span className="pform__suffix">
                      <input
                        className="input"
                        type="number" min="0" step="1" max={c.giao_duoc}
                        aria-label={`Số lượng giao — ${c.ten}`}
                        value={soLuong[c.khoa] ?? ""}
                        onChange={(e) => setSoLuong((p) => ({ ...p, [c.khoa]: e.target.value }))}
                      />
                      <span>{c.don_vi ?? "SL"}</span>
                    </span>
                  </div>
                );
              })}
              {chuaCoHang.length > 0 && (
                <div className="pform__items-off">
                  Chưa có hàng trong kho: {chuaCoHang.map((c) => c.ten).join(", ")}
                </div>
              )}
            </div>
          </section>
        )}

        <section>
          <h3 className="pform__section-title">Ngày & nơi nhận</h3>
          <div className="pform__grid">
            <label className="pform__field">
              Ngày cần giao
              <ChonNgay className="input" aria-label="Ngày cần giao" value={ngay} min={HOM_NAY} onChange={(v) => setNgay(v)} />
              {ngayQuaKhu && <span className="pform__hint is-error">Không được ở quá khứ — hôm nay là {fmtDate(HOM_NAY)}.</span>}
            </label>
          </div>
        </section>

        {khongCoDiaChi ? (
          <div className="banner banner--error" role="alert" style={{ margin: 0 }}>
            Khách <b>{order.customer_name ?? ""}</b> chưa có địa chỉ giao — thêm ở hồ sơ khách hàng rồi quay
            lại chọn.{" "}
            {navigate && (
              <button type="button" className="dhb__td-link"
                onClick={() => navigate("khach-hang", order.customer_id != null ? { openCustomerId: order.customer_id } : undefined)}>
                Mở hồ sơ khách hàng ↗
              </button>
            )}
          </div>
        ) : (
          <fieldset className="pform__choices">
            <legend>Giao tới</legend>
            {coTheoDon && (
              <TheChon name="gh-yc-dia-chi" value="" chon={dcId} onChon={setDcId}
                tieuDe="Địa chỉ ghi trên đơn" nhan="Theo đơn" dong2={nn.dia_chi} />
            )}
            {nn.so_dia_chi.map((x) => (
              <TheChon key={x.id} name="gh-yc-dia-chi" value={String(x.id)} chon={dcId} onChon={setDcId}
                tieuDe={x.nhan} nhan={x.mac_dinh ? "Mặc định" : undefined} dong2={x.dia_chi} />
            ))}
          </fieldset>
        )}

        <fieldset className="pform__choices">
          <legend>Người nhận</legend>
          {nn.nguoi_nhan && (
            <TheChon name="gh-yc-nguoi-nhan" value="" chon={lhId} onChon={setLhId}
              tieuDe={nn.nguoi_nhan} nhan="Theo đơn" phai={nn.sdt ?? undefined} />
          )}
          {nn.lien_he.map((x) => (
            <TheChon key={x.id} name="gh-yc-nguoi-nhan" value={String(x.id)} chon={lhId} onChon={setLhId}
              tieuDe={x.ten} nhan={x.chinh ? "Liên hệ chính" : undefined}
              dong2={x.chuc_vu ?? undefined} phai={x.sdt ?? undefined} />
          ))}
          {!nn.nguoi_nhan && nn.lien_he.length === 0 && (
            <p className="pform__hint" style={{ margin: 0 }}>Khách chưa có người liên hệ — thêm ở hồ sơ khách hàng.</p>
          )}
        </fieldset>
        <p className="pform__hint" style={{ margin: "-8px 0 0" }}>
          Địa chỉ và người nhận lấy từ hồ sơ khách — muốn thêm mới thì sửa ở hồ sơ khách hàng.
        </p>

        {luuY && (
          <div className="pform__note">
            <b>Lưu ý giao của đơn</b>
            <span>{luuY}</span>
          </div>
        )}

        {loi && <div className="banner banner--error" role="alert" style={{ margin: 0 }}>{loi}</div>}
      </div>
    </DetailModal>
  );
}

/** Một lựa chọn dạng thẻ (radio) — tên đậm, dòng phụ bên dưới, số điện thoại canh phải; thay cho
 *  `<select>` nhồi mọi thông tin vào một dòng ngăn bằng dấu chấm. */
function TheChon({
  name, value, chon, onChon, tieuDe, nhan, dong2, phai,
}: {
  name: string;
  value: string;
  chon: string;
  onChon: (v: string) => void;
  tieuDe: string;
  nhan?: string;
  dong2?: string | null;
  phai?: string;
}) {
  const on = chon === value;
  return (
    <label className={`pform__choice ${on ? "is-on" : ""}`}>
      <input type="radio" name={name} value={value} checked={on} onChange={() => onChon(value)} aria-label={tieuDe} />
      <span className="pform__choice-main">
        <span className="pform__choice-title">
          {tieuDe}
          {nhan && <em>{nhan}</em>}
        </span>
        {dong2 && <span className="pform__choice-sub">{dong2}</span>}
      </span>
      {phai && <span className="pform__choice-side">{phai}</span>}
    </label>
  );
}
