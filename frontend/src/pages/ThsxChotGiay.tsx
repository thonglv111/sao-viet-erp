// Khối "Chờ chốt giấy" trên bàn tổ Cắt (spec dòng giấy theo đầu vào §3.0–3.3).
//
// Lệnh / bài ghép có giấy, sau phát hành, hiện ở đây: dòng giấy của bước LẤY giấy (mã · khổ · số),
// tồn ĐÚNG khổ và các lô cùng mã khác khổ để tổ tự xem — máy không kết luận. Tổ Cắt CHỈ thấy công
// đoạn Trước In của tổ mình: thêm (chèn ngay trước In) hoặc xoá được — kể cả bước người lập lệnh đặt
// sẵn. Chưa có công đoạn nào thì chọn "Không cần cắt". Lệnh chưa có bước cắt mà chưa chốt thì bước
// In bị khoá (cổng "chờ tổ Cắt"); lệnh đặt sẵn bước cắt thì không khoá gì.
//
// Nạp lại theo `eventTick` (SSE nhóm sản xuất, mắc ở AppShell): lệnh mới phát hành tự hiện, không
// bắt bấm tải lại. Màn xưởng: nút to, chữ to.
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type ChotGiayDong } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { Button } from "../components/Button";
import { Icon } from "../components/Icons";
import { ngay, ngayGio, num } from "./keHoachSxShared";
import { nhanDonVi } from "./lsxBuoc";
import { nhanKho } from "../lib/khoGiay";

export function ThsxChotGiay({
  teamId, eventTick, onDaGhi, ghiDuoc = true,
}: {
  teamId: number;
  eventTick?: number;
  /** Người xem có quyền Thực hiện TRỌN tổ (`quyen.run_order === "all"`) — chốt giấy không gắn việc
   *  của riêng ai nên mức "Của tôi" không đủ (máy chủ `gate_to` trả 403). Không có thì ẩn mọi nút
   *  ghi, chỉ để xem (lỗi #26). */
  ghiDuoc?: boolean;
  /** Thêm / xoá / chốt xong — bàn tổ nạp lại danh sách việc (bước cắt vừa thêm là việc của tổ này). */
  onDaGhi?: () => void;
}) {
  const { token } = useAuth();
  const [ds, setDs] = useState<ChotGiayDong[] | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chon, setChon] = useState<ChotGiayDong | null>(null);

  // `giuLoi`: nạp lại SAU một lần ghi hỏng — đừng xoá câu báo vừa đặt (lỗi #26: nút như chết).
  const nap = useCallback((giuLoi = false) => {
    if (!token) return;
    api.sanXuat.chotGiay.list(token, teamId)
      .then((r) => { setDs(r); if (!giuLoi) setLoi(null); })
      .catch((e) => setLoi(e instanceof ApiError ? e.message : "Không tải được danh sách chờ chốt giấy."));
  }, [token, teamId]);
  useEffect(() => { nap(); }, [nap, eventTick]);

  const ghi = async (f: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setLoi(null);
    try {
      await f();
      setChon(null);
      nap();
      onDaGhi?.();
    } catch (e) {
      setLoi(e instanceof ApiError ? e.message : "Không lưu được — thử lại.");
      nap(true);
    } finally {
      setBusy(false);
    }
  };
  const khoa = (d: ChotGiayDong) =>
    d.chu_the === "lsx" ? { lsx_id: d.id } : { bai_ghep_id: d.id };

  if (!ds || ds.length === 0) {
    return loi ? <div className="thsx-chot"><p className="thsx-chot__loi" role="alert">{loi}</p></div> : null;
  }
  const xacNhan = (d: ChotGiayDong) => !!d.chot || d.cau_hinh_san;
  const choChot = ds.filter((d) => !xacNhan(d)).length;

  return (
    <section className="thsx-chot" aria-label="Chờ chốt giấy">
      <div className="thsx-chot__h">
        <Icon name="scissors" size={16} />
        <span>Chờ chốt giấy</span>
        {choChot > 0 && <span className="thsx-chot__n thsx-num">{choChot}</span>}
      </div>
      {loi && <p className="thsx-chot__loi" role="alert">{loi}</p>}
      <ul className="thsx-chot__list">
        {ds.map((d) => (
          <li key={`${d.chu_the}${d.id}`} className={`thsx-chot__it${xacNhan(d) ? " is-da-chot" : ""}`}>
            <div className="thsx-chot__dau">
              <b className="thsx-chot__ma">{d.ma}</b>
              <span className="thsx-chot__ten">{d.chu_the === "bai" ? "Bài ghép " : ""}{d.ten}</span>
              {d.han && <span className="thsx-chot__han">Hạn {ngay(d.han)}</span>}
            </div>
            {d.giay.map((g, i) => (
              // Mỗi mẩu một ô, cách bằng khoảng trống — không nối bằng "·" (#68).
              <p key={i} className="thsx-chot__giay" style={{ display: "flex", flexWrap: "wrap", columnGap: 12 }}>
                <span>{g.ma}</span>
                <span>khổ {g.nhan_kho}</span>
                <span>cần <b className="thsx-num">{num(g.so_to)}</b> {nhanDonVi(g.don_vi)}</span>
                <span>
                  {g.ton_to_dung_kho == null
                    ? "chưa có khổ để so tồn"
                    : <>tồn đúng khổ <b className="thsx-num">{num(g.ton_to_dung_kho)}</b></>}
                </span>
              </p>
            ))}
            {(d.lo_cung_ma ?? []).length > 0 && (
              <p className="thsx-chot__cuon">
                Lô cùng mã khác khổ:
                {(d.lo_cung_ma ?? []).map((c) => (
                  <span key={c.ma_lo} style={{ display: "block" }}>
                    {`${c.ma_lo} khổ ${nhanKho(c.kho_rong, c.kho_dai)} còn ${num(c.sl_con_lai)} ${nhanDonVi(c.don_vi)} ở ${c.kho_ten}`}
                  </span>
                ))}
              </p>
            )}
            {d.chot?.cach === "khong_cat" ? (
              <div className="thsx-chot__act">
                <span className="thsx-chot__nhan">
                  <Icon name="check" size={15} /> Đã chốt: không cắt
                  {d.chot.boi_ten ? ` bởi ${d.chot.boi_ten}` : ""}
                  {d.chot.luc ? ` lúc ${ngayGio(d.chot.luc)}` : ""}
                </span>
                {ghiDuoc && d.sua_duoc && (
                  <Button variant="ghost" disabled={busy}
                    onClick={() => ghi(() => api.sanXuat.chotGiay.go(token!, { team_id: teamId, ...khoa(d) }))}>
                    Gỡ chốt
                  </Button>
                )}
              </div>
            ) : (
              <>
                {d.buoc_truoc_in.length === 0 ? (
                  <p className="thsx-chot__trong">Chưa có công đoạn cắt</p>
                ) : (
                  <div className="thsx-chot__buoc">
                    <span className="thsx-chot__buoc-h">
                      Công đoạn trước In
                      {d.cau_hinh_san ? " (đặt sẵn trong lệnh)" : ""}
                      {d.chot?.cach === "cat" && d.chot.boi_ten ? ` chốt bởi ${d.chot.boi_ten}` : ""}
                      {d.chot?.cach === "cat" && d.chot.luc ? ` lúc ${ngayGio(d.chot.luc)}` : ""}
                    </span>
                    <ol className="thsx-chot__buoc-ds">
                      {d.buoc_truoc_in.map((b, i) => (
                        <li key={b.buoc_id}>
                          <span className="thsx-chot__buoc-ten">{i + 1}. {b.ten}</span>
                          {!ghiDuoc ? null : b.xoa_duoc ? (
                            <Button variant="ghost" disabled={busy}
                              aria-label={`Xoá công đoạn ${b.ten} của ${d.ma}`}
                              onClick={() => ghi(() => api.sanXuat.chotGiay.xoa(token!, {
                                team_id: teamId, ...khoa(d), buoc_id: b.buoc_id,
                              }))}>
                              Xoá
                            </Button>
                          ) : (
                            <span className="thsx-chot__buoc-khoa" title="Bước đã bắt đầu — không xoá được">
                              Đã bắt đầu
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                <div className="thsx-chot__act">
                  {ghiDuoc && d.sua_duoc && (
                    <Button variant={d.buoc_truoc_in.length === 0 ? "accent" : "secondary"}
                      disabled={busy || d.cong_doan_chen_duoc.length === 0}
                      title={d.cong_doan_chen_duoc.length === 0
                        ? "Chưa có công đoạn Giai đoạn Trước In nào giao cho tổ này trong danh mục Công đoạn"
                        : undefined}
                      onClick={() => setChon(d)}>
                      <Icon name="plus" size={15} /> Thêm công đoạn
                    </Button>
                  )}
                  {ghiDuoc && d.buoc_truoc_in.length === 0 && (
                    <Button variant="secondary" disabled={busy}
                      onClick={() => ghi(() => api.sanXuat.chotGiay.chot(token!, {
                        team_id: teamId, ...khoa(d), cach: "khong_cat",
                      }))}>
                      Không cần cắt
                    </Button>
                  )}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {chon && (
        <HopChenCat
          dong={chon} busy={busy}
          onDong={() => setChon(null)}
          onChen={(ids) => ghi(() => api.sanXuat.chotGiay.them(token!, {
            team_id: teamId, ...khoa(chon), cong_doan_ids: ids,
          }))}
        />
      )}
    </section>
  );
}

/** Hộp "Thêm công đoạn": chỉ công đoạn Trước In của tổ; tick nhiều, lên/xuống để sắp thứ tự chạy. */
function HopChenCat({
  dong, busy, onDong, onChen,
}: {
  dong: ChotGiayDong;
  busy: boolean;
  onDong: () => void;
  onChen: (ids: number[]) => void;
}) {
  const [thuTu, setThuTu] = useState<number[]>([]);
  const ten = new Map(dong.cong_doan_chen_duoc.map((c) => [c.id, c.ten]));
  const doi = (id: number) =>
    setThuTu((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const doiCho = (i: number, j: number) =>
    setThuTu((t) => {
      if (j < 0 || j >= t.length) return t;
      const n = [...t];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onDong(); } };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onDong]);

  return (
    <div className="thsx-chot__scrim" role="presentation" onClick={onDong}>
      <div className="thsx-chot__hop" role="dialog" aria-modal="true"
        aria-label={`Thêm công đoạn trước In cho ${dong.ma}`} onClick={(e) => e.stopPropagation()}>
        <h3 className="thsx-chot__hop-h">Thêm công đoạn · {dong.ma}</h3>
        <p className="thsx-chot__hop-mo">Công đoạn chèn vào ngay trước In, chạy theo thứ tự tick — sắp lại bằng nút lên/xuống.</p>
        <ul className="thsx-chot__cd">
          {dong.cong_doan_chen_duoc.map((c) => (
            <li key={c.id}>
              <label className="thsx-chot__cd-o">
                <input type="checkbox" checked={thuTu.includes(c.id)} onChange={() => doi(c.id)} />
                <span>{c.ten}</span>
                <span className="thsx-chot__cd-ma">{c.ma}</span>
              </label>
            </li>
          ))}
        </ul>
        {thuTu.length > 0 && (
          <ol className="thsx-chot__thu-tu" aria-label="Thứ tự chạy">
            {thuTu.map((id, i) => (
              <li key={id}>
                <span>{i + 1}. {ten.get(id)}</span>
                <button type="button" className="thsx-chot__mui" aria-label={`Đưa ${ten.get(id)} lên`}
                  disabled={i === 0} onClick={() => doiCho(i, i - 1)}>▲</button>
                <button type="button" className="thsx-chot__mui" aria-label={`Đưa ${ten.get(id)} xuống`}
                  disabled={i === thuTu.length - 1} onClick={() => doiCho(i, i + 1)}>▼</button>
              </li>
            ))}
          </ol>
        )}
        <div className="thsx-chot__act">
          <Button variant="ghost" onClick={onDong} disabled={busy}>Huỷ</Button>
          <Button variant="accent" disabled={busy || thuTu.length === 0} onClick={() => onChen(thuTu)}>
            <Icon name="plus" size={15} /> Thêm
          </Button>
        </div>
      </div>
    </div>
  );
}
