// Chế độ "Xem theo: TỪNG MÓN" của Yêu cầu mua hàng (phương án 3, 07/10/2026): mỗi món một dòng, kèm
// đơn mua đang giữ nó và tiến độ năm nấc. Dùng chung cho màn Yêu cầu mua hàng và Mua hàng › Yêu cầu
// chờ xử lý. Thu mua tick các món Chờ lập đơn (của MỘT hay NHIỀU yêu cầu, 08/10/2026) rồi bấm "Lập
// đơn mua" ở thanh nổi của màn cha. Lựa chọn sống ở màn cha để còn qua sang trang, đổi chế độ xem.
// Máy chủ chốt món nào tick được (`chon_duoc`).
// Khuôn lưới `lds` (08/10/2026): cột do màn cha giữ (`useCotBang`), mỗi màn một khoá nhớ.
import { useEffect, useRef } from "react";
import type { MuaChoLenh, YeuCauMonRow } from "../../../api/client";
import { CuonLuoi, rongLuoi, soCotGhim, soVN } from "../../../components/LuoiDs";
import { PhanTrangDayDu } from "../../../components/PhanTrangDayDu";
import { fmtDateTime } from "../../../utils/format";
import { tenDonVi } from "../../tenDonVi";
import { OMuaCho } from "../mua-cho/OMuaCho";
import { ChipNhan, DongRong, type CotBang, type CotMH } from "../luoi-mua-hang";
import { NacTienDo, TT_MON } from "../trang-thai-mua";
import { OCanHang } from "./BangYeuCau";
import "../trang-thai-mua.css";

/** Cột của lưới Từng món. `chon` chỉ hiện khi có món tick được (hoặc đang có món đã tick). */
export const COT_MON: CotMH[] = [
  { key: "chon", label: "Chọn", coDinh: true, w: 40 },
  { key: "vat_tu", label: "Vật tư", coDinh: true, w: 260 },
  { key: "yc", label: "Yêu cầu", w: 150 },
  { key: "nv", label: "NV yêu cầu", w: 160 },
  { key: "can", label: "Cần hàng", w: 200 },
  { key: "kho", label: "Khổ", w: 120 },
  { key: "sl", label: "Số lượng", w: 110, n: true },
  { key: "mua_cho", label: "Mua cho", w: 160 },
  { key: "don", label: "Đơn mua", w: 150 },
  { key: "tien_do", label: "Tiến độ", w: 100 },
  { key: "tt", label: "Tình trạng" },
];

function khoMon(r: YeuCauMonRow) {
  if (r.hang_loai !== "giay") return <span className="lds-mu3">Không theo khổ</span>;
  if (r.kho_rong > 0 && r.kho_dai > 0) return `${r.kho_rong} × ${r.kho_dai} mm`;
  if (r.kho_rong > 0) return `khổ ${r.kho_rong} mm`;
  return <span className="lds-mu3">Không ghi khổ</span>;
}

/** Chú thích của mã yêu cầu: nội dung, bộ phận và người yêu cầu, ngày tạo. */
function chuThich(r: YeuCauMonRow): string {
  const nguoi = [r.requesting_department_name || "Nội bộ", r.requested_by_name].filter(Boolean).join(", ");
  return [r.content, nguoi, `Tạo ${fmtDateTime(r.created_at)}`].filter(Boolean).join("\n");
}

export function BangMonYeuCau({
  cot,
  rows,
  loading,
  loi,
  onThuLai,
  coLoc,
  onXoaLoc,
  goiYTrong,
  total,
  page,
  size,
  onPage,
  onSize,
  onMoYeuCau,
  chon,
  onDoi,
  onChonTrang,
  onMoLenh,
}: {
  cot: CotBang;
  rows: YeuCauMonRow[];
  loading: boolean;
  loi: string | null;
  onThuLai: () => void;
  coLoc: boolean;
  onXoaLoc: () => void;
  goiYTrong: string;
  total: number;
  page: number;
  size: number;
  onPage: (p: number) => void;
  onSize: (n: number) => void;
  /** Bấm mã yêu cầu — mở yêu cầu đó. */
  onMoYeuCau?: (r: YeuCauMonRow) => void;
  /** Món đang chọn (id dòng). Thiếu `onDoi` = không có quyền lập đơn ⇒ không có ô chọn. */
  chon?: ReadonlySet<number>;
  onDoi?: (r: YeuCauMonRow) => void;
  /** Ô đầu cột: chọn / bỏ mọi món tick được của trang. */
  onChonTrang?: (rows: YeuCauMonRow[], bat: boolean) => void;
  onMoLenh?: (l: MuaChoLenh) => void;
}) {
  const chonDuoc = onDoi ? rows.filter((r) => r.chon_duoc) : [];
  const coOChon = chonDuoc.length > 0 || (!!onDoi && rows.some((r) => chon?.has(r.line_id)));
  const cotHien = cot.hien.filter((c) => c.key !== "chon" || coOChon);
  const soDangChon = chonDuoc.filter((r) => chon?.has(r.line_id)).length;
  const oDau = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (oDau.current) oDau.current.indeterminate = soDangChon > 0 && soDangChon < chonDuoc.length;
  }, [soDangChon, chonDuoc.length]);

  return (
    <div className="lds-sheet">
      <CuonLuoi ghim={soCotGhim(cotHien, cot.luoi?.ghim)}>
        <table className="lds-g" style={{ minWidth: rongLuoi(cotHien) }}>
          <colgroup>
            {cotHien.map((c) => (
              <col key={c.key} style={c.w ? { width: c.w } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {cotHien.map((c) =>
                c.key === "chon" ? (
                  <th key={c.key} className="mh-o-cot">
                    {chonDuoc.length > 0 && onChonTrang && (
                      <input
                        ref={oDau}
                        type="checkbox"
                        className="lds-cb"
                        checked={soDangChon > 0 && soDangChon === chonDuoc.length}
                        aria-label="Chọn mọi món chờ lập đơn của trang"
                        onChange={() => onChonTrang(chonDuoc, soDangChon < chonDuoc.length)}
                      />
                    )}
                  </th>
                ) : (
                  <th key={c.key} className={c.n ? "n" : undefined}>
                    {c.label}
                    {cot.luoi?.keo(c.key)}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {(loading && rows.length === 0) || loi || rows.length === 0 ? (
              <DongRong
                soCot={cotHien.length}
                dangTai={loading && rows.length === 0}
                loi={loi}
                onThuLai={onThuLai}
                chuaCo="Chưa có món nào."
                khongKhop="Không có món nào khớp điều kiện đang lọc."
                coLoc={coLoc}
                onXoaLoc={onXoaLoc}
                goiY={goiYTrong}
              />
            ) : (
              rows.map((r) => {
                const dang = !!chon?.has(r.line_id);
                const bam = r.chon_duoc && !!onDoi;
                const huy = r.tinh_trang === "huy";
                const dv = tenDonVi(r.unit) ?? r.unit;
                // Về một phần: phần trăm như bảng Đơn mua ("Về một phần 40%"); số đủ nằm ở chú thích.
                let phu: { chu: string; title: string } | null = null;
                if (r.tinh_trang === "mot_phan" && r.received_quantity != null && r.ordered_quantity) {
                  phu = {
                    chu: `${Math.min(99, Math.round((r.received_quantity / r.ordered_quantity) * 100))}%`,
                    title: `Về ${soVN(r.received_quantity)} trên ${soVN(r.ordered_quantity)} ${dv}`,
                  };
                }
                return (
                  <tr
                    key={r.line_id}
                    className={`lds-dong${bam ? "" : " mh-khoa"}${dang ? " is-tick" : ""}${huy ? " mh-cu" : ""}`}
                    tabIndex={bam ? 0 : undefined}
                    onClick={bam ? () => onDoi?.(r) : undefined}
                    onKeyDown={
                      bam
                        ? (e) => {
                            if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                              e.preventDefault();
                              onDoi?.(r);
                            }
                          }
                        : undefined
                    }
                    title={huy && r.cancel_reason ? `Lý do huỷ: ${r.cancel_reason}` : r.note ?? undefined}
                  >
                    {cotHien.map((c) => {
                      switch (c.key) {
                        case "chon":
                          return (
                            <td key={c.key} className="mh-o-cot" onClick={(e) => e.stopPropagation()}>
                              {(r.chon_duoc || dang) && (
                                <input
                                  type="checkbox"
                                  className="lds-cb"
                                  checked={dang}
                                  aria-label={`Chọn ${r.item_name}`}
                                  onChange={() => onDoi?.(r)}
                                />
                              )}
                            </td>
                          );
                        case "vat_tu":
                          return (
                            <td key={c.key} title={r.note ? `${r.item_name}\n${r.note}` : r.item_name}>
                              {r.item_name}
                              {r.note && <span className="lds-mu" style={{ marginLeft: 8 }}>{r.note}</span>}
                            </td>
                          );
                        case "yc":
                          return (
                            <td key={c.key} onClick={(e) => e.stopPropagation()}>
                              {onMoYeuCau ? (
                                <button type="button" className="lds-lk" onClick={() => onMoYeuCau(r)} title={chuThich(r)}>
                                  {r.request_code}
                                </button>
                              ) : (
                                <span title={chuThich(r)}>{r.request_code}</span>
                              )}
                            </td>
                          );
                        case "nv":
                          return (
                            <td key={c.key} title={r.requesting_department_name ?? undefined}>
                              {r.requested_by_name || <span className="lds-mu3">Không rõ</span>}
                            </td>
                          );
                        case "can":
                          return (
                            <td key={c.key}>
                              <OCanHang ngay={r.needed_date} xong={huy || r.tinh_trang === "nhap_kho" || r.tinh_trang === "du"} />
                            </td>
                          );
                        case "kho":
                          return <td key={c.key}>{khoMon(r)}</td>;
                        case "sl":
                          return (
                            <td key={c.key} className="n">
                              {soVN(r.quantity)}
                              <span className="lds-u">{dv}</span>
                            </td>
                          );
                        case "mua_cho":
                          return (
                            <td key={c.key} onClick={(e) => e.stopPropagation()}>
                              <OMuaCho loai={[r.loai_mua]} lenh={r.mua_cho} donVi={dv} onMoLenh={onMoLenh} />
                            </td>
                          );
                        case "don":
                          return (
                            <td key={c.key} title={r.supplier_name ?? undefined}>
                              {r.purchase_code || <span className="lds-mu3">Chưa có</span>}
                            </td>
                          );
                        case "tien_do":
                          return <td key={c.key}>{!huy && <NacTienDo n={r.tien_do} />}</td>;
                        case "tt":
                          return (
                            <td key={c.key}>
                              <ChipNhan nhan={TT_MON[r.tinh_trang]} />
                              {phu && <span className="lds-mu" style={{ marginLeft: 6 }} title={phu.title}>{phu.chu}</span>}
                            </td>
                          );
                        default:
                          return <td key={c.key} />;
                      }
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </CuonLuoi>
      {total > 0 && (
        <PhanTrangDayDu
          trang={page}
          size={size}
          tong={total}
          soDong={rows.length}
          onTrang={onPage}
          onSize={onSize}
          loading={loading}
          donVi="món"
          ariaLabel="Phân trang món yêu cầu"
        />
      )}
    </div>
  );
}
