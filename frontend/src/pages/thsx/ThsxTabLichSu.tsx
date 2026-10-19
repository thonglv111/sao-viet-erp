// Tab LỊCH SỬ của ngăn công việc (kế hoạch 4/4, mockup `ban-to-ngan-B-day-du.html` pane `ls`).
//
// Mọi việc đã xảy ra với CHÍNH công việc này — chạy máy, người và khuôn, sản lượng, bàn giao, vật
// tư, KCS — mới nhất trên cùng. Máy chủ dựng câu (`services/san_xuat/lich_su_viec.py`), FE chỉ vẽ.
// 10/10/2026: vẽ bằng `Timeline` chung — cùng dáng tab Nhật ký của lệnh (chấm rỗng nối trục dọc,
// câu, thẻ nhỏ cho `ct` và lý do, dòng xám "người lúc ngày giờ" bên dưới).
//
// Chip nhóm lọc TẠI CHỖ: đây là một công việc, vài chục dòng, không phải danh sách bản ghi có trang.
// Nạp lại mỗi khi `tick` đổi (ngăn truyền đúng object chi tiết vừa nạp — SSE hay cú bấm của chính
// mình đều nạp lại chi tiết), nên lịch sử tự thêm dòng mà không cần F5.
import { useEffect, useState } from "react";

import { api, ApiError, type SxLichSuViec } from "../../api/client";
import { useAuth } from "../../auth/useAuth";
import { Timeline } from "../../components/Timeline";

const NHOM: { ma: string | null; ten: string }[] = [
  { ma: null, ten: "Tất cả" },
  { ma: "chay_may", ten: "Chạy máy" },
  { ma: "nguoi_khuon", ten: "Người và khuôn" },
  { ma: "san_luong", ten: "Sản lượng" },
  { ma: "ban_giao", ten: "Bàn giao" },
  { ma: "vat_tu", ten: "Vật tư" },
  { ma: "kcs", ten: "KCS" },
];

const TONE = { g: "moss", b: "steel", r: "signal" } as const;

/** "9/10/2026 11:58" — cùng khuôn dòng phụ của Nhật ký lệnh; đọc `luc` như các mốc khác của ngăn. */
function ngayGio(luc: string | null): string {
  if (!luc) return "—";
  const d = new Date(luc);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ThsxTabLichSu({ congViecId, tick }: { congViecId: number; tick?: unknown }) {
  const { token } = useAuth();
  const [ds, setDs] = useState<SxLichSuViec | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [nhom, setNhom] = useState<string | null>(null);
  const [lan, setLan] = useState(0);

  // Đổi việc thì bỏ dữ liệu cũ và về "Tất cả"; nạp lại cùng việc thì giữ dòng đang có cho khỏi nháy.
  useEffect(() => { setDs(null); setNhom(null); }, [congViecId]);

  useEffect(() => {
    if (!token) return;
    let bo = false;
    setLoi(null);
    api.sanXuat.lichSuViec(token, congViecId)
      .then((r) => { if (!bo) setDs(r); })
      .catch((e) => {
        if (bo) return;
        setLoi(e instanceof ApiError && e.isNetwork ? "Mất kết nối tới máy chủ." : "Không nạp được lịch sử của việc.");
      });
    return () => { bo = true; };
  }, [token, congViecId, tick, lan]);

  const dong = (ds?.items ?? []).filter((x) => nhom == null || x.nhom === nhom);
  const tong = ds?.items.length ?? 0;

  return (
    <section className="thsx-b-sec thsx-ls">
      <div className="thsx-b-sec__dau">
        <h3 className="thsx-b-sec__h">Lịch sử</h3>
        {ds && <span className="thsx-b-mo3">{tong} việc</span>}
        {ds && tong > 0 && (
          <span className="thsx-b-sec__phai">
            <span className="thsx-ls__chips" role="group" aria-label="Lọc theo nhóm">
              {NHOM.map((n) => {
                const so = n.ma == null ? tong : (ds.dem[n.ma] ?? 0);
                return (
                  <button key={n.ten} type="button" aria-pressed={nhom === n.ma}
                    className={`thsx-ls__chip${so === 0 ? " is-rong" : ""}`} onClick={() => setNhom(n.ma)}>
                    {n.ten}
                  </button>
                );
              })}
            </span>
          </span>
        )}
      </div>

      {loi && !ds ? (
        <p className="thsx-b-trong">
          {loi} <button type="button" className="thsx-b-lk" onClick={() => setLan((x) => x + 1)}>Thử lại</button>
        </p>
      ) : !ds ? (
        <p className="thsx-b-trong">Đang nạp lịch sử…</p>
      ) : tong === 0 ? (
        <p className="thsx-b-trong">Chưa có việc gì được ghi lại.</p>
      ) : dong.length === 0 ? (
        <p className="thsx-b-trong">Không có việc nào thuộc nhóm này.</p>
      ) : (
        <div className="thsx-ls__tl">
          <Timeline
            items={dong.map((x) => ({
              title: x.cau,
              tags: x.ly_do ? [...x.ct, `Lý do: ${x.ly_do}`] : x.ct,
              meta: `${x.nguoi || "—"} lúc ${ngayGio(x.luc)}`,
              tone: TONE[x.mau as keyof typeof TONE],
            }))}
          />
        </div>
      )}
    </section>
  );
}
