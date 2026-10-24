import { useEffect, useState } from "react";
import { OGoDinhDang } from "../../components/OGoDinhDang";
import { ArrowRight, CheckCircle2, PackageCheck } from "lucide-react";
import { ApiError, api, type LsxDetail, type NhaGiaCong } from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Select } from "../../components/Select";
import { nhanDonVi } from "../lsxBuoc";
import { useNapTenDonVi } from "../tenDonVi";
import "./giaCong.css";

export function TronGoiDialog({
  lsx,
  open,
  onClose,
  onDone,
  onMoNhaCungCap,
}: {
  lsx: LsxDetail;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  /** Chưa có nhà gia công ⇒ nút dẫn sang danh mục Nhà cung cấp. Không truyền thì chỉ có lời dẫn. */
  onMoNhaCungCap?: () => void;
}) {
  const { token } = useAuth();
  // Hộp thoại mở được từ màn chưa nạp bảng đơn vị ⇒ hậu tố ô số in mã trần "cai".
  useNapTenDonVi();
  const [ds, setDs] = useState<NhaGiaCong[] | null>(null);
  const [ncc, setNcc] = useState<number | "">("");
  const [sl, setSl] = useState(String(lsx.so_luong_dat ?? ""));
  // Tick sẵn theo nguồn giấy của phiếu tính giá (chép vào quy cách lệnh): công ty lo giấy ⇒ xưởng
  // cấp cho nhà gia công. Khoá thiếu thì coi như công ty lo — cùng mặc định ô Nguồn giấy của lệnh.
  const congTyLoGiay = String((lsx.quy_cach_json ?? {}).nguon_giay ?? "cong_ty") === "cong_ty";
  const [capGiay, setCapGiay] = useState(congTyLoGiay);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !token) return;
    api.giaCongNgoai
      .nhaGiaCong(token)
      .then(setDs)
      .catch((e: unknown) => setErr(e instanceof ApiError ? e.message : String(e)));
  }, [open, token]);

  async function dat() {
    if (!token || ncc === "") return;
    setBusy(true);
    setErr(null);
    try {
      await api.giaCongNgoai.datTronGoi(token, lsx.id, {
        nha_cung_cap_id: ncc,
        sl_dat: Number(sl),
        xuong_cap_giay: capGiay,
      });
      onDone();
    } catch (e: unknown) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const dv = nhanDonVi(lsx.don_vi_tinh);
  return (
    <ConfirmDialog
      open={open}
      icon={<PackageCheck size={20} />}
      title={`Gia công trọn gói — ${lsx.ma}`}
      confirmLabel="Đặt gia công trọn gói"
      busy={busy}
      error={err}
      confirmDisabled={ncc === "" || !(Number(sl) > 0)}
      onConfirm={dat}
      onCancel={onClose}
    >
      <div className="gcn__form gcn__form--cot">
        {/* Một câu nói HẬU QUẢ bằng lời của người lên kế hoạch, không hộp màu: hộp xám đặt đầu hộp
            thoại trông như vùng bị khoá, và "luồng giao việc / bàn tổ" là chữ của người viết code. */}
        <p className="gcn__dan">
          Giao cả lệnh cho một nhà gia công làm trọn. Lệnh không xuống tổ, không vào Xếp lịch; hàng về
          thì nhập số nhận ở khối Gia công ngoài trên lệnh.
        </p>

        <div className="gcn__o">
          <span className="gcn__label-title">Nhà gia công</span>
          {/* Danh sách rỗng thì THAY ô chọn bằng lối đi khai, chứ không bày một ô chọn chỉ có dòng
              "— chọn —" kèm cảnh báo vàng bên dưới: bấm vào ô đó không ra gì. */}
          {ds != null && ds.length === 0 ? (
            <div className="gcn__trong">
              <span className="gcn__trong-chu">
                Chưa có nhà gia công nào. Mở danh mục Nhà cung cấp, chọn nhà cần dùng rồi tích ô
                “Nhận gia công”.
              </span>
              {onMoNhaCungCap && (
                <button type="button" className="btn btn--ghost" onClick={onMoNhaCungCap}>
                  Mở Nhà cung cấp
                  <ArrowRight size={14} />
                </button>
              )}
            </div>
          ) : (
            // Ô chọn chung có tìm GẦN ĐÚNG (gõ không dấu, một mẩu tên: "hung thinh"). `portal` vì
            // nằm trong hộp thoại — danh sách thả không bị khung hộp thoại cắt.
            <Select<number | null>
              value={ncc === "" ? null : ncc}
              onChange={(v) => setNcc(v ?? "")}
              disabled={ds == null}
              placeholder={ds == null ? "Đang tải…" : "Chọn nhà gia công"}
              ariaLabel="Nhà gia công"
              searchable
              searchPlaceholder="Gõ tên nhà gia công…"
              portal
              className="gcn__sel"
              options={(ds ?? []).map((n) => ({ value: n.id, label: n.ten }))}
            />
          )}
        </div>

        {/* Không có đơn giá (chủ chốt 27/09 + 07/10/2026): tiền trả nhà gia công kế toán gõ ở
            phiếu chi theo hoá đơn của họ. */}
        <div>
          <label className="gcn__o">
            {/* Đơn vị đã đứng cuối ô ⇒ nhãn khỏi lặp "(cái)". Số hiện có dấu chấm nghìn. */}
            <span className="gcn__label-title">Số đặt</span>
            <span className="gcn__input-wrap">
              <OGoDinhDang
                inputMode="numeric"
                value={sl === "" ? "" : Number(sl).toLocaleString("vi-VN")}
                onChange={(e) => setSl(e.target.value.replace(/\D/g, ""))}
                placeholder="Nhập số lượng"
              />
              <span className="gcn__suffix">{dv}</span>
            </span>
          </label>
        </div>
        <div className="gcn__duoi-hang">
          {lsx.so_luong_dat != null && Number(sl) !== lsx.so_luong_dat && (
            <button
              type="button"
              className="gcn__quick-btn"
              onClick={() => setSl(String(lsx.so_luong_dat))}
            >
              <CheckCircle2 size={13} />
              Bằng 100% lệnh ({lsx.so_luong_dat.toLocaleString("vi-VN")} {dv})
            </button>
          )}
        </div>

        {/* Một ô tick thì là một dòng tick — không bọc thành thẻ có viền to ngang ô nhập. */}
        <label className="gcn__tick">
          <input
            type="checkbox"
            checked={capGiay}
            onChange={(e) => setCapGiay(e.target.checked)}
          />
          <span>
            <span className="gcn__label-title">Xưởng cấp giấy</span>
            <span className="gcn__tick-goi-y">
              {capGiay
                ? congTyLoGiay
                  ? "Theo phiếu tính giá, giấy công ty lo. Đặt xong, chọn khổ và số lượng ở khối Gia công ngoài trên lệnh để kho xuất."
                  : "Đặt xong, chọn khổ và số lượng ở khối Gia công ngoài trên lệnh để kho xuất."
                : "Nhà gia công tự lo giấy — kho không xuất gì cho lần này."}
            </span>
          </span>
        </label>
      </div>
    </ConfirmDialog>
  );
}
