// Dải "TIẾP THEO: GỬI DUYỆT" đầu ngăn đơn mua (phương án B, 15/10/2026,
// docs/mockups/dieu-khoan-theo-nut-bam.html). Cọc là con số người duyệt đồng ý, nên nó nằm ngay cạnh
// nút Gửi duyệt và được gửi CÙNG lần gửi — không còn hộp "Sửa điều khoản" riêng mà người dùng phải
// tự nhớ ghé trước khi gửi.
//
// HẠN TRẢ chỉ ĐỌC (16/10/2026, docs/prd-dieu-khoan-tra-tien-theo-ncc.md): điều khoản trả thuộc nhà
// cung cấp, đơn không có điều khoản riêng — muốn đổi thì sang hồ sơ NCC. Thoả thuận riêng cho một
// đơn ghi vào Nội dung.
//
// MỘT HÀNG GỌN (user 15/10/2026: bản thẻ hai tầng "to đùng"): nợ NCC là chip nhỏ rê chuột ra số.
// Điện thoại xếp dọc, nút Gửi duyệt cuối và rộng hết hàng.
//
// Chỉ hiện ở Nháp, Bị từ chối (gửi duyệt) và Chờ duyệt (vẫn sửa được cọc — luật máy chủ cho tới khi
// duyệt). Duyệt xong cọc khoá; cột phải ngăn hiện ổ khoá.
import { useEffect, useState } from "react";
import { ApiError, api, type PurchaseRequestRow, type SupplierCredit } from "../../../../api/client";
import { useAuth } from "../../../../auth/useAuth";
import { Button } from "../../../../components/Button";
import { Icon } from "../../../../components/Icons";
import { OGoDinhDang } from "../../../../components/OGoDinhDang";
import { money } from "../../../../utils/format";
import { moTaHanTra } from "../../don-mua-chung/hanTra";
import "../../trang-thai-mua.css";

export function DaiGuiDuyet({
  row,
  credit,
  guiBusy,
  onGui,
  onDoi,
  onMoNcc,
}: {
  row: PurchaseRequestRow;
  credit?: SupplierCredit | null;
  guiBusy: boolean;
  onGui: (coc: number) => void;
  onDoi: (next: PurchaseRequestRow) => void;
  onMoNcc?: (supplierId: number) => void;
}) {
  const { token } = useAuth();
  const choDuyet = row.status === "pending_approval";
  const [coc, setCoc] = useState(String(row.deposit_expected || ""));
  useEffect(() => setCoc(String(row.deposit_expected || "")), [row.deposit_expected]);
  const [busy, setBusy] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);

  const soCoc = Math.max(0, Math.round(Number(coc) || 0));
  const tong = row.total_estimate ?? 0;
  const cocVuot = soCoc > tong;
  const cocDoi = soCoc !== (row.deposit_expected || 0);
  const han = moTaHanTra(row.supplier_credit_days, row.supplier_debt_cutoff_day);

  async function luuCoc(deposit_expected: number) {
    if (!token || busy) return false;
    setBusy(true);
    setLoi(null);
    try {
      onDoi(await api.purchaseRequests.updateContract(token, row.id, { contract_number: row.contract_number ?? null, deposit_expected }));
    } catch (err) {
      setLoi(err instanceof ApiError ? err.message : "Không lưu được.");
    } finally {
      setBusy(false);
    }
  }

  function gui() {
    if (cocVuot) {
      setLoi(`Cọc lớn hơn tổng đơn (${money(tong)}). Cọc là ứng trước một phần của chính đơn này.`);
      return;
    }
    setLoi(null);
    onGui(soCoc);
  }

  return (
    <section className="mh-tiep" aria-label={choDuyet ? "Đơn đang chờ duyệt" : "Việc tiếp theo: gửi duyệt"}>
      <span className="mh-tiep__nhan">
        {choDuyet ? "Đang chờ duyệt" : row.status === "rejected" ? "Tiếp theo: gửi duyệt lại" : "Tiếp theo: gửi duyệt"}
      </span>
      <label
        className="mh-tiep__o"
        title={choDuyet ? "Đổi được tới khi duyệt." : "Người duyệt đồng ý đúng số này, duyệt xong là khoá."}
      >
        Cọc
        <span className={`mh-dk__tien${cocVuot ? " is-loi" : ""}`}>
          <OGoDinhDang
            inputMode="numeric"
            value={soCoc > 0 ? soCoc.toLocaleString("vi-VN") : ""}
            onChange={(e) => setCoc(e.target.value.replace(/\D/g, ""))}
            placeholder="Không cọc"
            aria-label="Cọc"
            aria-invalid={cocVuot || undefined}
          />
          <span>đ</span>
        </span>
      </label>
      <span className="mh-tiep__o mh-tiep__han" title={han.phu}>
        Hạn trả
        <span className="mh-tiep__gt">{han.chinh}</span>
        {onMoNcc && row.supplier_id != null && (
          <button type="button" className="mh-lk" onClick={() => onMoNcc(row.supplier_id!)}
            title="Điều khoản trả thuộc nhà cung cấp, mọi đơn của nhà cung cấp này dùng chung.">
            Sửa ở hồ sơ nhà cung cấp
          </button>
        )}
      </span>
      {credit?.vuot_han_muc && (
        <span
          className="mh-tiep__no"
          title={`Đang nợ nhà cung cấp ${money(credit.no_hien_tai)}, vượt hạn mức ${money(credit.vuot_bao_nhieu)}. Chỉ nhắc, không chặn.`}
        >
          Vượt hạn mức nợ {money(credit.vuot_bao_nhieu)}
        </span>
      )}
      <span className="mh-gian" />
      {choDuyet ? (
        cocDoi && (
          <button type="button" className="mh-nut" disabled={busy || cocVuot}
            onClick={() => void luuCoc(soCoc)}>
            Lưu cọc
          </button>
        )
      ) : (
        <Button variant="accent" loading={guiBusy} disabled={busy} onClick={gui}>
          <Icon name="send" size={14} /> {row.status === "rejected" ? "Gửi duyệt lại" : "Gửi duyệt"}
        </Button>
      )}
      {loi && <small className="mh-tiep__loi" role="alert">{loi}</small>}
    </section>
  );
}
