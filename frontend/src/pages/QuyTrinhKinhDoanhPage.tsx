import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../components/Icons";
import { useLaDienThoai } from "../utils/dienThoai";
import "./quy-trinh-kinh-doanh.css";

/** Quy trình kinh doanh — sơ đồ làn "đơn hàng đi qua những bộ phận nào, làm ở màn nào".
  *
  * Làm lại 05/10/2026. Sơ đồ cũ sai nghĩa: làn "Khách hàng" có ô bấm được (khách không dùng hệ
  * thống), thiếu hẳn Cọc, Kế hoạch SX, KCS, Hóa đơn; Nhập kho và Phiếu xuất báo "đang phát triển"
  * dù màn Kho đã chạy; toạ độ gõ tay, chữ 10px. Nay: CỘT = bộ phận thật trong xưởng, mỗi bước là
  * một ô số, mũi tên mang điều kiện ngắn ("cần cọc", "kho đã nhận"). Trên sơ đồ chỉ có tên bước —
  * bấm vào ô mới hiện mô tả và nút mở màn. Toạ độ x/y TÍNH từ làn + hàng, không gõ pixel. */

export type BoPhan = "kd" | "kt" | "khsx" | "to" | "kcs" | "kho" | "gh";

export const BO_PHAN: { key: BoPhan; nhan: string }[] = [
  { key: "kd", nhan: "Kinh doanh" },
  { key: "kt", nhan: "Kế toán" },
  { key: "khsx", nhan: "Kế hoạch SX" },
  { key: "to", nhan: "Tổ sản xuất" },
  { key: "kcs", nhan: "KCS" },
  { key: "kho", nhan: "Kho" },
  { key: "gh", nhan: "Giao hàng" },
];

export interface Buoc {
  id: string;
  /** Số thứ tự hiện trên ô; ô mở đầu/kết thúc không có số. */
  stt?: number;
  ten: string;
  boPhan: BoPhan;
  /** Hàng trên sơ đồ (0 = trên cùng). */
  hang: number;
  loai?: "dau" | "cuoi";
  moTa?: string;
  /** Id màn trên menu; bỏ trống = bước không có màn riêng. */
  man?: string;
  /** Tên màn hiện trên nút — đúng nhãn menu để người dùng tìm lại được. */
  tenMan?: string;
}

export const BUOC: Buoc[] = [
  { id: "dau", ten: "Khách hỏi giá", boPhan: "kd", hang: 0, loai: "dau" },
  { id: "khach", stt: 1, ten: "Ghi nhận khách", boPhan: "kd", hang: 1, man: "khach-hang", tenMan: "Khách hàng",
    moTa: "Khách mới thì lập hồ sơ; khách cũ chọn lại để kế thừa người phụ trách và điều khoản." },
  { id: "tinhgia", stt: 2, ten: "Lập phiếu tính giá", boPhan: "kd", hang: 2, man: "tinh-gia", tenMan: "Tính giá",
    moTa: "Chọn quy cách, giấy và các công đoạn từ In trở đi; phần mềm tính ra giá vốn và giá bán." },
  { id: "baogia", stt: 3, ten: "Làm báo giá", boPhan: "kd", hang: 3, man: "bao-gia", tenMan: "Báo giá in ấn",
    moTa: "Một phiếu tính giá ra đúng một báo giá. Báo giá đặc thù phải trình Giám đốc Kinh doanh duyệt." },
  { id: "guikhach", stt: 4, ten: "Gửi khách, ghi kết quả", boPhan: "kd", hang: 4, man: "bao-gia", tenMan: "Báo giá in ấn",
    moTa: "Gửi báo giá cho khách rồi ghi lại khách đồng ý hay từ chối. Khách từ chối thì dừng ở đây." },
  { id: "chotdon", stt: 5, ten: "Lên đơn, chốt đơn", boPhan: "kd", hang: 5, man: "don-hang-ban", tenMan: "Đơn hàng bán",
    moTa: "Tạo đơn hàng bán từ báo giá khách đã đồng ý, điền hạn giao và lưu ý sản xuất rồi chốt đơn." },
  { id: "coc", stt: 6, ten: "Thu cọc", boPhan: "kt", hang: 5, man: "ke-toan-phieu-thu", tenMan: "Phiếu thu",
    moTa: "Lập phiếu thu cọc theo tỷ lệ của đơn. Đủ cọc thì đơn tự xuống hàng chờ của Kế hoạch sản xuất." },
  { id: "lenh", stt: 7, ten: "Lên lệnh sản xuất", boPhan: "khsx", hang: 5, man: "ke-hoach-sx", tenMan: "Kế hoạch sản xuất",
    moTa: "Nhận đơn ở hàng chờ, lên lệnh cho từng món. Món đủ tồn kho thì lấy từ kho, không cần lệnh." },
  { id: "vattu", stt: 8, ten: "Lo vật tư", boPhan: "khsx", hang: 6, man: "ke-hoach-vat-tu", tenMan: "Kế hoạch vật tư",
    moTa: "Xem lệnh còn thiếu giấy, vật tư gì và hạn phải đặt mua." },
  { id: "xeplich", stt: 9, ten: "Xếp lịch máy", boPhan: "khsx", hang: 7, man: "xep-lich", tenMan: "Xếp lịch",
    moTa: "Đặt giờ chạy cho lệnh theo từng máy, thấy trước lệnh nào có nguy cơ trễ hạn." },
  { id: "chay", stt: 10, ten: "Chạy công đoạn", boPhan: "to", hang: 7, man: "theo-doi-san-xuat", tenMan: "Theo dõi sản xuất",
    moTa: "Mỗi tổ nhận việc và khai sản lượng ngay tại bàn của tổ mình (menu Tổ sản xuất)." },
  { id: "kcs", stt: 11, ten: "Kiểm hàng, gửi kho", boPhan: "kcs", hang: 7, man: "kcs", tenMan: "KCS",
    moTa: "KCS kiểm thành phẩm theo lệnh; phần đạt được gửi sang kho." },
  { id: "nhapkho", stt: 12, ten: "Nhận thành phẩm", boPhan: "kho", hang: 7, man: "kho-main", tenMan: "Yêu cầu nhập xuất",
    moTa: "Kho đối chiếu rồi nhận phần KCS gửi. Kho nhận đủ mọi món thì đơn mới tính là xong sản xuất." },
  { id: "ycgiao", stt: 13, ten: "Lập yêu cầu giao", boPhan: "kd", hang: 8, man: "don-hang-ban", tenMan: "Đơn hàng bán",
    moTa: "Lập ở chặng Giao của đơn, chỉ cho phần kho đã nhận. Mỗi yêu cầu là một chuyến; giao thiếu thì lập yêu cầu mới." },
  { id: "chuyen", stt: 14, ten: "Xếp chuyến giao", boPhan: "gh", hang: 8, man: "giao-hang", tenMan: "Giao hàng",
    moTa: "Xếp xe, người giao, giờ lấy và giờ giao. Mỗi chuyến sinh một phiếu xuất kho." },
  { id: "xuatkho", stt: 15, ten: "Soạn hàng, xuất kho", boPhan: "kho", hang: 9, man: "kho-main", tenMan: "Yêu cầu nhập xuất",
    moTa: "Kho soạn hàng theo phiếu xuất của chuyến rồi ghi sổ khi giao cho tài xế." },
  { id: "giao", stt: 16, ten: "Giao, ghi kết quả", boPhan: "gh", hang: 9, man: "giao-hang", tenMan: "Giao hàng",
    moTa: "Ghi khách nhận đủ, nhận thiếu hay không nhận. Hàng không giao được quay về kho." },
  { id: "hoadon", stt: 17, ten: "Ghi hóa đơn", boPhan: "kt", hang: 10, man: "don-hang-ban", tenMan: "Đơn hàng bán",
    moTa: "Ghi số hóa đơn đã xuất bên MISA theo phần đã giao, ở chặng Hóa đơn của đơn. Có hóa đơn mới phát sinh công nợ." },
  { id: "thutien", stt: 18, ten: "Thu tiền, đối công nợ", boPhan: "kt", hang: 11, man: "ke-toan-cong-no-phai-thu", tenMan: "Công nợ phải thu",
    moTa: "Theo dõi khoản phải thu của từng khách, lập phiếu thu khi khách trả." },
  { id: "cuoi", ten: "Đơn hoàn tất", boPhan: "kt", hang: 12, loai: "cuoi" },
];

export interface Noi {
  tu: string;
  toi: string;
  /** Điều kiện ngắn in trên mũi tên. */
  nhan?: string;
  /** Cùng hàng nhưng phải vòng xuống dưới để khỏi đè lên ô ở giữa. */
  vongDuoi?: boolean;
}

export const NOI: Noi[] = [
  { tu: "dau", toi: "khach" },
  { tu: "khach", toi: "tinhgia" },
  { tu: "tinhgia", toi: "baogia" },
  { tu: "baogia", toi: "guikhach" },
  { tu: "guikhach", toi: "chotdon", nhan: "khách đồng ý" },
  { tu: "chotdon", toi: "coc", nhan: "cần cọc" },
  { tu: "coc", toi: "lenh", nhan: "đủ cọc" },
  { tu: "chotdon", toi: "lenh", nhan: "không cần cọc", vongDuoi: true },
  { tu: "lenh", toi: "vattu" },
  { tu: "vattu", toi: "xeplich" },
  { tu: "xeplich", toi: "chay" },
  { tu: "chay", toi: "kcs" },
  { tu: "kcs", toi: "nhapkho", nhan: "hàng đạt" },
  { tu: "nhapkho", toi: "ycgiao", nhan: "kho đã nhận" },
  { tu: "ycgiao", toi: "chuyen" },
  { tu: "chuyen", toi: "xuatkho" },
  { tu: "xuatkho", toi: "giao" },
  { tu: "giao", toi: "hoadon", nhan: "khách đã nhận" },
  { tu: "hoadon", toi: "thutien" },
  { tu: "thutien", toi: "cuoi", nhan: "thu đủ" },
];

const DAU_H = 48;      // hàng tên bộ phận
const HANG_H = 66;
const NUT_H = 44;
const LE = 12;         // lề hai bên ô trong làn
const LAN_MIN = 152;   // hẹp hơn thì tên bước 2 dòng bị cắt — thà kéo ngang khung
const LAN_MAX = 210;
const THE_W = 300;

const KHOA_LOC = "qtkd:bo-phan";

function docLoc(): BoPhan | "all" {
  try {
    const v = localStorage.getItem(KHOA_LOC);
    return BO_PHAN.some((b) => b.key === v) ? (v as BoPhan) : "all";
  } catch {
    return "all";
  }
}

const theoId = new Map(BUOC.map((b) => [b.id, b]));
const lanCua = (b: Buoc) => BO_PHAN.findIndex((x) => x.key === b.boPhan);
const SO_HANG = Math.max(...BUOC.map((b) => b.hang)) + 1;

export function QuyTrinhKinhDoanhPage({
  navigate,
  moDuoc = () => true,
}: {
  navigate: (id: string) => void;
  /** Người đang xem có mở được màn này không — thiếu quyền thì nút mở bị khoá kèm lời nói rõ. */
  moDuoc?: (manId: string) => boolean;
}) {
  const laDT = useLaDienThoai();
  const [loc, setLoc] = useState<BoPhan | "all">(docLoc);
  const [chon, setChon] = useState<string | null>(null);
  const [roi, setRoi] = useState<string | null>(null);
  const [rong, setRong] = useState(0);
  const khungRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = khungRef.current;
    if (!el) return;
    const doi = () => setRong(el.clientWidth);
    doi();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(doi);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (chon == null) return;
    const dong = (e: KeyboardEvent) => { if (e.key === "Escape") setChon(null); };
    window.addEventListener("keydown", dong);
    return () => window.removeEventListener("keydown", dong);
  }, [chon]);

  const chonLoc = (v: BoPhan) => {
    const moi = loc === v ? "all" : v;
    setLoc(moi);
    try { localStorage.setItem(KHOA_LOC, moi); } catch { /* chỉ là tiện ích nhớ lựa chọn */ }
  };

  // ---- Toạ độ: tính từ làn + hàng ----
  const soLan = BO_PHAN.length;
  const lanW = Math.round(Math.min(LAN_MAX, Math.max(LAN_MIN, (rong || 1100) / soLan)));
  const W = lanW * soLan;
  const H = DAU_H + SO_HANG * HANG_H + 12;
  const nutW = lanW - 2 * LE;
  const x0 = (b: Buoc) => lanCua(b) * lanW + LE;
  const yTren = (b: Buoc) => DAU_H + b.hang * HANG_H + (HANG_H - NUT_H) / 2;
  const xGiua = (b: Buoc) => x0(b) + nutW / 2;

  const duong = NOI.map((n) => {
    const a = theoId.get(n.tu)!;
    const b = theoId.get(n.toi)!;
    const yA = yTren(a) + NUT_H / 2;
    let d: string;
    let nhanXY: [number, number];
    if (a.hang === b.hang && n.vongDuoi) {
      const yDuoi = yTren(a) + NUT_H + (HANG_H - NUT_H) / 2 - 2;
      // Vào ô đích lệch trái, chừa chính giữa đáy ô cho mũi tên đi ra của nó.
      const xVao = x0(b) + 18;
      d = `M${xGiua(a)} ${yTren(a) + NUT_H} V${yDuoi} H${xVao} V${yTren(b) + NUT_H + 2}`;
      nhanXY = [(xGiua(a) + xVao) / 2, yDuoi];
    } else if (a.hang === b.hang) {
      const phai = lanCua(b) > lanCua(a);
      const x1 = phai ? x0(a) + nutW : x0(a);
      const x2 = phai ? x0(b) - 2 : x0(b) + nutW + 2;
      d = `M${x1} ${yA} H${x2}`;
      // Khe giữa hai ô liền làn chỉ ~28px — chữ đặt lên khe TRÊN hàng, khỏi đè lên ô.
      nhanXY = [(x1 + x2) / 2, yTren(a) - 10];
    } else if (lanCua(a) === lanCua(b)) {
      const y1 = yTren(a) + NUT_H;
      const y2 = yTren(b) - 2;
      d = `M${xGiua(a)} ${y1} V${y2}`;
      nhanXY = [xGiua(a), (y1 + y2) / 2];
    } else {
      const y1 = yTren(a) + NUT_H;
      const y2 = yTren(b) - 2;
      const ym = Math.round((y1 + y2) / 2);
      d = `M${xGiua(a)} ${y1} V${ym} H${xGiua(b)} V${y2}`;
      nhanXY = [(xGiua(a) + xGiua(b)) / 2, ym];
    }
    return { ...n, d, nhanXY };
  });

  const nutChon = chon ? theoId.get(chon) ?? null : null;
  const sang = roi ?? chon;
  const mo = (bp: BoPhan) => loc !== "all" && bp !== loc;

  // Thẻ chi tiết: dưới ô được chọn, ép vào trong khung; sát đáy thì lật lên trên ô.
  const theTrai = nutChon ? Math.max(6, Math.min(W - THE_W - 6, xGiua(nutChon) - THE_W / 2)) : 0;
  const latLen = nutChon ? yTren(nutChon) + NUT_H + 210 > H : false;

  // ĐIỆN THOẠI (14/10/2026): sơ đồ 7 làn không vừa 375px ⇒ dòng thời gian dọc, mỗi bước một thẻ có
  // sẵn mô tả + nút mở màn (không phải chạm ô mới thấy). Cùng dữ liệu `BUOC`, cùng bộ lọc bộ phận.
  if (laDT) {
    return (
      <main className="qtkd qtkd--dt">
        <div className="qtkd-dt__loc" role="group" aria-label="Lọc theo bộ phận">
          <button type="button" className={loc === "all" ? "is-on" : ""}
            onClick={() => loc !== "all" && chonLoc(loc)}>
            Tất cả
          </button>
          {BO_PHAN.map((b) => (
            <button key={b.key} type="button" className={`is-${b.key}${loc === b.key ? " is-on" : ""}`}
              onClick={() => chonLoc(b.key)}>
              <span className="qtkd__cham" aria-hidden="true" />
              {b.nhan}
            </button>
          ))}
        </div>
        <ol className="qtkd-dt">
          {BUOC.filter((b) => b.loai || loc === "all" || b.boPhan === loc).map((b) =>
            b.loai ? (
              <li key={b.id} className={`qtkd-dt__moc${b.loai === "cuoi" ? " is-cuoi" : ""}`}>{b.ten}</li>
            ) : (
              <li key={b.id} className={`qtkd-dt__buoc is-${b.boPhan}`}>
                <span className="qtkd-dt__so">{b.stt}</span>
                <div className="qtkd-dt__than">
                  <span className="qtkd-dt__bp">
                    <span className="qtkd__cham" aria-hidden="true" />
                    {BO_PHAN.find((x) => x.key === b.boPhan)!.nhan}
                  </span>
                  <strong className="qtkd-dt__ten">{b.ten}</strong>
                  {b.moTa && <p className="qtkd-dt__mota">{b.moTa}</p>}
                  {b.man && (moDuoc(b.man) ? (
                    <button type="button" className="qtkd-dt__mo" onClick={() => navigate(b.man!)}>
                      Mở {b.tenMan}
                      <Icon name="arrowRight" size={14} />
                    </button>
                  ) : (
                    <span className="qtkd-dt__mo is-khoa">
                      <Icon name="lock" size={13} />
                      {b.tenMan}: chưa có quyền
                    </span>
                  ))}
                </div>
              </li>
            ),
          )}
        </ol>
      </main>
    );
  }

  return (
    <main className="qtkd">
      <header className="qtkd__head">
        <h1 className="qtkd__title">Quy trình kinh doanh</h1>
      </header>

      <div className="qtkd__khung" ref={khungRef}>
        <div className="qtkd__sodo" style={{ width: W, height: H }}
          onMouseDown={(e) => {
            if (!(e.target as HTMLElement).closest(".qtkd__nut, .qtkd__the")) setChon(null);
          }}>
          <svg className="qtkd__nen" width={W} height={H} aria-hidden="true">
            <defs>
              <marker id="qtkd-mui" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M1 1 L9 5 L1 9 Z" className="qtkd__mui" />
              </marker>
              <marker id="qtkd-mui-dam" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M1 1 L9 5 L1 9 Z" className="qtkd__mui is-dam" />
              </marker>
            </defs>

            {BO_PHAN.map((b, li) => (
              <rect key={b.key} x={li * lanW} y={0} width={lanW} height={H}
                className={`qtkd__lan${li % 2 ? " is-le" : ""}${loc === b.key ? ` is-sang is-${b.key}` : ""}`} />
            ))}
            {BO_PHAN.slice(1).map((b, i) => (
              <line key={b.key} className="qtkd__lan-ke" x1={(i + 1) * lanW} y1={0} x2={(i + 1) * lanW} y2={H} />
            ))}
            <line className="qtkd__lan-ke" x1={0} y1={DAU_H} x2={W} y2={DAU_H} />

            {duong.map((d) => {
              const dam = sang != null && (d.tu === sang || d.toi === sang);
              const nhat = loc !== "all" && ![d.tu, d.toi].some((id) => theoId.get(id)!.boPhan === loc);
              return (
                <path key={`${d.tu}-${d.toi}`} d={d.d} fill="none"
                  className={`qtkd__noi${dam ? " is-dam" : ""}${nhat ? " is-nhat" : ""}`}
                  markerEnd={dam ? "url(#qtkd-mui-dam)" : "url(#qtkd-mui)"} />
              );
            })}
          </svg>

          {/* Điều kiện trên mũi tên — chữ HTML để không bị co theo khung vẽ. */}
          {duong.filter((d) => d.nhan).map((d) => (
            <span key={`n-${d.tu}-${d.toi}`}
              className={`qtkd__nhan-noi${loc !== "all" && ![d.tu, d.toi].some((id) => theoId.get(id)!.boPhan === loc) ? " is-nhat" : ""}`}
              style={{ left: d.nhanXY[0], top: d.nhanXY[1] }}>
              {d.nhan}
            </span>
          ))}

          {BO_PHAN.map((b, li) => (
            <button key={b.key} type="button" aria-pressed={loc === b.key}
              className={`qtkd__lan-ten is-${b.key}${loc === b.key ? " is-on" : ""}`}
              style={{ left: li * lanW + 6, width: lanW - 12, top: 7, height: DAU_H - 14 }}
              title={loc === b.key ? "Bấm lần nữa để xem lại mọi bộ phận" : `Chỉ xem việc của ${b.nhan}`}
              onClick={() => chonLoc(b.key)}>
              <span className="qtkd__cham" aria-hidden="true" />
              {b.nhan}
            </button>
          ))}

          {BUOC.map((b) => (
            b.loai ? (
              <span key={b.id} className={`qtkd__moc${b.loai === "cuoi" ? " is-cuoi" : ""}${mo(b.boPhan) ? " is-nhat" : ""}`}
                style={{ left: x0(b) + nutW / 2, top: yTren(b) + NUT_H / 2 }}>
                {b.ten}
              </span>
            ) : (
              <button key={b.id} type="button"
                className={`qtkd__nut is-${b.boPhan}${chon === b.id ? " is-chon" : ""}${mo(b.boPhan) ? " is-nhat" : ""}`}
                style={{ left: x0(b), top: yTren(b), width: nutW, height: NUT_H }}
                aria-expanded={chon === b.id}
                aria-label={`Bước ${b.stt}: ${b.ten}`}
                onMouseEnter={() => setRoi(b.id)}
                onMouseLeave={() => setRoi(null)}
                onClick={() => setChon(chon === b.id ? null : b.id)}>
                <span className="qtkd__nut-so">{b.stt}</span>
                <span className="qtkd__nut-ten">{b.ten}</span>
              </button>
            )
          ))}

          {nutChon && (
            <div className={`qtkd__the is-${nutChon.boPhan}`} role="dialog" aria-label={`Bước ${nutChon.stt}: ${nutChon.ten}`}
              style={{
                left: theTrai, width: THE_W,
                ...(latLen ? { bottom: H - yTren(nutChon) + 8 } : { top: yTren(nutChon) + NUT_H + 8 }),
              }}>
              <div className="qtkd__the-dau">
                <span className="qtkd__the-bp">
                  <span className="qtkd__cham" aria-hidden="true" />
                  {BO_PHAN.find((x) => x.key === nutChon.boPhan)!.nhan}
                </span>
                <button type="button" className="qtkd__the-dong" aria-label="Đóng" onClick={() => setChon(null)}>
                  <Icon name="x" size={14} />
                </button>
              </div>
              <h3 className="qtkd__the-ten">{nutChon.stt}. {nutChon.ten}</h3>
              <p className="qtkd__the-mota">{nutChon.moTa}</p>
              {nutChon.man && (moDuoc(nutChon.man) ? (
                <button type="button" className="qtkd__mo" onClick={() => navigate(nutChon.man!)}>
                  Mở {nutChon.tenMan}
                  <Icon name="arrowRight" size={14} />
                </button>
              ) : (
                <span className="qtkd__mo is-khoa" title="Tài khoản của bạn chưa được cấp quyền mở màn này">
                  <Icon name="lock" size={13} />
                  {nutChon.tenMan}: chưa có quyền
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
