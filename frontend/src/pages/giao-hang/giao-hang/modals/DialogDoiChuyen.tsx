// Đổi / huỷ MỘT chuyến khi tài xế CHƯA cầm hàng (đã lên kế hoạch / kho đang chuẩn bị) — 19/09/2026.
// Đổi xe KHÔNG có ở đây: chuyến trong lượt ăn số đồng hồ của xe lượt, máy chủ chặn đổi xe riêng một
// chuyến — muốn đổi xe thì huỷ chuyến rồi Bán hàng lập yêu cầu mới. Huỷ chuyến là kết cục của yêu
// cầu (một yêu cầu = một chuyến): yêu cầu thành "Chuyến đã huỷ", phần hàng nhả về "giao được".
// Giờ lấy hàng / dự kiến giao đã gỡ (mg 0400) — hẹn giờ cho kho là nút Sửa ở dòng "Yêu cầu xuất kho".
//
// 12/10/2026 chủ chọn phương án A: ngăn phải như Lên đơn, dùng lại danh sách người (thấy ai rảnh, đổi
// được cả phụ xe). Huỷ là chữ đỏ nhạt ở chân trái, bấm mới hiện hộp xác nhận có ô lý do.
import { useEffect, useState } from "react";
import type { DeliveryDriver, DeliveryDriverPick, DeliveryTrip } from "../../../../api/client";
import { api } from "../../../../api/client";
import { Button } from "../../../../components/Button";
import { ConfirmDialog } from "../../../../components/ConfirmDialog";
import { NganPhai } from "../../../ke-toan/shared/NganPhai";
import { ChonKipXe } from "../components/ChonKipXe";
import { napNguonLenDon, nguonLenDonSan, type NguonLenDon } from "../shared/nguonLenDon";
import "../../../ke-toan/ke-toan.css";

export function DialogDoiChuyen({
  trip,
  token,
  onClose,
  onXong,
}: {
  trip: DeliveryTrip;
  token: string;
  onClose: () => void;
  /** `daHuy` = chuyến vừa bị huỷ (máy chủ rút nó khỏi lượt) — màn cha đóng ngăn lượt nếu lượt mất. */
  onXong: (daHuy?: boolean) => void;
}) {
  const goc = {
    tai: String(trip.employee_id),
    phu: trip.phu_xe_employee_id ? String(trip.phu_xe_employee_id) : "",
    ghiChu: trip.ghi_chu_phan_cong ?? "",
  };
  const [nguon, setNguon] = useState<NguonLenDon | null>(() => nguonLenDonSan(token));
  const [employeeId, setEmployeeId] = useState(goc.tai);
  const [phuXeId, setPhuXeId] = useState(goc.phu);
  const [ghiChu, setGhiChu] = useState(goc.ghiChu);
  const [loi, setLoi] = useState<string | null>(null);
  const [canhBao, setCanhBao] = useState<string[]>([]);
  const [dangGui, setDangGui] = useState(false);
  const [hoiHuy, setHoiHuy] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const [loiHuy, setLoiHuy] = useState<string | null>(null);

  useEffect(() => {
    let bo = false;
    napNguonLenDon(token).then((n) => { if (!bo) setNguon(n); });
    return () => { bo = true; };
  }, [token]);

  const taiXe = nguon?.taiXe ?? [];
  // Tài xế hiện tại có thể không còn trong danh sách chọn (vai bị tắt ô Giao hàng) — vẫn phải thấy
  // hàng của họ đang được chọn, nên chèn tạm từ tên trên chuyến.
  const coNguoi = (id: string, ten: string | null | undefined): DeliveryDriverPick[] =>
    !id || taiXe.some((t) => String(t.id) === id) ? []
      : [{ id: Number(id), full_name: ten ?? "Người hiện tại", code: null, department: null, co_thao_tac: true }];
  const ds = [...coNguoi(goc.tai, trip.employee_name), ...coNguoi(goc.phu, trip.phu_xe_name), ...taiXe];

  const doiTai = employeeId !== goc.tai;
  const doiPhu = phuXeId !== goc.phu;
  const doi = doiTai || doiPhu || ghiChu !== goc.ghiChu;

  const luu = () => {
    setLoi(null);
    setDangGui(true);
    api.giaoHang
      .updatePlan(token, trip.id, {
        ...(doiTai ? { employee_id: Number(employeeId) } : {}),
        // null = gỡ phụ xe, không gửi = giữ nguyên (máy chủ phân biệt hai trường hợp).
        ...(doiPhu ? { phu_xe_employee_id: phuXeId ? Number(phuXeId) : null } : {}),
        ghi_chu_phan_cong: ghiChu.trim() || null,
      })
      .then((r) => {
        if (r.canh_bao.length) {
          setCanhBao(r.canh_bao);
          window.setTimeout(() => onXong(), 1500);
        } else onXong();
      })
      .catch((e: unknown) => setLoi(e instanceof Error ? e.message : "Không đổi được chuyến"))
      .finally(() => setDangGui(false));
  };

  const huy = () => {
    setLoiHuy(null);
    setDangGui(true);
    api.giaoHang
      .cancelPlan(token, trip.id, lyDo.trim())
      .then(() => onXong(true))
      .catch((e: unknown) => setLoiHuy(e instanceof Error ? e.message : "Không huỷ được chuyến"))
      .finally(() => setDangGui(false));
  };

  const chan = (
    <>
      <button type="button" className="gh-chu-do" onClick={() => setHoiHuy(true)}>Huỷ chuyến</button>
      <span className="rc__spacer" />
      {!employeeId && <span className="gh-nho">Còn thiếu tài xế.</span>}
      <Button variant="ghost" onClick={onClose}>Đóng</Button>
      <Button variant="accent" disabled={!doi || !employeeId || dangGui} onClick={luu}>Lưu thay đổi</Button>
    </>
  );

  return (
    <>
      <NganPhai
        duongDan="Giao hàng"
        tieuDe="Đổi chuyến"
        the={<span className="gh-the">{trip.request_code}</span>}
        tomTat={[
          { nhan: "Khách", giaTri: trip.customer_name ?? "—" },
          { nhan: "Đơn", giaTri: trip.order_code ?? "—" },
          { nhan: "Xe", giaTri: trip.xe_bien_so ?? "—" },
          { nhan: "Đề nghị kho", giaTri: trip.yeu_cau_kho_ma ?? "Chưa gửi" },
        ]}
        chan={chan}
        onDong={onClose}
        chanDong={() => doi}
        cauHoiBo="Bỏ thay đổi chưa lưu?"
      >
        <div className="gh-ld">
          <div className="gh-ld__trai">
            <ChonKipXe taiXe={ds} trangThai={nguon?.trangThai ?? new Map<number, DeliveryDriver>()}
              dangNap={nguon === null} employeeId={employeeId} phuXeId={phuXeId}
              onEmployee={setEmployeeId} onPhuXe={setPhuXeId} />
          </div>
          <div className="gh-ld__phai">
            <section className="gh-ld__nhom">
              <label className="gh-ld__tieu" htmlFor="gh-dc-ghi-chu">Ghi chú cho kíp xe</label>
              <textarea id="gh-dc-ghi-chu" className="input gh-ld__nhap" rows={3} value={ghiChu}
                placeholder="Ví dụ: gọi trước cho bảo vệ KCN" onChange={(e) => setGhiChu(e.target.value)} />
            </section>
            <p className="gh-ld__goi">
              Đổi xe thì huỷ chuyến rồi lên đơn lại, vì chuyến trong lượt tính km theo xe của lượt.
            </p>
            {canhBao.map((c) => (
              <div key={c} className="banner banner--warn" role="status" style={{ margin: 0 }}>{c}</div>
            ))}
            {loi && <div className="banner banner--error" role="alert" style={{ margin: 0 }}>{loi}</div>}
          </div>
        </div>
      </NganPhai>

      <ConfirmDialog
        open={hoiHuy}
        danger
        title={`Huỷ chuyến ${trip.request_code}?`}
        message={trip.kho_da_lap_phieu
          ? `Kho đã lập phiếu cho đề nghị xuất ${trip.yeu_cau_kho_ma ?? ""}, hàng đã soạn. Báo kho huỷ phiếu trước rồi mới huỷ chuyến được.`
          : `Yêu cầu giao kết thúc ở “Chuyến đã huỷ”, hàng nhả về phần giao được. Bán hàng thấy ngay trên đơn, muốn giao tiếp thì lập yêu cầu mới.${trip.yeu_cau_kho_ma ? ` Đề nghị xuất kho ${trip.yeu_cau_kho_ma} huỷ theo.` : ""}`}
        confirmLabel="Huỷ chuyến"
        cancelLabel={trip.kho_da_lap_phieu ? "Đóng" : "Không huỷ"}
        hideConfirm={!!trip.kho_da_lap_phieu}
        confirmDisabled={!lyDo.trim()}
        busy={dangGui}
        error={loiHuy}
        onConfirm={huy}
        onCancel={() => { setHoiHuy(false); setLoiHuy(null); }}
      >
        {!trip.kho_da_lap_phieu && (
          <label className="gh-dc__ly-do">
            Lý do huỷ
            <input className="input" value={lyDo} autoFocus onChange={(e) => setLyDo(e.target.value)} />
          </label>
        )}
      </ConfirmDialog>
    </>
  );
}
