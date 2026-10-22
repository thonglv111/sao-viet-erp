// Hộp "Đổi máy" của ngăn bàn tổ (mockup `ban-to-hop-thoai-B.html#doi-may`, mở từ nút ⋯). Danh sách máy do máy chủ dựng (`/work-items/{id}/may-doi`):
// công đoạn có tick tổ ⇒ chỉ máy THUỘC tổ của việc (máy thuộc tổ, mg `0434`) — máy hư thì việc chờ,
// thợ sang phụ tổ khác chứ việc không đi theo; chưa tick tổ ⇒ máy làm được công đoạn như Xếp lịch.
// Mỗi máy kèm TÌNH TRẠNG lúc này (cùng nguồn cột Trạng thái màn Thiết bị) và các tổ khác cùng dùng máy.
//
// Tách khỏi `ThsxDrawer` vì tự gọi API: chỉ mount khi mở hộp, nên danh sách luôn nạp lại mỗi lần mở
// (máy vừa hỏng/vừa nhận lệnh khác phải hiện đúng lúc chọn), và ngăn kéo vẫn không cần phiên đăng nhập.
import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type SxMayDoiOut } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { Select, type SelectOption } from "../components/Select";
import { ThsxHop } from "./thsx/ThsxHop";

// Thứ tự nhóm: máy nhận việc được lên đầu; có phiếu sửa vẫn chạy được nên đứng ngay sau; máy hỏng
// cuối cùng. Mã lạ (máy chủ thêm trạng thái mới) xếp trước nhóm hỏng để không bị giấu.
const DS_TEN = new Intl.ListFormat("vi", { style: "long", type: "conjunction" });
const THU_TU_TT = ["ranh", "co_phieu_sua", "dang_chay", "bao_tri", "khoa", "may_dung"];
function thuTu(tt: string): number {
  const i = THU_TU_TT.indexOf(tt);
  return i < 0 ? THU_TU_TT.length - 1.5 : i;
}

interface Props {
  congViecId: number;
  mayHienTaiId: number | null;
  /** Nhãn máy đang dùng, vd "CT-01 Máy cắt tờ ITO 100" — ô khoá đầu hộp. */
  mayHienTai: string;
  tenCongDoan: string;
  /** Phụ đề hộp, vd "Cắt tờ của LSX26-0004". */
  phuDe?: string;
  busy: boolean;
  onDoi: (mayId: number, lyDo?: string | null) => Promise<boolean>;
  onClose: () => void;
}

export function ThsxDoiMay({ congViecId, mayHienTaiId, mayHienTai, tenCongDoan, phuDe, busy, onDoi, onClose }: Props) {
  const { token } = useAuth();
  const [ds, setDs] = useState<SxMayDoiOut | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [mayId, setMayId] = useState<number | "">("");
  const [lyDo, setLyDo] = useState("");

  useEffect(() => {
    if (!token) return;
    let bo = false;
    setDs(null);
    setLoi(null);
    api.sanXuat
      .mayDoi(token, congViecId)
      .then((r) => { if (!bo) setDs(r); })
      .catch((e) => {
        if (bo) return;
        setLoi(e instanceof ApiError && e.isNetwork ? "Mất kết nối tới máy chủ" : "Không nạp được danh sách máy");
      });
    return () => { bo = true; };
  }, [token, congViecId, mayHienTaiId]);

  const opts = useMemo<SelectOption<number | "">[]>(
    () => [...(ds?.items ?? [])]
      .sort((a, b) => thuTu(a.trang_thai) - thuTu(b.trang_thai) || a.ma.localeCompare(b.ma, "vi"))
      .map((m) => ({
        value: m.id,
        label: m.ten ? `${m.ma} ${m.ten}` : m.ma,
        group: m.nhan,
        // Tình trạng chi tiết + tổ khác cùng dùng máy — hai câu, không nối mẩu bằng dấu.
        sub: [m.chi_tiet, m.to_khac?.length ? `Cũng thuộc ${DS_TEN.format(m.to_khac)}` : null]
          .filter(Boolean).join(". ") || undefined,
        search: `${m.nhan} ${m.loai_may ?? ""}`,
      })),
    [ds],
  );
  const chon = ds?.items.find((m) => m.id === mayId) ?? null;

  async function xacNhan() {
    if (mayId === "" || busy) return;
    if (await onDoi(mayId, lyDo.trim() || null)) onClose();
  }

  return (
    <ThsxHop tieuDe="Đổi máy" phuDe={phuDe} nutChinh="Đổi máy" nutChinhKhoa={mayId === ""} dangGui={busy}
      onDong={onClose} onChinh={xacNhan}>
      <div className="thsx-f">
        <span className="thsx-f__n">Máy đang dùng</span>
        <input className="thsx-x-in" value={mayHienTai} readOnly disabled aria-label="Máy đang dùng" />
      </div>
      <div className="thsx-f">
        <span className="thsx-f__n">Đổi sang máy</span>
        <Select portal searchable value={mayId} options={opts} onChange={setMayId}
          disabled={!ds || opts.length === 0} ariaLabel="Đổi sang máy"
          placeholder={loi ? "Không chọn được" : !ds ? "Đang nạp máy…" : opts.length === 0 ? "Không có máy đổi được" : "Chọn máy"}
          searchPlaceholder="Gõ mã, tên hoặc tình trạng máy" className="thsx-x-seltrig" />
        {chon && (chon.to_khac?.length ?? 0) > 0 && (
          <span className="thsx-f__g">
            Máy này cũng thuộc{" "}
            {chon.to_khac.map((t) => <span key={t} className="lds-tag">{t}</span>)}
          </span>
        )}
        {loi ? (
          <span className="thsx-f__g thsx-f__g--loi">{loi}</span>
        ) : ds && (
          <span className="thsx-f__g">
            {ds.theo_to
              ? (opts.length === 0
                ? "Tổ không còn máy khác chạy công đoạn này. Việc chờ máy sửa xong."
                : `Chỉ hiện máy của tổ chạy được công đoạn ${tenCongDoan}.`)
              : ds.theo_cong_doan
                ? `Chỉ hiện máy khai cho công đoạn ${tenCongDoan}.`
                : `Công đoạn ${tenCongDoan} chưa khai máy, đang hiện mọi máy còn dùng.`}
          </span>
        )}
      </div>
      {/* Chỉ cảnh báo, không chặn: tổ có thể biết điều máy chủ chưa biết (máy đã sửa xong mà phiếu
          chưa đóng, lệnh kia đang tạm dừng…). */}
      {chon && chon.trang_thai !== "ranh" && (
        <div className="thsx-bao thsx-bao--vang" role="status">
          {chon.ma} đang ở tình trạng {chon.nhan.toLowerCase()}{chon.chi_tiet ? `: ${chon.chi_tiet}` : ""}.
        </div>
      )}
      <label className="thsx-f">
        <span className="thsx-f__n">Lý do đổi</span>
        <input className="thsx-x-in" value={lyDo} onChange={(e) => setLyDo(e.target.value)}
          placeholder="Không bắt buộc, ví dụ máy hỏng, đổi ca" />
      </label>
    </ThsxHop>
  );
}
