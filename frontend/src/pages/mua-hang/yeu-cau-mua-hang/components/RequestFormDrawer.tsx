// Ngăn TẠO / SỬA yêu cầu mua hàng — phương án 3 (07/10/2026, docs/mockups/mua-hang-gon-3-phuong-an.html
// mục 2 của phương án 3). Như một trang tính:
//
//   - Ngày cần + mục đích lên MỘT hàng ở đầu form, như dòng tiêu đề của bảng tính; người yêu cầu, bộ
//     phận lấy từ tài khoản (không có ô gõ tên).
//   - Bảng món trải hết bề ngang: Vật tư | Khổ | Tồn khổ này | Số lượng mua | Ghi chú. Kho và mua hàng
//     giấy tờ chỉ đếm "tờ"; tờ khác tờ ở KHỔ.
// Toàn bộ `save` / validate ở trang cha giữ NGUYÊN.
import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import type {
  DepartmentPurchaseRequestInput,
  DepartmentPurchaseRequestRow,
  DepartmentPurchaseRequestLineInput,
  TonKhoaRow,
} from "../../../../api/client";
import { api } from "../../../../api/client";
import { useAuth } from "../../../../auth/useAuth";
import { Button } from "../../../../components/Button";
import { ChonNgay } from "../../../../components/ChonNgay";
import { Icon } from "../../../../components/Icons";
import { DonViChonTheoHang, MaterialCombobox } from "../../../../components/MaterialCombobox";
import { KhungKho } from "../../../../components/kho-giay/KhungKho";
import { NganPhai, useDongNgan } from "../../../ke-toan/shared/NganPhai";
import { fmtQty } from "../../../khoShared";
import { OMuaCho } from "../../mua-cho/OMuaCho";
import { SOURCE_TYPE_LABELS } from "../shared/constants";
import { chuanKho, coDonViGoc, coKho } from "../../../../lib/khoGiay";
import { congNgay as congNgayVN } from "../../../../utils/ky";
import { emptyLine, laGiayDong, phieuCoDuLieu, todayInputValue } from "../shared/helpers";
import "../../../ke-toan/ke-toan.css";
import "../../../kho-ngan-a.css";
import "./yc-form-a.css";

/** Ngày cách hôm nay `n` ngày, dạng yyyy-mm-dd theo giờ xưởng. */
function congNgay(n: number): string {
  return congNgayVN(todayInputValue(), n);
}

const CHON_NHANH: { nhan: string; ngay: number }[] = [
  { nhan: "Hôm nay", ngay: 0 },
  { nhan: "+3 ngày", ngay: 3 },
  { nhan: "+7 ngày", ngay: 7 },
  { nhan: "+14 ngày", ngay: 14 },
];

/** Tồn toàn xưởng theo khoá của từng mặt hàng — nạp một lần mỗi mã. `null` = không có quyền xem. */
function useTonKhoa(token: string | null, lines: DepartmentPurchaseRequestLineInput[]) {
  const [ton, setTon] = useState<Record<string, TonKhoaRow[] | null>>({});
  const khoa = useMemo(
    () => [...new Set(lines.filter((l) => l.hang_loai && l.hang_id).map((l) => `${l.hang_loai}:${l.hang_id}`))],
    [lines],
  );
  useEffect(() => {
    if (!token) return;
    for (const k of khoa) {
      if (k in ton) continue;
      const [loai, id] = k.split(":");
      setTon((c) => ({ ...c, [k]: [] }));
      api.kho.phieu
        .tonKhoa(token, loai as "giay" | "vat_tu", Number(id))
        .then((rows) => setTon((c) => ({ ...c, [k]: rows })))
        .catch(() => setTon((c) => ({ ...c, [k]: null })));
    }
    // `ton` cố ý vắng: chỉ nạp mã mới thêm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, khoa]);
  return ton;
}

/** Nút Huỷ ở chân ngăn: đi qua cửa đóng của ngăn để cũng hỏi "Bỏ phiếu đang nhập?" khi gõ dở. */
function NutHuy({ disabled }: { disabled: boolean }) {
  const dong = useDongNgan();
  return <Button variant="ghost" onClick={dong} disabled={disabled}>Huỷ</Button>;
}

export function RequestFormDrawer({
  editing,
  departmentName,
  form,
  setForm,
  setLine,
  formError,
  minNeededDate,
  saving,
  save,
  closeForm,
}: {
  editing: DepartmentPurchaseRequestRow | null;
  departmentName: string | null;
  form: DepartmentPurchaseRequestInput;
  setForm: Dispatch<SetStateAction<DepartmentPurchaseRequestInput>>;
  setLine: (index: number, patch: Partial<DepartmentPurchaseRequestLineInput>) => void;
  formError: string | null;
  minNeededDate: string;
  saving: boolean;
  save: (e: FormEvent) => Promise<void>;
  closeForm: () => void;
}) {
  const { token, user } = useAuth();
  // Gõ dở = hỏi trước khi đóng (bấm nền / Esc / nút X). TẠO MỚI: có chữ nào đã gõ là hỏi. SỬA: chỉ hỏi
  // khi khác bản lúc mở — phiếu cũ vốn đầy dữ liệu, mở ra xem rồi đóng không có gì để mất.
  const bangLucMo = useRef(JSON.stringify(form));
  const dangGoDo = () => !saving && (editing ? JSON.stringify(form) !== bangLucMo.current : phieuCoDuLieu(form));
  const ton = useTonKhoa(token, form.lines);
  const coQuyenTon = !Object.values(ton).some((v) => v === null);

  // Dòng đang có mặt hàng; dòng trống cuối (mồi để gõ) không đếm.
  const mon = form.lines.filter((l) => l.hang_loai && l.hang_id);
  const thieuSo = mon.filter((l) => !(Number(l.quantity) > 0)).length;
  // Giấy phải có khổ (hai cạnh, hoặc ít nhất khổ rộng) — kho và mua hàng tách giấy theo khổ, thiếu
  // khổ thì không biết mua giấy nào, không NCC nào khớp.
  const thieuKho = mon.filter((l) => laGiayDong(l) && !((l.kho_rong ?? 0) > 0));
  const [daBam, setDaBam] = useState(false);
  // Cho lệnh SX chỉ sinh từ Kế hoạch vật tư (máy chủ chốt) — form chỉ hiện, không cho đổi.
  const laChoLenh = !!form.nguon_lenh?.length || form.loai_mua === "cho_lsx";

  /** Tồn của dòng. Giấy: CÙNG khổ (khổ chỉ-rộng không khớp khổ hai cạnh), tách theo đơn vị gốc —
   *  tờ và kg không cộng được nên mỗi đơn vị một số, hiện cạnh nhau. Vật tư khác: khổ tuỳ chọn
   *  (27/10/2026) — có khổ thì cùng khổ, trống khổ thì cộng mọi khổ; tách theo đơn vị gốc như giấy
   *  (kg và thùng không cộng được). Hàng khác: một số. */
  function tonDong(l: DepartmentPurchaseRequestLineInput): { so: number; dv: string }[] | null {
    const rows = ton[`${l.hang_loai}:${l.hang_id}`];
    if (!rows) return null;
    if (!coDonViGoc(l.hang_loai)) return [{ so: rows.reduce((s, r) => s + r.ton, 0), dv: "" }];
    const laGiay = l.hang_loai === "giay";
    const [r0, d0] = chuanKho(l.kho_rong, l.kho_dai);
    if (laGiay && !r0) return null;
    const theoKho = laGiay || r0 > 0;
    const theoGoc = new Map<string, { so: number; dv: string }>();
    for (const r of rows) {
      const [r1, d1] = chuanKho(r.kho_rong, r.kho_dai);
      if (theoKho && (r1 !== r0 || d1 !== d0)) continue;
      const k = r.don_vi_goc ?? "";
      const cu = theoGoc.get(k) ?? { so: 0, dv: r.don_vi_goc_ten ?? r.don_vi_goc ?? "" };
      theoGoc.set(k, { ...cu, so: cu.so + r.ton });
    }
    return theoGoc.size ? [...theoGoc.values()] : [{ so: 0, dv: "" }];
  }

  /** Khổ đang có trong kho của mã — gộp các đơn vị gốc cùng khổ vào một gợi ý. */
  function goiYKho(l: DepartmentPurchaseRequestLineInput) {
    const rows = ton[`${l.hang_loai}:${l.hang_id}`] ?? [];
    const theoKho = new Map<string, { rong: number; dai: number; chu: string[] }>();
    for (const r of rows) {
      if (!r.kho_rong) continue;
      const [rr, dd] = chuanKho(r.kho_rong, r.kho_dai);
      const k = `${rr}:${dd}`;
      const g = theoKho.get(k) ?? { rong: rr, dai: dd, chu: [] };
      g.chu.push(`${fmtQty(r.ton)} ${r.don_vi_goc_ten ?? ""}`.trim());
      theoKho.set(k, g);
    }
    return [...theoKho.values()].map((g) => ({ rong: g.rong, dai: g.dai, ghiChu: `Tồn ${g.chu.join("  ")}` }));
  }

  function themMon(m: { hang_loai: "giay" | "vat_tu"; hang_id: number; ten: string; dinh_luong?: number | null }) {
    setForm((c) => {
      const dong: DepartmentPurchaseRequestLineInput = {
        ...emptyLine(), hang_loai: m.hang_loai, hang_id: m.hang_id, item_name: m.ten,
        dinh_luong: m.dinh_luong ?? null,
      };
      // Dòng trống mồi sẵn (form mới) thì thay luôn, khỏi để một hàng rác.
      const lines = c.lines.filter((l) => l.hang_loai || l.item_name.trim());
      return { ...c, lines: [...lines, dong] };
    });
  }

  const chan = (
    <>
      <span className="ycf-xt">
        <b>{mon.length} món</b>
        {thieuSo > 0 && <span className="ycf-do">còn {thieuSo} món chưa nhập số lượng</span>}
        {thieuSo === 0 && thieuKho.length > 0 && (
          <span className="ycf-do">{daBam ? `${thieuKho[0].item_name} chưa có khổ` : ""}</span>
        )}
      </span>
      <span className="rc__spacer" />
      <NutHuy disabled={saving} />
      <Button type="submit" form="ycmh-form" variant="accent" loading={saving}>
        <Icon name={editing ? "edit" : "send"} size={14} /> {editing ? "Cập nhật yêu cầu" : "Gửi yêu cầu"}
      </Button>
    </>
  );

  const soCot = coQuyenTon ? 7 : 6;

  return (
    <NganPhai
      duongDan={editing ? `Yêu cầu mua hàng > ${editing.code}` : "Yêu cầu mua hàng > Tạo mới"}
      tieuDe={editing ? "Sửa yêu cầu mua hàng" : "Tạo yêu cầu mua hàng"}
      phuDe={
        <div className="mh-kv">
          <span>NV yêu cầu<b>{user?.name ?? "Tôi"}</b></span>
          <span>Bộ phận<b>{departmentName || "Nội bộ"}</b></span>
          <span>Gửi tới<b>Thu mua</b></span>
          {form.source_type && <span>Nguồn<b>{SOURCE_TYPE_LABELS[form.source_type]}</b></span>}
          {form.related_document_code && <span>Chứng từ<b>{form.related_document_code}</b></span>}
        </div>
      }
      chan={chan}
      onDong={closeForm}
      chanDong={dangGoDo}
    >
      <form
        id="ycmh-form"
        className="kna ycf3"
        onSubmit={(e) => {
          setDaBam(true);
          if (thieuKho.length) {
            e.preventDefault();
            return;
          }
          void save(e);
        }}
      >
        {formError && <div className="kna-canh kna-canh--do" role="alert">{formError}</div>}
        <div className="ycf3-dau">
          <label className="kna-o-truong">
            <span>Ngày cần hàng <em>*</em></span>
            <ChonNgay
              className="kna-o"
              required
              min={minNeededDate}
              value={form.needed_date}
              onChange={(v) => setForm({ ...form, needed_date: v })}
            />
          </label>
          <div className="ycf-pick" role="group" aria-label="Chọn nhanh ngày cần">
            {CHON_NHANH.map((c) => {
              const ngay = congNgay(c.ngay);
              return (
                <button key={c.nhan} type="button" className={form.needed_date === ngay ? "on" : ""}
                  onClick={() => setForm({ ...form, needed_date: ngay })}>
                  {c.nhan}
                </button>
              );
            })}
          </div>
          <label className="kna-o-truong">
            <span>Nội dung, mục đích <em>*</em></span>
            <input
              className="kna-o"
              required
              value={form.content}
              placeholder="VD: thiếu giấy cho lệnh LSX26-0014, cần trước ngày đóng gói"
              onChange={(e) => setForm({ ...form, content: e.target.value })}
            />
          </label>
        </div>
        <div className="ycf3-loai" role="group" aria-label="Loại mua">
          <span className="ycf3-loai__nhan">Loại mua</span>
          {laChoLenh ? (
            <>
              <OMuaCho loai={["cho_lsx"]} lenh={editing?.mua_cho ?? []} />
              <span className="ycf3-loai__goi">Lập từ Kế hoạch vật tư, không đổi được loại</span>
            </>
          ) : (
            <>
              <span className="ycf-pick">
                {(["theo_yeu_cau", "mua_ton"] as const).map((x) => (
                  <button key={x} type="button" className={(form.loai_mua ?? "theo_yeu_cau") === x ? "on" : ""}
                    aria-pressed={(form.loai_mua ?? "theo_yeu_cau") === x}
                    onClick={() => setForm({ ...form, loai_mua: x })}>
                    {x === "mua_ton" ? "Mua tồn kho" : "Theo yêu cầu"}
                  </button>
                ))}
              </span>
              <span className="ycf3-loai__goi">
                {form.loai_mua === "mua_ton"
                  ? "Hàng về vào kho chung, lệnh nào cần thì giữ chỗ"
                  : "Mua theo nhu cầu của bộ phận, không gắn lệnh sản xuất"}
              </span>
            </>
          )}
        </div>

        <div className="ycf3-muc">Vật tư cần mua<span className="mh-tag">{mon.length} món</span></div>
        <div className="lds-bang lds-bang--nhap ycf3-khung">
          <table className="lds-g ycf3-bang" style={{ minWidth: coQuyenTon ? 986 : 890 }}>
            <colgroup>
              <col />
              <col style={{ width: 230 }} />
              <col style={{ width: 96 }} />
              {coQuyenTon && <col style={{ width: 96 }} />}
              <col style={{ width: 160 }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 44 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Vật tư</th>
                <th>Khổ</th>
                <th className="n">Định lượng</th>
                {coQuyenTon && <th className="n">Tồn khổ này</th>}
                <th className="n">Số lượng mua</th>
                <th>Ghi chú</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {form.lines.map((line, index) => {
                if (!line.hang_loai || !line.hang_id) {
                  // Dòng cũ chưa gắn danh mục (mở phiếu cũ ra sửa): phải chọn lại mặt hàng.
                  if (!line.item_name.trim()) return null;
                  return (
                    <tr key={index}>
                      <td colSpan={soCot - 1}>
                        <MaterialCombobox
                          token={token ?? ""}
                          hangTen={line.item_name || null}
                          chiCoNhaCungCap
                          onPick={(m) => setLine(index, {
                            hang_loai: m.hang_loai, hang_id: m.hang_id, item_name: m.ten, unit: "",
                            kho_rong: 0, kho_dai: 0, dinh_luong: m.dinh_luong ?? null,
                          })}
                        />
                      </td>
                      <td className="c">
                        <button type="button" className="ycf-xoa" aria-label="Xoá dòng"
                          onClick={() => setForm((c) => ({ ...c, lines: c.lines.filter((_, i) => i !== index) }))}>
                          <Icon name="trash" size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                }
                const laGiay = laGiayDong(line);
                const t = tonDong(line);
                const sl = Number(line.quantity) || 0;
                return (
                    <tr key={index}>
                    <td title={line.item_name}>
                      <span className="ycf3-ic" aria-hidden>
                        <Icon name={line.hang_loai === "giay" ? "paper" : "box"} size={14} />
                      </span>
                      {line.item_name}
                    </td>
                    <td>
                      {coKho(line.hang_loai) ? (
                        <KhungKho
                          rong={line.kho_rong ?? 0}
                          dai={line.kho_dai ?? 0}
                          goiY={goiYKho(line)}
                          onChange={(v) => setLine(index, { kho_rong: v.rong, kho_dai: v.dai })}
                        />
                      ) : (
                        <span className="mh-mo3">Không theo khổ</span>
                      )}
                    </td>
                    {/* Định lượng CHỈ ĐỌC — gsm khai ở danh mục giấy, không ai gõ ở chứng từ mua. */}
                    <td className="n">{laGiay ? (line.dinh_luong ?? <span className="mh-mo3">–</span>) : ""}</td>
                    {coQuyenTon && (
                      <td className="n">
                        {t == null ? (
                          <span className="mh-mo3">{laGiay ? "Chọn khổ" : ""}</span>
                        ) : (
                          // Cùng khổ khác đơn vị gốc (tờ và kg) là hai số đứng cạnh, không cộng.
                          <span className="ycf3-ton">
                            {t.map((x, i) => (
                              <span key={i} className={x.so <= 0 ? "mh-do" : undefined}>
                                {fmtQty(x.so)}{t.length > 1 && x.dv ? ` ${x.dv}` : ""}
                              </span>
                            ))}
                          </span>
                        )}
                      </td>
                    )}
                    <td className="n">
                      <label className={`ycf-gi${sl > 0 ? "" : " loi"}`}>
                        <input
                          inputMode="decimal"
                          aria-label={`Số lượng mua ${line.item_name}`}
                          value={sl > 0 ? String(line.quantity) : ""}
                          onChange={(e) => {
                            const so = e.target.value.replace(",", ".").replace(/[^\d.]/g, "");
                            setLine(index, { quantity: so ? Number(so) : 0 });
                          }}
                        />
                        {/* Giấy + vật tư khác (10/10/2026, khai nhiều ĐVT): ĐVT tự chọn trong các đơn vị
                            đã khai ở danh mục — chính nó quyết dòng đếm theo đơn vị gốc nào (tờ hay kg,
                            kg hay thùng). Thành phẩm, khuôn: đơn vị của mặt hàng. */}
                        <DonViChonTheoHang
                          chiDoc={!coDonViGoc(line.hang_loai)}
                          gon={coDonViGoc(line.hang_loai)}
                          token={token ?? ""}
                          hangLoai={line.hang_loai ?? null}
                          hangId={line.hang_id ?? null}
                          value={line.unit}
                          onChange={(ma) => setLine(index, { unit: ma })}
                        />
                      </label>
                    </td>
                    <td>
                      <input
                        className="ycf-ghi"
                        placeholder="Thêm ghi chú"
                        aria-label={`Ghi chú ${line.item_name}`}
                        value={line.note ?? ""}
                        onChange={(e) => setLine(index, { note: e.target.value })}
                      />
                    </td>
                    <td className="c">
                      <button type="button" className="ycf-xoa" aria-label={`Xoá ${line.item_name}`}
                        onClick={() => setForm((c) => {
                          const lines = c.lines.filter((_, i) => i !== index);
                          return { ...c, lines: lines.length ? lines : [emptyLine()] };
                        })}>
                        <Icon name="trash" size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td colSpan={soCot} className="ycf3-them">
                  <MaterialCombobox
                    key={mon.length}
                    token={token ?? ""}
                    hangTen={null}
                    chiCoNhaCungCap
                    placeholder="Thêm vật tư: gõ tên hoặc mã giấy, vật tư khác…"
                    onPick={(m) => themMon(m)}
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </form>
    </NganPhai>
  );
}
