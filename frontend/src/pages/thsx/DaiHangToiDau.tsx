// KHỐI "HÀNG ĐANG TỚI ĐÂU" — dải bước dọc có chấm + ô đuôi "làm xong thì hàng đi đâu". Tách khỏi
// `ThsxCotPhai` ngày 27/10/2026 để ngăn hồ sơ lệnh (`LenhSxNgan`, phương án C) vẽ ĐÚNG một hình với
// ngăn Việc của tổ. Component chỉ vẽ; câu vị trí và cách gom bước do bên gọi quyết, vì ngăn tổ nói
// theo "tổ mình" còn ngăn lệnh nói theo cả lệnh.
import type { ReactNode } from "react";
import type { SxDaiDuoi } from "../../api/client";
import { Icon } from "../../components/Icons";
import { gioNgan } from "../keHoachSxShared";
import { cauDuoi } from "../thsxTuyen";
import "../thuc-hien-sx.css";

export type BuocDai = {
  key: string;
  ten: string;
  /** Chữ phụ dưới tên (tổ, "Thuê ngoài"…), mỗi mẩu một thẻ — không nối bằng dấu. */
  phu: string[];
  trangThai: string | null;
  /** Chấm to viền đậm: bước của tổ đang xem. */
  laMe?: boolean;
  /** Chữ xanh "tổ mình" sau chữ phụ. */
  minh?: boolean;
  thueNgoai?: boolean;
};

export type ODuoi = { icon: "warehouse" | "truck" | "arrowRight"; ten: string; so: string[] };

/** Ô đuôi từ `dai_duoi` máy chủ dựng — cùng câu cho cả hai ngăn. `dv` dịch mã đơn vị. */
export function oDuoi(d: SxDaiDuoi | null | undefined, dv: (ma: string | null | undefined) => string): ODuoi | null {
  if (!d) return null;
  return {
    icon: d.loai === "ve_kho" ? "warehouse" : d.loai === "giao_khach" ? "truck" : "arrowRight",
    ...cauDuoi(d, dv, (v) => `${gioNgan(v)} ${v ? new Date(v).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }) : ""}`.trim()),
  };
}

export function DaiHangToiDau({ cau, chamCau = "toi", phu, buoc, duoi }: {
  cau: ReactNode;
  /** Màu chấm trước câu: tới (xanh lá) · sắp (xanh dương) · qua (xám). */
  chamCau?: "toi" | "sap" | "qua";
  phu?: ReactNode;
  buoc: BuocDai[];
  duoi?: ODuoi | null;
}) {
  return (
    <section className="thsx-b-blk">
      <h3 className="thsx-b-blk__h">Hàng đang tới đâu</h3>
      <div className="thsx-b-cau">
        <span className={`thsx-b-cau__dot is-${chamCau}`} aria-hidden="true" />
        <span>{cau}</span>
        {phu && <span className="thsx-b-mo3">{phu}</span>}
      </div>
      <ol className="thsx-b-vlist">
        {buoc.map((o) => {
          const lop = [
            "thsx-b-vs",
            o.trangThai === "completed" ? "is-xong" : "",
            o.trangThai === "running" || o.trangThai === "paused" ? "is-dang" : "",
            o.laMe ? "is-me" : "",
            o.thueNgoai ? "is-ngoai" : "",
          ].filter(Boolean).join(" ");
          return (
            <li key={o.key} className={lop}>
              <i className="thsx-b-vs__o" aria-hidden="true" />
              <div>
                <div className="thsx-b-vs__nm">{o.ten}</div>
                <div className="thsx-b-vs__to">
                  {o.phu.map((t) => <span key={t}>{t}</span>)}
                  {o.minh && <span className="thsx-b-vs__minh">tổ mình</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {duoi && (
        <div className="thsx-b-duoi">
          <Icon name={duoi.icon} size={15} />
          <div>
            <div className="thsx-b-duoi__nm">{duoi.ten}</div>
            {duoi.so.length > 0 && (
              <div className="thsx-b-vs__to">{duoi.so.map((t) => <span key={t}>{t}</span>)}</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
