// GHI / SỬA MỘT ĐỢT GIAO (tách từ pages/PurchaseRequestsPage.tsx).
// ⚠️ KHỐI CẤM XÉ: `tienDot` / `conLai` / `daGiaoKhac` sinh thẳng ra công nợ, và vòng đời `blob:`
// của ảnh hoá đơn (tạo → xem trước → thu hồi) phải nằm nguyên một chỗ. Dài quá trần 400 dòng là
// CỐ Ý — xé nhỏ là tách con số ra khỏi luật sinh ra nó.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  api,
  anhNho, assetUrl,
  type PurchaseDeliveryInput,
  type PurchaseDeliveryRow,
  type PurchaseRequestRow,
} from "../../../../api/client";
import { useAuth } from "../../../../auth/useAuth";
import { Button } from "../../../../components/Button";
import { ChonNgay } from "../../../../components/ChonNgay";
import { Icon } from "../../../../components/Icons";
import { KhungKho } from "../../../../components/kho-giay/KhungKho";
import { chuanKho } from "../../../../lib/khoGiay";
import { NganPhai } from "../../../ke-toan/shared/NganPhai";
import "../../../ke-toan/ke-toan.css";
import "../../../kho-ngan-a.css";
import "../../yeu-cau-mua-hang/components/yc-form-a.css";
import "../../yeu-cau-mua-hang/components/yc-ds-a.css";
import "../components/don-form-a.css";
// Đơn vị lưu bằng MÃ (`cai`), tên hiển thị ("cái") nằm ở danh mục Đơn vị — xem pages/tenDonVi.ts.
import { tenDonVi } from "../../../tenDonVi";
import { hanTraDot } from "../../don-mua-chung/hanTra";
import { ATTACHMENT_IMAGE_TYPES } from "../shared/constants";
import { daGiaoKhac, nhanKhoMua, tienTheoSoLuong, todayInputValue } from "../shared/helpers";
import type { AnhCho } from "../shared/types";

/**
 * GHI / SỬA MỘT ĐỢT GIAO — khai theo TỪNG DÒNG HÀNG (Đ4).
 *
 * Không có ô nhập tiền: thành tiền hiện ra là số CHỈ-ĐỌC, suy từ đơn giá đã chốt trên phiếu. NCC
 * tính khác đơn giá đặt thì sửa đơn giá trên phiếu rồi duyệt lại, đừng mở ô tiền ở đây.
 *
 * Trần mỗi dòng = số đặt − những gì các đợt KHÁC đã nhận. Khai vống là bơm thẳng vào công nợ một
 * món nợ chưa từng phát sinh; server chặn, đây chặn sớm và nói rõ còn bao nhiêu.
 */
const so = (n: number) => Math.round(n).toLocaleString("vi-VN");

/** Dòng giấy — có khổ nhận sửa được (hai cạnh hoặc chỉ rộng; 10/10/2026 bỏ dạng cuộn/tờ). */
const laGiay = (line: PurchaseRequestRow["lines"][number]) => line.hang_loai === "giay";
/** Hai khổ giống nhau sau khi xếp cạnh ngắn trước. Khổ chỉ-rộng KHÔNG bằng khổ hai cạnh. */
const cungKho = (a: { rong: number; dai: number }, b: { rong: number; dai: number }) => {
  const [ar, ad] = chuanKho(a.rong, a.dai);
  const [br, bd] = chuanKho(b.rong, b.dai);
  return ar === br && ad === bd;
};

export function DeliveryDialog({
  row,
  delivery,
  onClose,
  onDone,
  onChanged,
}: {
  row: PurchaseRequestRow;
  delivery: PurchaseDeliveryRow | null;
  onClose: () => void;
  /** Lưu XONG đợt — cập nhật rồi ĐÓNG hộp. */
  onDone: (next: PurchaseRequestRow) => void;
  /** Đổi thứ gì đó mà hộp phải MỞ TIẾP (xoá một ảnh hoá đơn). Đóng hộp ở đây là người dùng mất
   *  hết những gì đang gõ dở chỉ vì bấm nhầm một cái ×. */
  onChanged: (next: PurchaseRequestRow) => void;
}) {
  const { token } = useAuth();
  const suaDot = delivery != null;

  const conLai = useCallback(
    (lineId: number) =>
      Math.max(
        0,
        row.lines.find((l) => l.id === lineId)!.quantity -
          daGiaoKhac(row, lineId, delivery?.id ?? null),
      ),
    [row, delivery],
  );

  const [ngayGiao, setNgayGiao] = useState(
    delivery?.delivery_date ?? todayInputValue(),
  );
  // Một hoá đơn = cặp ký hiệu + số (13/10/2026): số chỉ duy nhất trong một ký hiệu.
  const [kyHieu, setKyHieu] = useState(delivery?.invoice_symbol ?? "");
  const [soHoaDon, setSoHoaDon] = useState(delivery?.invoice_number ?? "");
  const [ngayHoaDon, setNgayHoaDon] = useState(delivery?.invoice_date ?? "");
  // HẠN TRẢ của đợt do MÁY CHỦ chụp lúc lưu theo điều khoản NCC (16/10/2026) — không ô nào đổi
  // được. Đây chỉ xem trước bằng đúng luật `tinh_han_dot`; sửa đợt thì hạn tính lại như vậy.
  const hanDot = hanTraDot(row.supplier_credit_days, row.supplier_debt_cutoff_day, ngayHoaDon || null, ngayGiao || null);
  const [ghiChu, setGhiChu] = useState(delivery?.note ?? "");
  // Ghi chú là ô HIẾM dùng ⇒ mặc định thu về một nút chữ. Nhưng đợt đang sửa mà ĐÃ có ghi chú thì
  // phải mở sẵn: giấu nó đi là người sửa không thấy câu cũ, và tưởng đợt này chưa ghi gì.
  const [moGhiChu, setMoGhiChu] = useState(() => (delivery?.note ?? "") !== "");
  // Chỉ tự đặt con trỏ khi NGƯỜI DÙNG bấm mở, không giật focus lúc hộp vừa hiện.
  const ghiChuMoSan = useRef(moGhiChu);
  // Ô số của TỪNG dòng đặt. Ghi đợt mới: điền sẵn phần CÒN LẠI ⇒ hàng về đủ thì chỉ bấm Lưu.
  // Không nhận món nào thì xoá trắng ô đó — dòng trống bị loại khỏi đợt.
  const [soNhan, setSoNhan] = useState<Record<number, string>>(() => {
    const out: Record<number, string> = {};
    for (const line of row.lines) {
      const cu = delivery?.lines.find(
        (dl) => dl.purchase_request_line_id === line.id,
      );
      if (suaDot) {
        out[line.id] = cu ? String(cu.quantity) : "";
      } else {
        // Đợt MỚI: không có đợt nào để bỏ qua, nên trừ hết những gì các đợt hiện có đã lấy.
        const con = line.quantity - daGiaoKhac(row, line.id, null);
        out[line.id] = con > 0 ? String(con) : "";
      }
    }
    return out;
  });
  // KHỔ THỰC NHẬN của dòng giấy (07/10/2026). Mặc định = khổ đặt (sửa đợt cũ thì khổ đã ghi);
  // NCC giao khác khổ thì sửa — hàng vào tồn theo khổ nhận vì kho so khổ bằng nhau tuyệt đối.
  const [khoNhan, setKhoNhan] = useState<Record<number, { rong: number; dai: number }>>(() => {
    const out: Record<number, { rong: number; dai: number }> = {};
    for (const line of row.lines) {
      if (!laGiay(line)) continue;
      const cu = delivery?.lines.find((dl) => dl.purchase_request_line_id === line.id);
      out[line.id] = cu && cu.kho_rong
        ? { rong: cu.kho_rong, dai: cu.kho_dai }
        : { rong: line.kho_rong, dai: line.kho_dai };
    }
    return out;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ảnh/PDF hoá đơn chụp ngay lúc ghi đợt. Phải GIỮ TRONG BỘ NHỚ rồi tải sau khi lưu: đợt chưa
  // tồn tại thì chưa có `delivery_id` để gắn file vào. Ghi đợt xong mới quay ra tìm nút đính kèm
  // là kiểu người ta quên — hoá đơn đang cầm trên tay lúc nhận hàng, không phải lúc mở lại phiếu.
  //
  // Mỗi file mang theo một `blob:` URL để hiện ẢNH THẬT ngay khi chọn: người nhận hàng phải soát
  // được con số trên tờ hoá đơn có đọc nổi không TRƯỚC khi lưu, chứ không phải sau khi tải xong.
  const [anhMoi, setAnhMoi] = useState<AnhCho[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dangKeo, setDangKeo] = useState(false);
  // URL do `createObjectURL` cấp KHÔNG tự mất khi component chết — phải thu hồi tay, nếu không mỗi
  // lần mở/đóng hộp là rò một tấm ảnh. Ref chỉ để bản dọn lúc unmount thấy được danh sách mới nhất.
  const anhMoiRef = useRef<AnhCho[]>([]);
  useEffect(() => {
    anhMoiRef.current = anhMoi;
  }, [anhMoi]);
  useEffect(
    () => () => {
      for (const a of anhMoiRef.current) if (a.url) URL.revokeObjectURL(a.url);
    },
    [],
  );
  const anhDaCo = (delivery?.id ?? null) === null
    ? []
    : row.attachments.filter(
        (a) => a.delivery_id === delivery!.id && a.kind === "hoa_don",
      );

  // CHIA SỐ NHẬN thành phần TÍNH TIỀN và phần DƯ (28/08/2026). NCC giao thêm mà giá giữ nguyên
  // là chuyện có thật ("đơn 500 cái, họ giao 1000, tiền vẫn 5tr"), nên số nhận được phép vượt số
  // đặt — nhưng phần vượt giá 0đ. Phần tính tiền luôn được lấp TRƯỚC, nên tổng nợ của đơn dừng
  // đúng ở giá trị đã duyệt dù hàng về gấp đôi.
  //
  // ⚠️ Đây là bản XEM TRƯỚC. Con số THẬT do server chia (`phan_bo_du_dot`) theo thứ tự
  // (`delivery_date`, `seq_no`) của TOÀN BỘ các đợt. Bản này lấy `daGiaoKhac` = mọi đợt KHÁC làm
  // phần đã lấp — đúng tuyệt đối khi ghi đợt MỚI (mọi đợt khác đều nằm trước), có thể lệch khi
  // sửa một đợt CŨ nằm giữa. Nó chỉ để người khai thấy ngay hậu quả của số vừa gõ.
  const chiaDong = useMemo(() => {
    const out: Record<number, { tinhTien: number; du: number }> = {};
    for (const line of row.lines) {
      const qty = Number(soNhan[line.id]) || 0;
      const daKhac = daGiaoKhac(row, line.id, delivery?.id ?? null);
      const dat = Number(line.quantity) || 0;
      const tinhTien = Math.max(
        0,
        Math.min(daKhac + qty, dat) - Math.min(daKhac, dat),
      );
      out[line.id] = { tinhTien, du: Math.max(0, qty - tinhTien) };
    }
    return out;
  }, [row, soNhan, delivery]);

  // THÀNH TIỀN của đợt = Σ phần TÍNH TIỀN × đơn giá/CK/VAT đã chốt trên phiếu.
  //
  // KHÔNG có ô nhập tiền (chủ chốt 07/08/2026, đảo lại quyết định 06/08): *"không cho sửa nữa,
  // dựa vào số lượng thực tế tính ra tiền luôn"*. Ô gõ tay đẻ ra đúng cái lệch mà chính chủ bắt
  // được — chi tiết PMH hiện một số, ngoài bảng hiện số khác cho cùng một đợt.
  const tienDot = useMemo(
    () =>
      row.lines.reduce((sum, line) => {
        const t = chiaDong[line.id]?.tinhTien ?? 0;
        return sum + (t > 0 ? tienTheoSoLuong(line, t) : 0);
      }, 0),
    [row.lines, chiaDong],
  );
  // CỌC ĐÃ CHI trừ vào đợt này (15/10/2026) — chép luật `phan_bo_tien_dot`: cọc chung bù đợt giao
  // trước trước. Đợt mới nhận phần cọc chưa bù (`coc_chua_bu`); đợt đang sửa giữ phần đã bù cộng
  // phần còn dư. Không hiện thì người ghi đợt tưởng còn phải trả đủ giá trị đợt. Cọc mới DUYỆT mà
  // chưa chi thì không trừ gì — cọc dự kiến không vào công nợ.
  const cocTru = Math.min(tienDot, (suaDot ? delivery!.coc_bu : 0) + (row.coc_chua_bu ?? 0));
  const traRieng = suaDot ? delivery!.paid_amount : 0;

  /** Nhận file vào hàng chờ. Chặn ngay tại đây thay vì để server từ chối sau khi đợt đã lưu —
   *  lúc đó đợt đã tạo rồi mà người dùng chỉ thấy một câu báo lỗi, dễ ghi lại lần nữa. */
  function themAnh(list: FileList | null) {
    if (!list?.length) return;
    const nhan: AnhCho[] = [];
    for (const file of Array.from(list)) {
      const laAnh = file.type.startsWith("image/");
      if (!(laAnh || file.type === "application/pdf")) {
        setError(`"${file.name}": chỉ nhận ảnh hoặc PDF.`);
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        setError(`"${file.name}": vượt quá 10 MB.`);
        continue;
      }
      nhan.push({ file, url: laAnh ? URL.createObjectURL(file) : "" });
    }
    if (nhan.length) setAnhMoi((cur) => [...cur, ...nhan]);
  }

  /** Bỏ một file khỏi hàng chờ — THU HỒI URL ngay tại đây, đừng đợi unmount: bỏ 10 tấm rồi mới
   *  đóng hộp là 10 tấm nằm lại trong bộ nhớ suốt phiên làm việc. */
  function boAnhCho(index: number) {
    setAnhMoi((cur) => {
      const bo = cur[index];
      if (bo?.url) URL.revokeObjectURL(bo.url);
      return cur.filter((_, j) => j !== index);
    });
  }

  async function xoaAnh(attachmentId: number) {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      onChanged(await api.purchaseRequests.deleteAttachment(token, row.id, attachmentId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không xóa được ảnh.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!token || busy) return;
    const lines = row.lines
      .map((line) => {
        const existing = delivery?.lines.find(
          (item) => item.purchase_request_line_id === line.id,
        );
        const kho = khoNhan[line.id];
        return {
          purchase_request_line_id: line.id,
          quantity: Number(soNhan[line.id]),
          note: existing?.note ?? null,
          // Giấy tờ: gửi khổ nhận; trùng khổ đặt thì máy chủ tự lưu 0 · 0 (= theo khổ đặt).
          ...(kho ? { kho_rong: kho.rong, kho_dai: kho.dai } : {}),
        };
      })
      .filter((l) => Number.isFinite(l.quantity) && l.quantity > 0);
    if (lines.length === 0) {
      setError(
        "Đợt giao phải có ít nhất một dòng hàng. Không nhận món nào thì đừng ghi đợt.",
      );
      return;
    }
    // BỎ 28/08/2026 khối chặn "nhận vượt số còn lại". Nó là bản sao ở giao diện của luật cũ bên
    // `_clean_dot_lines`; luật đó đã gỡ vì NCC giao thêm mà giá giữ nguyên là chuyện có thật.
    // Gỡ server mà quên gỡ đây thì hộp thoại vẫn từ chối, chỉ khác là bằng một câu tự bịa —
    // đúng cái bẫy đã sập một lần: ba nơi cùng canh một luật (`max` của ô nhập, khối này, và
    // service) mà chỉ sửa hai. Nay số nhận vượt KHÔNG đẻ nợ nữa, phần vượt hiện ngay dưới ô gõ.
    if (!ngayGiao) {
      setError("Đợt giao phải có ngày nhận hàng.");
      return;
    }
    if (kyHieu.trim() && !soHoaDon.trim()) {
      setError("Có ký hiệu thì phải có số hoá đơn.");
      return;
    }
    const thieuCanh = lines.find((l) => "kho_rong" in l && !l.kho_rong !== !l.kho_dai);
    if (thieuCanh) {
      setError("Khổ nhận của giấy tờ cần đủ hai cạnh.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const existingLines = new Map(
        (delivery?.lines ?? []).map((line) => [line.purchase_request_line_id, line]),
      );
      const linesChanged =
        !suaDot ||
        lines.length !== existingLines.size ||
        lines.some((line) => {
          const existing = existingLines.get(line.purchase_request_line_id);
          return (
            existing == null ||
            Math.abs(existing.quantity - line.quantity) > 1e-9 ||
            (existing.note ?? null) !== (line.note ?? null) ||
            ("kho_rong" in line && (existing.kho_rong !== line.kho_rong || existing.kho_dai !== line.kho_dai))
          );
        });
      const payload: PurchaseDeliveryInput = {
        delivery_date: ngayGiao,
        invoice_symbol: kyHieu.trim().toUpperCase() || null,
        invoice_number: soHoaDon.trim() || null,
        invoice_date: ngayHoaDon || null,
        note: ghiChu.trim() || null,
        lines: linesChanged ? lines : null,
      };
      let sau = suaDot
        ? await api.purchaseRequests.updateDelivery(
            token,
            row.id,
            delivery!.id,
            payload,
          )
        : await api.purchaseRequests.createDelivery(token, row.id, payload);

      if (anhMoi.length > 0) {
        // Đợt VỪA tạo là đợt có `seq_no` lớn nhất trong kết quả trả về — server đánh số tăng dần
        // trong phạm vi phiếu. Không dò theo id vì id do DB cấp, giao diện không đoán được.
        const dotId = suaDot
          ? delivery!.id
          : sau.deliveries.reduce(
              (max, d) => (d.seq_no > max.seq_no ? d : max),
              sau.deliveries[0],
            )?.id;
        if (dotId != null) {
          for (const { file } of anhMoi) {
            sau = await api.purchaseRequests.uploadAttachment(
              token,
              row.id,
              file,
              "hoa_don",
              dotId,
            );
          }
        }
      }
      onDone(sau);
    } catch (err) {
      // ĐỢT ĐÃ LƯU rồi mới hỏng ở khâu tải ảnh thì KHÔNG được nói "không lưu được đợt giao" —
      // người dùng sẽ ghi lại lần nữa và đẻ đợt trùng.
      setError(
        err instanceof ApiError ? err.message : "Không lưu được đợt giao.",
      );
    } finally {
      setBusy(false);
    }
  }

  // Hoá đơn chung nhiều đợt (NCC giao nhiều đợt rồi xuất một hoá đơn): lối chọn nhanh "Cùng đợt N"
  // điền lại ký hiệu + số + ngày hoá đơn của đợt đó. Mỗi hoá đơn (ký hiệu + số) một nút, lấy đợt
  // đầu tiên mang hoá đơn đó.
  const hoaDonCu = useMemo(() => {
    const out: { seq: number; ky: string; so: string; ngay: string | null }[] = [];
    for (const d of [...row.deliveries].sort((a, b) => a.seq_no - b.seq_no)) {
      if (d.id === delivery?.id || !d.invoice_number) continue;
      const ky = d.invoice_symbol ?? "";
      if (out.some((h) => h.so === d.invoice_number && h.ky === ky)) continue;
      out.push({ seq: d.seq_no, ky, so: d.invoice_number, ngay: d.invoice_date });
    }
    return out;
  }, [row.deliveries, delivery]);
  const laHoaDonCu = (h: { ky: string; so: string }) =>
    h.so === soHoaDon.trim() && h.ky === kyHieu.trim().toUpperCase();
  const datHoaDon = (ky: string, so: string, ngay: string) => {
    setKyHieu(ky);
    setSoHoaDon(so);
    setNgayHoaDon(ngay);
  };
  const soDong = row.lines.filter((l) => (Number(soNhan[l.id]) || 0) > 0).length;
  const coGiay = row.lines.some((l) => l.hang_loai === "giay");

  const chan = (
    <>
      <span className="ycf-xt">
        <b>{soDong} dòng</b> nhận đợt này
      </span>
      <span className="rc__spacer" />
      <Button variant="ghost" onClick={onClose} disabled={busy}>Huỷ</Button>
      <Button variant="accent" loading={busy} onClick={() => void submit()}>
        Lưu đợt giao
      </Button>
    </>
  );

  return (
    <NganPhai
      tang={1}
      duongDan={`Mua hàng > ${row.code} > ${suaDot ? `Sửa đợt ${delivery!.seq_no}` : "Ghi đợt giao"}`}
      tieuDe={`Đợt ${suaDot ? delivery!.seq_no : row.deliveries.length + 1}`}
      the={row.supplier_name ? <span className="kna-tag">{row.supplier_name}</span> : undefined}
      chan={chan}
      onDong={onClose}
      chanDong={() =>
        !busy &&
        (anhMoi.length > 0 ||
          soHoaDon !== (delivery?.invoice_number ?? "") ||
          kyHieu !== (delivery?.invoice_symbol ?? ""))
      }
    >
      <div className="kna">
        {error && <div className="kna-canh kna-canh--do" role="alert">{error}</div>}
        <div className="kna-luoi">
          <div className="kna-cot">
            <div className="dfa-dau">
              <h3>Hàng nhận đợt này</h3>
              <span className="dga-nut">
                <Button
                  variant="ghost"
                  onClick={() =>
                    setSoNhan(() => {
                      const out: Record<number, string> = {};
                      for (const line of row.lines) {
                        const con = conLai(line.id);
                        out[line.id] = con > 0 ? String(con) : "";
                      }
                      return out;
                    })
                  }
                >
                  Nhận đủ phần còn lại
                </Button>
              </span>
            </div>
            <section className="kna-the kna-the--cat">
              <div className="lds-bang lds-bang--nhap dfa-bang">
                <table className="lds-g kna-tren" style={{ minWidth: 558 }}>
                  <colgroup>
                    <col />
                    <col style={{ width: 104 }} />
                    <col style={{ width: 104 }} />
                    <col style={{ width: 150 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Vật tư</th>
                      <th className="n">Đặt</th>
                      <th className="n">Đã nhận</th>
                      <th className="n">Đợt này</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.lines.map((line) => {
                      const con = conLai(line.id);
                      const daNhan = daGiaoKhac(row, line.id, delivery?.id ?? null);
                      const dvt = tenDonVi(line.unit) ?? line.unit;
                      const chia = chiaDong[line.id] ?? { tinhTien: 0, du: 0 };
                      const kho = khoNhan[line.id] ?? { rong: line.kho_rong, dai: line.kho_dai };
                      const khacKho = laGiay(line) && !!kho.rong
                        && !cungKho(kho, { rong: line.kho_rong, dai: line.kho_dai });
                      const khoDat = nhanKhoMua(line);
                      const dangGo = soNhan[line.id] ?? "";
                      return (
                        <tr key={line.id}>
                          <td>
                            <div className="kna-hang__ten">{line.item_name}</div>
                            {coGiay && line.hang_loai === "giay" && (
                              <div className="ycf-phu">
                                <KhungKho
                                  ariaLabel={`Khổ nhận ${line.item_name}`}
                                  canh={khacKho}
                                  rong={kho.rong}
                                  dai={kho.dai}
                                  goiY={line.kho_rong ? [{ rong: line.kho_rong, dai: line.kho_dai, ghiChu: "Khổ đặt" }] : []}
                                  onChange={(v) => setKhoNhan((c) => ({ ...c, [line.id]: { rong: v.rong, dai: v.dai } }))}
                                />
                              </div>
                            )}
                            {khacKho && (
                              <div className="ycd-phu ycd-vang">
                                {khoDat ? `Khác khổ đặt ${khoDat.replace(/^Khổ /, "")}` : "Đơn chưa ghi khổ"}, hàng vào tồn theo khổ nhận
                              </div>
                            )}
                          </td>
                          <td className="n"><span className="kna-so">{so(line.quantity)}</span> <span className="kna-dv">{dvt}</span></td>
                          <td className="n">
                            <span className={`kna-so${daNhan > 0 ? "" : " kna-mo"}`}>{so(daNhan)}</span> <span className="kna-dv">{dvt}</span>
                          </td>
                          <td className="n">
                            {con <= 0 && !dangGo ? (
                              <button
                                type="button"
                                className="ycf-them"
                                title="Đã nhận đủ số đặt. NCC giao thêm thì gõ số, phần vượt tính 0 đ."
                                onClick={() => setSoNhan((c) => ({ ...c, [line.id]: "0" }))}
                              >
                                Đã nhận đủ
                              </button>
                            ) : (
                              <label className="ycf-gi dfa-gi">
                                {/* KHÔNG có `max`: số nhận được phép vượt số đặt, phần vượt 0 đ. */}
                                <input
                                  inputMode="decimal"
                                  aria-label={`Số nhận đợt này ${line.item_name}`}
                                  value={dangGo}
                                  onChange={(e) =>
                                    setSoNhan((cur) => ({
                                      ...cur,
                                      [line.id]: e.target.value.replace(",", ".").replace(/[^\d.]/g, ""),
                                    }))
                                  }
                                />
                                <span>{dvt}</span>
                              </label>
                            )}
                            {/* PHÉP CHIA HIỆN NGAY DƯỚI Ô GÕ: chỗ duy nhất người khai còn kịp thấy
                                phần nào tính tiền trước khi số chạy vào công nợ. */}
                            {chia.du > 0 && (
                              <div className="dfa-duoi">
                                {so(chia.tinhTien)} tính tiền, <b>{so(chia.du)} dư 0 đ</b>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
            {moGhiChu ? (
              <label className="kna-o-truong">
                <span>Ghi chú đợt</span>
                <input
                  className="kna-o"
                  autoFocus={!ghiChuMoSan.current}
                  value={ghiChu}
                  onChange={(e) => setGhiChu(e.target.value)}
                  placeholder="Ví dụ: giao tại kho 2, thiếu 3 ram bù sau."
                />
              </label>
            ) : (
              <span>
                <button type="button" className="ycf-them" onClick={() => setMoGhiChu(true)}>
                  <Icon name="plus" size={11} /> Ghi chú đợt
                </button>
              </span>
            )}
          </div>

          <div className="kna-cot">
            <section className="kna-the">
              <div className="kna-the__than kna-form">
                <label className="kna-o-truong">
                  <span>Ngày nhận hàng <em>*</em></span>
                  {/* Chặn TƯƠNG LAI; quá khứ vẫn cho — hàng về hôm qua mới ghi hôm nay là thường. */}
                  <ChonNgay
                    className="kna-o"
                    max={todayInputValue()}
                    value={ngayGiao}
                    onChange={(v) => setNgayGiao(v)}
                  />
                </label>
                <div className="kna-o-truong">
                  <span>Hoá đơn của nhà cung cấp</span>
                  {/* Ba ô có nhãn riêng (13/10/2026): ngày hoá đơn KHÁC ngày nhận hàng ở trên —
                      hạn trả tính từ ngày hoá đơn, chưa có mới lùi về ngày nhận hàng. */}
                  <div className="dgd-hd">
                    <label className="dgd-hd__o">
                      <span>Ký hiệu</span>
                      <input
                        className="kna-o"
                        maxLength={64}
                        value={kyHieu}
                        onChange={(e) => setKyHieu(e.target.value.toUpperCase())}
                        placeholder="VD 1C26TAA"
                      />
                    </label>
                    <label className="dgd-hd__o">
                      <span>Số hoá đơn</span>
                      <input
                        className="kna-o"
                        maxLength={64}
                        value={soHoaDon}
                        onChange={(e) => setSoHoaDon(e.target.value)}
                      />
                    </label>
                    <label className="dgd-hd__o">
                      <span>Ngày hoá đơn</span>
                      <ChonNgay
                        className="kna-o"
                        aria-label="Ngày hoá đơn"
                        max={todayInputValue()}
                        value={ngayHoaDon}
                        onChange={(v) => setNgayHoaDon(v)}
                      />
                    </label>
                  </div>
                  {/* Chọn nhanh CHỈ khi đơn đã có hoá đơn ở đợt trước. Chưa có đợt nào thì để trống
                      hai ô là đủ nói "chưa có hoá đơn" — một nút "Chưa có" đứng lẻ chỉ gây rối. */}
                  {hoaDonCu.length > 0 && (
                  <div className="ycf-pick dgd-pick" role="group" aria-label="Chọn nhanh hoá đơn">
                    {hoaDonCu.map((h) => (
                      <button
                        key={`${h.ky} ${h.so}`}
                        type="button"
                        className={laHoaDonCu(h) ? "on" : ""}
                        title={`Hoá đơn ${`${h.ky} ${h.so}`.trim()}`}
                        onClick={() => datHoaDon(h.ky, h.so, h.ngay ?? "")}
                      >
                        Cùng đợt {h.seq}
                      </button>
                    ))}
                      <button
                        type="button"
                        className={soHoaDon && !hoaDonCu.some(laHoaDonCu) ? "on" : ""}
                        onClick={() => {
                          if (hoaDonCu.some(laHoaDonCu)) datHoaDon("", "", "");
                        }}
                      >
                        Hoá đơn mới
                      </button>
                    <button
                      type="button"
                      className={!soHoaDon && !ngayHoaDon && !kyHieu ? "on" : ""}
                      onClick={() => datHoaDon("", "", "")}
                    >
                      Chưa có
                    </button>
                  </div>
                  )}
                </div>
                <div className="kna-o-truong">
                  <span>Ảnh hoá đơn, biên bản giao</span>
                  {/* Input thật ẩn; cái người dùng thấy là vùng bấm + thả. Kéo thả gọi lại đúng
                      `themAnh` nên luật ảnh/PDF + 10 MB chỉ ở một chỗ. */}
                  <input
                    type="file"
                    hidden
                    multiple
                    accept="image/*,application/pdf"
                    ref={fileRef}
                    onChange={(e) => {
                      themAnh(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    className={`kna-tha dgd-tha${dangKeo ? " is-drop" : ""}`}
                    disabled={busy}
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (!busy) setDangKeo(true);
                    }}
                    onDragLeave={(e) => {
                      if (e.target === e.currentTarget) setDangKeo(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDangKeo(false);
                      if (!busy) themAnh(e.dataTransfer.files);
                    }}
                  >
                    <Icon name="paperclip" size={14} /> Kéo ảnh hoặc PDF vào đây
                  </button>
                  {(anhDaCo.length > 0 || anhMoi.length > 0) && (
                    <div className="pdot__filegrid dgd-tep">
                      {anhDaCo.map((a) => (
                        <div className="pdot__file" key={a.id}>
                          <a href={assetUrl(a.file_url) ?? "#"} target="_blank" rel="noreferrer" title={a.file_name}>
                            {ATTACHMENT_IMAGE_TYPES.includes(a.file_type ?? "") ? (
                              <img className="pdot__thumb" src={anhNho(a.file_url) ?? ""} alt={a.file_name} />
                            ) : (
                              <span className="pdot__thumb pdot__thumb--pdf"><Icon name="fileText" size={22} /></span>
                            )}
                          </a>
                          <button type="button" className="pdot__filex" aria-label={`Xoá ${a.file_name}`} disabled={busy} onClick={() => xoaAnh(a.id)}>
                            ×
                          </button>
                        </div>
                      ))}
                      {anhMoi.map((a, i) => (
                        <div className="pdot__file" key={`${a.file.name}-${i}`}>
                          {/* Xem trước ẢNH THẬT để soát con số trên hoá đơn TRƯỚC khi lưu. */}
                          {a.url ? (
                            <img className="pdot__thumb pdot__thumb--cho" src={a.url} alt={a.file.name} title={a.file.name} />
                          ) : (
                            <span className="pdot__thumb pdot__thumb--pdf pdot__thumb--cho" title={a.file.name}>
                              <Icon name="fileText" size={22} />
                            </span>
                          )}
                          <span className="pdot__tilebadge">Chưa lưu</span>
                          <button type="button" className="pdot__filex" aria-label={`Bỏ ${a.file.name}`} disabled={busy} onClick={() => boAnhCho(i)}>
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <small className="kna-mo">Ảnh hoặc PDF, tối đa 10 MB mỗi tệp.</small>
                </div>
              </div>
            </section>

            {/* TIỀN ĐỢT — CHỈ ĐỌC: máy tính từ phần TÍNH TIỀN × đơn giá/CK/VAT đã chốt trên đơn,
                không ai gõ tay (chủ chốt 07/08/2026). */}
            <section className="kna-the">
              <div className="kna-the__dau"><h3>Tiền đợt này</h3></div>
              <div className="kna-the__than dfa-cs">
                {row.lines.map((line) => {
                  const t = chiaDong[line.id]?.tinhTien ?? 0;
                  if (t <= 0) return null;
                  return (
                    <div key={line.id} className="dfa-cs__con" style={{ paddingLeft: 0 }}>
                      <span>{line.item_name}</span>
                      <span className="kna-so">{so(tienTheoSoLuong(line, t))}</span>
                    </div>
                  );
                })}
                <div className="dfa-cs__tong">
                  <span>Cộng đợt {suaDot ? delivery!.seq_no : row.deliveries.length + 1}</span>
                  <b className="kna-so">{so(tienDot)} đ</b>
                </div>
                {(cocTru > 0 || traRieng > 0) && (
                  <>
                    {cocTru > 0 && (
                      <div className="dfa-cs__con" style={{ paddingLeft: 0 }}>
                        <span>Trừ cọc đã chi</span>
                        <span className="kna-so">{so(-cocTru)}</span>
                      </div>
                    )}
                    {traRieng > 0 && (
                      <div className="dfa-cs__con" style={{ paddingLeft: 0 }}>
                        <span>Đã trả riêng đợt này</span>
                        <span className="kna-so">{so(-traRieng)}</span>
                      </div>
                    )}
                    <div className="dfa-cs__tong">
                      <span>Còn phải trả</span>
                      <b className="kna-so">{so(Math.max(0, tienDot - cocTru - traRieng))} đ</b>
                    </div>
                  </>
                )}
                <small className="kna-mo">Đã gồm chiết khấu và VAT của đơn. Phần nhận vượt số đặt tính 0 đ.</small>
                <div className="dgd-han">
                  <div className="dgd-han__dong">
                    <span>Hạn trả đợt này</span>
                    <span className="kna-so">{hanDot.ngay ?? <span className="kna-mo">Chưa có</span>}</span>
                  </div>
                  <small className="kna-mo">{hanDot.giai} Theo điều khoản của nhà cung cấp.</small>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </NganPhai>
  );
}
