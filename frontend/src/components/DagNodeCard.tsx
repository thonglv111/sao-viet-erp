import React, { useMemo } from "react";
import { dvNhan, type RefRow } from "../pages/LsxRoutingTable";
import { type EditRow, n, tenBuoc } from "../pages/lsxBuoc";
import { Icon } from "./Icons";
import { ChipKhuon, ChipLoaiBuoc } from "./ChipBuoc";

export interface DagNodeCardProps {
  row: EditRow;
  index: number;
  total: number;
  position: { x: number; y: number };
  isSelected: boolean;
  isConnecting: boolean;
  /** Hiện chấm vàng "Chờ" ở mép trên: bước đang chờ bước LSX khác, hoặc đang kéo dây từ thẻ LSX
   *  khác (chỗ thả). Dây chờ lệnh khác cắm vào đây, KHÔNG vào cổng Vào bên trái — cổng đó chỉ cho
   *  vật liệu chảy trong lệnh này. */
  congCho?: boolean;
  isHoveredPort: "in" | "out" | null;
  congDoanRefs: RefRow[] | null;
  toRefs: RefRow[] | null;
  mayRefs: RefRow[] | null;
  warnings: string[];
  /** Khác null = bước in này CHẠY CHUNG tờ với bài ghép đó — thông số tờ sửa ở bài. */
  maBaiGhep?: string | null;
  canUpdate: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onNodeMouseDown: (e: React.MouseEvent, key: string) => void;
  onPortMouseDown: (e: React.MouseEvent, key: string, portType: "in" | "out") => void;
  onPortMouseUp: (e: React.MouseEvent, key: string, portType: "in" | "out") => void;
  /** `tab` chỉ dùng cho deep-link từ badge — mở drawer là nhảy thẳng tới khối đó. */
  onOpenDrawer: (index: number, tab?: "vat_tu") => void;
  onDeleteNode: (index: number) => void;
}

export function DagNodeCard({
  row,
  index,
  total: _total,
  position,
  isSelected,
  isConnecting: _isConnecting,
  congCho = false,
  isHoveredPort,
  congDoanRefs,
  toRefs,
  // (`mayRefs` vẫn là prop; thẻ thôi hiện máy và thời lượng từ 07/11/2026.)
  warnings,
  maBaiGhep,
  canUpdate,
  onMouseEnter,
  onMouseLeave,
  onNodeMouseDown,
  onPortMouseDown,
  onPortMouseUp,
  onOpenDrawer,
  onDeleteNode,
}: DagNodeCardProps) {
  // Tìm nhãn tổ & máy
  // BỘ PHẬN NHẬN (07/11/2026): bước lệnh mang bộ phận, không mang tổ và máy. Tên lấy từ danh sách
  // bộ phận chọn được của bước; bước cũ còn mang tổ thì lùi về danh sách tổ.
  const toTen = useMemo(() => {
    if (!row.department_id) return null;
    return row.bo_phan_chon?.find((b) => b.id === row.department_id)?.ten
      ?? toRefs?.find((t) => t.id === row.department_id)?.ten
      ?? row.department_ten ?? null;
  }, [row.department_id, row.bo_phan_chon, row.department_ten, toRefs]);

  // Màu viền theo mức độ cảnh báo
  const hasError = warnings.some((w) => w.includes("chưa") || w.includes("đứt"));
  const hasWarning = warnings.length > 0 && !hasError;

  let cardClass = "dag-node";
  if (maBaiGhep) cardClass += " dag-node--ghep";
  if (isSelected) cardClass += " dag-node--selected";
  else if (hasError) cardClass += " dag-node--has-error";
  else if (hasWarning) cardClass += " dag-node--has-warning";

  const seqNumber = (index + 1) * 10;
  const ngoai = row.loai_buoc === "thue_ngoai";

  return (
    <div
      className={cardClass}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
      onMouseDown={(e) => onNodeMouseDown(e, row.key)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Cổng vào (Input Port - bên trái) */}
      <div
        className={`dag-port dag-port--in ${isHoveredPort === "in" ? "dag-port--in-target" : ""}`}
        title="Tiền nhiệm (Input) - Bấm kéo dây từ bước trước nối vào đây"
        onMouseDown={(e) => {
          e.stopPropagation();
          onPortMouseDown(e, row.key, "in");
        }}
        onMouseUp={(e) => {
          e.stopPropagation();
          onPortMouseUp(e, row.key, "in");
        }}
      />

      {congCho && (
        <div
          className="dag-port dag-port--cho"
          title="Chờ bước của lệnh khác — thả dây từ thẻ lệnh khác vào đây"
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => {
            e.stopPropagation();
            onPortMouseUp(e, row.key, "in");
          }}
        />
      )}

      {/* Số món vật tư của bước — số ở GÓC thẻ, cùng kiểu số trong chip chuỗi bước ở tab Vật tư
          của lệnh. Nhìn cả chuỗi một lượt là biết bước nào ăn vật tư; bấm vào mở thẳng tab Vật tư. */}
      {row.vat_tus.length > 0 && (
        <button
          type="button"
          className="dag-node__vat-tu"
          title={[`${row.vat_tus.length} món vật tư`, ...row.vat_tus.map((v) => v.vat_tu_ten)].join("\n")}
          aria-label={`${row.vat_tus.length} món vật tư — mở tab Vật tư`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpenDrawer(index, "vat_tu");
          }}
        >
          {row.vat_tus.length}
        </button>
      )}

      {/* Header của Card */}
      <div className="dag-node__head">
        <span className="dag-node__seq">#{seqNumber}</span>
        <span className="dag-node__title" title={tenBuoc(row, congDoanRefs)}>
          {tenBuoc(row, congDoanRefs) || "Công đoạn"}
        </span>

        {maBaiGhep ? (
          <span className="dag-node__type-tag dag-node__type-tag--ghep" title="Chạy chung tờ">
            {maBaiGhep}
          </span>
        ) : (
          /* Chip DÙNG CHUNG với bảng công đoạn và các màn xưởng (`ChipBuoc`) — thẻ DAG trước đây
             tự vẽ lại nhãn từ `LSX_LOAI_BUOC_META` nên bước thuê ngoài chưa điền nơi làm chỉ hiện
             chữ "Thuê ngoài" trống trơn, không ai biết còn thiếu gì. */
          /* Thẻ chỉ rộng 240px: chip "Ngoài · <nhà gia công>" ở đầu thẻ đẩy tên bước về 0 rồi tràn
             khỏi thẻ, mà kể cả chip ngắn "Thuê ngoài" cũng cắt tên bước còn vài chữ. Bước thuê
             ngoài nói chuyện đó MỘT lần ở hàng nơi làm bên dưới (icon xe + tên nhà, màu thuê ngoài). */
          !ngoai && <ChipLoaiBuoc loai_buoc={row.loai_buoc} nha_cung_cap={row.nha_cung_cap} capLenh />
        )}
        {/* Con dao của bước — thẻ DAG là chỗ người kế hoạch nhìn cả chuỗi một lượt, thiếu dao phải
            thấy ngay ở đây chứ không phải mở từng drawer. */}
        <ChipKhuon
          can_khuon={row.requires_tooling}
          khuon={{
            ma: row.khuon_be_ma,
            so_ke: row.khuon_be_so_ke,
            tinh_trang: row.khuon_be_tinh_trang,
          }}
        />

        {canUpdate && (
          <div className="dag-node__actions">
            <button
              type="button"
              className="dag-node__btn"
              title="Sửa chi tiết bước (Mở Drawer)"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDrawer(index);
              }}
            >
              <Icon name="edit" size={12} />
            </button>
            <button
              type="button"
              className="dag-node__btn dag-node__btn--delete"
              title="Xóa công đoạn này"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteNode(index);
              }}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Body của Card */}
      <div className="dag-node__body">
        {/* Tổ / Máy — bước thuê ngoài không có tổ trong xưởng: hàng này nói NƠI LÀM (nhà gia
            công), "Chưa chọn tổ" ở đó là kêu thiếu một thứ không bao giờ phải điền. */}
        <div className="dag-node__row">
          {ngoai ? (
            <span
              className={`dag-node__badge ${
                row.nha_cung_cap_id == null ? "dag-node__badge--thieu" : "dag-node__badge--ngoai"
              }`}
              title={
                row.nha_cung_cap_id != null
                  ? `Thuê ngoài tại ${row.nha_cung_cap || "nhà đã chọn"}`
                  : "Bước thuê ngoài chưa chọn nhà gia công"
              }
            >
              <Icon name="truck" size={11} />
              <span className="dag-node__badge-chu">
                {row.nha_cung_cap_id != null ? row.nha_cung_cap || "Nhà đã chọn" : "Chưa chọn nhà gia công"}
              </span>
            </span>
          ) : (
            <span className="dag-node__badge">
              <Icon name="users" size={11} />
              {toTen ?? "Chưa có bộ phận nhận"}
            </span>
          )}
        </div>

        {/* Luồng số lượng Vào -> Ra */}
        <div className="dag-node__flow">
          <span>
            {n(row.so_luong_vao) > 0 ? n(row.so_luong_vao).toLocaleString("vi-VN") : "—"}{" "}
            <small>{dvNhan(row.don_vi_vao)}</small>
          </span>
          <span className="dag-node__flow-arrow">➔</span>
          <span>
            {n(row.so_luong_ra) > 0 ? n(row.so_luong_ra).toLocaleString("vi-VN") : "—"}{" "}
            <small>{dvNhan(row.don_vi_ra)}</small>
          </span>
        </div>


        {/* Cảnh báo nếu có */}
        {warnings.length > 0 && (
          <div className="dag-node__warnings">
            {warnings.map((w, idx) => (
              <span
                key={idx}
                className={`dag-node__warning-chip ${
                  w.includes("chưa") || w.includes("đứt")
                    ? "dag-node__warning-chip--err"
                    : "dag-node__warning-chip--warn"
                }`}
              >
                ⚠️ {w}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Cổng ra (Output Port - bên phải) */}
      <div
        className="dag-port dag-port--out"
        title="Kế nhiệm (Output) - Bấm giữ kéo dây nối sang bước tiếp theo"
        onMouseDown={(e) => {
          e.stopPropagation();
          onPortMouseDown(e, row.key, "out");
        }}
        onMouseUp={(e) => {
          e.stopPropagation();
          onPortMouseUp(e, row.key, "out");
        }}
      />
    </div>
  );
}
