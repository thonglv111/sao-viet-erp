// KẾ HOẠCH VẬT TƯ — lưới "mỗi chỗ thiếu một phiếu mua" (spec
// `docs/spec-ke-hoach-vat-tu-mot-o-mot-phieu.md`, 07/10/2026). Mỗi dòng là một lệnh với một mặt
// hàng; "Theo lệnh" và "Theo mặt hàng" là hai cách nhóm cùng các dòng đó (`LuoiVatTu`).
//
// Ranh giới với tab "Vật tư" của MỘT lệnh (`LsxVatTuPanel`): bên đó chỉ nói CẦN, không biết tồn.
// Bên này mới trừ tồn + hàng đang về + phần kho đã cấp, và đầu ra đi thẳng sang Thu mua.
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type DeNghiMuaXemTruoc } from "../api/client";
import { useCan } from "../auth/permissions";
import { useAuth } from "../auth/useAuth";
import { LuoiVatTu } from "./ke-hoach-vat-tu/LuoiVatTu";
import "./ke-hoach-sx.css";

export function KeHoachVatTuPage({
  navigate,
  eventTick,
  focusLsxMa,
  onSoViec,
}: {
  navigate?: (id: string, params?: Record<string, unknown>) => void;
  /** Số việc phải lo (thiếu · chưa rõ) vừa tính — AppShell cập nhật badge thanh bên từ
   *  đây, khỏi tự gọi `/can-doi` lần nữa trong lúc màn này đang mở. */
  onSoViec?: (n: number) => void;
  /** Tăng mỗi lần có event SSE → bảng tự tính lại, không bắt người dùng F5. */
  eventTick?: number;
  /** Đèn "Vật tư" ở Kế hoạch SX bấm sang đây: mở cách nhìn theo lệnh + tìm sẵn mã lệnh đó. */
  focusLsxMa?: string | null;
}) {
  const { token } = useAuth();
  // Bit "tạo yêu cầu mua cho bộ phận" — KHÔNG lách bằng quyền `san_xuat`. Thiếu bit thì nút "Đề
  // nghị mua" tự ẩn, bảng cân đối vẫn xem được bình thường.
  // `null` = CHƯA BIẾT (chưa hỏi xong, hoặc hỏi mà hỏng). KHÔNG gộp với `false`: gộp thì đúng một
  // lỗi mạng cũng làm mọi nút "Mua" biến mất vĩnh viễn cho tới khi F5 — người dùng đọc thành
  // "phần mềm hỏng", đúng câu hỏi nhận ngày 20/08/2026.
  const [canDeNghiMua, setCanDeNghiMua] = useState<boolean | null>(null);
  // Nút mở form ở MÀN Yêu cầu mua hàng ⇒ còn cần ô Xem của màn đó: quyền `san_xuat` không mở màn
  // này nữa (28/09/2026), thiếu ô Xem thì bấm "Mua" là ăn màn chặn.
  const coManYcmh = useCan()("yeu_cau_mua_hang", "read");
  // "Đề nghị mua ngay" KHÔNG tự đẻ phiếu nữa (20/08/2026, theo yêu cầu chủ): nó mở form "Tạo yêu
  // cầu mua hàng" ở màn Yêu cầu mua hàng, ĐÃ điền sẵn nội dung · từng dòng vật tư · lệnh nguồn.
  // Ngày cần hàng để TRỐNG cho người lập gõ (18/09/2026) — lưu xong nó quay về làm "Ngày cần" của
  // đúng các lệnh đã tick.
  //
  // Đi bằng đường seed có sẵn (`purchaseSeed*`, thứ màn Kho đang dùng) chứ không dựng form mua thứ
  // hai ngay trên bảng cân đối: hai form cùng một việc thì đúng một tháng nữa chúng lệch nhau, mà
  // chỗ lệch luôn rơi vào ô ít ai bấm nhất.
  const moFormMua = useCallback(
    (nhap: DeNghiMuaXemTruoc) => {
      navigate?.("yeu-cau-mua-hang", {
        purchaseSeedLines: nhap.lines.map((d) => ({
          hang_loai: d.hang_loai,
          hang_id: d.hang_id,
          item_name: d.item_name,
          unit: d.unit,
          quantity: d.quantity,
          kho_rong: d.kho_rong,
          kho_dai: d.kho_dai,
          dinh_luong: d.dinh_luong ?? null,
        })),
        purchaseSeedPurpose: nhap.noi_dung,
        purchaseSeedHeader: {
          source_type: "san_xuat",
          loai_mua: "cho_lsx",
          needed_date: nhap.needed_date,
          related_document_type: nhap.related_document_type,
          related_document_code: nhap.related_document_code,
        },
        purchaseSeedNguon: nhap.nguon,
      });
    },
    [navigate],
  );

  useEffect(() => {
    if (!token) return;
    let alive = true;
    let hen: number | undefined;
    let lan = 0;
    const hoi = () => {
      api.departmentPurchaseRequests
        .canCreate(token)
        .then((r: { can_create: boolean }) => alive && setCanDeNghiMua(r.can_create))
        .catch((e: unknown) => {
          if (!alive) return;
          // Server TRẢ LỜI là không có quyền ⇒ chốt `false`, ẩn nút cho đúng.
          if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
            setCanDeNghiMua(false);
            return;
          }
          // Mạng rớt / 5xx ⇒ vẫn CHƯA BIẾT. Thử lại vài nhịp; nút cứ hiện, ai bấm thì lỗi thật của
          // server nói ra — thà báo lỗi còn hơn nút mất tăm không một lời nào.
          if (lan < 3) {
            lan += 1;
            hen = window.setTimeout(hoi, 1_000 * lan);
          }
        });
    };
    hoi();
    return () => {
      alive = false;
      if (hen) window.clearTimeout(hen);
    };
  }, [token]);

  return (
    <main className="khsx">
      <LuoiVatTu
        eventTick={eventTick}
        focusLsxMa={focusLsxMa}
        canDeNghiMua={coManYcmh && canDeNghiMua !== false}
        onMoFormMua={navigate ? moFormMua : undefined}
        onOpenLsx={navigate ? (id) => navigate("ke-hoach-sx", { openLsxId: id }) : undefined}
        navigate={navigate}
        onSoViec={onSoViec}
      />
    </main>
  );
}
