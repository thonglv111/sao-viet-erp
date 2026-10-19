// Ngăn chi tiết một dòng của tab "Đơn giao hàng" (06/10/2026, mockup
// docs/mockups/giao-hang-phuong-an-B-chi-tiet.html) — vỏ `NganPhai` chung của hệ thống, 1180px.
//
//   Lộ trình — Rời kho → thẻ từng khách (nơi giao, người nhận, hẹn, lưu ý, hàng, kết quả) → Về kho.
//              Bước CẢ LƯỢT (xuất phát, về kho) ở đầu ngăn; việc của RIÊNG một
//              điểm (nhập kết quả, trả hàng, đổi/huỷ) ở thẻ điểm đó.
//   Chứng từ — MỖI ĐƠN một bộ giấy tờ (chủ chốt "cách 1"): cột trái các đơn của lượt, bên phải chỉ
//              giấy tờ và tệp của đơn đang chọn (bảng hàng Yêu cầu / Đã giao / Còn nằm ở thẻ điểm
//              bên Lộ trình — nói một lần). Một chuyến = một đơn trong lượt, nên phiếu kho và tệp
//              đã gắn đúng đơn sẵn — không gom chung cả lượt.
//   Lịch sử  — các mốc trạng thái của mọi điểm, mới nhất trước.
//
// Đơn NHÀ GIA CÔNG GIAO THẲNG không xe, không kíp, không km: cột thuộc tính nói nhà gia công, lệnh
// nguồn, ngày khách nhận, người ghi nhận.
// Phương án A (docs/mockups/giao-hang-lam-lai-3-phuong-an.html, 07/10/2026): tóm tắt là dải chữ
// thường không đóng hộp, tab không mang số đếm, không nói lặp trạng thái / số lượng / mã.
// Ngăn MỘT đơn (chuyến lẻ, giao thẳng) theo phương án A của docs/mockups/giao-hang-chi-tiet-3-phuong-an.html
// (07/10/2026): bỏ thẻ viền, thân là các nhóm nhãn trái giá trị phải (`ChiTietDon`), nút của chuyến
// lên đầu ngăn. Lượt nhiều điểm vẫn giữ thẻ từng điểm trên lộ trình.
// Ngăn MỘT đơn theo kiểu 3 của ngăn Phiếu thu (08/10/2026): mã yêu cầu là tiêu đề + chip trạng thái chữ
// thường; thân trái là khách + lưu ý + lưới hàng kiểu bảng tính; mọi ô ngắn (nơi giao, người nhận, xe,
// nhà gia công, kết quả…) dồn vào cột thuộc tính bên phải (`RayThuocTinh`). Tab Chứng từ dùng lưới giấy
// tờ + ô kéo-thả tệp của kế toán (`TabChungTu`) cho cả ngăn lượt.
// Lộ trình phương án C (docs/mockups/luot-xe-lo-trinh-3-phuong-an.html, 12/10/2026): thẻ từng điểm
// xếp chồng làm lượt 5 điểm dài gần 2 màn ⇒ cả lượt gói trong MỘT dải ô số (Kho → 1 → … → Kho), bấm
// ô nào thì thẻ điểm đó hiện dưới dải. Màn hẹp (tài xế dùng điện thoại): dải chỉ còn ô số, thêm
// nút ‹ › lật điểm, nút của điểm dính đáy ngăn. Tab Chứng từ theo
// docs/mockups/luot-xe-chung-tu-may-tinh-va-dien-thoai.html: giấy tờ là danh sách có ô biểu tượng theo
// loại, chip trạng thái đơn nằm ở cột đơn, điện thoại có nút Chụp ảnh.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Package, Paperclip, Truck, Undo2 } from "lucide-react";
import type {
  BangGiaoItem, DeliveryHistory, DeliveryRequestDetail, DeliveryRequestLine, DeliveryTrip, DinhKemChuyen,
  LuotXeChiTiet,
} from "../../../../api/client";
import { api } from "../../../../api/client";
import { Button } from "../../../../components/Button";
import { useHep } from "../../../../lib/useHep";
import { Cum, TheNho } from "../../../ke-toan/shared/Cum";
import { RayThuocTinh } from "../../../ke-toan/shared/LuoiGon";
import { NganPhai } from "../../../ke-toan/shared/NganPhai";
import { TabChungTu } from "../../../ke-toan/shared/TabChungTu";
import { NHAN_TRANG_THAI_CHUYEN } from "../shared/constants";
import {
  buocLuot,
  coKetQua,
  gioNgay,
  henKho,
  lienKetBanDo,
  monGiao,
  ngay,
  ngayIso,
  nhanChuyen,
  sdtDoc,
  soVoiHen,
  so,
  toneChuyen,
  trangThaiLuot,
  type BuocLuot,
  type FormLuot,
} from "../shared/helpers";
import { NutBuocChuyen, type ThaoTacChuyen } from "../tabs/BangKeHoach";
import { BuocGuiKho } from "../modals/BuocGuiKho";
import { ChungTuKhoNoi, type ChungTuKho } from "../../../gia-cong/ChungTuKhoNoi";
import { DrawerChiTiet } from "./DrawerChiTiet";
import { HopBatDauGiao } from "./HopBatDauGiao";
import { HopVeKho } from "./HopVeKho";
import { CHUA_CAM_HANG, ChipGh, Pill, TraHang } from "./giaoHangCells";
import "../../../ke-toan/ke-toan.css";

type Tab = "lo-trinh" | "chung-tu" | "lich-su";

/** Ô tóm tắt hai tầng: giá trị + dòng phụ nhỏ. Dải tóm tắt là một hàng chữ thường dưới tiêu đề
 *  (phương án A, 07/10/2026) — không dùng khối nền xám `tomTat` của NganPhai: ô dữ liệu không đóng hộp. */
const o2 = (chinh: ReactNode, phu?: ReactNode) => (
  <>
    {chinh}
    {phu != null && phu !== "" && <small className="gh-tom-phu">{phu}</small>}
  </>
);

export function NganLuot({
  item,
  token,
  canWrite,
  formDau = null,
  onDoi,
  onDong,
  len,
  xuong,
  onDoiChuyen,
  ...tt
}: {
  item: BangGiaoItem;
  token: string;
  canWrite: boolean;
  /** Bấm nút cần ô nhập ở dòng bảng ⇒ ngăn mở sẵn ô đó. */
  formDau?: FormLuot | null;
  /** Có thao tác làm đổi trạng thái ⇒ bảng (và ngăn) tải lại. */
  onDoi: () => void;
  onDong: () => void;
  len?: () => void;
  xuong?: () => void;
  onDoiChuyen?: (t: DeliveryTrip) => void;
} & ThaoTacChuyen) {
  const l = item.luot;
  const ds: DeliveryTrip[] = l ? l.diem : item.trip ? [item.trip] : [];
  const dau = ds[0];
  const gt = !l ? item.trip?.giao_thang ?? null : null;

  const [tab, setTab] = useState<Tab>("lo-trinh");
  const [mo, setMo] = useState<FormLuot | null>(formDau);
  const [dangGui, setDangGui] = useState(false);
  const [tin, setTin] = useState<string | null>(null);
  const [canhBao, setCanhBao] = useState<string[]>([]);
  const [loi, setLoi] = useState<string | null>(null);
  const [chiTiet, setChiTiet] = useState<Record<number, DeliveryRequestDetail>>({});
  const [chonDon, setChonDon] = useState<number | null>(dau?.id ?? null);
  const [demTep, setDemTep] = useState<Record<number, number>>({});
  const hep = useHep();
  const [moTomTat, setMoTomTat] = useState(false);
  // Nút Sửa ở dòng "Yêu cầu xuất kho" (tab Chứng từ) ⇒ mở lại bước hẹn kho cho các chuyến này.
  const [henKhoMo, setHenKhoMo] = useState<number[] | null>(null);
  // Bấm mã ở tab Chứng từ: mở đúng bản ghi của module đó, chồng lên ngăn lượt, chỉ đọc.
  const [chungTuKho, setChungTuKho] = useState<ChungTuKho | null>(null);
  const [yeuCauMo, setYeuCauMo] = useState<DeliveryRequestDetail | null>(null);
  const moYeuCau = (requestId: number) => {
    api.giaoHang.request(token, requestId).then(setYeuCauMo)
      .catch((e: unknown) => setLoi(e instanceof Error ? e.message : "Không mở được yêu cầu giao"));
  };
  // Ô đang chọn trên dải lộ trình: -1 = Rời kho, 0…n-1 = điểm, n = Về kho.
  const [chonDiem, setChonDiem] = useState<number>(() => diemMacDinh(ds, l));

  // Điểm đang chọn vừa có kết quả ⇒ tự sang điểm còn đang giao kế tiếp (hết thì sang ô Về kho) —
  // tài xế nhập xong khách này là thấy ngay khách sau.
  const ttChon = useRef<string | null>(null);
  const ttHienTai = ds[chonDiem]?.trang_thai ?? null;
  useEffect(() => {
    const truoc = ttChon.current;
    ttChon.current = ttHienTai;
    const t = dsRef.current[chonDiem];
    if (truoc !== "dang_giao" || !t || !coKetQua(t)) return;
    const ke = dsRef.current.findIndex((x, i) => i > chonDiem && x.trang_thai === "dang_giao");
    const vong = ke >= 0 ? ke : dsRef.current.findIndex((x) => x.trang_thai === "dang_giao");
    setChonDiem(vong >= 0 ? vong : l?.cho_ve_kho ? dsRef.current.length : chonDiem);
  }, [ttHienTai, chonDiem, l?.cho_ve_kho]);

  // Lịch sử nằm ở chi tiết YÊU CẦU — nạp lại mỗi khi một điểm đổi trạng thái. Bảng hàng KHÔNG chờ
  // nó nữa: bảng giao gửi kèm `t.hang` (07/10/2026), chi tiết chỉ là đường dự phòng.
  const dsRef = useRef(ds);
  dsRef.current = ds;
  const khoaCt = ds.map((t) => `${t.request_id}:${t.trang_thai}:${t.tra_hang_trang_thai ?? ""}`).join("|");
  useEffect(() => {
    let thoi = false;
    Promise.all(dsRef.current.map((t) => api.giaoHang.request(token, t.request_id)
      .then((d) => [t.request_id, d] as const)
      .catch(() => null)))
      .then((kq) => {
        if (!thoi) setChiTiet(Object.fromEntries(kq.filter((x) => x != null)));
      });
    return () => {
      thoi = true;
    };
  }, [token, khoaCt]);

  // Số tệp của từng đơn cho cột trái tab Chứng từ — đếm một lần lúc mở tab.
  const daDemTep = useRef(false);
  useEffect(() => {
    if (tab !== "chung-tu" || daDemTep.current || dsRef.current.length < 2) return;
    daDemTep.current = true;
    Promise.all(dsRef.current.map((t) => api.giaoHang.dinhKemChuyen(token, t.id)
      .then((r) => [t.id, r.items.length] as const)
      .catch(() => null)))
      .then((kq) => setDemTep((c) => ({ ...Object.fromEntries(kq.filter((x) => x != null)), ...c })));
  }, [tab, token]);

  // Dòng báo THÀNH CÔNG tự tắt; cảnh báo thì giữ tới lần bấm sau — nó cần người đọc.
  useEffect(() => {
    if (!tin) return;
    const h = window.setTimeout(() => setTin(null), 8000);
    return () => window.clearTimeout(h);
  }, [tin]);

  if (!dau) return null;

  const lam = (b: Extract<BuocLuot, { lam: unknown }>) => {
    setLoi(null);
    setTin(null);
    setCanhBao([]);
    setDangGui(true);
    b.lam(token)
      .then((r) => {
        setTin(b.bao(r));
        setCanhBao(r.canh_bao);
        setMo(null);
        onDoi();
      })
      .catch((e: unknown) => setLoi(e instanceof Error ? e.message : "Không thao tác được"))
      .finally(() => setDangGui(false));
  };
  const moO = (f: FormLuot) => {
    setTin(null);
    setCanhBao([]);
    setLoi(null);
    setTab("lo-trinh");
    setMo(f);
  };

  const buoc = l ? buocLuot(l, canWrite) : [];
  const tinh = l ? trangThaiLuot(l) : { text: nhanChuyen(dau), tone: toneChuyen(dau.trang_thai) };
  const xong = ds.filter(coKetQua).length;

  // Lịch sử gộp mọi điểm. Mỗi yêu cầu một sổ riêng — id không trùng giữa hai sổ.
  const lichSu: (DeliveryHistory & { khach: string | null })[] = ds
    .flatMap((t) => (chiTiet[t.request_id]?.lich_su ?? []).map((h) => ({ ...h, khach: t.customer_name })))
    .sort((a, b) => (a.luc < b.luc ? 1 : -1));

  const tomTat = l
    ? [
        { nhan: "Xe", giaTri: o2(l.xe_bien_so ?? "—", l.xe_ten) },
        { nhan: "Kíp", giaTri: o2(dau.employee_name ?? "—", dau.phu_xe_name ? `phụ xe ${dau.phu_xe_name}` : null) },
        {
          nhan: "Xuất phát",
          giaTri: l.so_dong_ho_xuat_phat != null
            ? o2(gioNgay(lucXuatPhat(ds, chiTiet)), `đồng hồ ${so(l.so_dong_ho_xuat_phat)}`)
            : o2("Chưa rời kho", henKho(dau) ? `kho hẹn ${henKho(dau)}`
              : dau.ngay_can_giao ? `cần giao ${ngay(dau.ngay_can_giao)}` : null),
        },
        { nhan: "Đã chạy", giaTri: o2(`${so(l.tong_km)} km`, `${xong} trên ${ds.length} điểm`) },
      ]
    : [];

  // Nút của MỘT chuyến (không lượt) đứng ở đầu ngăn như mọi ngăn khác (phương án A 07/10/2026);
  // lượt nhiều điểm thì đầu ngăn là bước CẢ LƯỢT, nút riêng nằm ở thẻ từng điểm.
  const nutChuyen = !l ? (
    <>
      <NutBuocChuyen t={dau} tt={tt} />
      {CHUA_CAM_HANG.includes(dau.trang_thai) && onDoiChuyen && (
        <Button variant="ghost" onClick={() => onDoiChuyen(dau)}>Đổi / huỷ chuyến</Button>
      )}
    </>
  ) : undefined;
  const hanhDong = l && mo === null && buoc.length > 0
    ? buoc.map((b, i) => (
        <Button key={b.nhan} variant={i === 0 ? "accent" : "ghost"} disabled={dangGui}
          onClick={() => ("form" in b ? moO(b.form) : lam(b))}>
          {b.nhan}
        </Button>
      ))
    : nutChuyen;

  const theDiem = (t: DeliveryTrip, i: number) => (
    <TheDiem key={t.id} t={t} stt={l ? i + 1 : null} ct={chiTiet[t.request_id]} giaoThang={!!gt} hep={hep}
      nut={
        <>
          {l ? (
            <>
              {t.trang_thai === "dang_giao" && tt.onKetQua && (
                <Button variant="accent" onClick={() => tt.onKetQua!(t)}>Nhập kết quả</Button>
              )}
              <TraHang t={t} onDaTra={tt.onDaTra ? () => tt.onDaTra!(t) : undefined} />
            </>
          ) : (
            <NutBuocChuyen t={t} tt={tt} />
          )}
          {CHUA_CAM_HANG.includes(t.trang_thai) && onDoiChuyen && (
            <Button variant="ghost" onClick={() => onDoiChuyen(t)}>Đổi / huỷ chuyến</Button>
          )}
        </>
      } />
  );

  const tc = ds.find((t) => t.id === chonDon) ?? dau;

  return (
    <>
    <NganPhai
      duongDan={l ? "Lượt xe" : gt ? "Nhà gia công giao thẳng" : "Chuyến giao"}
      tieuDe={l ? l.code : <span className="kt-ngan__soLon">{dau.request_code}</span>}
      the={l ? <Pill text={tinh.text} tone={tinh.tone} /> : <ChipGh text={tinh.text} tone={tinh.tone} />}
      hanhDong={hanhDong}
      phuDe={l ? (
        <>
        {/* Điện thoại: bốn ô chiếm gần nửa màn ⇒ gom thành MỘT dòng (biển số, số điểm đã xong), bấm mới
            mở đủ bốn ô (12/10/2026). */}
        {hep && (
          <button type="button" className="gh-kv-gon" aria-expanded={moTomTat}
            onClick={() => setMoTomTat((v) => !v)}>
            <span>{l.xe_bien_so ?? "—"}</span>
            <span className="gh-nho">{dau.employee_name ?? "—"}</span>
            <span className="gh-kv-gon__phai">{xong} trên {ds.length} điểm</span>
            <ChevronDown size={16} aria-hidden="true" className="gh-kv-gon__mui" />
          </button>
        )}
        {(!hep || moTomTat) && <dl className="gh-kv">
          {tomTat.map((o) => (
            <div key={o.nhan}>
              <dt>{o.nhan}</dt>
              <dd>{o.giaTri}</dd>
            </div>
          ))}
        </dl>}
        </>
      ) : undefined}
      cot={l ? undefined : <RayDon t={dau} />}
      // Tab không mang số đếm (luật chung).
      tabs={[
        { id: "lo-trinh", nhan: l ? "Lộ trình" : "Chi tiết" },
        { id: "chung-tu", nhan: "Chứng từ" },
        { id: "lich-su", nhan: "Lịch sử" },
      ]}
      tab={tab}
      onTab={(id) => setTab(id as Tab)}
      len={len}
      xuong={xuong}
      onDong={onDong}
    >
      {tin && <div className="banner banner--success" role="status">{tin}</div>}
      {canhBao.map((c) => (
        <div key={c} className="banner banner--warn" role="status">{c}</div>
      ))}
      {loi && <div className="banner banner--error" role="alert">{loi}</div>}

      {tab === "lo-trinh" && (
        <>
          {l && mo === "xuat_phat" && (
            <HopBatDauGiao
              luot={l}
              gui={(n, xn) => api.giaoHang.batDauGiaoCaLuot(token, l.id, { so_dong_ho_xuat_phat: n, xac_nhan_km_lon: xn })
                .then((r) => {
                  setTin(`Lượt ${l.code} đã rời kho, đồng hồ ${so(n)} km.`);
                  setCanhBao(r.canh_bao);
                  onDoi();
                })}
              onXong={() => setMo(null)}
              onHuy={() => setMo(null)}
            />
          )}
          {l && mo === "ve_kho" && (
            <HopVeKho
              luot={l}
              diemCuoi={ds.find((t) => t.luot?.so_dong_ho != null
                && t.luot.so_dong_ho === l.so_dong_ho_gan_nhat)?.customer_name ?? null}
              gui={(n) => api.giaoHang.veKho(token, l.id, { so_dong_ho: n })
                .then((r) => {
                  setTin(`Lượt ${l.code} đã về kho${r.km_ve_kho != null ? `, chặng về kho ${so(r.km_ve_kho)} km` : ""}.`);
                  setCanhBao(r.canh_bao);
                  onDoi();
                })}
              onXong={() => setMo(null)}
              onHuy={() => setMo(null)}
            />
          )}
          {l && mo === null && buoc.length === 0 && l.so_cho_lay_hang > 0 && (
            <p className="rc__sub gh-goi-y">
              Đơn đã gửi kho. Kho ghi sổ phiếu xuất xong thì điểm đó tự sang Đã lấy hàng.
            </p>
          )}


          {l ? (
            <DaiLoTrinh luot={l} ds={ds} chon={Math.min(chonDiem, ds.length)} onChon={setChonDiem} hep={hep}
              lucRoi={lucXuatPhat(ds, chiTiet)} theDiem={theDiem} />
          ) : (
            <ChiTietDon t={dau} ct={chiTiet[dau.request_id]} />
          )}
        </>
      )}

      {tab === "chung-tu" && (
        <div className={ds.length > 1 ? "gh-ctd" : undefined}>
          {/* Lượt một đơn không có cột đơn ⇒ mã đơn, PO, yêu cầu giao nằm một dòng trên giấy tờ. */}
          {l && ds.length === 1 && (
            <div className="gh-ctd__phu gh-ctd__ma">
              {tc.order_code && <span className="gh-the">{tc.order_code}</span>}
              {tc.customer_po_no && <span className="gh-the">PO {tc.customer_po_no}</span>}
              {tc.request_code && (
                <MaChungTu ma={tc.request_code} title="Xem yêu cầu giao hàng" onMo={() => moYeuCau(tc.request_id)} />
              )}
            </div>
          )}
          {ds.length > 1 && (
            <nav className="gh-ctd__ray" aria-label="Đơn trong lượt">
              {ds.map((t, i) => (
                // Thẻ là div (bấm chọn đơn); nút tên giữ bàn phím — chip yêu cầu giao bên trong là nút riêng.
                <div key={t.id} className={`gh-ctd__don${t.id === tc.id ? " is-chon" : ""}`}
                  onClick={() => setChonDon(t.id)}>
                  <span className={`gh-so${coKetQua(t) ? " is-xong" : ""}`} aria-hidden="true">{i + 1}</span>
                  <span className="gh-ctd__ten">
                    <button type="button" className="gh-ctd__chon" aria-pressed={t.id === tc.id}
                      onClick={() => setChonDon(t.id)}>{t.customer_name}</button>
                    <span className="gh-ctd__phu">
                      {t.order_code && <span className="gh-the">{t.order_code}</span>}
                      {t.customer_po_no && <span className="gh-the">PO {t.customer_po_no}</span>}
                      {t.request_code && (
                        <span onClick={(e) => e.stopPropagation()}>
                          <MaChungTu ma={t.request_code} title="Xem yêu cầu giao hàng"
                            onMo={() => moYeuCau(t.request_id)} />
                        </span>
                      )}
                    </span>
                    <span className="gh-ctd__phu">
                      <ChipGh text={nhanChuyen(t)} tone={toneChuyen(t.trang_thai)} />
                      {demTep[t.id] != null && (
                        <span className={`gh-ctd__tep${demTep[t.id] > 0 ? " is-co" : ""}`}>
                          <Paperclip size={12} aria-hidden="true" />
                          {demTep[t.id] > 0 ? `${demTep[t.id]} tệp` : "chưa có tệp"}
                        </span>
                      )}
                    </span>
                  </span>
                </div>
              ))}
            </nav>
          )}
          <ChungTuDon key={tc.id} t={tc} giaoThang={!!gt} nhieuDon={ds.length > 1}
            token={token} hep={hep}
            onMoKho={setChungTuKho}
            // Lượt nhiều khách: mở cả lượt — Cần lúc là chung một xe tới lấy.
            onHenKho={canWrite ? () => setHenKhoMo(ds.filter((x) => x.yeu_cau_kho_ma).map((x) => x.id)) : undefined}
            onDemTep={(n) => setDemTep((c) => (c[tc.id] === n ? c : { ...c, [tc.id]: n }))} />
        </div>
      )}

      {tab === "lich-su" && (
        lichSu.length === 0 ? (
          <p className="rc__sub">Chưa có mốc nào.</p>
        ) : (
          <ul className="gh-ls">
            {lichSu.map((h) => (
              <li key={h.id}>
                <span className="gh-ls__luc">{gioNgay(h.luc)}</span>
                <span className="gh-ls__viec">
                  <span className="gh-ls__dong">
                    <b>{NHAN_TRANG_THAI_CHUYEN[h.den_trang_thai] ?? h.den_trang_thai}</b>
                    {ds.length > 1 && h.khach && <span className="gh-the">{h.khach}</span>}
                  </span>
                  <span className="gh-ls__dong gh-nho">
                    {h.nguoi_thao_tac_name && <span>{h.nguoi_thao_tac_name}</span>}
                    {h.ghi_chu && <span>{h.ghi_chu}</span>}
                    {h.ly_do && <span>Lý do: {h.ly_do}</span>}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )
      )}
    </NganPhai>
    {yeuCauMo && (
      <DrawerChiTiet key={yeuCauMo.request.id} detail={yeuCauMo} canCancel={false} tang={1}
        onClose={() => setYeuCauMo(null)} />
    )}
    {chungTuKho && (
      <ChungTuKhoNoi mo={chungTuKho} token={token} lop="gh-chung-tu-lop" onClose={() => setChungTuKho(null)} />
    )}
    {henKhoMo && (
      <BuocGuiKho tripIds={henKhoMo} token={token} tang={1}
        onXong={(daLuu) => {
          setHenKhoMo(null);
          if (daLuu) {
            setTin("Đã hẹn kho.");
            onDoi();
          }
        }} />
    )}
    </>
  );
}

/** Giờ xe rời kho = mốc "Đang giao" sớm nhất trong lịch sử các điểm. */
function lucXuatPhat(ds: DeliveryTrip[], ct: Record<number, DeliveryRequestDetail>): string | null {
  const ids = new Set(ds.map((t) => t.request_id));
  const moc = [...ids]
    .flatMap((id) => ct[id]?.lich_su ?? [])
    .filter((h) => h.den_trang_thai === "dang_giao")
    .map((h) => h.luc)
    .sort();
  return moc[0] ?? null;
}

/** Ô chọn sẵn lúc mở ngăn: điểm đang giao; chưa ai đi thì điểm đầu chưa có kết quả; xong hết mà chưa
 *  về kho thì ô Về kho; còn lại (đã về kho) điểm 1. */
function diemMacDinh(ds: DeliveryTrip[], l: LuotXeChiTiet | null | undefined): number {
  const dang = ds.findIndex((t) => t.trang_thai === "dang_giao");
  if (dang >= 0) return dang;
  const chua = ds.findIndex((t) => !coKetQua(t));
  if (chua >= 0) return chua;
  return l && !l.ve_kho_luc ? ds.length : 0;
}

/** Tên khách trên dải: bỏ loại hình công ty ở đầu — ô dải hẹp, đủ chỗ cho phần tên riêng. */
function tenNgan(ten?: string | null): string {
  return (ten ?? "—").replace(/^(công ty|cty)\s+(cổ phần|cp|tnhh(\s+(mtv|một thành viên))?)\s+/iu, "");
}

function lopMoc(t: DeliveryTrip): string {
  if (t.trang_thai === "dang_giao") return " is-dang";
  if (t.trang_thai === "that_bai") return " is-loi";
  return coKetQua(t) ? " is-xong" : "";
}

/** Giờ phút của một mốc ("09:29 12/10" ⇒ "09:29"). */
const gio = (v?: string | null) => gioNgay(v).split(" ")[0];

/** Dải lộ trình: Kho → điểm 1…n → Kho, giữa hai ô là km chặng (đoạn đã chạy tô xanh). Bấm ô nào thì
 *  thẻ của ô đó hiện dưới dải. Màn hẹp: ô chỉ còn số tròn, thêm hàng ‹ › để lật bằng ngón cái. */
function DaiLoTrinh({
  luot: l, ds, chon, onChon, hep, lucRoi, theDiem,
}: {
  luot: LuotXeChiTiet;
  ds: DeliveryTrip[];
  chon: number;
  onChon: (i: number) => void;
  hep: boolean;
  lucRoi: string | null;
  theDiem: (t: DeliveryTrip, i: number) => ReactNode;
}) {
  const n = ds.length;
  const daRoi = l.so_dong_ho_xuat_phat != null;
  const daVe = !!l.ve_kho_luc;
  const refChon = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (hep) refChon.current?.scrollIntoView?.({ inline: "center", block: "nearest" });
  }, [chon, hep]);

  const o = (i: number, nhan: string, moc: ReactNode, lop: string, ten?: ReactNode, phu?: ReactNode) => (
    <button type="button" ref={i === chon ? refChon : undefined} aria-label={nhan} aria-pressed={i === chon}
      className={`gh-c__o${i === chon ? " is-chon" : ""}`} onClick={() => onChon(i)}>
      <span className={`gh-c__moc${lop}`} aria-hidden="true">{moc}</span>
      {!hep && <span className="gh-c__ten" aria-hidden="true">{ten}</span>}
      {!hep && <span className="gh-c__phu" aria-hidden="true">{phu}</span>}
    </button>
  );
  const noi = (xong: boolean, km?: number | null) => (
    <span className="gh-c__noi" aria-hidden="true">
      <i className={xong ? "is-xong" : undefined} />
      {!hep && km != null && <span>{so(km)} km</span>}
    </span>
  );
  const nhanLat = chon < 0 ? "Rời kho" : chon >= n ? "Về kho" : `Điểm ${chon + 1} trên ${n}`;

  return (
    <div className={`gh-c${hep ? " is-hep" : ""}`}>
      <ol className="gh-c__dai" aria-label="Lộ trình">
        <li>
          {o(-1, "Mốc rời kho", daRoi ? "✓" : "", daRoi ? " is-xong" : " is-kho", "Rời kho",
            daRoi ? gio(lucRoi) : "chưa rời")}
        </li>
        {ds.map((t, i) => (
          <li key={t.id}>
            {noi(coKetQua(t), t.km)}
            {o(i, `Điểm ${i + 1} ${t.customer_name ?? ""}`.trim(), i + 1, lopMoc(t), tenNgan(t.customer_name),
              coKetQua(t) ? gio(t.thoi_gian_ket_thuc) : `hẹn ${ngay(t.ngay_can_giao).slice(0, 5)}`)}
          </li>
        ))}
        <li>
          {noi(daVe, l.km_ve_kho)}
          {o(n, "Mốc về kho", daVe ? "✓" : "", daVe ? " is-xong" : " is-kho", "Về kho",
            daVe ? gio(l.ve_kho_luc) : "chưa về")}
        </li>
      </ol>
      {hep && (
        <div className="gh-c__lat">
          <button type="button" aria-label="Ô trước" disabled={chon <= -1} onClick={() => onChon(chon - 1)}>
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <span>{nhanLat}</span>
          <button type="button" aria-label="Ô sau" disabled={chon >= n} onClick={() => onChon(chon + 1)}>
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>
      )}
      {chon >= 0 && chon < n ? theDiem(ds[chon], chon) : <TheKho luot={l} loai={chon < 0 ? "roi" : "ve"} luc={lucRoi} />}
    </div>
  );
}

/** Thẻ của ô Kho trên dải: lúc rời / về, số đồng hồ, chặng về. */
function TheKho({ luot: l, loai, luc }: { luot: LuotXeChiTiet; loai: "roi" | "ve"; luc?: string | null }) {
  const roi = loai === "roi";
  const da = roi ? l.so_dong_ho_xuat_phat != null : !!l.ve_kho_luc;
  return (
    <article className="gh-dt" aria-label={roi ? "Rời kho" : "Về kho"}>
      <div className="gh-dt__dau">
        <div className="gh-dt__ten"><b>{roi ? "Rời kho" : "Về kho"}</b></div>
      </div>
      {da ? (
        <dl className="gh-dt__luoi">
          <div><dt>{roi ? "Lúc rời" : "Lúc về"}</dt><dd>{gioNgay(roi ? luc : l.ve_kho_luc)}</dd></div>
          <div><dt>Đồng hồ</dt><dd>{so(roi ? l.so_dong_ho_xuat_phat : l.so_dong_ho_ve_kho)}</dd></div>
          {!roi && <div><dt>Chặng về</dt><dd>{so(l.km_ve_kho)} km</dd></div>}
        </dl>
      ) : (
        <p className="gh-dt__luu gh-nho gh-c__goi-y">
          {roi ? "Xe chưa rời kho. Bắt đầu giao ở đầu ngăn, kèm số đồng hồ lúc xuất phát."
            : "Mọi điểm có kết quả thì nút “Về kho” hiện ở đầu ngăn."}
        </p>
      )}
    </article>
  );
}

/** Dòng hàng của chuyến: bảng giao gửi kèm sẵn (`t.hang`, nạp gộp cả trang) nên ngăn có bảng hàng
 *  ngay lúc mở; chỉ khi thiếu (chuyến không đi từ bảng giao) mới chờ chi tiết yêu cầu nạp riêng. */
function dongHang(t: DeliveryTrip, ct?: DeliveryRequestDetail): DeliveryRequestLine[] {
  return t.hang ?? ct?.request.lines ?? [];
}

/** Bảng hàng Yêu cầu / Đã giao / Còn trong thẻ từng điểm của lượt. */
function BangHang({ dong, hep = false }: { dong: DeliveryRequestLine[]; hep?: boolean }) {
  if (dong.length === 0) return null;
  // Điện thoại: bốn cột không đủ chỗ ⇒ tên hàng một dòng, ba số Yêu cầu / Đã giao / Còn ở dòng dưới.
  if (hep) return (
    <ul className="gh-hang-dt" aria-label="Hàng giao">
      {monGiao(dong).map((x) => {
        const dv = x.dvt ?? "";
        const con = x.qty - x.da_giao;
        return (
          <li key={x.id}>
            <span>{x.ten}</span>
            <span className="gh-hang-dt__so">
              <span><small>Yêu cầu</small>{so(x.qty)} <span className="gh-nho">{dv}</span></span>
              <span><small>Đã giao</small>{so(x.da_giao)} <span className="gh-nho">{dv}</span></span>
              <span><small>Còn</small>{so(con)} <span className="gh-nho">{dv}</span></span>
            </span>
          </li>
        );
      })}
    </ul>
  );
  return (
    <table className="gh-hang">
      <thead>
        <tr>
          <th>Hàng giao</th>
          <th className="r">Yêu cầu</th>
          <th className="r">Đã giao</th>
          <th className="r">Còn</th>
        </tr>
      </thead>
      <tbody>
        {monGiao(dong).map((x) => {
          const dv = x.dvt ?? "";
          const con = x.qty - x.da_giao;
          return (
            <tr key={x.id}>
              <td title={x.thanhPhan.join(" + ") || undefined}>{x.ten}</td>
              <td className="r gh-num">{so(x.qty)} <span className="gh-nho">{dv}</span></td>
              <td className="r gh-num">{x.da_giao > 0 ? <>{so(x.da_giao)} <span className="gh-nho">{dv}</span></> : <span className="gh-mo">0</span>}</td>
              <td className="r gh-num">{con > 0 ? <>{so(con)} <span className="gh-nho">{dv}</span></> : <span className="gh-mo">0</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Ô số lượng của lưới hàng: số rồi đơn vị mờ; 0 thì gạch mờ như ô "Thu trước đó" của phiếu thu. */
function oSl(n: number, dv: string) {
  return n > 0 ? <>{so(n)} <span className="kt-mo">{dv}</span></> : <span className="kt-mo">–</span>;
}

/** Thân trái của ngăn MỘT đơn (kiểu 3, 08/10/2026): khách giao tới (chữ lớn như "Lý do nộp"), lưu ý khi
 *  giao, lưới hàng kiểu bảng tính như "Áp vào hoá đơn". Các ô ngắn nằm ở cột phải (`RayDon`). */
function ChiTietDon({ t, ct }: { t: DeliveryTrip; ct?: DeliveryRequestDetail }) {
  const dong = dongHang(t, ct);
  return (
    <>
      <div className="kt-ngan__muc">Giao cho</div>
      <div className="kt-ngan__ly gh-k3-khach">
        <span>{t.customer_name ?? "—"}</span>
        {t.order_code && <TheNho>{t.order_code}</TheNho>}
        {t.customer_po_no && <TheNho>PO {t.customer_po_no}</TheNho>}
      </div>

      {t.luu_y_giao && (
        <>
          <div className="kt-ngan__muc">Lưu ý khi giao</div>
          <p className="gh-k3-luu">{t.luu_y_giao}</p>
        </>
      )}

      {dong.length > 0 && (
        <>
          <div className="kt-ngan__muc">Hàng giao</div>
          <div className="kt-bang">
            <table className="kt-g" style={{ minWidth: 520 }}>
              <colgroup>
                <col />
                <col style={{ width: 136 }} />
                <col style={{ width: 136 }} />
                <col style={{ width: 136 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Mặt hàng</th>
                  <th className="kt-g__so">Yêu cầu</th>
                  <th className="kt-g__so">Đã giao</th>
                  <th className="kt-g__so">Còn</th>
                </tr>
              </thead>
              <tbody>
                {monGiao(dong).map((x) => {
                  const dv = x.dvt ?? "";
                  const ten = x.ten;
                  return (
                    <tr key={x.id}>
                      <td title={x.thanhPhan.length ? `${ten} (${x.thanhPhan.join(" + ")})` : ten}>{ten}</td>
                      <td className="kt-g__so">{oSl(x.qty, dv)}</td>
                      <td className="kt-g__so">{oSl(x.da_giao, dv)}</td>
                      <td className="kt-g__so">{oSl(x.qty - x.da_giao, dv)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

/** Cột thuộc tính bên phải của ngăn MỘT đơn. Ô trống tự ẩn (`RayThuocTinh` bỏ giá trị null).
 *  Giao thẳng: không xe, không tài xế, không km — thay bằng nhà gia công, lệnh nguồn, ngày khách nhận
 *  theo biên bản (kế toán ghi hoá đơn theo ngày này, khác lúc bấm chốt) và người ghi nhận. */
function RayDon({ t }: { t: DeliveryTrip }) {
  const gt = t.giao_thang ?? null;
  const ketQua = coKetQua(t) && !gt;
  const hen = gt ? soVoiHen(t.ngay_can_giao, t.thoi_gian_ket_thuc) : null;
  return (
    <RayThuocTinh o={[
      { nhan: "Nơi giao", giaTri: (
        <Cum>
          <span>{t.dia_chi || "Chưa có địa chỉ"}</span>
          {t.dia_chi && (
            <a className="kt-lk" href={lienKetBanDo(t.dia_chi)} target="_blank" rel="noreferrer">Mở bản đồ</a>
          )}
        </Cum>
      ) },
      { nhan: "Người nhận", giaTri: (
        <Cum>
          <span>{t.nguoi_nhan || "—"}</span>
          {t.sdt_nguoi_nhan && (
            <a className="kt-lk" href={`tel:${t.sdt_nguoi_nhan.replace(/\s+/g, "")}`}>{sdtDoc(t.sdt_nguoi_nhan)}</a>
          )}
        </Cum>
      ) },
      // Giao thẳng: ô Khách nhận đã nói so với hẹn — khỏi nhắc hẹn lần nữa.
      { nhan: "Hẹn giao", giaTri: gt ? null : ngay(t.ngay_can_giao) },
      { nhan: "Nhà gia công", giaTri: gt ? (
        <Cum>
          <span>{gt.nha_cung_cap_ten ?? "—"}</span>
          {gt.nha_cung_cap_sdt && (
            <a className="kt-lk" href={`tel:${gt.nha_cung_cap_sdt.replace(/\s+/g, "")}`}>{sdtDoc(gt.nha_cung_cap_sdt)}</a>
          )}
        </Cum>
      ) : null },
      { nhan: "Từ lệnh", giaTri: gt ? gt.lsx_ma ?? "—" : null },
      { nhan: "Khách nhận", giaTri: gt ? (
        <Cum>
          <span>{ngay(ngayIso(t.thoi_gian_ket_thuc))}</span>
          {hen && <TheNho>{hen.text}</TheNho>}
        </Cum>
      ) : null },
      { nhan: "Xe", giaTri: gt ? null : (
        <Cum>
          <span>{t.xe_bien_so ?? "—"}</span>
          {t.xe_ten && <TheNho>{t.xe_ten}</TheNho>}
        </Cum>
      ) },
      { nhan: "Tài xế", giaTri: gt ? null : t.employee_name ?? "—" },
      { nhan: "Phụ xe", giaTri: gt ? null : t.phu_xe_name },
      { nhan: "Kho hẹn", giaTri: gt ? null : henKho(t) },
      { nhan: "Tới nơi", giaTri: ketQua ? gioNgay(t.thoi_gian_ket_thuc) : null },
      { nhan: "Km", giaTri: gt ? null : t.km != null ? `${so(t.km)} km` : t.tong_km > 0 ? `${so(t.tong_km)} km` : null },
      { nhan: "Ký nhận", giaTri: ketQua ? t.nguoi_nhan_thuc_te : null },
      { nhan: "Lý do", giaTri: ketQua ? t.ly_do_that_bai : null },
      { nhan: "Ghi chú kết quả", giaTri: ketQua && !t.ly_do_that_bai ? t.ghi_chu_ket_qua : null },
      { nhan: "Ghi nhận", giaTri: gt ? (
        <Cum>
          <span>{t.employee_name ?? "—"}</span>
          <TheNho>{gioNgay(t.created_at ?? t.thoi_gian_ket_thuc)}</TheNho>
        </Cum>
      ) : null },
    ]} />
  );
}

function TheDiem({
  t,
  stt,
  ct,
  giaoThang,
  hep = false,
  nut,
}: {
  t: DeliveryTrip;
  stt: number | null;
  ct?: DeliveryRequestDetail;
  giaoThang: boolean;
  /** Màn hẹp: Chỉ đường / Gọi thành nút to, nút của điểm dính đáy ngăn, bảng hàng thành danh sách. */
  hep?: boolean;
  nut: ReactNode;
}) {
  const dong = dongHang(t, ct);
  const dangGiao = t.trang_thai === "dang_giao";
  return (
    <article className={`gh-dt${dangGiao ? " is-dang" : ""}`}
      aria-label={stt != null ? `Điểm ${stt} ${t.customer_name ?? ""}` : (t.customer_name ?? undefined)}>
      <div className="gh-dt__dau">
        <div className="gh-dt__ten">
          <b>{t.customer_name}</b>
          <div className="gh-dt__the">
            {t.order_code && <span className="gh-the">{t.order_code}</span>}
            {t.customer_po_no && <span className="gh-the">PO {t.customer_po_no}</span>}
            {/* Ngăn một yêu cầu: mã đã là tiêu đề ngăn — chỉ lượt nhiều điểm mới cần thẻ mã. */}
            {stt != null && t.request_code && <span className="gh-the">{t.request_code}</span>}
          </div>
        </div>
        <div className="gh-dt__nut">
          {/* Ngăn một đơn đã nói trạng thái ở đầu ngăn — thẻ chỉ nói khi lượt có nhiều điểm. */}
          {stt != null && <Pill text={nhanChuyen(t)} tone={toneChuyen(t.trang_thai)} />}
          {!hep && nut}
        </div>
      </div>
      <dl className="gh-dt__luoi">
        <div>
          <dt>Nơi giao</dt>
          <dd>
            <span>{t.dia_chi || "Chưa có địa chỉ"}</span>
            {t.dia_chi && (
              <a className={hep ? "btn btn--ghost gh-dt__nut-to" : "gh-lk gh-nho"} href={lienKetBanDo(t.dia_chi)}
                target="_blank" rel="noreferrer">
                {hep ? "Chỉ đường" : "Mở bản đồ"}
              </a>
            )}
          </dd>
        </div>
        <div>
          <dt>Người nhận</dt>
          <dd>
            <span>{t.nguoi_nhan || "—"}</span>
            {t.sdt_nguoi_nhan && (hep ? (
              <>
                <span className="gh-nho">{sdtDoc(t.sdt_nguoi_nhan)}</span>
                <a className="btn btn--ghost gh-dt__nut-to" href={`tel:${t.sdt_nguoi_nhan.replace(/\s+/g, "")}`}>
                  Gọi
                </a>
              </>
            ) : (
              <a className="gh-lk" href={`tel:${t.sdt_nguoi_nhan.replace(/\s+/g, "")}`}>{sdtDoc(t.sdt_nguoi_nhan)}</a>
            ))}
          </dd>
        </div>
        <div>
          <dt>Hẹn giao</dt>
          <dd>
            <span>{ngay(t.ngay_can_giao)}</span>
            {t.phieu_xuat && <span className="gh-nho">phiếu kho {t.phieu_xuat.ma}</span>}
          </dd>
        </div>
      </dl>
      {t.luu_y_giao && (
        <p className="gh-dt__luu"><span className="gh-nho">Lưu ý khi giao</span> {t.luu_y_giao}</p>
      )}
      {dong.length > 0 && (
        <div className="gh-dt__hang">
          <BangHang dong={dong} hep={hep} />
        </div>
      )}
      {coKetQua(t) && !giaoThang && (
        <div className="gh-dt__kq">
          <span>Tới <span className="gh-muc">{gioNgay(t.thoi_gian_ket_thuc)}</span></span>
          {t.luot?.so_dong_ho != null && <span>Đồng hồ <span className="gh-muc">{so(t.luot.so_dong_ho)}</span></span>}
          {t.km != null && <span>{t.luot ? "Chặng" : "Km"} <span className="gh-muc">{so(t.km)} km</span></span>}
          {t.nguoi_nhan_thuc_te && <span>Ký nhận <span className="gh-muc">{t.nguoi_nhan_thuc_te}</span></span>}
          {t.ly_do_that_bai && <span>Lý do <span className="gh-muc">{t.ly_do_that_bai}</span></span>}
          {!t.ly_do_that_bai && t.ghi_chu_ket_qua && <span>Ghi chú <span className="gh-muc">{t.ghi_chu_ket_qua}</span></span>}
        </div>
      )}
      {hep && <div className="gh-dt__day">{nut}</div>}
    </article>
  );
}

/** Trạng thái phiếu kho đọc theo việc của nó: phiếu xuất ghi sổ = hàng đã ra; phiếu nhập trả ghi
 *  sổ = kho đã nhận lại. */
function nhanPhieuKho(tt: string, loai: "xuat" | "tra"): { text: string; tone: "on" | "warn" } {
  if (tt === "posted") return { text: loai === "xuat" ? "Đã xuất kho" : "Kho đã nhận lại", tone: "on" };
  return { text: loai === "xuat" ? "Kho đang soạn" : "Chờ kho nhận lại", tone: "warn" };
}

/** Một dòng giấy tờ: ô biểu tượng theo loại | loại + số | trạng thái | ai, lúc nào. */
type DongGiay = { ic: "giao" | "kho" | "tra"; loai: string; so: ReactNode; tt: ReactNode; ai: ReactNode };

const IC_GIAY = { giao: Truck, kho: Package, tra: Undo2 } as const;

/** Trạng thái đề nghị kho — cùng chữ màn Kho. */
const TT_DE_NGHI: Record<string, { text: string; tone: "on" | "warn" | "off" | "xanh" | "tim" }> = {
  approved: { text: "Chờ kho lập phiếu", tone: "warn" },
  received: { text: "Kho tiếp nhận", tone: "xanh" },
  preparing: { text: "Đang chuẩn bị", tone: "tim" },
  partial: { text: "Đã cấp một phần", tone: "warn" },
  done: { text: "Hoàn tất", tone: "on" },
  rejected: { text: "Từ chối", tone: "off" },
  cancelled: { text: "Đã huỷ", tone: "off" },
};

/** Phiếu kho của dòng đề nghị: mã + lúc ghi sổ, bấm mở phiếu chỉ đọc — cùng dáng `PhieuKhoChip` bàn tổ. */
function PhieuKhoThe({ p, chu, onMo }: {
  p: NonNullable<DeliveryTrip["phieu_xuat"]>; chu: string; onMo: (c: ChungTuKho) => void;
}) {
  const id = p.id;
  return (
    <button type="button" className="gh-ma-ct" aria-haspopup="dialog" disabled={id == null}
      title={`Xem phiếu ${chu} kho${p.boi_ten ? `
Ghi sổ: ${p.boi_ten}` : ""}`}
      onClick={() => id != null && onMo({ loai: "phieu", id })}>
      <Package size={13} aria-hidden="true" />
      <span>{p.ma}</span>
      {p.luc && <small>{chu} {gioNgay(p.luc)}</small>}
    </button>
  );
}

/** Mã chứng từ bấm được — mở bản ghi của module đó (ngăn kho / ngăn yêu cầu giao), chỉ đọc. */
function MaChungTu({ ma, title, onMo }: { ma: string; title: string; onMo?: () => void }) {
  if (!onMo) return <>{ma}</>;
  return (
    <button type="button" className="gh-ma-ct" aria-haspopup="dialog" title={title} onClick={onMo}>{ma}</button>
  );
}

/** Người làm + giờ: tên trên, giờ chữ xám dưới — giờ không đóng hộp. */
const aiLuc = (ten: ReactNode, luc?: string | null) => (
  <>
    <span>{ten}</span>
    {luc && <small>{gioNgay(luc)}</small>}
  </>
);

/** Tệp của MỘT chuyến trong khuôn ô kéo-thả + lưới ảnh của kế toán. Đếm tệp báo lên cho rail đơn. */
function TepChuyen({ tripId, token, onDem, hep }: {
  tripId: number; token: string; onDem: (n: number) => void; hep: boolean;
}) {
  const [tep, setTep] = useState<DinhKemChuyen[]>([]);
  const onDemRef = useRef(onDem);
  onDemRef.current = onDem;
  const nap = useCallback(() => {
    api.giaoHang.dinhKemChuyen(token, tripId)
      .then((r) => {
        setTep(r.items);
        onDemRef.current(r.items.length);
      })
      .catch(() => setTep([]));
  }, [token, tripId]);
  useEffect(nap, [nap]);
  return (
    <TabChungTu tep={tep} daHuy={false} coQuyen onDoi={nap} chupAnh={hep}
      taiMot={(f) => api.giaoHang.themDinhKemChuyen(token, tripId, f)}
      xoaMot={(id) => api.giaoHang.xoaDinhKemChuyen(token, tripId, id)}
      chuKeo="Kéo ảnh hoá đơn hoặc biên bản khách ký vào đây"
      chuChuaCo="Chưa có tệp. Kéo ảnh hoá đơn hoặc biên bản khách ký vào đây" />
  );
}

function ChungTuDon({
  t,
  giaoThang,
  nhieuDon,
  token,
  hep,
  onDemTep,
  onHenKho,
  onMoKho,
}: {
  t: DeliveryTrip;
  giaoThang: boolean;
  /** Lượt nhiều đơn ⇒ nói trạng thái của đơn đang chọn; một đơn thì đầu ngăn đã nói. */
  nhieuDon: boolean;
  token: string;
  hep: boolean;
  onDemTep: (n: number) => void;
  /** Có quyền ⇒ dòng "Đề nghị xuất kho" có nút Sửa (hẹn lại kho) tới lúc kho lập phiếu. */
  onHenKho?: () => void;
  onMoKho: (c: ChungTuKho) => void;
}) {
  const daKy = coKetQua(t) && !!t.nguoi_nhan_thuc_te;
  const px = t.phieu_xuat ? nhanPhieuKho(t.phieu_xuat.trang_thai, "xuat") : null;
  const pt = t.phieu_tra ? nhanPhieuKho(t.phieu_tra.trang_thai, "tra") : null;
  const mo = <span className="kt-mo">–</span>;

  const hen = t.yeu_cau_kho_ma ? (
    <span className="gh-giay__hen">
      <span>{henKho(t) ? `Cần lúc ${henKho(t)}` : "Chưa hẹn giờ"}</span>
      {/* Hẹn kho (mg 0400): sửa được tới lúc kho lập phiếu. */}
      {onHenKho && !t.kho_da_lap_phieu && (
        <Button variant="ghost" className="gh-giay__sua" onClick={onHenKho}>Sửa</Button>
      )}
    </span>
  ) : null;
  const ttDn = t.yeu_cau_kho_trang_thai ? TT_DE_NGHI[t.yeu_cau_kho_trang_thai] : null;
  const ycKhoId = t.yeu_cau_kho_id;
  const traId = t.tra_hang_id;

  const giay: DongGiay[] = [];
  // Xuất kho / nhập trả: MỘT dòng mỗi chiều như "Đề nghị và phiếu kho" của bàn tổ — mã đề nghị ở cột
  // tên, phiếu kho do nó sinh ra là thẻ ở cột cuối cùng dòng; chưa có phiếu thì cột cuối là hẹn kho.
  if (giaoThang) {
    giay.push({ ic: "kho", loai: "Xuất kho", so: <span className="kt-mo">Không qua kho</span>, tt: mo,
      ai: <span className="kt-mo">Nhà gia công giao thẳng cho khách</span> });
  } else {
    giay.push({
      ic: "kho",
      loai: "Đề nghị xuất kho",
      so: t.yeu_cau_kho_ma
        ? <MaChungTu ma={t.yeu_cau_kho_ma} title="Xem đề nghị xuất kho"
            onMo={ycKhoId != null ? () => onMoKho({ loai: "de_nghi", id: ycKhoId }) : undefined} />
        : mo,
      tt: px ? <ChipGh text={px.text} tone={px.tone} />
        : t.yeu_cau_kho_ma ? <ChipGh text={ttDn?.text ?? (t.yeu_cau_kho_trang_thai ?? "—")} tone={ttDn?.tone ?? "warn"} />
          : <ChipGh text="Chưa gửi kho" tone="warn" />,
      ai: t.phieu_xuat
        ? <PhieuKhoThe p={t.phieu_xuat} chu="xuất" onMo={onMoKho} />
        : hen,
    });
  }
  // Phiếu xuất kho bán hàng = cùng số PXK, đọc theo việc GIAO: kho ghi sổ xong mới tới tay tài xế,
  // khách ký là xong. Giao thẳng không qua kho ⇒ chỉ còn việc giao (13/10/2026).
  const xuatXong = t.phieu_xuat?.trang_thai === "posted";
  giay.push({
    ic: "giao",
    loai: giaoThang ? "Giao cho khách" : "Phiếu xuất kho bán hàng",
    so: !giaoThang && xuatXong && t.phieu_xuat ? t.phieu_xuat.ma : mo,
    // Giao thẳng một đơn đã có kết quả: đầu ngăn đã nói — thôi nhắc.
    tt: daKy && t.trang_thai === "thanh_cong" ? <ChipGh text="Khách đã ký" tone="on" />
      : coKetQua(t) ? (giaoThang && !nhieuDon ? mo : <ChipGh text={nhanChuyen(t)} tone={toneChuyen(t.trang_thai)} />)
        : !giaoThang && !xuatXong ? <ChipGh text="Chờ kho xuất" tone="warn" />
          : <ChipGh text={nhanChuyen(t)} tone={toneChuyen(t.trang_thai)} />,
    ai: coKetQua(t)
      ? aiLuc(t.nguoi_nhan_thuc_te ?? <span className="kt-mo">Không ai ký nhận</span>, t.thoi_gian_ket_thuc)
      : <span className="kt-mo">Chờ khách ký</span>,
  });
  if (t.tra_hang_ma || t.phieu_tra) {
    giay.push({
      ic: "tra",
      loai: "Đề nghị nhập trả",
      so: t.tra_hang_ma
        ? <MaChungTu ma={t.tra_hang_ma} title="Xem đề nghị nhập trả"
            onMo={traId != null ? () => onMoKho({ loai: "de_nghi", id: traId }) : undefined} />
        : mo,
      tt: pt ? <ChipGh text={pt.text} tone={pt.tone} />
        : <ChipGh text={t.tra_hang_trang_thai === "done" ? "Kho đã nhận lại" : "Chờ kho nhận lại"}
            tone={t.tra_hang_trang_thai === "done" ? "on" : "warn"} />,
      ai: t.phieu_tra ? <PhieuKhoThe p={t.phieu_tra} chu="nhập" onMo={onMoKho} /> : null,
    });
  }

  return (
    <div className="gh-ctd__mat">
      {/* Khách, mã đơn, PO và trạng thái đơn đã ở cột đơn bên trái (lượt) hoặc đầu ngăn (một đơn) —
          bên này chỉ giấy tờ và tệp, mỗi thông tin nói một lần. */}
      <section>
        <div className="kt-ngan__muc">Giấy tờ của đơn</div>
        <ul className="gh-giay" aria-label="Giấy tờ của đơn">
          {giay.map((g) => {
            const Ic = IC_GIAY[g.ic];
            return (
              <li key={g.loai}>
                <span className={`gh-giay__ic gh-giay__ic--${g.ic}`} aria-hidden="true"><Ic size={18} /></span>
                <span className="gh-giay__loai">
                  <span>{g.loai}</span>
                  <span className="gh-giay__so">{g.so}</span>
                </span>
                <span className="gh-giay__tt">{g.tt}</span>
                <span className="gh-giay__ai">{g.ai ?? <span className="kt-mo">Chưa ai làm</span>}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <div className="kt-ngan__muc">Tệp đính kèm của đơn</div>
        <TepChuyen tripId={t.id} token={token} onDem={onDemTep} hep={hep} />
      </section>
    </div>
  );
}
