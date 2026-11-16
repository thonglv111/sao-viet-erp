// Màn THUÊ GIA CÔNG (spec docs/superpowers/specs/2026-11-13-module-gia-cong-ngoai-design.md §4):
// Hàng chờ, Đơn gia công, Phiếu giao, Phiếu nhận, Hàng đang ở ngoài, Chờ trả tiền. Lệnh chỉ gắn cờ
// Thuê ngoài; đặt nhà, giao, nhận và trả tiền đều ở đây. Mọi danh sách tìm, lọc, cắt trang ở MÁY CHỦ.
import { useEffect, useState } from "react";
import type { TgcHangChoDong } from "../../api/thueGiaCong";
import type { NavigateFn } from "../../components/AppShell";
import { useCan } from "../../auth/permissions";
import { ChoTraTienTab } from "./ChoTraTienTab";
import { useNapTenDonVi } from "../tenDonVi";
import { useLocMan } from "../thanh-loc/useLocMan";
import { DonForm } from "./DonForm";
import { DonNgan } from "./DonNgan";
import { DonTab } from "./DonTab";
import { HangChoTab } from "./HangChoTab";
import { HangONgoaiTab } from "./HangONgoaiTab";
import { PhieuGiaoNgan } from "./PhieuGiaoNgan";
import { PhieuGiaoTab } from "./PhieuGiaoTab";
import { PhieuNhanNgan } from "./PhieuNhanNgan";
import { PhieuNhanTab } from "./PhieuNhanTab";
import "../rebuild-catalog.css";
import "../kcs/kcs-b.css";
import "../ke-toan/ke-toan.css";
import "./thue-gia-cong.css";

type TabTgc = "hang_cho" | "don" | "phieu_giao" | "phieu_nhan" | "hang_o_ngoai" | "cho_tra_tien";
const TABS: { key: TabTgc; nhan: string }[] = [
  { key: "hang_cho", nhan: "Hàng chờ" },
  { key: "don", nhan: "Đơn gia công" },
  { key: "phieu_giao", nhan: "Phiếu giao" },
  { key: "phieu_nhan", nhan: "Phiếu nhận" },
  { key: "hang_o_ngoai", nhan: "Hàng đang ở ngoài" },
  { key: "cho_tra_tien", nhan: "Chờ trả tiền" },
];

type LocMan = { tab: TabTgc };
const LOC_TRONG: LocMan = { tab: "hang_cho" };
const docLoc = (p: URLSearchParams): LocMan => {
  const t = p.get("tab") as TabTgc | null;
  return { tab: t && TABS.some((x) => x.key === t) ? t : "hang_cho" };
};
const ghiLoc = (t: LocMan) => ({ tab: t.tab === "hang_cho" ? undefined : t.tab });

export function ThueGiaCongPage({
  navigate,
  eventTick,
  openDonId,
  openSeq,
}: {
  navigate?: NavigateFn;
  eventTick?: number;
  /** Mở thẳng một đơn (từ màn lệnh / bài ghép / thông báo). `openSeq` đổi mỗi lần bấm. */
  openDonId?: number | null;
  openSeq?: number | null;
}) {
  const can = useCan();
  useNapTenDonVi();
  const [loc, setLoc] = useLocMan("thue-gia-cong", LOC_TRONG, docLoc, ghiLoc);
  const [lapDon, setLapDon] = useState<{ viecs: TgcHangChoDong[]; boChon: () => void } | null>(null);
  const [donMo, setDonMo] = useState<number | null>(null);
  const [dsDon, setDsDon] = useState<number[]>([]);
  const [pgMo, setPgMo] = useState<number | null>(null);
  const [dsPg, setDsPg] = useState<number[]>([]);
  const [pnMo, setPnMo] = useState<number | null>(null);
  const [dsPn, setDsPn] = useState<number[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (openDonId == null) return;
    setLoc({ tab: "don" });
    setDonMo(openDonId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDonId, openSeq]);

  const viTri = donMo != null ? dsDon.indexOf(donMo) : -1;
  const viTriPg = pgMo != null ? dsPg.indexOf(pgMo) : -1;
  const viTriPn = pnMo != null ? dsPn.indexOf(pnMo) : -1;
  const moDon = (id: number) => { setPgMo(null); setPnMo(null); setLoc({ tab: "don" }); setDonMo(id); };
  const moPg = (id: number) => { setDonMo(null); setPnMo(null); setLoc({ tab: "phieu_giao" }); setPgMo(id); };
  const moPn = (id: number) => { setDonMo(null); setPgMo(null); setLoc({ tab: "phieu_nhan" }); setPnMo(id); };
  const moLenh = navigate && can("san_xuat", "read")
    ? (lsxId: number) => navigate("ke-hoach-sx", { openLsxId: lsxId }) : undefined;

  return (
    <main className="rc kcs-page lds tgc-man">
      <header className="lds-dau">
        <h1 className="lds-dau__ten">Thuê gia công</h1>
      </header>

      <div className="kcsb-tabs" role="tablist" aria-label="Màn Thuê gia công">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={loc.tab === t.key}
            className={loc.tab === t.key ? "on" : undefined} onClick={() => setLoc({ ...loc, tab: t.key })}>
            {t.nhan}
          </button>
        ))}
      </div>

      {loc.tab === "hang_cho" && (
        <HangChoTab eventTick={eventTick} canTach={can("thue_gia_cong", "update")}
          onTaoDon={can("thue_gia_cong", "create") ? (viecs, boChon) => setLapDon({ viecs, boChon }) : undefined} />
      )}
      {loc.tab === "don" && (
        <DonTab eventTick={eventTick} tick={tick} dangMo={donMo} onMo={setDonMo} onDanhSach={setDsDon} />
      )}
      {loc.tab === "phieu_giao" && (
        <PhieuGiaoTab eventTick={eventTick} tick={tick} dangMo={pgMo} onMo={setPgMo} onDanhSach={setDsPg} />
      )}
      {loc.tab === "phieu_nhan" && (
        <PhieuNhanTab eventTick={eventTick} tick={tick} dangMo={pnMo} onMo={setPnMo} onDanhSach={setDsPn} />
      )}
      {loc.tab === "hang_o_ngoai" && <HangONgoaiTab eventTick={eventTick} tick={tick} onMoDon={moDon} />}
      {loc.tab === "cho_tra_tien" && (
        <ChoTraTienTab eventTick={eventTick} tick={tick} coLap={can("phieu_chi", "create")} onMoLenh={moLenh}
          onMoPhieuChi={navigate && can("phieu_chi", "read")
            ? (ma) => navigate("ke-toan-phieu-chi", { focusVoucherQuery: ma }) : undefined} />
      )}

      {lapDon && (
        <DonForm viecs={lapDon.viecs} onClose={() => setLapDon(null)}
          onDone={(d) => {
            lapDon.boChon();
            setLapDon(null);
            setTick((k) => k + 1);
            setLoc({ ...loc, tab: "don" });
            setDonMo(d.id);
          }} />
      )}
      {donMo != null && (
        <DonNgan
          key={donMo}
          donId={donMo}
          eventTick={eventTick}
          canSua={can("thue_gia_cong", "update")}
          canDat={can("thue_gia_cong", "create")}
          canHuy={can("thue_gia_cong", "cancel")}
          canGiao={can("thue_gia_cong", "create")}
          onDong={() => setDonMo(null)}
          onDoi={() => setTick((k) => k + 1)}
          onMoLenh={moLenh}
          onMoPhieuGiao={moPg}
          onMoPhieuNhan={moPn}
          len={viTri > 0 ? () => setDonMo(dsDon[viTri - 1]) : undefined}
          xuong={viTri >= 0 && viTri < dsDon.length - 1 ? () => setDonMo(dsDon[viTri + 1]) : undefined}
        />
      )}
      {pgMo != null && (
        <PhieuGiaoNgan
          key={pgMo}
          phieuId={pgMo}
          eventTick={eventTick}
          canHuy={can("thue_gia_cong", "cancel")}
          onDong={() => setPgMo(null)}
          onDoi={() => setTick((k) => k + 1)}
          onMoDon={moDon}
          onMoLenh={moLenh}
          len={viTriPg > 0 ? () => setPgMo(dsPg[viTriPg - 1]) : undefined}
          xuong={viTriPg >= 0 && viTriPg < dsPg.length - 1 ? () => setPgMo(dsPg[viTriPg + 1]) : undefined}
        />
      )}
      {pnMo != null && (
        <PhieuNhanNgan
          key={pnMo}
          phieuId={pnMo}
          eventTick={eventTick}
          canHuy={can("thue_gia_cong", "cancel")}
          onDong={() => setPnMo(null)}
          onDoi={() => setTick((k) => k + 1)}
          onMoDon={moDon}
          onMoLenh={moLenh}
          len={viTriPn > 0 ? () => setPnMo(dsPn[viTriPn - 1]) : undefined}
          xuong={viTriPn >= 0 && viTriPn < dsPn.length - 1 ? () => setPnMo(dsPn[viTriPn + 1]) : undefined}
        />
      )}
    </main>
  );
}
