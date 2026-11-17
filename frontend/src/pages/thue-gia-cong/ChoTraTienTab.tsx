// Tab "Chờ trả tiền" (spec 2026-11-13 §4.6): phiếu nhận chưa có phiếu chi còn hiệu lực. Dùng CHUNG
// bảng "Gia công chờ chi" và hộp lập phiếu chi của màn Phiếu chi — tick nhiều phiếu nhận cùng nhà gia
// công để lập một phiếu chi. Tìm, lọc nhà ở MÁY CHỦ; hàng chờ không cắt trang (hết việc thì rụng).
import { useEffect, useMemo, useState } from "react";
import { Building2 } from "lucide-react";
import { ApiError } from "../../api/client";
import { tgcApi, type TgcChoTraTien, type TgcNhaGiaCong } from "../../api/thueGiaCong";
import { useAuth } from "../../auth/useAuth";
import { ChonCot, OTim, useCauHinhLuoi } from "../../components/LuoiDs";
import { useDebounced } from "../../utils/useDebounced";
import { COT_GIA_CONG, HangChoGiaCong } from "../ke-toan/phieu-chi/components/HangChoGiaCong";
import { LapPhieuChiGiaCongModal } from "../ke-toan/phieu-chi/modals/LapPhieuChiGiaCongModal";
import { ThanhLoc } from "../thanh-loc/ThanhLoc";
import type { DieuKien } from "../thanh-loc/thanh-loc";

type Loc = { nha?: string };

export function ChoTraTienTab({ eventTick, tick, coLap, onMoLenh, onMoPhieuChi }: {
  eventTick?: number;
  tick?: number;
  /** Có quyền `phieu_chi:create` ⇒ có ô tick và nút lập phiếu chi. */
  coLap: boolean;
  onMoLenh?: (lsxId: number) => void;
  /** Lập xong mở phiếu chi vừa lập ở màn Phiếu chi (theo mã). Không có = ở lại màn này. */
  onMoPhieuChi?: (ma: string) => void;
}) {
  const { token } = useAuth();
  const luoi = useCauHinhLuoi("tgc-cho-tra-tien");
  const [tim, setTim] = useState("");
  const timCham = useDebounced(tim.trim());
  const [loc, setLoc] = useState<Loc>({});
  const [rows, setRows] = useState<TgcChoTraTien[] | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [nhas, setNhas] = useState<TgcNhaGiaCong[]>([]);
  const [lap, setLap] = useState<TgcChoTraTien[] | null>(null);
  const [lan, setLan] = useState(0);

  useEffect(() => {
    if (token) tgcApi.nhaGiaCong(token, true).then(setNhas).catch(() => setNhas([]));
  }, [token]);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    tgcApi.choTraTien(token, { q: timCham || undefined, nha_cung_cap_id: loc.nha ? Number(loc.nha) : undefined })
      .then((r) => { if (alive) { setRows(r); setLoi(null); } })
      .catch((e) => { if (alive) setLoi(e instanceof ApiError ? e.message : "Không tải được danh sách chờ trả tiền."); });
    return () => { alive = false; };
  }, [token, timCham, loc, tick, eventTick, lan]);

  const dieuKien: DieuKien<Loc>[] = useMemo(() => [{
    khoa: "nha", nhan: "Nhà gia công", icon: Building2, kieu: "mot", tim: true,
    giaTri: nhas.map((n) => ({ value: String(n.id), nhan: n.ten })),
    doc: (l) => l.nha, ghi: (l, v) => ({ ...l, nha: v }),
  }], [nhas]);

  return (
    <section aria-label="Chờ trả tiền">
      <section className="lds-loc">
        <div className="lds-loc__thanh tl-thanh" role="search">
          <OTim value={tim} onChange={setTim} placeholder="Tìm phiếu nhận, mã đơn, nhà gia công, mã lệnh…" ariaLabel="Tìm phiếu nhận chờ trả tiền" />
          <ThanhLoc dieuKien={dieuKien} loc={loc} onLoc={setLoc} />
          <span className="kcsb-gian" />
          <ChonCot cot={COT_GIA_CONG} {...luoi.chonCot} />
        </div>
      </section>
      <HangChoGiaCong key={lan} rows={rows} loi={loi} onLap={coLap ? setLap : undefined} luoi={luoi} onMoLenh={onMoLenh} />
      {lap && lap.length > 0 && (
        <LapPhieuChiGiaCongModal
          rows={lap}
          onClose={() => setLap(null)}
          onDone={(pc) => {
            setLap(null);
            setLan((n) => n + 1);
            onMoPhieuChi?.(pc.code);
          }}
        />
      )}
    </section>
  );
}
