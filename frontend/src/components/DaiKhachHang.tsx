// Dải KHÁCH HÀNG bốn ô (Khách hàng / Giao tới / Người nhận / Ghi chú nội bộ) — dùng chung cho
// Phiếu tính giá (chọn được) và Báo giá (chỉ đọc). Chủ dự án chốt 04/10/2026: khách, điểm giao,
// người nhận, ghi chú CHỌN Ở PHIẾU; báo giá chép sang và không sửa được (máy chủ chặn).
// Mockup đã duyệt: docs/mockups/bao-gia-ke-thua-tu-ptg.html (phương án B).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Building2, Check, ChevronDown, FileText, MapPin, Plus, User } from "lucide-react";
import { api, type CustomerAddress, type CustomerContact, type CustomerRow } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { DsTimKhach } from "./ChonKhachHang";
import "./dai-khach-hang.css";

export interface KhachCuaPhieu {
  customer_id: number | null;
  customer_name: string | null;
  delivery_address: string | null;
  contact_name_snapshot: string | null;
  contact_phone_snapshot: string | null;
  contact_title_snapshot: string | null;
  contact_email_snapshot: string | null;
}

/** Thay đổi gửi lên — đúng khuôn `PATCH /phieu-tinh-gia/{id}/khach-hang`. */
export type DoiKhach = Partial<Omit<KhachCuaPhieu, "customer_name">> & {
  customer_name?: string | null;
  ghi_chu?: string | null;
};

type O = "kh" | "dc" | "ng";

interface Props {
  giaTri: KhachCuaPhieu;
  ghiChu: string | null;
  /** Có = chọn được (màn phiếu). Không có = chỉ đọc (màn báo giá). */
  onDoi?: (patch: DoiKhach) => void;
  /** Khoá cả dải (đang lưu, hoặc không có quyền sửa). */
  khoa?: boolean;
  /** Dòng phụ dưới tên khách (vd "MST 0312…"). Không truyền (undefined) thì dải tự tra hồ sơ khách. */
  phuKhach?: string | null;
  /** Nhãn điểm giao đang chọn (vd "Kho Bắc Ninh") do máy chủ trả kèm phiếu — có thì khỏi tải danh
   *  sách điểm giao chỉ để lấy nhãn; danh sách chỉ tải khi mở ô chọn. */
  nhanDiemGiao?: string | null;
  /** Dòng chân dải: lý do, nguồn, đường về phiếu. */
  chan?: ReactNode;
}

export function DaiKhachHang({ giaTri, ghiChu, onDoi, khoa, phuKhach, nhanDiemGiao, chan }: Props) {
  const { token } = useAuth();
  const sua = !!onDoi;
  const [mo, setMo] = useState<O | null>(null);
  const [diemGiao, setDiemGiao] = useState<CustomerAddress[]>([]);
  const [lienHe, setLienHe] = useState<CustomerContact[]>([]);
  // Điểm giao + danh bạ đã tải cho khách nào (null = chưa tải) — tải khi mở ô chọn, không lúc mở màn.
  const [napCho, setNapCho] = useState<number | null>(null);
  const [dsXong, setDsXong] = useState<number | null>(null);
  const [mst, setMst] = useState<string | null>(null);
  const [note, setNote] = useState(ghiChu ?? "");
  const [ghiChuDu, setGhiChuDu] = useState(false);
  const goc = useRef<HTMLDivElement>(null);
  const cid = giaTri.customer_id;

  useEffect(() => setNote(ghiChu ?? ""), [ghiChu]);

  // Đổi khách ⇒ bỏ danh sách của khách cũ.
  useEffect(() => {
    setDiemGiao([]);
    setLienHe([]);
    setNapCho(null);
    setDsXong(null);
  }, [cid]);

  // Điểm giao + danh bạ của khách đang chọn: chỉ cần khi MỞ ô "Giao tới" / "Người nhận" (tô mặc định,
  // liên hệ chính). Trước 05/10/2026 tải ngay lúc mở màn — thêm hai lệnh gọi cho mỗi lần mở phiếu.
  useEffect(() => {
    if (!sua || !token || cid == null || napCho === cid || (mo !== "dc" && mo !== "ng")) return;
    setNapCho(cid);
    Promise.all([
      api.customers.addresses(token, cid).then((r) => setDiemGiao(r.items)).catch(() => setDiemGiao([])),
      api.customers.contacts(token, cid).then((r) => setLienHe(r.items)).catch(() => setLienHe([])),
    ]).then(() => setDsXong(cid));
  }, [sua, token, cid, mo, napCho]);

  // MST dưới tên khách: màn nào đã có (phiếu trả kèm) thì truyền `phuKhach`, khỏi tra.
  useEffect(() => {
    if (!sua || !token || cid == null || phuKhach !== undefined) {
      setMst(null);
      return;
    }
    api.customers.get(token, cid).then((r) => setMst(r.customer.tax_code)).catch(() => setMst(null));
  }, [sua, token, cid, phuKhach]);

  useEffect(() => {
    if (!mo) return;
    const dong = (e: MouseEvent) => {
      if (goc.current && !goc.current.contains(e.target as Node)) setMo(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMo(null);
    document.addEventListener("mousedown", dong);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", dong);
      document.removeEventListener("keydown", esc);
    };
  }, [mo]);

  async function chonKhach(k: CustomerRow) {
    setMo(null);
    if (!onDoi || !token || k.id === cid) return;
    // Đổi khách: điền sẵn điểm giao MẶC ĐỊNH + liên hệ CHÍNH (cùng luật máy chủ). Tự tính ở đây để
    // phiếu chưa lưu cũng thấy ngay; máy chủ nhận nguyên bộ nên không điền đè lần nữa.
    const [dg, lh] = await Promise.all([
      api.customers.addresses(token, k.id).then((r) => r.items).catch(() => [] as CustomerAddress[]),
      api.customers.contacts(token, k.id).then((r) => r.items).catch(() => [] as CustomerContact[]),
    ]);
    const a = dg.find((x) => x.is_default) ?? dg[0];
    const c = lh.find((x) => x.is_primary) ?? lh[0];
    onDoi({
      customer_id: k.id,
      customer_name: k.name,
      delivery_address: a?.address ?? null,
      contact_name_snapshot: c ? c.name : (k.contact_name ?? null),
      contact_phone_snapshot: c ? c.phone : k.phone,
      contact_title_snapshot: c ? c.title : null,
      contact_email_snapshot: c ? c.email : (k.email ?? null),
    });
  }

  const dgDangChon = diemGiao.find((a) => a.address === giaTri.delivery_address) ?? null;
  const lhDangChon =
    lienHe.find(
      (c) => c.name === giaTri.contact_name_snapshot && (c.phone ?? null) === giaTri.contact_phone_snapshot,
    ) ?? null;

  const nhan = (Icon: typeof User, ten: string) => (
    <div className="dkh__k">
      <Icon size={13} aria-hidden="true" />
      {ten}
      {sua && <ChevronDown size={13} className="dkh__chev" aria-hidden="true" />}
    </div>
  );
  const trong = (chu: string) => (
    <span className="dkh__empty">
      <Plus size={13} aria-hidden="true" />
      {chu}
    </span>
  );

  const oKhach = (
    <>
      {nhan(Building2, "Khách hàng")}
      {giaTri.customer_name ? (
        <>
          <div className="dkh__v">{giaTri.customer_name}</div>
          {(phuKhach ?? (mst ? `MST ${mst}` : null)) && (
            <div className="dkh__s">{phuKhach ?? `MST ${mst}`}</div>
          )}
        </>
      ) : sua ? (
        trong("Chọn khách hàng")
      ) : (
        <span className="dkh__off">Chưa có</span>
      )}
    </>
  );
  const oGiao = (
    <>
      {nhan(MapPin, "Giao tới")}
      {cid == null ? (
        <span className="dkh__off">Chọn khách trước</span>
      ) : giaTri.delivery_address ? (
        dgDangChon || nhanDiemGiao ? (
          <>
            <div className="dkh__v">{dgDangChon?.label ?? nhanDiemGiao}</div>
            <div className="dkh__s">{giaTri.delivery_address}</div>
          </>
        ) : (
          <div className="dkh__v dkh__v--thuong">{giaTri.delivery_address}</div>
        )
      ) : sua ? (
        trong(dsXong !== cid || diemGiao.length ? "Chọn điểm giao" : "Khách chưa khai điểm giao")
      ) : (
        <span className="dkh__off">Chưa có</span>
      )}
    </>
  );
  const oNhan = (
    <>
      {nhan(User, "Người nhận")}
      {cid == null ? (
        <span className="dkh__off">Chọn khách trước</span>
      ) : giaTri.contact_name_snapshot || giaTri.contact_phone_snapshot ? (
        <>
          <div className="dkh__v">{giaTri.contact_name_snapshot || giaTri.contact_phone_snapshot}</div>
          {giaTri.contact_title_snapshot && <div className="dkh__s">{giaTri.contact_title_snapshot}</div>}
          {giaTri.contact_name_snapshot && giaTri.contact_phone_snapshot && (
            <div className="dkh__s">{giaTri.contact_phone_snapshot}</div>
          )}
        </>
      ) : sua ? (
        trong(dsXong !== cid || lienHe.length ? "Chọn người nhận" : "Khách chưa có danh bạ")
      ) : (
        <span className="dkh__off">Chưa có</span>
      )}
    </>
  );

  const nutO = (o: O, noiDung: ReactNode, tat = false) =>
    sua ? (
      <button
        type="button"
        className={`dkh__o${mo === o ? " is-open" : ""}`}
        disabled={khoa || tat}
        aria-expanded={mo === o}
        onClick={() => {
          setMo(mo === o ? null : o);
        }}
      >
        {noiDung}
      </button>
    ) : (
      <div className="dkh__o">{noiDung}</div>
    );

  const ghiChuGoc = ghiChu ?? "";
  return (
    <div className={`dkh${sua ? " dkh--sua" : ""}`} ref={goc}>
      {nutO("kh", oKhach)}
      {nutO("dc", oGiao, cid == null)}
      {nutO("ng", oNhan, cid == null)}
      <div className="dkh__o dkh__o--note">
        <div className="dkh__k">
          <FileText size={13} aria-hidden="true" />
          Ghi chú nội bộ
        </div>
        {sua ? (
          <textarea
            className="dkh__notebox"
            value={note}
            disabled={khoa}
            placeholder="Bấm để ghi chú cho người làm báo giá và sản xuất"
            aria-label="Ghi chú nội bộ"
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => {
              if (note.trim() !== ghiChuGoc.trim()) onDoi?.({ ghi_chu: note.trim() || null });
            }}
          />
        ) : ghiChuGoc.trim() ? (
          <>
            <div className={`dkh__clamp${ghiChuDu ? " is-full" : ""}`}>{ghiChuGoc}</div>
            {(ghiChuGoc.length > 90 || ghiChuGoc.includes("\n")) && (
              <button type="button" className="dkh__more" onClick={() => setGhiChuDu((v) => !v)}>
                {ghiChuDu ? "Thu gọn" : "Xem thêm"}
              </button>
            )}
          </>
        ) : (
          <span className="dkh__off">Không có ghi chú</span>
        )}
      </div>
      {chan ? <div className="dkh__ft">{chan}</div> : null}

      {mo && (
        <div className={`dkh__pop dkh__pop--${mo}`} role="listbox">
          {mo === "kh" && <DsTimKhach chonId={cid} onChon={(k) => void chonKhach(k)} />}
          {(mo === "dc" || mo === "ng") && dsXong !== cid && <div className="dkh__none">Đang tải…</div>}
          {mo === "dc" && dsXong === cid &&
            (diemGiao.length ? (
              diemGiao.map((a) => (
                <button
                  type="button"
                  key={a.id}
                  className={`dkh__opt${a.address === giaTri.delivery_address ? " is-sel" : ""}`}
                  onClick={() => {
                    setMo(null);
                    if (a.address !== giaTri.delivery_address) onDoi?.({ delivery_address: a.address });
                  }}
                >
                  <span>
                    <span className="dkh__opt-t">
                      {a.label}
                      {a.is_default && <span className="dkh__tag">mặc định</span>}
                    </span>
                    <span className="dkh__opt-d">{a.address}</span>
                  </span>
                  <Check size={14} className="dkh__ck" aria-hidden="true" />
                </button>
              ))
            ) : (
              <div className="dkh__none">Khách chưa khai điểm giao. Thêm ở hồ sơ khách hàng.</div>
            ))}
          {mo === "ng" && dsXong === cid &&
            (lienHe.length ? (
              lienHe.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  className={`dkh__opt${c === lhDangChon ? " is-sel" : ""}`}
                  onClick={() => {
                    setMo(null);
                    if (c !== lhDangChon)
                      onDoi?.({
                        contact_name_snapshot: c.name,
                        contact_phone_snapshot: c.phone,
                        contact_title_snapshot: c.title,
                        contact_email_snapshot: c.email,
                      });
                  }}
                >
                  <span>
                    <span className="dkh__opt-t">
                      {c.name}
                      {c.is_primary && <span className="dkh__tag">liên hệ chính</span>}
                    </span>
                    <span className="dkh__opt-d">
                      {c.title && <span>{c.title}</span>}
                      {c.phone && <span>{c.phone}</span>}
                    </span>
                  </span>
                  <Check size={14} className="dkh__ck" aria-hidden="true" />
                </button>
              ))
            ) : (
              <div className="dkh__none">Khách chưa có danh bạ liên hệ. Thêm ở hồ sơ khách hàng.</div>
            ))}
        </div>
      )}
    </div>
  );
}
