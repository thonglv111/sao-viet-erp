/** Màn CÔNG NỢ PHẢI THU (đặc tả NPTh-1 … NPTh-3, A.11, A.17, A.18) — dựng trên bộ khung chung kế toán,
 *  cùng khuôn màn Công nợ phải trả.
 *
 *  Khuôn trang (phương án A, 07/10/2026): tiêu đề + dải tab có số — ô tìm, thanh lọc chung → "Còn
 *  nợ tới …" + "Xem cột" (Tuổi nợ | Trong kỳ và liên hệ, bộ sau có thêm cột Phụ trách) → lưới kiểu
 *  bảng tính, dòng Cộng đầu bảng → chân phân trang. Bấm dòng mở ngăn khách hàng; bấm số quá hạn / thu
 *  trong kỳ mở ngăn đúng chỗ đó. Mọi lọc chạy ở MÁY CHỦ. Nợ tính theo từng HOÁ ĐƠN bán.
 *
 *  ⚠️ LUẬT SỐNG CÒN: im lặng không được đồng nghĩa với hết nợ. Tải hỏng thì để TRỐNG và nói rõ,
 *  KHÔNG hiện 0 đ.
 *
 *  Thân trang là khuôn chung `ThanTrangCongNo` — màn phải trả dùng cùng; màn này chỉ khai chữ và
 *  cách đọc trường.
 *
 *  Liên thông từ Phiếu thu (`focusCustomer`, lỗi 11): lần tải ĐẦU đã mang tên khách (không tải thừa
 *  một lượt rỗng), xong thì mở ngăn đúng khách đó — khách không còn trong danh sách (đã thu đủ) vẫn mở
 *  theo mã khách.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { api, type ReceivableCustomerRow, type ReceivablesSummary, type SaleOption } from "../../../api/client";
import { useAuth } from "../../../auth/useAuth";
import { useCan } from "../../../auth/permissions";
import type { NavigateFn } from "../../../components/AppShell";
import { ChipTT, soVN } from "../../../components/LuoiDs";
import { LOC_CONG_NO_TRONG, THE_TRA_COC, dangLocCongNo, dieuKienCongNo, type TrangThaiCongNo } from "../shared/locCongNo";
import { ThanTrangCongNo, nhanTuoiDangLoc, type CauHinhThanCongNo } from "../shared/ThanTrangCongNo";
import { useTrangCongNo } from "../shared/trangCongNo";
import { ReceivablesDrawer } from "./components/ReceivablesDrawer";
import { PAGE_SIZE } from "./shared/constants";
import type { Bucket } from "./shared/types";
import "../ke-toan.css";

/** Mã màn — khoá nhớ kỳ và dấu `man` trên URL (trùng id AppShell). */
const MAN = "ke-toan-cong-no-phai-thu";

const CAU_HINH: CauHinhThanCongNo<ReceivableCustomerRow> = {
  tieuDe: "Công nợ phải thu",
  donVi: "khách hàng",
  nhanDoiTac: "Khách hàng",
  nhanKhoan: "Hoá đơn",
  rongKhoan: 72,
  nhanThemKy: "Bán trong kỳ",
  nhanDaKy: "Thu trong kỳ",
  nhanGanNhat: "Thu gần nhất",
  chuChuaGanNhat: "chưa thu lần nào",
  chuHet: "Đã thu hết",
  coPhuTrach: true,
  nhanTim: "Tìm khách hàng",
  goiYTim: "Tìm khách hàng, kể cả đã thu hết",
  chuTai: "Đang tải công nợ phải thu…",
  chuLoi: "Không tải được công nợ phải thu.",
  chuChuaCo: "Không còn khách hàng nào nợ",
  ariaPhanTrang: "Phân trang công nợ phải thu",
  id: (r) => r.customer_id,
  ten: (r) => r.customer_name,
  choNo: (r) => r.payment_term_days,
  themTrongKy: (r) => r.ban_trong_ky,
  daTraTrongKy: (r) => r.received_in_period,
  ganNhat: (r) => (r.thu_gan_nhat_ngay ? { ngay: r.thu_gan_nhat_ngay, tien: r.thu_gan_nhat_tien ?? 0 } : null),
  lienHe: (r) => ({ ten: r.lien_he_ten, sdt: r.lien_he_sdt, phuTrach: r.sale_user_name }),
  theThem: [THE_TRA_COC],
  danhDau: (r) =>
    (r.cho_tra_lai ?? 0) > 0 ? (
      <ChipTT mau="cam" vuong title="Tiền khách phải trả lại: đơn đã huỷ, hoặc đã ghi đủ hoá đơn mà vẫn dư">Chờ trả lại {soVN(r.cho_tra_lai ?? 0)}</ChipTT>
    ) : (r.tien_dang_de ?? 0) > 0 ? (
      <ChipTT mau="xam" vuong title="Tiền khách đang để ở đơn, sẽ trừ vào hoá đơn của chính đơn đó">Đang để {soVN(r.tien_dang_de ?? 0)}</ChipTT>
    ) : null,
};

type KhachMo = { id: number | null; name: string };

/** Bộ lọc của lượt tải liên thông: đúng tên khách, không nút / mốc tuổi / bộ lọc nâng cao nào. */
function laLuotLienThong(tt: TrangThaiCongNo | null, ten: string): boolean {
  return tt != null && tt.tim.trim() === ten.trim() && !dangLocCongNo({ ...tt, tim: "" });
}

export function AccountingReceivablesPage({
  navigate,
  eventTick = 0,
  focusCustomer = null,
}: {
  navigate: NavigateFn;
  eventTick?: number;
  /** Liên thông từ Phiếu thu (link "Thu hoá đơn", lỗi 11): tìm theo tên và mở ngăn của khách này. */
  focusCustomer?: KhachMo | null;
}) {
  const { token } = useAuth();
  const can = useCan();
  // Thu tiền = lập phiếu thu ⇒ hỏi quyền của MÀN PHIẾU THU, không phải màn này.
  const quyen = {
    thu: can("phieu_thu", "create"),
    // Trả lại tiền cho khách = lập phiếu chi ⇒ quyền của màn Phiếu chi.
    traLai: can("phieu_chi", "create"),
    xemPhieuThu: can("phieu_thu", "read"),
    xemKhach: can("khach_hang", "read"),
    xemDonBan: can("don_hang_ban", "read"),
  };

  const sp = useTrangCongNo<ReceivablesSummary>(
    {
      man: MAN,
      coTrang: PAGE_SIZE,
      goi: (t, p) => api.accounting.receivables(t, p),
      chuLoi: "Không tải được công nợ phải thu.",
      dau: focusCustomer ? { the: "all", tuoi: null, tim: focusCustomer.name, loc: LOC_CONG_NO_TRONG } : undefined,
    },
    token,
    eventTick,
  );
  const rows = sp.data?.items ?? [];

  // Người phụ trách + nhãn khách cho thanh lọc: cùng nguồn màn Khách hàng dùng; hai lời cần quyền
  // xem Khách hàng — không có quyền hay tải hỏng thì không có hai điều kiện đó.
  const xemKhach = quyen.xemKhach;
  const [nguoi, setNguoi] = useState<SaleOption[] | null>(null);
  const [nhanKhach, setNhanKhach] = useState<string[] | null>(null);
  useEffect(() => {
    if (!token || !xemKhach) return;
    let song = true;
    api.customers.sales(token).then((ds) => song && setNguoi(ds)).catch(() => song && setNguoi(null));
    api.customers.tagLabels(token).then((ds) => song && setNhanKhach(ds)).catch(() => song && setNhanKhach(null));
    return () => {
      song = false;
    };
  }, [token, xemKhach]);

  const aging = sp.data?.aging;
  const dieuKien = useMemo(
    () => dieuKienCongNo({ nhanHan: "Hạn thu", nhanHet: "Khách đã thu hết" }, aging ?? [], nguoi, nhanKhach),
    [aging, nguoi, nhanKhach],
  );

  const [open, setOpen] = useState<{ id: number; name: string; bucket: Bucket } | null>(null);
  const moDuoc = useMemo(() => rows.filter((r) => r.customer_id != null), [rows]);
  const viTri = open ? moDuoc.findIndex((r) => r.customer_id === open.id) : -1;
  const mo = (row: ReceivableCustomerRow, bucket: Bucket = "all") => {
    if (row.customer_id != null) setOpen({ id: row.customer_id, name: row.customer_name, bucket });
  };

  // Liên thông: chỉ mở ngăn khi số đang hiện là của ĐÚNG lượt tải theo tên khách — `ttData` là bộ lọc
  // đã sinh ra `data`, nên câu trả lời cũ về muộn sau khi ô tìm đã đổi không bị tính nhầm.
  const choMo = useRef<KhachMo | null>(focusCustomer);
  const daApDung = useRef(focusCustomer);
  useEffect(() => {
    // Liên thông tới lần nữa khi màn đang mở (khách khác): lọc lại theo khách mới.
    if (!focusCustomer || focusCustomer === daApDung.current) return;
    daApDung.current = focusCustomer;
    choMo.current = focusCustomer;
    const daDung = laLuotLienThong({ the: sp.the, tuoi: sp.tuoi, tim: sp.timTre, loc: sp.loc }, focusCustomer.name);
    sp.datTim(focusCustomer.name);
    sp.setThe("all");
    sp.setTuoi(null);
    sp.setLoc(LOC_CONG_NO_TRONG);
    // Bộ lọc đã đúng sẵn thì không có gì kéo lượt tải mới — tự nạp lại.
    if (daDung) sp.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCustomer]);
  useEffect(() => {
    const cho = choMo.current;
    if (!cho || sp.loading || !sp.data || !laLuotLienThong(sp.ttData, cho.name)) return;
    choMo.current = null;
    const hang = sp.data.items.find((r) => (cho.id != null ? r.customer_id === cho.id : r.customer_name === cho.name));
    const id = hang?.customer_id ?? cho.id;
    if (id != null) setOpen({ id, name: hang?.customer_name ?? cho.name, bucket: "all" });
  }, [sp.data, sp.loading, sp.ttData]);

  const nhanTuoi = nhanTuoiDangLoc(sp);

  return (
    <ThanTrangCongNo
      ch={CAU_HINH}
      sp={sp}
      dieuKien={dieuKien}
      dangXem={open?.id ?? null}
      onMo={mo}
      ngan={
        open && (
          <ReceivablesDrawer
            key={`${open.id}:${open.bucket}`}
            customerId={open.id}
            customerName={open.name}
            ma={sp.data?.items.find((r) => r.customer_id === open.id)?.customer_code ?? null}
            bucket={open.bucket}
            tuoi={sp.tuoi && nhanTuoi ? { khoa: sp.tuoi, nhan: nhanTuoi } : null}
            ky={sp.ky}
            eventTick={eventTick}
            quyen={quyen}
            navigate={navigate}
            len={viTri > 0 ? () => mo(moDuoc[viTri - 1]) : undefined}
            xuong={viTri >= 0 && viTri < moDuoc.length - 1 ? () => mo(moDuoc[viTri + 1]) : undefined}
            onClose={() => setOpen(null)}
            onChanged={sp.load}
          />
        )
      }
    />
  );
}
