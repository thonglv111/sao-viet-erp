// Tab "Yêu cầu chờ xử lý" của màn Mua hàng — phương án 3 (07/10/2026). Bảng `BangYeuCau` và chế độ
// "Xem theo: Từng món" dùng CHUNG với màn Yêu cầu mua hàng nên cùng một yêu cầu hiện cùng một kiểu.
//
// Mặc định xem TỪNG MÓN, lọc sẵn Chờ lập đơn: việc của Thu mua là gom món thành đơn, tick món rồi bấm
// "Lập đơn mua" ở thanh nổi. Xem theo Yêu cầu thì bấm dòng còn Chờ lập đơn là mở form với mọi món.
//
// TICK CHÉO (08/10/2026, phương án 1): một đơn gom được món của NHIỀU yêu cầu. Lựa chọn sống ở đây —
// qua sang trang, đổi lọc, đổi chế độ xem vẫn còn; xem theo Yêu cầu thì ô tick ba trạng thái chọn cả
// món chờ lập đơn của yêu cầu đó. Form lập đơn tự chia theo nhà cung cấp lúc lưu.
import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type {
  DepartmentPurchaseRequestLineOut,
  DepartmentPurchaseRequestRow,
  MuaChoLenh,
  YeuCauMonRow,
} from "../../../../api/client";
import type { KyDS } from "../../../thanh-loc/ky-danh-sach";
import type { DieuKien } from "../../../thanh-loc/thanh-loc";
import { ThanhCongCuMuaHang, tabCoSo } from "../../loc-mua-hang/ThanhCongCuMuaHang";
import { MOC_YEU_CAU, TAB_CHINH_YEU_CAU, type LocYeuCau } from "../../loc-mua-hang/dieu-kien-yeu-cau";
import { TT_YEU_CAU } from "../../trang-thai-mua";
import { ChonCotBang, useCotBang } from "../../luoi-mua-hang";
import { BangMonYeuCau, COT_MON } from "../../yeu-cau-chung/BangMonYeuCau";
import { BangYeuCau, COT_YEU_CAU, type ChonMonYeuCau } from "../../yeu-cau-chung/BangYeuCau";
import { NutXemTheo, tabMon, useMonYeuCau, useXemTheo } from "../../yeu-cau-chung/xem-theo";
import type { SourceStatusFilter } from "../shared/types";

/** Món còn chờ lập đơn: chưa huỷ, chưa nằm trong đơn còn sống (đơn bị trả vẫn giữ món). Khớp
 *  `chon_duoc` của máy chủ ở bảng Từng món. */
function choLapDon(line: DepartmentPurchaseRequestLineOut): boolean {
  return !line.cancelled_at && (!line.fulfilment || line.fulfilment.purchase_status === "cancelled");
}

/** Dựng dòng "Từng món" từ một dòng yêu cầu — để món tick ở bảng Yêu cầu vẫn hiện được ở chế độ
 *  "Chỉ xem món đã chọn". */
function monTuDong(row: DepartmentPurchaseRequestRow, l: DepartmentPurchaseRequestLineOut): YeuCauMonRow {
  return {
    line_id: l.id,
    request_id: row.id,
    request_code: row.code,
    request_status: row.status,
    content: row.content,
    requesting_department_name: row.requesting_department_name,
    requested_by_name: row.requested_by_name,
    created_at: row.created_at,
    needed_date: row.needed_date,
    hang_loai: l.hang_loai,
    hang_id: l.hang_id,
    kho_rong: l.kho_rong,
    kho_dai: l.kho_dai,
    dinh_luong: l.dinh_luong ?? null,
    item_name: l.item_name,
    unit: l.unit,
    quantity: l.quantity,
    note: l.note,
    purchase_request_id: null,
    purchase_code: null,
    purchase_status: null,
    supplier_name: null,
    ordered_quantity: null,
    received_quantity: null,
    tinh_trang: "cho_lap",
    tien_do: 0,
    chon_duoc: true,
    cancel_reason: null,
    loai_mua: row.loai_mua,
    mua_cho: l.mua_cho,
  };
}

export function YeuCauInboxTab({
  bannerLoi,
  sourceQ,
  setSourceQ,
  sourceQDebounced,
  sourceStatus,
  setSourceStatus,
  tinhTrang,
  setTinhTrang,
  demTheoTab,
  ky,
  onKy,
  dieuKien,
  loc,
  onLoc,
  xoaLocThem,
  coLocThem,
  khoaLoc,
  monTick,
  sourcePage,
  setSourcePage,
  monPage,
  setMonPage,
  sourceLoading,
  sourceError,
  sourceRows,
  sourceTotal,
  sourceSize,
  onSourceSize,
  loadSources,
  canCreate,
  openCreatePurchaseRequest,
  lapDonTuMon,
  openYcmh,
  onMoLenh,
}: {
  bannerLoi: ReactNode;
  sourceQ: string;
  setSourceQ: Dispatch<SetStateAction<string>>;
  sourceQDebounced: string;
  sourceStatus: SourceStatusFilter;
  setSourceStatus: Dispatch<SetStateAction<SourceStatusFilter>>;
  /** Chip tình trạng món (chế độ Từng món) — giữ ở cha để đổi tab lớn không mất. */
  tinhTrang: string;
  setTinhTrang: Dispatch<SetStateAction<string>>;
  /** Số yêu cầu theo trạng thái hiển thị — máy chủ đếm sau lọc, trước tab. */
  demTheoTab: Record<string, number> | null;
  ky: KyDS;
  onKy: (k: KyDS) => void;
  dieuKien: DieuKien<LocYeuCau>[];
  loc: LocYeuCau;
  onLoc: (l: LocYeuCau) => void;
  /** Bỏ kỳ + điều kiện của thanh lọc (ô tìm và tab do tab này tự bỏ). */
  xoaLocThem: () => void;
  coLocThem: boolean;
  /** JSON tham số kỳ + điều kiện — cùng chuỗi đang gửi cho danh sách yêu cầu. */
  khoaLoc: string;
  /** Tăng sau mỗi thao tác chạm yêu cầu (lập đơn, huỷ…) — nạp lại danh sách món. */
  monTick: number;
  sourcePage: number;
  setSourcePage: Dispatch<SetStateAction<number>>;
  monPage: number;
  setMonPage: Dispatch<SetStateAction<number>>;
  sourceLoading: boolean;
  sourceError: string | null;
  sourceRows: DepartmentPurchaseRequestRow[];
  sourceTotal: number;
  sourceSize: number;
  onSourceSize: (size: number) => void;
  loadSources: () => void;
  canCreate: boolean;
  openCreatePurchaseRequest: (pickedSource: DepartmentPurchaseRequestRow) => void;
  /** Lập MỘT lần đơn từ các món đã tick — `{id yêu cầu: [id dòng]}`, có thể nhiều yêu cầu. */
  lapDonTuMon: (theoYeuCau: Map<number, number[]>) => void;
  openYcmh?: (code: string) => void;
  onMoLenh?: (l: MuaChoLenh) => void;
}) {
  const [xemTheo, setXemTheo] = useXemTheo("svn.mua-hang.yeu-cau.xem-theo", "mon");
  // Cột của hai lưới — nhớ riêng cho màn Mua hàng (cùng lưới ở Yêu cầu mua hàng nhớ khoá khác).
  const cotYc = useCotBang("mh-yc", COT_YEU_CAU);
  const cotMon = useCotBang("mh-yc-mon", COT_MON);
  const mon = useMonYeuCau({
    bat: xemTheo === "mon",
    q: sourceQDebounced,
    tinhTrang,
    page: monPage,
    size: sourceSize,
    khoaLoc,
    tick: monTick,
  });

  const [chon, setChon] = useState<Map<number, YeuCauMonRow>>(new Map());
  const [chiXemChon, setChiXemChon] = useState(false);
  // Sau thao tác chạm yêu cầu (lập đơn xong, huỷ…) món đã chọn có thể không còn chờ lập đơn ⇒ bỏ hết.
  useEffect(() => {
    setChon(new Map());
    setChiXemChon(false);
  }, [monTick]);
  // Danh sách nạp lại thấy món đã vào đơn (người khác vừa lập) ⇒ bỏ khỏi lựa chọn.
  useEffect(() => {
    const ds = mon.data?.items;
    if (!ds) return;
    setChon((cu) => {
      const roi = ds.filter((r) => !r.chon_duoc && cu.has(r.line_id));
      if (!roi.length) return cu;
      const moi = new Map(cu);
      roi.forEach((r) => moi.delete(r.line_id));
      return moi;
    });
  }, [mon.data]);
  useEffect(() => {
    if (chon.size === 0) setChiXemChon(false);
  }, [chon.size]);
  const daChon = useMemo(() => [...chon.values()], [chon]);
  const idChon = useMemo(() => new Set(chon.keys()), [chon]);
  const soYeuCau = useMemo(() => new Set(daChon.map((r) => r.request_id)).size, [daChon]);

  const doiMon = (r: YeuCauMonRow) =>
    setChon((cu) => {
      const moi = new Map(cu);
      if (moi.has(r.line_id)) moi.delete(r.line_id);
      else moi.set(r.line_id, r);
      return moi;
    });
  const chonTrang = (rows: YeuCauMonRow[], bat: boolean) =>
    setChon((cu) => {
      const moi = new Map(cu);
      rows.forEach((r) => (bat ? moi.set(r.line_id, r) : moi.delete(r.line_id)));
      return moi;
    });
  const chonMon = canCreate
    ? {
        trangThai: (row: DepartmentPurchaseRequestRow): ChonMonYeuCau => {
          if (row.status !== "open") return null;
          const cho = row.lines.filter(choLapDon);
          if (!cho.length) return null;
          const n = cho.filter((l) => chon.has(l.id)).length;
          return n === 0 ? "khong" : n === cho.length ? "het" : "mot_phan";
        },
        doi: (row: DepartmentPurchaseRequestRow) => {
          const cho = row.lines.filter(choLapDon);
          setChon((cu) => {
            const moi = new Map(cu);
            const het = cho.every((l) => moi.has(l.id));
            cho.forEach((l) => (het ? moi.delete(l.id) : moi.set(l.id, monTuDong(row, l))));
            return moi;
          });
        },
      }
    : undefined;
  const lapDon = () => {
    const theo = new Map<number, number[]>();
    for (const r of daChon) theo.set(r.request_id, [...(theo.get(r.request_id) ?? []), r.line_id]);
    lapDonTuMon(theo);
  };

  // `tabYc`: hàng tab trạng thái + bộ lọc đi theo CHẾ ĐỘ XEM; `laYc`: bảng đang vẽ. "Chỉ xem món đã
  // chọn" đổi bảng sang từng món nhưng giữ nguyên hàng tab của chế độ đang đứng (có số đếm).
  const tabYc = xemTheo === "yc";
  const laYc = tabYc && !chiXemChon;
  const coLoc = sourceQ.trim() !== "" || (tabYc ? sourceStatus !== "all" : tinhTrang !== "all") || coLocThem;
  const xoaLoc = () => {
    setSourceQ("");
    if (tabYc) setSourceStatus("all");
    else setTinhTrang("all");
    xoaLocThem();
    setSourcePage(1);
    setMonPage(1);
  };
  return (
    <>
      {bannerLoi}

      <ThanhCongCuMuaHang
        tabs={tabYc ? tabCoSo(TAB_CHINH_YEU_CAU, TT_YEU_CAU, demTheoTab, sourceStatus) : tabMon(mon.data?.dem_theo_tab, tinhTrang)}
        tab={tabYc ? sourceStatus : tinhTrang}
        ariaTabs={tabYc ? "Lọc trạng thái yêu cầu" : "Lọc tình trạng món"}
        onTab={(v) => {
          setChiXemChon(false);
          if (tabYc) {
            setSourceStatus(v as SourceStatusFilter);
            setSourcePage(1);
          } else {
            setTinhTrang(v);
            setMonPage(1);
          }
        }}
        q={sourceQ}
        onQ={(v) => {
          setChiXemChon(false);
          setSourceQ(v);
          setSourcePage(1);
          setMonPage(1);
        }}
        placeholder="Tìm mã yêu cầu, mã lệnh, nội dung, vật tư…"
        ky={ky}
        moc={MOC_YEU_CAU}
        onKy={onKy}
        dieuKien={dieuKien}
        loc={loc}
        onLoc={onLoc}
        ben={
          <NutXemTheo
            // "Chỉ xem món đã chọn" luôn là bảng từng món ⇒ nút sáng đúng thứ đang hiện.
            v={chiXemChon ? "mon" : xemTheo}
            onDoi={(v) => {
              setChiXemChon(false);
              setXemTheo(v);
            }}
          />
        }
        chonCot={<ChonCotBang b={laYc ? cotYc : cotMon} />}
      />

      {laYc ? (
        <BangYeuCau
          cot={cotYc}
          rows={sourceRows}
          loading={sourceLoading}
          loi={sourceError}
          onThuLai={loadSources}
          chonId={null}
          onChon={openCreatePurchaseRequest}
          // Chỉ yêu cầu còn Chờ lập đơn mới mở form được; dòng khác nhạt đi, không bấm.
          khoaDong={(row) => !canCreate || row.status !== "open"}
          coLoc={coLoc}
          onXoaLoc={xoaLoc}
          goiYTrong="Đơn mua hàng luôn bắt đầu từ một yêu cầu của bộ phận, chờ họ gửi sang."
          total={sourceTotal}
          page={sourcePage}
          size={sourceSize}
          onPage={setSourcePage}
          onSize={onSourceSize}
          chonMon={chonMon}
          onMoLenh={onMoLenh}
        />
      ) : (
        <BangMonYeuCau
          cot={cotMon}
          rows={chiXemChon ? daChon : mon.data?.items ?? []}
          loading={chiXemChon ? false : mon.loading}
          loi={chiXemChon ? null : mon.loi}
          onThuLai={mon.nap}
          coLoc={coLoc}
          onXoaLoc={xoaLoc}
          goiYTrong="Món trong các yêu cầu của bộ phận hiện ở đây, tick món chờ lập đơn để gom thành đơn mua."
          // Chỉ xem món đã chọn: một lượt, không phân trang.
          total={chiXemChon ? 0 : mon.data?.total ?? 0}
          page={monPage}
          size={sourceSize}
          onPage={setMonPage}
          onSize={onSourceSize}
          onMoYeuCau={openYcmh ? (r) => openYcmh(r.request_code) : undefined}
          chon={canCreate ? idChon : undefined}
          onDoi={canCreate ? doiMon : undefined}
          onChonTrang={canCreate ? chonTrang : undefined}
          onMoLenh={onMoLenh}
        />
      )}

      {canCreate && chon.size > 0 && (
        <div className="mh-noi" role="region" aria-label="Món đang chọn">
          <span>Đã chọn {chon.size} món</span>
          <span className="mh-tag">từ {soYeuCau} yêu cầu</span>
          <button type="button" className="mh-lk" aria-pressed={chiXemChon} onClick={() => setChiXemChon((v) => !v)}>
            {chiXemChon ? "Xem lại cả danh sách" : "Chỉ xem món đã chọn"}
          </button>
          <button type="button" className="mh-lk" onClick={() => setChon(new Map())}>
            Bỏ chọn
          </button>
          <button type="button" className="btn btn--primary" onClick={lapDon}>
            Lập đơn mua cho {chon.size} món
          </button>
        </div>
      )}
    </>
  );
}
