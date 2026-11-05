// Ngăn MỘT đơn của màn Theo dõi sản xuất — hai cột (phương án A, 13/10/2026, khuôn Moltin).
// Mockup: `docs/mockups/chi-tiet-lenh-theo-doi-3-phuong-an.html`.
//   Tổng quan — cột chính: bảng Mặt hàng (đặt, nhập kho từ lệnh, có hàng kèm phần từ tồn của mã, đã
//   giao); bấm một món bung các lệnh của món, mỗi lệnh một tuyến bước kèm làm ra trên kế hoạch và chỗ
//   vướng. Cột phải: Đơn, Đang vướng, Giao hàng.
//   Lịch sử — nhật ký cấp đơn (giao xưởng, bước xong, KCS, sự cố, kho nhận, giao hàng), thẻ mã lệnh.
//
// "Có hàng" tính cả tồn có sẵn của mã thành phẩm (mg 0394): đơn có lệnh làm hụt mà tồn phủ đủ thì
// KHÔNG thiếu — đừng dựng cột "Còn thiếu" từ số nhập kho của lệnh.
//
// ⚠️ CHỈ XEM, KHÔNG MỘT SỐ TIỀN NÀO.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { ApiError, api } from "../api/client";
import type { LenhSxChang, TdsxDonChiTiet, TdsxLenhCuaMon, TdsxMon, TdsxNhomMon, TdsxSuKienDon } from "../api/client";
import { useTat } from "../auth/permissions";
import { useAuth } from "../auth/useAuth";
import { ChipTT, LocNhanhTrangThai, ngayVN, soVN, type MauTT } from "../components/LuoiDs";
import { NganPhai } from "./ke-toan/shared/NganPhai";
import "./ke-toan/ke-toan.css";
import { LichSu, TuyenBuoc, buocTronGoi, gioNgan, ngayThang, type BuocDoc, type DongLichSu } from "./lsxRoutingDoc";
import { NHAN_VUONG, NHOM_MON, cauVuong, chipHan, dangO } from "./tdsxDon";

const MAU_NHOM_DON: Record<string, [string, MauTT]> = {
  dang_lam: ["Đang làm", "xanh"],
  cho_giao: ["Chờ giao", "ngoc"],
  da_giao: ["Đã giao đủ", "la"],
};

const MAU_NHOM_MON: Partial<Record<TdsxNhomMon, MauTT>> = { vuong: "do", dang: "xanh", chua: "slate", kho: "ngoc", giao: "la" };

/** Bước để vẽ của một lệnh: lệnh trọn gói là MỘT bước "Gia công trọn gói". */
function buocCuaLenh(l: TdsxLenhCuaMon): BuocDoc[] {
  return l.tron_goi ? [buocTronGoi(l.nha_gia_cong, l.xong)] : l.buoc_ds;
}

/** Bước ⇒ chấm của tuyến ngang (`TuyenBuoc`). */
function changCua(b: BuocDoc): LenhSxChang {
  return {
    ten: b.ten ?? "Bước", nhom: null, trang_thai: b.trang_thai, hien_tai: b.hien_tai,
    ngoai: b.ngoai, kcs_loi: b.kcs_khong_dat > 0,
  };
}

/** "Đang vướng" của một món: các cờ dịch ra lời, kèm bước đang kẹt nếu biết. */
function vuongMon(m: TdsxMon): string | null {
  if (m.co.length === 0) return null;
  const c = m.co[0];
  const buoc = m.lenh.find((l) => l.co.includes(c) && l.buoc)?.buoc;
  const dau = NHAN_VUONG[c] ?? c;
  const them = m.co.length > 1 ? ` và ${m.co.length - 1} việc khác` : "";
  return `${buoc ? `${dau} ở ${buoc}` : dau}${them}`;
}

/** Chữ trạng thái của một lệnh trong dòng bung: [chữ chính, chữ phụ]. */
function chuLenh(l: TdsxLenhCuaMon): [string, string | null] {
  if (!l.da_xuong) return ["Còn ở Kế hoạch sản xuất", null];
  // Trọn gói: tên nhà gia công đã nằm trên tuyến bước ngay dưới — đừng nói lần hai.
  if (l.tron_goi) return [l.xong ? "Đã nhận hàng gia công về" : "Đang gia công", null];
  if (l.xong) return [`${l.buoc_ds.length} bước đã xong`, null];
  if (l.buoc) return [`Đang ở ${l.buoc}`, l.buoc_so && l.buoc_tong ? `bước ${l.buoc_so} trên ${l.buoc_tong}` : null];
  return ["Đang sản xuất", null];
}

/** Câu KCS của máy chủ có số không đạt > 0. */
function kcsCoLoi(s: string): boolean {
  const m = /([\d.,]+) không đạt/.exec(s);
  return !!m && Number(m[1].replace(",", ".")) > 0;
}

function dongLichSu(ds: TdsxSuKienDon[], nhieuLenh: boolean): DongLichSu[] {
  return ds.map((e) => ({
    luc: e.luc,
    noi_dung: e.noi_dung,
    the: nhieuLenh ? e.lenh : null,
    mau:
      e.loai === "su_co" || (e.loai === "kcs" && kcsCoLoi(e.noi_dung)) || (e.loai === "giao" && e.noi_dung.endsWith("thất bại"))
        ? "do"
        : e.loai === "kho_nhan" || e.loai === "giao"
          ? "la"
          : null,
  }));
}

function O({ k, v, phu }: { k: ReactNode; v: ReactNode; phu?: (string | null | undefined)[] }) {
  const p = (phu ?? []).filter(Boolean) as string[];
  return (
    <div className="kt-ray__o">
      <dt>{k}</dt>
      <dd>
        {v}
        {p.map((x, i) => (
          <small key={i} className="lsa-phu">{x}</small>
        ))}
      </dd>
    </div>
  );
}

export function TdsxNganDon({
  orderId,
  onDong,
  len,
  xuong,
  eventTick,
  onMoLenh,
}: {
  orderId: number;
  onDong: () => void;
  len?: () => void;
  xuong?: () => void;
  /** Nhịp SSE ĐÃ GỘP của màn — tải lại ngăn lặng lẽ. */
  eventTick?: number;
  /** Có quyền xem Hồ sơ lệnh ⇒ mã lệnh bấm được sang đó. */
  onMoLenh?: (lsxId: number) => void;
}) {
  const { token } = useAuth();
  const tatGiao = useTat()("giao_hang");
  const [d, setD] = useState<TdsxDonChiTiet | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [nhom, setNhom] = useState<string>("tat_ca");
  const [mo, setMo] = useState<string | null>(null);
  const [tab, setTab] = useState("tong_quan");
  const daMoSan = useRef<number | null>(null);

  const nap = useCallback(() => {
    if (!token) return;
    api.theoDoiSanXuat
      .chiTietDon(token, orderId)
      .then((r) => {
        setD(r);
        setLoi(null);
        // Lần đầu mở đơn: đơn một món thì bung món đó, nhiều món thì bung món vướng đầu tiên.
        if (daMoSan.current !== orderId) {
          daMoSan.current = orderId;
          const dau = r.mon.length === 1 ? r.mon[0] : r.mon.find((m) => m.nhom === "vuong");
          setMo(dau ? dau.khoa : null);
        }
      })
      .catch((e) => {
        setLoi(
          e instanceof ApiError
            ? e.status === 404
              ? "Đơn này không còn trong danh sách theo dõi."
              : e.isForbidden
                ? "Đơn này ngoài phạm vi bạn được xem."
                : e.message
            : "Máy chủ không phản hồi.",
        );
      });
  }, [token, orderId]);

  // Đổi đơn (↑ ↓) ⇒ về chip Tất cả, xoá bản cũ để không vẽ nhầm đơn trước.
  useEffect(() => {
    setD(null);
    setNhom("tat_ca");
    nap();
  }, [nap]);

  const tickDau = useRef(eventTick);
  useEffect(() => {
    if (eventTick === tickDau.current) return;
    tickDau.current = eventTick;
    nap();
  }, [eventTick, nap]);

  const dem = useMemo(() => {
    const r: Record<string, number> = { tat_ca: d?.mon.length ?? 0 };
    for (const m of d?.mon ?? []) r[m.nhom] = (r[m.nhom] ?? 0) + 1;
    return r;
  }, [d]);

  const don = d?.don;
  const han = don ? chipHan(don) : null;
  const [nhanNhom, mauNhom] = MAU_NHOM_DON[don?.nhom ?? "dang_lam"];
  const mons = d?.mon ?? [];
  const monHien = mons.filter((m) => nhom === "tat_ca" || m.nhom === nhom);
  const soLenh = mons.reduce((s, m) => s + m.lenh.length, 0);
  const lichSu = d ? dongLichSu(d.lich_su, soLenh > 1) : [];

  // Đang vướng: trễ hạn (cấp đơn) + từng món vướng. Món đủ hàng máy chủ đã gỡ cờ.
  const vuong: { ten: string; phu: string | null }[] = [];
  if (don?.vuong?.ly_do === "tre") vuong.push({ ten: cauVuong(don) ?? "Trễ hạn giao", phu: null });
  for (const m of mons) {
    const v = vuongMon(m);
    if (v) vuong.push({ ten: v, phu: mons.length > 1 ? m.ten : null });
  }
  // Giao hàng: phần KHÔNG có trong bảng — đang giữ cho yêu cầu giao, chưa lên yêu cầu.
  const conGiao = mons.filter((m) => m.nhom !== "giao" && (m.dang_giu > 0 || m.con_phai_giao > 0));

  const bang = d && don && (
    <section className="lsa-the" aria-labelledby="tdsx-mh-h">
      <h3 className="lsa-the__h" id="tdsx-mh-h">
        Mặt hàng
        <span className="lsa-mu">
          {mons.length} mặt hàng {soLenh > 0 ? `và ${soLenh} lệnh` : "chưa có lệnh"}
        </span>
      </h3>
      {mons.length > 1 && (
        <LocNhanhTrangThai
          muc={NHOM_MON.filter((n) => n.key === "tat_ca" || (dem[n.key] ?? 0) > 0).map((n) => ({
            key: n.key,
            label: n.ten,
            count: dem[n.key] ?? 0,
            mau: n.key === "tat_ca" ? undefined : MAU_NHOM_MON[n.key],
          }))}
          dang={nhom}
          onChon={setNhom}
          ariaLabel="Lọc mặt hàng của đơn"
        />
      )}
      <div className="lsa-cuon">
        <table className="tdsx-mh lsa-mh">
          <caption className="sr-only">Mặt hàng của đơn {don.order_no}</caption>
          <colgroup>
            <col style={{ width: 24 }} />
            <col />
            <col style={{ width: 92 }} />
            <col style={{ width: 72 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 64 }} />
          </colgroup>
          <thead>
            <tr>
              <th aria-label="Bung lệnh" />
              <th>Mặt hàng</th>
              <th className="n">Đặt</th>
              <th className="n">Nhập kho</th>
              <th className="n">Có hàng</th>
              <th className="n">Đã giao</th>
            </tr>
          </thead>
          <tbody>
            {monHien.length === 0 ? (
              <tr>
                <td colSpan={6} className="tdsx-mu">Không có mặt hàng nào ở nhóm này.</td>
              </tr>
            ) : (
              monHien.map((m) => {
                const dangMo = mo === m.khoa;
                const [o1, o2] = dangO(m);
                const doi = () => setMo(dangMo ? null : m.khoa);
                const du = m.co_hang >= m.dat;
                return (
                  <Fragment key={m.khoa}>
                    <tr
                      className={`tdsx-mh__dong${dangMo ? " is-mo" : ""}`}
                      tabIndex={0}
                      aria-expanded={dangMo}
                      onClick={doi}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          doi();
                        }
                      }}
                    >
                      <td className="tdsx-mh__mui" aria-hidden="true">{dangMo ? "▾" : "▸"}</td>
                      <td className="tdsx-mh__ten" title={m.ten ?? undefined}>
                        {m.ten ?? "Chưa đặt tên"}
                        <span className={`tdsx-mh__phu lsa-manh${m.nhom === "vuong" ? " tdsx-do" : ""}`}>
                          <span>{o1}</span>
                          {o2 && <span className="tdsx-cach">{o2}</span>}
                        </span>
                      </td>
                      <td className="n">
                        {soVN(m.dat)}
                        {m.don_vi && <span className="lds-u">{m.don_vi}</span>}
                      </td>
                      <td className="n">{m.kho_da_nhan > 0 ? soVN(m.kho_da_nhan) : <span className="tdsx-mu">0</span>}</td>
                      <td className="n">
                        <span className={du ? undefined : "lsa-cam"}>{soVN(m.co_hang)}</span>
                        {m.co_tu_ton > 0 && <span className="tdsx-mh__phu">{soVN(m.co_tu_ton)} từ tồn của mã</span>}
                      </td>
                      <td className="n">{m.da_giao > 0 ? soVN(m.da_giao) : <span className="tdsx-mu">0</span>}</td>
                    </tr>
                    {dangMo && (
                      <tr className="tdsx-mh__bung">
                        <td />
                        <td colSpan={5}>
                          {m.lenh.length === 0 ? (
                            <p className="tdsx-mu">
                              {du ? "Mặt hàng lấy từ tồn của mã, không cần lệnh." : "Đơn đã chốt mặt hàng này nhưng xưởng chưa lên lệnh."}
                            </p>
                          ) : (
                            m.lenh.map((l) => {
                              const buoc = buocCuaLenh(l);
                              const hut = l.xong && l.lam_ra != null && l.ke_hoach_ra != null && l.lam_ra < l.ke_hoach_ra;
                              // Món đủ hàng thì lô lỗi / sự cố của lệnh không còn giữ món (cùng luật máy chủ).
                              const co = m.nhom === "kho" || m.nhom === "giao" ? [] : l.co.map((c) => NHAN_VUONG[c] ?? c);
                              const [c1, c2] = chuLenh(l);
                              return (
                                <div key={l.id} className="lsa-lenh">
                                  <div className="lsa-lenh__dau">
                                    {onMoLenh ? (
                                      <button type="button" className="lds-lk" onClick={() => onMoLenh(l.id)}>
                                        {l.ma}
                                      </button>
                                    ) : (
                                      <span>{l.ma}</span>
                                    )}
                                    {m.lenh.length > 1 && l.ten && <span>{l.ten}</span>}
                                    <span className="lsa-mu">{c1}</span>
                                    {c2 && <span className="lsa-mu">{c2}</span>}
                                    {l.lam_ra != null && l.ke_hoach_ra != null && (
                                      <span className="lsa-lenh__so">
                                        <span className={hut ? "lsa-cam" : undefined}>{soVN(l.lam_ra)}</span>
                                        <span className="lsa-mu"> / {soVN(l.ke_hoach_ra)} {l.don_vi_ra ?? ""}</span>
                                      </span>
                                    )}
                                  </div>
                                  {l.da_xuong && buoc.length > 0 && (
                                    <TuyenBuoc chang={buoc.map(changCua)} tronGoi={l.tron_goi} nhaGiaCong={l.nha_gia_cong} xong={l.xong} />
                                  )}
                                  {co.length > 0 && <p className="lsa-lenh__vuong">{co.join(" và ")}{l.buoc ? ` ở ${l.buoc}` : ""}</p>}
                                </div>
                              );
                            })
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );

  const cot = d && don && (
    <>
      <h3 className="kt-ngan__muc">Đơn</h3>
      <dl className="kt-ray">
        <O
          k="Hạn giao"
          v={
            don.han_giao ? (
              <>
                {ngayVN(don.han_giao)}
                {han && <span className={`tdsx-ngan__nho${han[1] === "do" ? " tdsx-do" : ""}`}>{han[0]}</span>}
              </>
            ) : (
              <span className="lsa-mu">Chưa hẹn</span>
            )
          }
        />
        {don.nhom === "dang_lam" && (
          <O k="Dự kiến xong" v={don.du_kien_xong ? ngayThang(don.du_kien_xong) : <span className="lsa-mu">Chưa ước được</span>} />
        )}
        {d.giao_xuong_luc && <O k="Giao xưởng" v={gioNgan(d.giao_xuong_luc)} />}
      </dl>

      {vuong.length > 0 && (
        <>
          <h3 className="kt-ngan__muc">Đang vướng</h3>
          <dl className="kt-ray">
            {vuong.map((v, i) => (
              <div key={i} className="kt-ray__o">
                <dd className="tdsx-do">
                  {v.ten}
                  {v.phu && <small className="lsa-phu">{v.phu}</small>}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {conGiao.length > 0 && (
        <>
          <h3 className="kt-ngan__muc">Giao hàng</h3>
          {conGiao.map((m) => (
            <Fragment key={m.khoa}>
              {mons.length > 1 && <p className="lsa-nho lsa-mu">{m.ten}</p>}
              <dl className="kt-ray">
                {m.dang_giu > 0 && <O k={tatGiao ? "Đang chờ kho xuất" : "Đang giữ cho yêu cầu giao"} v={`${soVN(m.dang_giu)} ${m.don_vi ?? ""}`} />}
                {m.con_phai_giao > 0 && <O k={tatGiao ? "Chưa xuất hàng" : "Chưa lên yêu cầu giao"} v={`${soVN(m.con_phai_giao)} ${m.don_vi ?? ""}`} />}
              </dl>
            </Fragment>
          ))}
        </>
      )}
    </>
  );

  return (
    <NganPhai
      duongDan="Theo dõi sản xuất"
      tieuDe={don?.order_no ?? "Đơn hàng"}
      the={don ? <ChipTT mau={mauNhom}>{nhanNhom}</ChipTT> : undefined}
      phuDe={
        don ? (
          <span className="tdsx-ngan__phu">
            {don.khach_hang && <span>{don.khach_hang}</span>}
            {don.phu_trach && <span>{don.phu_trach} phụ trách</span>}
          </span>
        ) : undefined
      }
      tabs={d ? [{ id: "tong_quan", nhan: "Tổng quan" }, { id: "lich_su", nhan: "Lịch sử", dem: lichSu.length }] : undefined}
      tab={tab}
      onTab={setTab}
      cot={tab === "tong_quan" && cot ? cot : undefined}
      len={len}
      xuong={xuong}
      onDong={onDong}
    >
      {loi && !d ? (
        <p className="tdsx-do">{loi}</p>
      ) : !d ? (
        <p className="tdsx-mu">Đang tải…</p>
      ) : tab === "lich_su" ? (
        <LichSu dong={lichSu} rong="Đơn chưa có việc nào được ghi." />
      ) : (
        bang
      )}
    </NganPhai>
  );
}
