// Ô CÔNG THỨC — gõ ra chip tiếng Việt, có gợi ý biến, kiểm cú pháp và bảng biến khả dụng.
import { useEffect, useMemo, useRef, useState } from "react";

import { catToken, laToanTu } from "../formulaTokens";
import {
  boDau, inDangChu, khopNgoac, khungHam, kiemCongThuc, nhanDoiBac, noiGon, nhomNghin, timBac,
  tinhDong, viTriToken, xoaBac, type Bac,
} from "../congThucBacThang";
import { traBien, useBienCongThuc, type BienCongThuc } from "../bienCongThuc";
import { CircleXIcon, XIcon } from "../icons";

const MATH_FUNCS = ["ceil", "floor", "round", "max", "min", "if"];

/** Màu viền theo cấp lồng — lặp lại nếu lồng sâu hơn 4 cấp. Không dùng `--rust`: màu đó đã là
 *  accent chính của cả màn (viền focus, nút chính…), lẫn vào đây thì không còn phân biệt được
 *  "đang gõ" với "đang ở cấp mấy". */
const MAU_CAP = ["var(--steel, #4a5560)", "var(--moss, #2f5d3a)", "var(--plum, #5f4d9e)", "var(--amber, #9c7714)"];

/** Vẽ MỘT chip. Trước đây hàm này tự cắt token từ `value` rồi vẽ cả dãy một lượt — nay ô gõ có
 *  thể nằm CHÈN GIỮA dãy, nên chỗ gọi phải tự cắt đôi mảng token và vẽ từng chip với chỉ số thật.
 *
 *  `onDatCaret(i)` = bấm vào chip thì đưa ô gõ về đúng chỗ đó (nửa trái → đứng trước chip, nửa
 *  phải → đứng sau). Không có nó thì chip chỉ xoá được bằng nút "×", mà nút "×" chỉ mọc trên chip
 *  BIẾN — gõ nhầm dấu "×" ở giữa công thức là phải xoá lùi từ cuối về, đúng chỗ khó chịu 25/08. */
function veChip({
  tok,
  idx,
  tra,
  validVars,
  whitelist,
  onXoa,
  onDatCaret,
  them = "",
}: {
  tok: string;
  idx: number;
  tra: (ma: string) => BienCongThuc | undefined;
  validVars: string[] | null;
  whitelist: string[];
  onXoa?: (index: number) => void;
  onDatCaret?: (index: number) => void;
  /** Lớp phụ theo NGỮ CẢNH của chip trong cả công thức: `is-khung` (ngoặc/phẩy của lệnh gọi hàm —
   *  vẽ nhạt), `is-chon` (đang nằm trong bậc được chọn), `is-sang` (cặp ngoặc cạnh con trỏ),
   *  `is-loi` (token gây lỗi). Chip tự nó không biết mấy điều này. */
  them?: string;
}) {
  const info = tra(tok);
  const isValidVar = validVars ? validVars.includes(tok) : (whitelist.includes(tok) || !!info);

  // Bấm chip = đặt con trỏ, KHÔNG được để ô gõ mất focus trước đã: blur chốt nốt chữ đang gõ dở
  // thành chip mới, chỉ số chip lúc ấy đã xê dịch ⇒ con trỏ nhảy sai chỗ. `preventDefault` ở
  // mousedown giữ focus lại, phần chốt chữ do chính `onDatCaret` lo (nó biết chèn ở đâu).
  const datCaret = onDatCaret
    ? (e: React.MouseEvent<HTMLSpanElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        onDatCaret(e.clientX < r.left + r.width / 2 ? idx : idx + 1);
      }
    : undefined;

  // Phải chặn CẢ `click`, không chỉ `mousedown`: nền ô (`rc-formula__single-stage`) có onClick kéo
  // con trỏ về cuối để "bấm chỗ trống là gõ tiếp". Cú bấm chip nổi bọt lên tới đó là vừa đặt con
  // trỏ xong đã bị lôi ngược về cuối — nhìn như bấm chip chẳng ăn thua gì.
  const chanNoi = (e: React.MouseEvent) => e.stopPropagation();
  // `data-idx` = chỉ số token của chip, đọc lại từ DOM khi người ta bấm vào KHOẢNG TRỐNG của ô
  // (kẽ 6px giữa hai chip, phần trắng cuối dòng…) — chỗ đó không có chip nào nhận cú bấm nên phải
  // dò bằng hình học thật, xem `datCaretTheoDiem`.
  const chung = { onMouseDown: datCaret, onClick: chanNoi, "data-idx": idx };

  if (isValidVar || info) {
    return (
      <span
        key={idx}
        {...chung}
        className={`rc-formula__chip-token rc-formula__chip-token--var ${them}`}
        title={info ? `${info.nhan} (Mã: ${tok})
Đơn vị: ${info.don_vi}
Nguồn: ${info.nguon}` : `Mã: ${tok}`}
      >
        <span className="rc-formula__chip-token-label">{info?.nhan ?? tok}</span>
        {onXoa && (
          <button
            type="button"
            className="rc-formula__chip-token-del"
            // Cũng phải chặn ở mousedown: để blur chạy trước là chữ đang gõ dở chốt thêm một
            // chip, `idx` xê ra và nút "×" xoá nhầm chip bên cạnh.
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onXoa(idx);
            }}
            onClick={chanNoi}
            title={`Xoá biến ${info?.nhan ?? tok}`}
          >
            ×
          </button>
        )}
      </span>
    );
  }

  if (MATH_FUNCS.includes(tok)) {
    return (
      <span key={idx} {...chung} className={`rc-formula__chip-token rc-formula__chip-token--func ${them}`}>
        {tok}
      </span>
    );
  }

  if (/^\d+(?:\.\d+)?$/.test(tok)) {
    return (
      <span key={idx} {...chung} className={`rc-formula__chip-token rc-formula__chip-token--num ${them}`}>
        {nhomNghin(tok)}
      </span>
    );
  }

  if (laToanTu(tok)) {
    const displayOp = tok === "*" ? "×" : tok === "/" ? "÷" : tok === "-" ? "−" : tok;
    return (
      <span key={idx} {...chung} className={`rc-formula__chip-token rc-formula__chip-token--op ${them}`}>
        {displayOp}
      </span>
    );
  }

  return (
    <span
      key={idx}
      {...chung}
      className={`rc-formula__chip-token rc-formula__chip-token--error ${them}`}
      title={`Biến "${tok}" chưa hỗ trợ hoặc gõ sai`}
    >
      {tok}
    </span>
  );
}

/** Chuỗi thô → token sạch (bỏ khoảng trắng). Một bản cho cả ô: chỉ số chip phải khớp chuỗi. */
function tachSach(tho: string): string[] {
  return catToken(tho).map((x) => x.trim()).filter(Boolean);
}

type CheDo = "truc_quan" | "chu";
/** Chế độ xem nhớ theo TRÌNH DUYỆT — tiện riêng từng người, không phải dữ liệu. Private mode hay
 *  chặn bộ nhớ thì về mặc định, không được làm vỡ ô. */
const KHOA_CHE_DO = "svn.congThuc.cheDo";
function docCheDo(): CheDo {
  try { return localStorage.getItem(KHOA_CHE_DO) === "chu" ? "chu" : "truc_quan"; } catch { return "truc_quan"; }
}
function luuCheDo(m: CheDo) {
  try { localStorage.setItem(KHOA_CHE_DO, m); } catch { /* không nhớ được thì thôi */ }
}

/** Chép chữ vào bộ nhớ tạm. `navigator.clipboard` chỉ có ở trang an toàn (https/localhost) — ngoài
 *  đó lùi về `execCommand` qua một ô ẩn. */
async function chepVaoBoNho(chuoi: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(chuoi);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = chuoi;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

// Biến ẨN khỏi bảng chip ở MỌI ô công thức — giá lẫn lượng (03/09/2026).
// `to_dau_vao`/`to_sau_in` là số CẢ CHUỖI (tờ vào / tờ tốt ra của máy in), cố định cho mọi bước:
// khai công thức theo chúng là tính trên số TRƯỚC khi trừ hao của các bước đứng giữa. Ô nào cũng
// nên dùng số của CHÍNH bước (`sl_vao`/`sl_ra`) hoặc `to_nguyen`. Chỉ giấu chip mời bấm — hai biến
// vẫn hợp lệ, công thức cũ đã lỡ dùng không bị báo đỏ và vẫn tính y như trước.
// `don_gia_khoan` (08/09/2026) đi cùng danh sách này nhưng vì lý do khác: nó CHỈ có số ở ô "Công
// thức tính tiền công" của đầu việc — mọi ô khác dùng chung bộ chip `quy_doi` (cách đo giờ, định
// mức vật tư, công thức lượng của Giấy/Vật tư, quy đổi đơn vị) đều không đứng ở đầu việc nào nên
// nó luôn bằng 0. Ô nào cần thì tự xin lại bằng prop `hien`. Ô xin lại rồi thì gánh thêm một luật
// mà chip khác không có: gọi chip là công thức RA THẲNG TIỀN, engine thôi nhân đơn giá
// (`bien_cong_thuc.cong_thuc_ra_tien` chốt, `lsx_service._khoan_theo_cong_thuc` thi hành).
const AN_MOI_O = ["to_dau_vao", "to_sau_in", "don_gia_khoan"];

export function FormulaField({
  value,
  onChange,
  configPrefix,
  bienGoiY,
  an,
  hien,
  loaiO: loaiOEp,
  bienThem,
  nhanO = "Công thức tính giá",
  goY = "Nhập công thức tính giá (vd: dai_tp * rong_tp * don_gia)...",
  id = "formula-textarea",
}: {
  value: string;
  onChange: (v: string) => void;
  configPrefix: string;
  bienGoiY?: string[];
  /** Danh sách mã biến CẦN ẨN khỏi bảng chip gợi ý, dù `loaiO` cho phép — dùng khi biến chỉ có
   *  nghĩa với MỘT số bản ghi trong cùng loại ô. Không ảnh hưởng `bienGoiY`, cũng KHÔNG làm biến
   *  mất hiệu lực: chỉ giấu chip mời bấm, công thức cũ đã dùng vẫn hợp lệ và vẫn tính như trước. */
  an?: string[];
  /** Mã biến XIN BÀY LẠI dù nằm trong danh sách ẩn mặc định `AN_MOI_O` — ngược chiều với `an`.
   *  Cần vì có biến chỉ đúng ở MỘT ô trong cả bộ chip dùng chung (`don_gia_khoan` chỉ có số ở
   *  "Công thức tính tiền công"): mặc định ẩn rồi cho một ô xin lại thì thêm ô mới sau này không
   *  vô tình thừa hưởng chip sai, còn làm ngược (mặc định bày, từng ô tự ẩn) thì quên một chỗ là
   *  mời người ta gõ vào thứ mãi mãi bằng 0. */
  hien?: string[];
  loaiO?: string;
  /** Biến BỔ SUNG ngoài từ điển hệ thống (chip riêng của vật tư) — hiện thành chip và hợp lệ. */
  bienThem?: BienCongThuc[];
  nhanO?: React.ReactNode;
  goY?: string;
  id?: string;
}) {
  const isCd = configPrefix.includes("cong-doan");
  const isGiay = configPrefix.endsWith("/giay");
  const isDonVi = configPrefix.includes("don-vi");
  const loaiO = loaiOEp ?? (isDonVi ? "quy_doi" : isCd ? "cong_doan" : isGiay ? "giay" : "vat_tu");
  const tuDienHeThong = useBienCongThuc();
  const tuDien = useMemo(
    () => (bienThem && bienThem.length ? [...tuDienHeThong, ...bienThem] : tuDienHeThong),
    [tuDienHeThong, bienThem],
  );
  const tra = useMemo(() => traBien(tuDien), [tuDien]);
  const whitelist = useMemo(
    () => bienGoiY ?? tuDien.filter((b) => b.loai.includes(loaiO)).map((b) => b.ma),
    [bienGoiY, tuDien, loaiO],
  );
  // Bảng chip = `whitelist` TRỪ phần ẩn. Ẩn CHỈ ở khâu hiển thị: `validVars` vẫn là cả `whitelist`
  // nên công thức cũ lỡ dùng biến ẩn không bị gạch đỏ, không bị chặn lưu, và vẫn tính y như trước.
  const bienHienThi = useMemo(() => {
    const bo = new Set([...AN_MOI_O, ...(an ?? [])]);
    for (const ma of hien ?? []) bo.delete(ma);
    return whitelist.filter((ma) => !bo.has(ma));
  }, [whitelist, an, hien]);
  const validVars = useMemo(
    () => (whitelist.length ? [...whitelist] : null),
    [whitelist],
  );

  // ---- CON TRỎ TRONG DÃY CHIP ----
  // Trước 25/08/2026 ô gõ đóng đinh ở CUỐI: muốn bỏ một dấu hay một biến nằm giữa công thức thì
  // hoặc bấm trúng nút "×" bé xíu (chỉ chip BIẾN mới có), hoặc xoá lùi sạch từ cuối về. Nay ô gõ
  // là một con trỏ chạy được: `caret` = số chip đứng TRƯỚC nó.
  //
  // Token được CHUẨN HOÁ (bỏ khoảng trắng thừa, nối lại bằng đúng một dấu cách) — chỗ xoá chip cũ
  // đã làm vậy từ trước, nay cả ô làm một kiểu để chỉ số chip khớp với chuỗi công thức.
  const toks = useMemo(() => tachSach(value), [value]);
  const [caret, setCaret] = useState(toks.length);
  const khop = useMemo(() => khopNgoac(toks), [toks]);
  const khung = useMemo(() => khungHam(toks, MATH_FUNCS), [toks]);
  const bacTheoIf = useMemo(() => timBac(toks), [toks]);
  // Bậc đang được chọn (bấm nhãn "điều kiện k"), khoá theo vị trí chữ `if` của nó. Mọi lần ghi
  // công thức đều bỏ chọn — chỉ số cũ không còn trỏ đúng bậc nữa.
  const [chonIf, setChonIf] = useState<number | null>(null);
  const bacChon: Bac | null = chonIf != null ? bacTheoIf.get(chonIf) ?? null : null;
  // Ô gõ đang có focus ⇒ mới sáng cặp ngoặc cạnh con trỏ (mở popup mà đã sáng ngoặc cuối là nhiễu).
  const [dangGo, setDangGo] = useState(false);

  // ---- HAI CHẾ ĐỘ XEM (29/09/2026) ----
  // Trực quan = chip + bậc thang; Dạng chữ = chuỗi mã kiểu thanh công thức Excel, copy/paste tự do.
  // Hai cách xem CÙNG một chuỗi: chuyển qua lại không đổi gì trong dữ liệu.
  const [cheDo, setCheDo] = useState<CheDo>(docCheDo);
  const [chu, setChu] = useState(() => inDangChu(toks, MATH_FUNCS));
  const taRef = useRef<HTMLTextAreaElement>(null);

  // ---- HOÀN TÁC ----
  // Ô ghi thẳng vào form theo từng nhịp nên phải tự giữ lịch sử: bấm nhầm "×" trên chip là mất.
  const truoc = useRef<string[]>([]);
  const sau = useRef<string[]>([]);
  // Cả phiên sửa ở Dạng chữ tính là MỘT bước hoàn tác (trình duyệt đã tự lo Ctrl+Z trong ô chữ).
  const daChupChu = useRef(false);
  const ghiLichSu = () => {
    truoc.current.push(value);
    if (truoc.current.length > 200) truoc.current.shift();
    sau.current = [];
  };
  // Tách dòng chỉ phụ thuộc `toks` (cấu trúc if/max/min), không phụ thuộc `caret` — con trỏ chỉ
  // quyết định dòng nào đang hiện ô gõ, không đổi hình dạng các dòng.
  const dongHang = useMemo(() => tinhDong(toks), [toks]);
  const dongHienThi = dongHang.length ? dongHang : [{ start: 0, end: 0, cap: 0 }];
  // Ô gõ thuộc dòng chứa token TẠI vị trí caret (token sẽ đứng NGAY SAU nó); caret ở cuối công
  // thức thì thuộc dòng cuối cùng.
  const dongCuaCaret = (() => {
    if (caret >= toks.length) return dongHienThi.length - 1;
    const idx = dongHienThi.findIndex((d) => caret >= d.start && caret < d.end);
    return idx >= 0 ? idx : dongHienThi.length - 1;
  })();
  // Chuỗi do CHÍNH ô này vừa ghi ra. Value đổi mà không phải do mình (mở drawer, cha nạp dữ liệu,
  // bấm nút mẫu) thì con trỏ về cuối; do mình thì giữ nguyên chỗ vừa đặt.
  const tuMinh = useRef<string | null>(null);
  // Đổi từ NGOÀI (mở ô của máy khác trong cùng popup, Huỷ, chép công thức chung…) ⇒ lịch sử hoàn
  // tác của công thức cũ không còn nghĩa — giữ lại là Ctrl+Z bê công thức máy kia sang máy này.
  useEffect(() => {
    if (tuMinh.current === value) return;
    const t = tachSach(value);
    setCaret(t.length);
    setChonIf(null);
    truoc.current = [];
    sau.current = [];
    setChu(inDangChu(t, MATH_FUNCS));
  }, [value]);

  /** Ghi công thức mới + đặt con trỏ, và nhớ là do mình ghi. */
  const ghi = (t: string[], caretMoi: number) => {
    const chuoi = t.join(" ");
    if (chuoi !== value) ghiLichSu();
    tuMinh.current = chuoi;
    onChange(chuoi);
    setCaret(Math.max(0, Math.min(caretMoi, t.length)));
    setChonIf(null);
  };

  /** Hoàn tác / làm lại: đặt nguyên chuỗi từ lịch sử, con trỏ về cuối. */
  const apLichSu = (tu: React.MutableRefObject<string[]>, sang: React.MutableRefObject<string[]>) => {
    const v = tu.current.pop();
    if (v === undefined) return;
    sang.current.push(value);
    tuMinh.current = v;
    onChange(v);
    const t = tachSach(v);
    setCaret(t.length);
    setChonIf(null);
    setChu(inDangChu(t, MATH_FUNCS));
    if (cheDo === "truc_quan") setTimeout(() => oInline()?.focus(), 0);
  };
  const hoanTac = () => apLichSu(truoc, sau);
  const lamLai = () => apLichSu(sau, truoc);

  /** Cắt chuỗi thô thành token sạch (một cú bấm có thể sinh nhiều token: "max(" → max + "("). */
  const catSach = tachSach;

  /** Chèn vào ĐÚNG chỗ con trỏ — không phải cuối công thức. */
  const chenTaiCaret = (tho: string) => {
    const moi = catSach(tho);
    if (!moi.length) return;
    const t = [...toks];
    t.splice(caret, 0, ...moi);
    ghi(t, caret + moi.length);
  };

  const [showSyntax, setShowSyntax] = useState(false);
  const syntaxBtnRef = useRef<HTMLButtonElement>(null);
  const syntaxPopRef = useRef<HTMLDivElement>(null);

  const [typedWord, setTypedWord] = useState("");

  useEffect(() => {
    if (!showSyntax) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (syntaxPopRef.current?.contains(t) || syntaxBtnRef.current?.contains(t)) return;
      setShowSyntax(false);
    };
    // Esc đóng popover — và CHỈ popover. Ô công thức luôn nằm trong một drawer, mà drawer cũng
    // nghe Esc trên `document`; listener của drawer gắn TRƯỚC nên ở pha nổi bọt nó chạy trước và
    // đóng phắt cả drawer. Bắt ở pha BẮT (`capture`) để mình chạy trước, rồi `preventDefault()`
    // làm dấu cho drawer biết phím này đã có chủ (xem `components/Drawer.tsx`).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setShowSyntax(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [showSyntax]);

  const commitTypedWord = (textToCommit?: string) => {
    const word = (textToCommit !== undefined ? textToCommit : typedWord).trim();
    if (word) {
      chenTaiCaret(word);
      setTypedWord("");
    }
  };

  const oInline = () => document.getElementById(id) as HTMLInputElement | null;

  /** Chèn toán tử / hàm / chip biến vào công thức đã chốt.
   *  Chữ đang gõ dở phải CHỐT TRƯỚC: bấm "×" giữa chừng mà mất chữ vừa gõ thì người khai không
   *  hiểu vì sao. Hàm và mở ngoặc dính liền tham số ("max(" → "max(dai_in"), còn lại tách bằng
   *  khoảng trắng cho tokenizer cắt đúng. */
  const insertVar = (text: string) => {
    if (cheDo === "chu") { chenVaoChu(text); return; }
    const them = text.trim();
    if (!them) return;
    const moi = [...catSach(typedWord), ...catSach(them)];
    if (!moi.length) return;
    const t = [...toks];
    t.splice(caret, 0, ...moi);
    ghi(t, caret + moi.length);
    setTypedWord("");
    setTimeout(() => oInline()?.focus(), 10);
  };

  /** Bỏ đúng token thứ `idx` (nút "×" trên chip, hoặc Backspace/Delete quanh con trỏ). */
  const handleRemoveToken = (idx: number) => {
    if (idx < 0 || idx >= toks.length) return;
    const t = [...toks];
    t.splice(idx, 1);
    ghi(t, idx < caret ? caret - 1 : caret);
  };

  /** Bấm vào một chip → đưa con trỏ về chỗ đó. Chữ đang gõ dở phải CHỐT trước (không thì nó bay
   *  mất), và chốt xong thì chỉ số chip xê ra — nên vị trí đích phải bù lại. */
  const datCaret = (i: number) => {
    const moi = catSach(typedWord);
    if (moi.length) {
      const t = [...toks];
      t.splice(caret, 0, ...moi);
      ghi(t, caret <= i ? i + moi.length : i);
      setTypedWord("");
    } else {
      setCaret(Math.max(0, Math.min(i, toks.length)));
      setChonIf(null);
    }
    setTimeout(() => oInline()?.focus(), 0);
  };

  // ---- DẠNG CHỮ ----
  /** Sửa ô chữ ⇒ tách token, nối lại đúng định dạng lưu rồi ghi ngay (không đợi rời ô: bấm ra ngoài
   *  popup là panel đóng liền, không có nhịp blur nào để chốt). Ký tự lạ vẫn thành token riêng
   *  (xem `formulaTokens.regexMoi`) nên KHÔNG có gì bị nuốt — nó hiện lỗi, người khai tự sửa. */
  const doiChu = (moi: string) => {
    setChu(moi);
    const chuoi = tachSach(moi).join(" ");
    if (chuoi === value) return;
    if (!daChupChu.current) { ghiLichSu(); daChupChu.current = true; }
    tuMinh.current = chuoi;
    onChange(chuoi);
  };

  /** Chèn vào ô chữ tại con trỏ (nút toán tử, chip biến, chọn gợi ý). */
  const chenVaoChu = (them: string, tuVt?: number) => {
    const ta = taRef.current;
    const a = tuVt ?? ta?.selectionStart ?? chu.length;
    const b = ta?.selectionEnd ?? chu.length;
    doiChu(chu.slice(0, a) + them + chu.slice(Math.max(a, b)));
    const p = a + them.length;
    requestAnimationFrame(() => { ta?.focus(); ta?.setSelectionRange(p, p); });
  };

  const doiCheDo = (m: CheDo) => {
    if (m === cheDo) return;
    luuCheDo(m);
    setCheDo(m);
    setChonIf(null);
    if (m === "chu") {
      // Chữ đang gõ dở ở ô chip phải chốt trước, không thì nó bay mất khi ô gõ biến mất.
      let t = toks;
      const dang = catSach(typedWord);
      if (dang.length) {
        t = [...toks];
        t.splice(caret, 0, ...dang);
        ghi(t, caret + dang.length);
        setTypedWord("");
      }
      setChu(inDangChu(t, MATH_FUNCS));
      daChupChu.current = false;
      requestAnimationFrame(() => taRef.current?.focus());
    } else {
      setCaret(toks.length);
      setTimeout(() => oInline()?.focus(), 0);
    }
  };

  // ---- SAO CHÉP / DÁN ----
  // Mang theo số lần để bấm chép lần hai (cùng câu) vẫn đếm lại từ đầu, không tắt sớm theo hẹn giờ cũ.
  const [thongBaoLan, setThongBaoLan] = useState<{ chu: string; lan: number } | null>(null);
  const thongBao = thongBaoLan?.chu ?? null;
  const setThongBao = (chu: string) => setThongBaoLan((c) => ({ chu, lan: (c?.lan ?? 0) + 1 }));
  useEffect(() => {
    if (!thongBaoLan) return;
    const h = setTimeout(() => setThongBaoLan(null), 1800);
    return () => clearTimeout(h);
  }, [thongBaoLan]);
  /** Chép ra chuỗi MÃ gọn kiểu Excel — dán được sang máy khác, ô khác, gửi qua Zalo. */
  const chep = (t: string[], nhan: string) => {
    void chepVaoBoNho(noiGon(t, MATH_FUNCS)).then((ok) =>
      setThongBao(ok ? nhan : "Không chép được — trình duyệt chặn bộ nhớ tạm"));
  };

  /** Dán ở chế độ Trực quan: tách chuỗi thành chip chèn ngay tại con trỏ. Ký tự lạ thành chip đỏ và
   *  dòng lỗi nói cách sửa — không tự sửa hộ (chủ chốt 29/09/2026). */
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const dan = e.clipboardData.getData("text");
    if (!dan.trim()) return;
    e.preventDefault();
    const moi = [...catSach(typedWord), ...catSach(dan)];
    const t = [...toks];
    t.splice(caret, 0, ...moi);
    ghi(t, caret + moi.length);
    setTypedWord("");
  };

  // ---- THAO TÁC THEO BẬC ----
  // Con trỏ đổi DÒNG là ô gõ được vẽ lại ở dòng khác (mất focus) — phải trả focus, không thì phím
  // kế tiếp (Ctrl+Z, Delete) rơi ra ngoài ô.
  const giuFocus = () => setTimeout(() => oInline()?.focus(), 0);
  const nhanDoi = (b: Bac) => {
    ghi(nhanDoiBac(toks, b), b.phay2 + 1);
    // Chọn luôn bản sao để người khai thấy nó mọc ở đâu, rồi sửa số ngay trên đó.
    setChonIf(b.phay2 + 1);
    giuFocus();
  };
  const xoa = (b: Bac) => {
    ghi(xoaBac(toks, b), b.ifIdx);
    giuFocus();
  };

  /** Bấm vào NỀN ô (không trúng chip, không trúng ô gõ) → tìm khe gần chỗ bấm nhất rồi đặt con
   *  trỏ vào đó: dòng chọn theo `clientY` (dòng nào chứa điểm bấm, không dòng nào chứa thì lấy dòng
   *  gần nhất theo chiều dọc), khe trong dòng chọn theo `clientX` (chip đầu tiên có TÂM nằm bên
   *  phải điểm bấm ⇒ con trỏ đứng TRƯỚC chip đó; không có chip nào ⇒ cuối dòng).
   *
   *  Đọc hình học từ DOM chứ không tính lại từ token: chip tự xuống dòng theo bề rộng ô, chỉ trình
   *  duyệt mới biết chip nào thực sự nằm ở đâu. */
  const datCaretTheoDiem = (e: React.MouseEvent<HTMLDivElement>) => {
    const dich = e.target as HTMLElement;
    // Chip và ô gõ có handler riêng — không cướp cú bấm của chúng.
    if (dich.closest(".rc-formula__chip-token") || dich.closest(".rc-formula__inline-input-box")
      || dich.closest(".rc-formula__nhan-cum")) return;
    e.preventDefault();
    const hang = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>(".rc-formula__row"),
    );
    if (!hang.length) {
      datCaret(toks.length);
      return;
    }
    let gan = hang[0];
    let cach = Infinity;
    for (const h of hang) {
      const r = h.getBoundingClientRect();
      const d = e.clientY < r.top ? r.top - e.clientY : e.clientY > r.bottom ? e.clientY - r.bottom : 0;
      if (d < cach) {
        cach = d;
        gan = h;
      }
    }
    const chip = Array.from(gan.querySelectorAll<HTMLElement>(":scope > [data-idx]"));
    if (!chip.length) {
      datCaret(toks.length);
      return;
    }
    for (const c of chip) {
      const r = c.getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) {
        datCaret(Number(c.dataset.idx));
        return;
      }
    }
    datCaret(Number(chip[chip.length - 1].dataset.idx) + 1);
  };

  /** Rời ô → chốt nốt chữ đang gõ dở thành chip. Ô inline KHÔNG nằm trong `value`, không chốt thì
   *  gõ "1000" rồi bấm thẳng nút Lưu là số đó bay mất, im lặng. */
  const handleInlineBlur = () => {
    commitTypedWord();
  };

  // ---- GỢI Ý BIẾN THEO TÊN TIẾNG VIỆT ----
  // Gõ "màu" hay "kem" là ra "Số màu pha", "Số bản kẽm" — trước đây phải gõ đúng MÃ hoặc cuộn xuống
  // tận bảng biến cuối ô (công thức dài thì bảng đó trôi khỏi màn).
  const [chiGoiY, setChiGoiY] = useState(0);
  const [tatGoiY, setTatGoiY] = useState(false);
  const goiYCho = (q: string) => {
    const k = boDau(q.trim());
    if (!k || /^\d/.test(k)) return [];
    const diem = (ma: string, nhan: string) => {
      const n = boDau(nhan);
      if (ma === k) return 0;
      if (ma.startsWith(k)) return 1;
      if (n.startsWith(k)) return 2;
      if (ma.includes(k) || n.includes(k)) return 3;
      return 9;
    };
    return bienHienThi
      .map((ma) => ({ ma, nhan: tra(ma)?.nhan ?? ma }))
      .map((x) => ({ ...x, d: diem(x.ma, x.nhan) }))
      .filter((x) => x.d < 9)
      .sort((a, b) => a.d - b.d)
      .slice(0, 8);
  };
  // Chữ đang gõ ở Dạng chữ = đoạn chữ/số liền ngay TRƯỚC con trỏ của ô chữ.
  const [tuChu, setTuChu] = useState<{ tu: string; dau: number } | null>(null);
  const docTuChu = (ta: HTMLTextAreaElement) => {
    const p = ta.selectionStart;
    if (p !== ta.selectionEnd) { setTuChu(null); return; }
    const m = /[\p{L}\p{M}\p{N}_]+$/u.exec(ta.value.slice(0, p));
    setTuChu(m ? { tu: m[0], dau: p - m[0].length } : null);
    setTatGoiY(false);
    setChiGoiY(0);
  };
  // Ô gõ chip có thể đang chứa cả dấu phép tính (dán/gõ nhanh "+ bản kẽm") — gợi ý theo đoạn chữ
  // CUỐI CÙNG sau dấu phép tính, phần trước chốt thành chip khi chọn.
  const duoiGo = typedWord.split(/[+\-*/(),<>=!]/).pop() ?? "";
  const tuDangGo = cheDo === "chu" ? tuChu?.tu ?? "" : duoiGo;
  const goiY = useMemo(() => {
    if (tatGoiY) return [];
    const ds = goiYCho(tuDangGo);
    // Đã gõ trọn đúng một mã và không còn mã nào dài hơn ⇒ khỏi mời chọn lại chính nó.
    return ds.length === 1 && ds[0].ma === tuDangGo ? [] : ds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tuDangGo, tatGoiY, bienHienThi, tra]);
  const chonGoiY = (ma: string) => {
    if (cheDo === "chu") {
      if (!tuChu) return;
      const ta = taRef.current;
      const cuoi = ta?.selectionStart ?? tuChu.dau + tuChu.tu.length;
      const moi = chu.slice(0, tuChu.dau) + ma + chu.slice(cuoi);
      doiChu(moi);
      setTuChu(null);
      const p = tuChu.dau + ma.length;
      requestAnimationFrame(() => { ta?.focus(); ta?.setSelectionRange(p, p); });
      return;
    }
    const moi = [...catSach(typedWord.slice(0, typedWord.length - duoiGo.length)), ma];
    const t = [...toks];
    t.splice(caret, 0, ...moi);
    ghi(t, caret + moi.length);
    setTypedWord("");
    setTimeout(() => oInline()?.focus(), 0);
  };
  /** Phím điều hướng danh sách gợi ý — dùng chung cho ô gõ chip và ô chữ. `true` = đã xử lý. */
  const phimGoiY = (e: React.KeyboardEvent): boolean => {
    if (!goiY.length) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = goiY.length;
      setChiGoiY((i) => (e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n));
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      chonGoiY(goiY[Math.min(chiGoiY, goiY.length - 1)].ma);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setTatGoiY(true);
      return true;
    }
    return false;
  };

  const handleInlineChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTatGoiY(false);
    setChiGoiY(0);
    const text = e.target.value;

    // Nếu gõ toán tử (+ - * / ()), commit từ trước đó (nếu có) + toán tử
    const lastChar = text.slice(-1);
    if (/^[\+\-\*\/\(\)]$/.test(lastChar)) {
      const wordBefore = text.slice(0, -1).trim();
      let appended = "";
      if (wordBefore) {
        appended += wordBefore + " ";
      }
      appended += (lastChar === "*" ? " * " : lastChar === "/" ? " / " : lastChar === "-" ? " - " : lastChar === "+" ? " + " : lastChar);
      chenTaiCaret(appended);
      setTypedWord("");
      return;
    }

    setTypedWord(text);

    // Nếu từ vừa gõ khớp chính xác 1 mã biến trong whitelist -> tự hóa Chip ngay!
    // TRỪ khi còn mã DÀI HƠN bắt đầu bằng chữ này (`so_mau` còn `so_mau_pha`): chốt sớm là người
    // ta không gõ nốt được nữa, phải tự gõ hết cả chữ (không còn gợi ý để chọn giữa chừng).
    const trimmed = text.trim();
    const conMaDaiHon = whitelist.some((v) => v !== trimmed && v.startsWith(trimmed));
    if (whitelist.includes(trimmed) && !conMaDaiHon) {
      chenTaiCaret(trimmed);
      setTypedWord("");
      return;
    }
  };

  const handleInlineKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (phimGoiY(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    const phim = e.key.toLowerCase();

    // Bậc đang chọn: Delete xoá cả bậc, Ctrl+C chép, Esc bỏ chọn.
    if (bacChon) {
      if (mod && phim === "c") {
        e.preventDefault();
        chep(toks.slice(bacChon.ifIdx, bacChon.phay2 + 1), "Đã chép bậc");
        return;
      }
      if (!typedWord && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        xoa(bacChon);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setChonIf(null);
        return;
      }
    }

    // Hoàn tác / làm lại — chỉ khi ô gõ trống; đang gõ dở thì để trình duyệt lo chữ trong ô.
    if (mod && !typedWord && phim === "z" && !e.shiftKey) {
      e.preventDefault();
      hoanTac();
      return;
    }
    if (mod && !typedWord && (phim === "y" || (phim === "z" && e.shiftKey))) {
      e.preventDefault();
      lamLai();
      return;
    }

    // Enter: chốt chữ đang gõ thành chip (số "1000" chẳng khớp biến nào cũng phải chốt được),
    // và chặn Enter lọt ra ngoài làm submit drawer.
    if (e.key === "Enter" && typedWord.trim()) {
      e.preventDefault();
      commitTypedWord();
      return;
    }

    // ---- ĐIỀU HƯỚNG TRONG DÃY CHIP ----
    // Ô gõ trống ⇒ mũi tên/Backspace/Delete nói về CHIP chứ không về chữ. Còn đang gõ dở thì để
    // yên cho con trỏ chạy trong chữ như mọi ô nhập bình thường.
    const el = e.currentTarget;
    const oDauChu = el.selectionStart === 0 && el.selectionEnd === 0;

    if (!typedWord) {
      if (e.key === "ArrowLeft" && caret > 0) {
        e.preventDefault();
        setCaret(caret - 1);
        return;
      }
      if (e.key === "ArrowRight" && caret < toks.length) {
        e.preventDefault();
        setCaret(caret + 1);
        return;
      }
      if (e.key === "Home" && caret > 0) {
        e.preventDefault();
        setCaret(0);
        return;
      }
      if (e.key === "End" && caret < toks.length) {
        e.preventDefault();
        setCaret(toks.length);
        return;
      }
      if (e.key === "Backspace" && caret > 0) {
        e.preventDefault();
        handleRemoveToken(caret - 1);   // xoá chip BÊN TRÁI con trỏ
        return;
      }
      if (e.key === "Delete" && caret < toks.length) {
        e.preventDefault();
        handleRemoveToken(caret);       // xoá chip BÊN PHẢI con trỏ
        return;
      }
      return;
    }

    // Đang gõ dở mà bấm ← ở đầu chữ: chốt chữ thành chip rồi đứng BÊN TRÁI nó, đúng như ô nhập
    // thường nhảy qua một từ. Không chốt thì chữ vừa gõ bay mất không dấu vết.
    if (e.key === "ArrowLeft" && oDauChu) {
      const moi = catSach(typedWord);
      if (!moi.length) return;
      e.preventDefault();
      const t = [...toks];
      t.splice(caret, 0, ...moi);
      ghi(t, caret);
      setTypedWord("");
    }
  };

  const groups = useMemo(() => {
    const sizeVars = ["dai_tp", "rong_tp", "dai_nguyen", "rong_nguyen", "dai_in", "rong_in",
      "dai", "rong"];
    // `so_con` là tên hiện hành (đổi lại từ `so_tp` ngày 08/09/2026, mg `0286`) — nó vốn đã nằm
    // cuối danh sách này từ thời trước mg `0189`, nên xoá `so_tp` là đủ, chip vẫn về đúng nhóm.
    const qtyVars = ["so_luong", "so_trang", "trang_moi_tay", "so_mau", "so_mau_phu", "so_mat",
      "so_kem", "to_dau_vao", "to_sau_in", "to_nguyen", "so_con"];
    const priceVars = ["dinh_luong", "don_gia_giay", "don_gia_vat_tu"];
    const daXep = new Set([...sizeVars, ...qtyVars, ...priceVars]);

    return [
      {
        name: "Kích thước",
        key: "size",
        colorClass: "rc-formula__var-tag--size",
        icon: (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect width="20" height="8" x="2" y="8" rx="1.5"/>
            <path d="M6 16v-4M10 16v-2M14 16v-4M18 16v-2"/>
          </svg>
        ),
        vars: bienHienThi.filter(v => sizeVars.includes(v))
      },
      {
        name: "Số lượng & Sản lượng",
        key: "qty",
        colorClass: "rc-formula__var-tag--qty",
        icon: (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 22V4c0-.5.2-1 .6-1.4C5 2.2 5.5 2 6 2h12c.5 0 1 .2 1.4.6.4.4.6.9.6 1.4v18l-4-2-4 2-4-2-4 2z"/>
            <path d="M8 6h8M8 10h8M8 14h6"/>
          </svg>
        ),
        vars: bienHienThi.filter(v => qtyVars.includes(v))
      },
      {
        name: "Giá vốn & Đơn giá",
        key: "price",
        colorClass: "rc-formula__var-tag--price",
        icon: (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" x2="12" y1="2" y2="22"/>
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
        ),
        vars: bienHienThi.filter(v => priceVars.includes(v))
      },
      {
        name: "Khác",
        key: "khac",
        colorClass: "rc-formula__var-tag--qty",
        icon: null,
        vars: bienHienThi.filter(v => !daXep.has(v)),
      },
    ].filter(g => g.vars.length > 0);
  }, [bienHienThi]);

  // Kiểm lỗi — MỘT bộ cho cả hai chế độ. Trả kèm chỉ số token gây lỗi để tô đỏ đúng chip (Trực
  // quan) hoặc chỉ đúng dòng (Dạng chữ), thay vì chỉ một câu dưới đáy ô.
  const kiem = useMemo(
    () => (value.trim() ? kiemCongThuc(toks, validVars, MATH_FUNCS) : { loi: null, idx: null }),
    [value, toks, validVars],
  );
  const valid = kiem.loi === null;
  const error = kiem.loi;
  const viTriLoi = cheDo === "chu" && kiem.idx != null ? viTriToken(chu)[kiem.idx] : undefined;
  const dongLoi = viTriLoi ? chu.slice(0, viTriLoi.i).split("\n").length : null;
  const toiChoLoi = () => {
    const ta = taRef.current;
    if (!ta || !viTriLoi) return;
    ta.focus();
    ta.setSelectionRange(viTriLoi.i, viTriLoi.i + viTriLoi.tok.length);
  };

  // Cặp ngoặc cạnh con trỏ sáng lên (như Excel tô cặp ngoặc) — chỉ lúc đang gõ trong ô.
  const sang = new Set<number>();
  if (dangGo && cheDo === "truc_quan" && !typedWord) {
    const p = toks[caret - 1] === "(" || toks[caret - 1] === ")" ? caret - 1
      : toks[caret] === "(" || toks[caret] === ")" ? caret : -1;
    if (p >= 0) {
      sang.add(p);
      if (khop[p] >= 0) sang.add(khop[p]);
    }
  }
  const lopPhu = (i: number) => [
    khung.has(i) && "is-khung",
    bacChon && i >= bacChon.ifIdx && i <= bacChon.phay2 && "is-chon",
    sang.has(i) && "is-sang",
    kiem.idx === i && "is-loi",
  ].filter(Boolean).join(" ");

  // Biến đang dùng — dòng tra nghĩa dưới ô chữ (ô chữ không rê chuột xem nghĩa từng chữ được).
  const bienDangDung = useMemo(
    () => [...new Set(toks)].filter((t) => whitelist.includes(t) || tra(t)),
    [toks, whitelist, tra],
  );

  return (
    // `data-giu-esc`: đang có lớp nhỏ hơn cần Esc (gợi ý biến / bậc đang chọn) — popup nổi thấy dấu
    // này thì nhường, không coi Esc là "Huỷ" (xem `FormulaPopover`).
    <div className="rc-formula" data-giu-esc={goiY.length || bacChon ? "" : undefined}>
      {/* 1. Trình soạn thảo công thức ở trên cùng */}
      <div className="rc-formula__editor-container">
        <div className="rc-formula__editor-header">
          <span className="rc-formula__editor-label">{nhanO}</span>
          {thongBao && <span className="rc-formula__thong-bao" role="status">{thongBao}</span>}
          <div className="rc-formula__che-do" role="group" aria-label="Chế độ xem">
            <button type="button" className={cheDo === "truc_quan" ? "is-active" : ""}
              aria-pressed={cheDo === "truc_quan"} onClick={() => doiCheDo("truc_quan")}
              title="Chip + bậc thang — dễ đọc">Trực quan</button>
            <button type="button" className={cheDo === "chu" ? "is-active" : ""}
              aria-pressed={cheDo === "chu"} onClick={() => doiCheDo("chu")}
              title="Chuỗi mã như thanh công thức Excel — copy/paste tự do">Dạng chữ</button>
          </div>
          <button type="button" className="rc-formula__syntax-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => chep(toks, "Đã chép công thức")} disabled={!toks.length}
            title="Chép cả công thức ra chuỗi mã (dán được sang máy khác, ô khác)">
            Sao chép
          </button>
          <button
            ref={syntaxBtnRef}
            type="button"
            className={`rc-formula__syntax-btn${showSyntax ? " is-open" : ""}`}
            onClick={() => setShowSyntax((s) => !s)}
            aria-expanded={showSyntax}
            title="Phép tính · hàm · biến được hỗ trợ"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M6 8h.01M10 8h.01M14 8h.01M6 12h.01M10 12h.01M14 12h.01M8 16h8" />
            </svg>
            Cú pháp
          </button>
          {showSyntax && (
            <div ref={syntaxPopRef} className="rc-syntax" role="dialog" aria-label="Cú pháp công thức">
              <div className="rc-syntax__head">
                <span>Cú pháp công thức</span>
                <button type="button" className="rc-syntax__x" onClick={() => setShowSyntax(false)} aria-label="Đóng">
                  <XIcon size={12} />
                </button>
              </div>
              <div className="rc-syntax__body">
                <div className="rc-syntax__sec-title">Phép tính</div>
                <table className="rc-syntax__tbl"><tbody>
                  <tr><td><code>+ - * /</code></td><td>cộng · trừ · nhân · chia</td></tr>
                  <tr><td><code>**</code></td><td>lũy thừa</td></tr>
                  <tr><td><code>( )</code></td><td>ngoặc nhóm</td></tr>
                  <tr><td><code>-x</code></td><td>dấu âm đơn</td></tr>
                  <tr><td><code>,</code></td><td>ngăn tham số hàm</td></tr>
                </tbody></table>
                <div className="rc-syntax__sec-title">So sánh — chỉ dùng trong if(...)</div>
                <table className="rc-syntax__tbl"><tbody>
                  <tr><td><code>&gt; &lt; &gt;= &lt;=</code></td><td>lớn hơn · nhỏ hơn · ≥ · ≤</td></tr>
                  <tr><td><code>== !=</code></td><td>bằng · khác</td></tr>
                </tbody></table>
                <div className="rc-syntax__sec-title">Hàm</div>
                <table className="rc-syntax__tbl"><tbody>
                  <tr><td><code>if(dk, dung, sai)</code></td><td>đúng điều kiện thì lấy vế 1, sai thì vế 2 — lồng được nhiều lớp</td></tr>
                  <tr><td><code>max(a,b)</code></td><td>lớn nhất — giá sàn</td></tr>
                  <tr><td><code>min(a,b)</code></td><td>nhỏ nhất — giá trần</td></tr>
                  <tr><td><code>round(x)</code></td><td>làm tròn</td></tr>
                  <tr><td><code>ceil(x)</code></td><td>làm tròn lên</td></tr>
                  <tr><td><code>floor(x)</code></td><td>làm tròn xuống</td></tr>
                </tbody></table>
                <div className="rc-syntax__sec-title">Biến</div>
                <p className="rc-syntax__note">Bấm chip biến ở dưới để chèn, hoặc gõ vài chữ tên tiếng Việt ("màu", "kẽm") rồi chọn gợi ý. Kích thước tính bằng <b>mét</b>.</p>
                <div className="rc-syntax__sec-title">Thao tác</div>
                <table className="rc-syntax__tbl"><tbody>
                  <tr><td><code>Ctrl+Z · Ctrl+Y</code></td><td>hoàn tác · làm lại</td></tr>
                  <tr><td><code>Ctrl+V</code></td><td>dán chuỗi công thức thành chip tại con trỏ</td></tr>
                  <tr><td>nhãn <i>điều kiện</i></td><td>bấm để chọn cả bậc — Nhân đôi / Xoá / Ctrl+C</td></tr>
                  <tr><td>Dạng chữ</td><td>sửa như ô chữ thường, copy/paste tự do</td></tr>
                </tbody></table>
              </div>
            </div>
          )}
        </div>

        {/* Thanh chèn toán tử nhanh */}
        {/* `preventDefault` trên mousedown: giữ con trỏ trong ô inline. Không có nó thì bấm nút là
            ô blur TRƯỚC → chốt chữ đang gõ một lần, rồi `insertVar` chốt thêm lần nữa → chip đôi. */}
        <div className="rc-formula__op-toolbar" onMouseDown={(e) => e.preventDefault()}>
          <span className="rc-formula__op-label">Chèn toán tử:</span>
          <button type="button" className="rc-formula__op-btn" onClick={() => insertVar(" + ")} title="Cộng">+</button>
          <button type="button" className="rc-formula__op-btn" onClick={() => insertVar(" - ")} title="Trừ">−</button>
          <button type="button" className="rc-formula__op-btn" onClick={() => insertVar(" * ")} title="Nhân">×</button>
          <button type="button" className="rc-formula__op-btn" onClick={() => insertVar(" / ")} title="Chia">÷</button>
          <button type="button" className="rc-formula__op-btn" onClick={() => insertVar("(")} title="Mở ngoặc">(</button>
          <button type="button" className="rc-formula__op-btn" onClick={() => insertVar(")")} title="Đóng ngoặc">)</button>
          <button type="button" className="rc-formula__op-btn" onClick={() => insertVar(" > ")} title="Lớn hơn">&gt;</button>
          <button type="button" className="rc-formula__op-btn" onClick={() => insertVar(" < ")} title="Nhỏ hơn">&lt;</button>
          <button type="button" className="rc-formula__op-btn" onClick={() => insertVar(" >= ")} title="Lớn hơn hoặc bằng">&gt;=</button>
          <button type="button" className="rc-formula__op-btn" onClick={() => insertVar(" <= ")} title="Nhỏ hơn hoặc bằng">&lt;=</button>
          <button type="button" className="rc-formula__op-btn" onClick={() => insertVar(" == ")} title="Bằng">==</button>
          <button type="button" className="rc-formula__op-btn" onClick={() => insertVar(" != ")} title="Khác">!=</button>
          <button type="button" className="rc-formula__op-btn" onClick={() => insertVar("max(")} title="Hàm max">max</button>
          <button type="button" className="rc-formula__op-btn" onClick={() => insertVar("min(")} title="Hàm min">min</button>
          <button type="button" className="rc-formula__op-btn" onClick={() => insertVar("round(")} title="Hàm round">round</button>
          <button type="button" className="rc-formula__op-btn" onClick={() => insertVar("if(")} title="Hàm if — điều kiện">if</button>
        </div>

        {cheDo === "truc_quan" ? (
        /* Ô công thức Chip Tiếng Việt duy nhất (Inline Chip Editor Container) */
        <div
          className="rc-formula__single-stage"
          // Bấm vào KHOẢNG TRỐNG của ô (chip và ô gõ tự chặn cú bấm của mình) → con trỏ về khe GẦN
          // NHẤT chỗ bấm. Trước 03/09/2026 chỗ này quăng thẳng con trỏ về CUỐI công thức, mà "khoảng
          // trống" gồm cả kẽ 6px giữa hai chip và cả phần trắng bên phải mỗi dòng — nhắm vào kẽ để
          // chen một dấu là bị đá về đuôi, nhìn như bấm không ăn.
          onMouseDown={(e) => datCaretTheoDiem(e)}
        >
          <div className="rc-formula__chips-wrap">
            {/* Mỗi DÒNG = một đoạn token liên tục (xem `tinhDong` — bậc thang: chuỗi else-if thẳng
                một cột). Con trỏ vẫn là MỘT chỉ số duy nhất trên mảng token phẳng — chỉ có dòng NÀO
                hiện ô gõ và ô gõ đứng ở đâu TRONG dòng đó là đổi theo `caret`. */}
            {dongHienThi.map((d, di) => {
              const laDongCoCaret = di === dongCuaCaret;
              const caretTrongDong = laDongCoCaret ? caret - d.start : 0;
              const veTuDong = (from: number, to: number) =>
                toks.slice(from, to).map((tok, i) =>
                  veChip({
                    tok, idx: from + i, tra, validVars, whitelist, onXoa: handleRemoveToken,
                    onDatCaret: datCaret, them: lopPhu(from + i),
                  }),
                );
              const b = d.bac;
              const dangChon = !!b && bacChon?.ifIdx === b.ifIdx;
              return (
                <div
                  key={di}
                  className={`rc-formula__row${d.dieuKien ? " is-dieu-kien" : ""}`}
                  style={d.cap > 0 ? {
                    marginLeft: d.cap * 18,
                    paddingLeft: 10,
                    borderLeft: `2px solid ${MAU_CAP[(d.cap - 1) % MAU_CAP.length]}`,
                  } : undefined}
                >
                  {laDongCoCaret ? veTuDong(d.start, d.start + caretTrongDong) : veTuDong(d.start, d.end)}

                  {laDongCoCaret && (
                    <div
                      className={`rc-formula__inline-input-box${caret < toks.length ? " rc-formula__inline-input-box--giua" : ""}`}
                      // Đứng giữa dãy thì ô gõ chỉ được rộng bằng chữ đang gõ — để nguyên `flex:1` là nó
                      // đẩy toàn bộ chip bên phải văng sang lề kia.
                      style={caret < toks.length ? { width: `${Math.max(1, typedWord.length)}ch` } : undefined}
                      // Bấm vào CHÍNH ô gõ thì không được coi là "bấm chỗ trống": nền ô sẽ kéo con trỏ về
                      // cuối, mà con trỏ đang đứng giữa dãy — vừa đặt xong đã bị lôi đi.
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        id={id}
                        className="rc-formula__inline-input"
                        value={typedWord}
                        onChange={handleInlineChange}
                        onKeyDown={handleInlineKeyDown}
                        onPaste={handlePaste}
                        onFocus={() => setDangGo(true)}
                        onBlur={() => { setDangGo(false); handleInlineBlur(); }}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={value.trim() ? "" : goY}
                      />
                    </div>
                  )}

                  {laDongCoCaret && veTuDong(d.start + caretTrongDong, d.end)}

                  {/* Nhãn mờ bên phải — KHÔNG phải token, không lưu (giống dòng gợi ý tham số của
                      Excel). Nhãn điều kiện bấm được: chọn cả bậc để nhân đôi / xoá / chép. */}
                  {d.nhan && (
                    <span className="rc-formula__nhan-cum"
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onClick={(e) => e.stopPropagation()}>
                      {dangChon && b && <>
                        <button type="button" className="rc-formula__bac-btn" onClick={() => nhanDoi(b)}
                          title="Chép bậc này ngay bên dưới — sửa số trên bản sao">Nhân đôi bậc</button>
                        <button type="button" className="rc-formula__bac-btn rc-formula__bac-btn--xoa"
                          onClick={() => xoa(b)} title="Bỏ bậc này — các bậc khác giữ nguyên">Xoá bậc</button>
                      </>}
                      {b ? (
                        <button type="button"
                          className={`rc-formula__nhan rc-formula__nhan--nut${dangChon ? " is-chon" : ""}`}
                          aria-pressed={dangChon}
                          title="Chọn cả bậc — Delete xoá, Ctrl+C chép"
                          onClick={() => {
                            if (typedWord.trim()) { commitTypedWord(); return; }
                            setChonIf(dangChon ? null : b.ifIdx);
                            oInline()?.focus();
                          }}>{d.nhan}</button>
                      ) : <span className="rc-formula__nhan">{d.nhan}</span>}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        ) : (
        <div className="rc-formula__chu">
          <textarea
            ref={taRef}
            id={id}
            className="rc-formula__chu-o"
            value={chu}
            rows={Math.min(18, Math.max(3, chu.split("\n").length + 1))}
            spellCheck={false}
            autoComplete="off"
            placeholder={goY}
            aria-label="Công thức dạng chữ"
            onChange={(e) => { doiChu(e.target.value); docTuChu(e.target); }}
            onSelect={(e) => docTuChu(e.currentTarget)}
            onKeyDown={(e) => { phimGoiY(e); }}
            onBlur={() => setTuChu(null)}
          />
          {bienDangDung.length > 0 && (
            <div className="rc-formula__bien-dung">
              <span className="rc-formula__bien-dung-nhan">Biến đang dùng:</span>
              {bienDangDung.map((ma) => (
                <span key={ma} className="rc-formula__bien-dung-muc">
                  <code>{ma}</code> = {tra(ma)?.nhan ?? "—"}
                </span>
              ))}
            </div>
          )}
        </div>
        )}

        {/* Gợi ý biến theo tên tiếng Việt — nằm TRONG luồng ngay dưới ô (không nổi), popup có cuộn
            cũng không cắt mất nó. */}
        {goiY.length > 0 && (
          <div className="rc-formula__goi-y" role="listbox" aria-label="Gợi ý biến"
            onMouseDown={(e) => e.preventDefault()}>
            {goiY.map((g, i) => (
              <button key={g.ma} type="button" role="option"
                aria-selected={i === chiGoiY}
                className={`rc-formula__goi-y-muc${i === chiGoiY ? " is-active" : ""}`}
                onClick={() => chonGoiY(g.ma)}>
                <span>{g.nhan}</span> <code>{g.ma}</code>
              </button>
            ))}
            <span className="rc-formula__goi-y-meo">↑↓ chọn · Enter chèn · Esc ẩn</span>
          </div>
        )}
      </div>

      {!valid && (
        <div className="rc-formula__validation">
          <div className="rc-formula__status rc-formula__status--error">
            <CircleXIcon size={12} sw={3} style={{ marginRight: "6px" }} />
            {error}
            {dongLoi != null && <>
              {" "}— dòng {dongLoi}
              <button type="button" className="rc-formula__toi-loi" onClick={toiChoLoi}>Tới chỗ lỗi</button>
            </>}
          </div>
        </div>
      )}

      {/* 3. Danh sách biến khả dụng (Gom chung 1 nhóm) */}
      <div className="rc-formula__header-bar">
        <span className="rc-formula__header-title">Danh sách biến khả dụng</span>
      </div>

      <div className="rc-formula__all-vars" onMouseDown={(e) => e.preventDefault()}>
        {groups.flatMap((g) => g.vars.map((v) => ({ v, colorClass: g.colorClass }))).map(({ v, colorClass }) => (
          <button
            key={v}
            type="button"
            className={`rc-formula__var-tag ${colorClass}`}
            onClick={() => insertVar(v)}
            // Hover nói đủ BA thứ: ý nghĩa · đơn vị · số ở đâu ra. Thiếu đơn vị thì người khai
            // không biết `dai_in` là mét hay milimét (chỗ đẻ ra công thức lệch thang); thiếu nguồn
            // thì không biết `to_dau_vao` đã gồm bù hao chưa rồi nhân hao thêm lần nữa.
            title={tra(v)
              ? `${tra(v)!.mo_ta}\nĐơn vị: ${tra(v)!.don_vi}\nNguồn: ${tra(v)!.nguon}`
              : v}
          >
            <span className="rc-formula__var-name">{tra(v)?.nhan ?? v}</span>
            <code className="rc-formula__var-code">{v}</code>
          </button>
        ))}
      </div>
    </div>
  );
}
