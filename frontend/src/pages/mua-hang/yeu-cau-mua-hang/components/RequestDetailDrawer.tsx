// Ngăn CHI TIẾT yêu cầu mua hàng — bản A (docs/mockups/mua-hang-phuong-an-A.html màn A3, chốt
// 07/10/2026). Khuôn trang đơn của Shopify: MỘT bảng dòng hàng, mỗi món một hàng đủ chuỗi yêu cầu
// → đơn mua → đã đặt → đã về → tình trạng. Món chưa có đơn đứng đầu (việc của Thu mua).
// Vỏ `NganPhai` (độ rộng chung, kéo mép, tab Lịch sử). `user` lấy thẳng bằng `useAuth()`.
import type { Dispatch, SetStateAction } from "react";
import type { DepartmentPurchaseRequestLineOut, DepartmentPurchaseRequestRow, MuaChoLenh } from "../../../../api/client";
import { useAuth } from "../../../../auth/useAuth";
import { Button } from "../../../../components/Button";
import { Icon } from "../../../../components/Icons";
import { StatusHistoryTimeline } from "../../../../components/StatusHistoryTimeline";
import { fmtDate } from "../../../../utils/format";
import { chuanKho, nhanKho } from "../../../../lib/khoGiay";
import { NganPhai } from "../../../ke-toan/shared/NganPhai";
// Đơn vị lưu bằng MÃ (`cai`), tên hiển thị ("cái") nằm ở danh mục Đơn vị — xem pages/tenDonVi.ts.
import { tenDonVi } from "../../../tenDonVi";
import { OMuaCho, khoaMuaCho } from "../../mua-cho/OMuaCho";
import { coDonSong, dongSong, noiDung } from "../shared/helpers";
import type { BoMonState } from "../shared/types";
import { SourceStatusBadge, StatusBadgePhieu } from "./requestCells";
import "../../../ke-toan/ke-toan.css";
import "../../../kho-ngan-a.css";
import "./yc-ds-a.css";
import "./yc-form-a.css";

type TabChiTiet = "items" | "orders" | "history";

const so = (n: number) => n.toLocaleString("vi-VN");

function conNgay(ngay: string): number {
  const d = new Date(`${ngay.slice(0, 10)}T00:00:00`);
  const h = new Date();
  h.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - h.getTime()) / 86_400_000);
}

/** Khổ của dòng giấy ("780 × 905 mm", chỉ rộng "khổ 1000 mm") — "" khi không có. */
function khoDong(line: DepartmentPurchaseRequestLineOut): string {
  if (line.hang_loai !== "giay" || !line.kho_rong) return "";
  const [r, d] = chuanKho(line.kho_rong, line.kho_dai);
  return nhanKho(r, d);
}

export function RequestDetailDrawer({
  selected,
  setSelectedId,
  drawerTab,
  setDrawerTab,
  boMonDuoc,
  setBoMon,
  canAdminCancel,
  canUpdate,
  openEdit,
  setCanceling,
  onLapDon,
  onMoLenh,
}: {
  selected: DepartmentPurchaseRequestRow;
  setSelectedId: Dispatch<SetStateAction<number | null>>;
  drawerTab: TabChiTiet;
  setDrawerTab: Dispatch<SetStateAction<TabChiTiet>>;
  boMonDuoc: boolean;
  setBoMon: Dispatch<SetStateAction<BoMonState | null>>;
  canAdminCancel: boolean;
  canUpdate: boolean;
  openEdit: (row: DepartmentPurchaseRequestRow) => void;
  setCanceling: Dispatch<SetStateAction<DepartmentPurchaseRequestRow | null>>;
  /** Có quyền lập đơn mua — nhảy sang màn Mua hàng mở sẵn form cho yêu cầu này. */
  onLapDon?: (code: string) => void;
  onMoLenh?: (l: MuaChoLenh) => void;
}) {
  const { user } = useAuth();
  const song = dongSong(selected);
  const coDon = song.filter(coDonSong).length;
  const chuaDon = song.length - coDon;
  // Món chưa có đơn lên đầu, món đã vào đơn xếp theo mã đơn, món đã bỏ xuống cuối.
  // Khổ + Định lượng là cột riêng, chỉ bày khi yêu cầu có dòng giấy (spec 2026-10-24 §6).
  const coGiay = selected.lines.some((l) => l.hang_loai === "giay");
  const dong = [...selected.lines].sort((a, b) => {
    const hang = (l: DepartmentPurchaseRequestLineOut) => (l.cancelled_at ? 2 : l.fulfilment ? 1 : 0);
    return hang(a) - hang(b) || (a.fulfilment?.purchase_code ?? "").localeCompare(b.fulfilment?.purchase_code ?? "");
  });
  const giaTri = song.reduce((s, l) => s + (l.line_total || 0), 0);
  const laChu = canUpdate && selected.requested_by_user_id === user?.id;
  const moHuy = selected.status === "open" && (canAdminCancel || laChu);
  const n = conNgay(selected.needed_date);
  const xong = selected.status === "done" || selected.status === "cancelled";

  // Món trong từng đơn mua — tab Đơn mua.
  const monTheoDon = new Map<string, string[]>();
  for (const l of song) {
    if (!l.fulfilment) continue;
    const ds = monTheoDon.get(l.fulfilment.purchase_code) ?? [];
    ds.push(l.item_name);
    monTheoDon.set(l.fulfilment.purchase_code, ds);
  }
  // Chip lệnh dưới từng món chỉ khi các món mua cho NHỮNG LỆNH KHÁC NHAU; cùng lệnh thì mục "Mua cho"
  // ở đầu ngăn đã nói (mỗi thông tin nói một lần).
  const lenhTungMon =
    selected.loai_mua === "cho_lsx" && new Set(song.map((l) => khoaMuaCho(null, l.mua_cho))).size > 1;

  const hanhDong = (
    <>
      {laChu && selected.status === "open" && (
        <Button variant="ghost" onClick={() => openEdit(selected)}>
          <Icon name="edit" size={14} /> Sửa
        </Button>
      )}
      {moHuy && (
        <Button variant="ghost" onClick={() => setCanceling(selected)}>
          <Icon name="ban" size={14} /> Huỷ yêu cầu
        </Button>
      )}
      {onLapDon && selected.status === "open" && chuaDon > 0 && (
        <Button variant="accent" onClick={() => onLapDon(selected.code)}>
          <Icon name="cart" size={14} /> Lập đơn mua cho {chuaDon} món
        </Button>
      )}
    </>
  );

  return (
    <NganPhai
      duongDan="Yêu cầu mua hàng"
      tieuDe={selected.code}
      the={<SourceStatusBadge status={selected.workflow_status} />}
      hanhDong={hanhDong}
      phuDe={noiDung(selected) ? <span className="ycd-ten">{noiDung(selected)}</span> : undefined}
      tomTat={[
        {
          nhan: "NV yêu cầu",
          giaTri: (
            <span className="ycd-phu" style={{ marginTop: 0, fontSize: "inherit", color: "inherit" }}>
              <span>{selected.requested_by_name || "Nội bộ"}</span>
              <span className="ycd-tag">{selected.requesting_department_name || "Nội bộ"}</span>
            </span>
          ),
        },
        {
          nhan: "Mua cho",
          giaTri: <OMuaCho loai={[selected.loai_mua]} lenh={selected.mua_cho} onMoLenh={onMoLenh} />,
        },
        {
          nhan: "Ngày cần hàng",
          giaTri: (
            <>
              {fmtDate(selected.needed_date)}{" "}
              {!xong && (
                <span className={n < 0 ? "ycd-do" : n <= 5 ? "ycd-vang" : "kna-mo"} style={{ fontWeight: 400 }}>
                  {n < 0 ? `quá ${-n} ngày` : n === 0 ? "cần hôm nay" : `còn ${n} ngày`}
                </span>
              )}
            </>
          ),
        },
        {
          nhan: "Đã có đơn mua",
          giaTri: song.length ? (
            <>
              {coDon} trên {song.length} món
              <div className="ycd-thanh"><i style={{ width: `${(coDon / song.length) * 100}%` }} /></div>
            </>
          ) : "Không còn món",
        },
        { nhan: "Giá trị ước tính", giaTri: giaTri > 0 ? `${so(giaTri)} đ` : <span className="kna-mo">Chưa có giá</span> },
      ]}
      canhBao={
        selected.reject_reason ? (
          <div className="kt-canh">Lý do từ chối hoặc huỷ: {selected.reject_reason}</div>
        ) : undefined
      }
      tabs={[
        { id: "items", nhan: "Vật tư", dem: song.length },
        { id: "orders", nhan: "Đơn mua", dem: selected.purchase_requests.length },
        { id: "history", nhan: "Lịch sử", dem: selected.status_history?.length || 0 },
      ]}
      tab={drawerTab}
      onTab={(id) => setDrawerTab(id as TabChiTiet)}
      onDong={() => setSelectedId(null)}
    >
      <div className="kna">
        {drawerTab === "items" && (
          <div className="lds-bang">
            <table className="lds-g">
              <colgroup>
                <col />
                {coGiay && <col style={{ width: 120 }} />}
                {coGiay && <col style={{ width: 96 }} />}
                <col style={{ width: 130 }} />
                <col style={{ width: 230 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 180 }} />
                {boMonDuoc && <col style={{ width: 48 }} />}
              </colgroup>
              <thead>
                <tr>
                  <th>Vật tư</th>
                  {coGiay && <th>Khổ</th>}
                  {coGiay && <th className="n">Định lượng</th>}
                  <th className="n">Yêu cầu</th>
                  <th>Đơn mua</th>
                  <th className="n">Đã đặt</th>
                  <th className="n">Đã về</th>
                  <th>Tình trạng</th>
                  {boMonDuoc && <th />}
                </tr>
              </thead>
              <tbody>
                {dong.map((line) => {
                  const f = line.fulfilment;
                  const kho = khoDong(line);
                  const nhan = f ? (f.received_quantity ?? (f.purchase_status === "received" ? f.ordered_quantity : 0)) : 0;
                  const dv = (ma: string) => tenDonVi(ma) ?? ma;
                  return (
                    <tr key={line.id} className={line.cancelled_at ? "ycd-bo" : undefined}>
                      <td>
                        <div>{line.item_name}</div>
                        {(line.note || line.cancelled_at || (lenhTungMon && line.mua_cho.length > 0)) && (
                          <div className="ycd-phu">
                            {lenhTungMon && line.mua_cho.length > 0 && (
                              <OMuaCho loai={["cho_lsx"]} lenh={line.mua_cho} donVi={dv(line.unit)} onMoLenh={onMoLenh} />
                            )}
                            {line.note && <span>{line.note}</span>}
                            {line.cancelled_at && (
                              <span>
                                Đã bỏ {fmtDate(line.cancelled_at)}
                                {line.cancelled_by_name ? ` bởi ${line.cancelled_by_name}` : ""}
                                {line.cancel_reason ? `: ${line.cancel_reason}` : ""}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      {coGiay && <td>{kho || <span className="lds-mu">–</span>}</td>}
                      {coGiay && (
                        <td className="n">{line.hang_loai === "giay" ? (line.dinh_luong ?? "–") : ""}</td>
                      )}
                      <td className="n">
                        {so(line.quantity)}<span className="lds-u">{dv(line.unit)}</span>
                      </td>
                      <td>
                        {f ? (
                          <>
                            <div>{f.purchase_code}</div>
                            {f.supplier_name && <div className="ycd-phu">{f.supplier_name}</div>}
                          </>
                        ) : line.cancelled_at ? null : selected.purchase_requests.length > 0 ? (
                          <span className="lds-mu">Chưa rõ, phiếu lập trước khi ghi theo dòng</span>
                        ) : (
                          <span className="lds-mu">Chưa có</span>
                        )}
                      </td>
                      <td className="n">
                        {f ? (
                          <>{so(f.ordered_quantity)}<span className="lds-u">{dv(f.ordered_unit)}</span></>
                        ) : !line.cancelled_at && <span className="lds-mu">Chưa đặt</span>}
                      </td>
                      <td className="n">
                        {f && (
                          <span className={nhan < f.ordered_quantity && f.purchase_status === "received" ? "ycd-do" : nhan ? "" : "lds-mu"}>
                            {so(nhan)}
                          </span>
                        )}
                      </td>
                      <td>
                        {line.cancelled_at ? (
                          <span className="purchase__status purchase__status--cancelled">Đã bỏ</span>
                        ) : f ? (
                          <>
                            <StatusBadgePhieu status={f.purchase_status} />
                            {f.purchase_status === "partially_received" && nhan < f.ordered_quantity && (
                              <div className="ycd-phu">Còn {so(f.ordered_quantity - nhan)} {dv(f.ordered_unit)} chưa về</div>
                            )}
                            {f.purchase_status === "received" && nhan < f.ordered_quantity && (
                              <div className="ycd-phu ycd-do">Giao thiếu so với số đặt</div>
                            )}
                            {f.purchase_status === "rejected" && (
                              <div className="ycd-phu ycd-do">Cần lập đơn lại cho món này</div>
                            )}
                          </>
                        ) : (
                          <span className="purchase__status purchase__status--draft">Chờ lập đơn</span>
                        )}
                      </td>
                      {boMonDuoc && (
                        <td className="c ycd-nut">
                          {!line.cancelled_at && (
                            <button
                              type="button"
                              className="ycf-xoa"
                              disabled={!line.can_cancel}
                              title={line.can_cancel ? "Bỏ món này" : (line.cancel_block_reason ?? "Không bỏ được món này")}
                              aria-label={`Bỏ ${line.item_name}`}
                              onClick={() => setBoMon({ line, reason: "", error: null })}
                            >
                              <Icon name="ban" size={14} />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {drawerTab === "orders" && (
          selected.purchase_requests.length === 0 ? (
            <section className="kna-the kna-the--cat">
              <div className="kna-the__than kna-mo">Chưa có đơn mua nào cho yêu cầu này.</div>
            </section>
          ) : (
            <div className="lds-bang">
              <table className="lds-g">
                <colgroup>
                  <col style={{ width: 180 }} />
                  <col />
                  <col />
                  <col style={{ width: 160 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Mã đơn</th>
                    <th>Nhà cung cấp</th>
                    <th>Món của yêu cầu này</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.purchase_requests.map((p) => {
                    const mon = monTheoDon.get(p.code) ?? [];
                    return (
                      <tr key={p.id}>
                        <td>{p.code}</td>
                        <td>{p.supplier_name || <span className="lds-mu">Chưa chọn</span>}</td>
                        <td>
                          {mon.length ? (
                            <div className="ycd-phu" style={{ color: "var(--ink)", fontSize: "inherit", marginTop: 0 }}>
                              {mon.map((t) => <span key={t}>{t}</span>)}
                            </div>
                          ) : <span className="lds-mu">Chưa rõ</span>}
                        </td>
                        <td>
                          <StatusBadgePhieu status={p.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}

        {drawerTab === "history" && (
          <section className="kna-the">
            <div className="kna-the__than">
              <StatusHistoryTimeline items={selected.status_history} />
            </div>
          </section>
        )}
      </div>
    </NganPhai>
  );
}
