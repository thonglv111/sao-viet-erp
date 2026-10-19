// BẢNG → THẺ trên điện thoại (14/10/2026 — docs/thiet-ke-mobile.md §4.1).
//
// ~100 màn vẽ bảng danh sách (`lds-g` trong `CuonLuoi`, `ns__table` của Nhân sự & Lương…), mỗi màn
// tự dựng ô theo khoá cột. Thay vì sửa từng màn, khung app (chỉ khi ở mốc điện thoại) chạy
// `useTheHoaBang`: mọi bảng khớp `BANG_THE` được đánh `data-the` và gọi `ganNhanThe` — mỗi ô nhận
// `data-nhan` = tiêu đề cột và `data-vai` = vai trò trên thẻ; CSS `styles/mobile/the.css` dựa vào đó
// biến mỗi `<tr>` thành một thẻ. Máy lớn không chạy nên không đổi gì.
//
// Bảng KHÔNG nên thành thẻ (lưới công tháng, ma trận…) thì không thêm vào `BANG_THE`, hoặc gắn
// `data-khong-the` lên bảng / khung bọc nó.
//
// Vai trò (`data-vai`):
//   dau   ô đầu tiên (thường là MÃ) — góc trên-trái, chữ đậm
//   dau-ten  ô đầu tiên mà là cột TÊN — cùng chỗ, chữ to như `ten`
//   tt    ô chip trạng thái đầu tiên — góc trên-phải
//   ten   cột tên chính (khách / nhân viên / NCC / hàng…) — dòng to dưới mã, không nhãn
//   tien  cột tiền (Số tiền / Giá trị / Tổng / Còn nợ…) có chữ số — đậm, để mắt bắt ngay
//   nut   ô chỉ chứa nút thao tác — chân thẻ
//   chon  ô tick chọn — góc trái, trước mã
//   toan  ô gộp nhiều cột (dòng trống, dòng Cộng) — trải hết bề ngang
//   ""    ô dữ liệu thường — cặp "nhãn · giá trị"
// `data-trong` = ô không có gì để xem (trống / "—") ⇒ thẻ ẩn ô đó cho gọn.
// Màn chỉnh được từng ô: `data-vai-the="…"` ép vai, `data-luon-hien` cấm ẩn khi trống,
// `data-nhan-the="…"` đặt nhãn riêng cho ô.

import { useEffect } from "react";

/** Nhãn cột coi là TÊN CHÍNH của dòng (hiện to ngay dưới mã). Thứ tự không quan trọng. */
const COT_TEN =
  /(khách|^tên|^loại|họ tên|nhân viên|nhà cung cấp|\bncc\b|mặt hàng|hàng hoá|^hàng|sản phẩm|đối tượng|nội dung|thiết bị|^máy|tiêu đề|người đề nghị|người nhận|công việc|vật tư|giấy)/i;

/** Nhãn cột TIỀN — giá trị in đậm trên thẻ. */
const COT_TIEN = /(tiền|giá trị|^tổng|còn nợ|còn thiếu|còn lại|số dư|thực lĩnh|công nợ|phải thu|phải trả)/i;

/** Phần tử "chip trạng thái" — các họ lớp đang dùng: lds-chip, ns-badge, cc-badge-pill, *-tag… */
const CHIP = "[class*='chip'], [class*='badge'], [class*='pill'], [class*='tag']";

const RONG = new Set(["", "—", "-", "–"]);

/** Ô TRẠNG THÁI = chip chiếm gần hết chữ của ô. Ô "Trần Văn Hùng [CHƯA KHAI LƯƠNG]" là ô TÊN có
 *  kèm chip, không phải ô trạng thái — kéo nó lên góc phải là bóp mã thành một cột dọc. */
function laOTrangThai(td: HTMLElement, chu: string): boolean {
  const chip = td.querySelector(CHIP);
  if (!chip) return false;
  const chuChip = (chip.textContent ?? "").replace(/\s+/g, " ").trim();
  return chuChip.length >= chu.length * 0.6;
}

/** Chữ NHÌN THẤY của ô: bỏ bong bóng gợi ý (`role=tooltip`), chữ cho trình đọc màn hình (`.sr-only`),
 *  phần `aria-hidden`; `boNut` thì bỏ luôn chữ trong nút. Không dùng `innerText` (ép trình duyệt
 *  dàn trang lại cho từng ô — bảng 300 dòng là chậm thấy rõ). */
function chuO(td: HTMLElement, boNut = false): string {
  let s = "";
  const di = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) s += n.textContent ?? "";
    else if (n instanceof Element) {
      if (n.matches("[role=tooltip], .sr-only, [aria-hidden='true']")) return;
      if (boNut && (n.tagName === "BUTTON" || n.matches("[role=button]"))) return;
      n.childNodes.forEach(di);
    }
  };
  td.childNodes.forEach(di);
  return s.replace(/\s+/g, " ").trim();
}

/** Ô NÚT THAO TÁC (xuống chân thẻ): ô `lds-nut`, hoặc ô chỉ toàn nút mà nút là biểu tượng / có từ hai
 *  nút / nằm ở cột "Thao tác". MỘT nút có chữ trong cột có tên (vd cột "Báo giá" = nút "BG26-0004")
 *  là DỮ LIỆU dạng liên kết — giữ nhãn "Báo giá · BG26-0004", không đẩy xuống chân thẻ. */
function laONut(td: HTMLElement, label: string, chu: string): boolean {
  if (td.classList.contains("lds-nut")) return true;
  if (!td.querySelector("button") || chuO(td, true)) return false;
  const soNut = td.querySelectorAll("button, a[href]").length;
  return !chu || soNut >= 2 || !label || /thao tác|hành động/i.test(label);
}

function datNeuKhac(el: HTMLElement, khoa: string, gt: string | null) {
  if (gt === null) {
    if (khoa in el.dataset) delete el.dataset[khoa];
  } else if (el.dataset[khoa] !== gt) {
    el.dataset[khoa] = gt;
  }
}

/** Gắn `data-nhan` / `data-vai` / `data-trong` cho mọi ô thân bảng. Gọi lại an toàn (chỉ ghi khi đổi). */
export function ganNhanThe(bang: HTMLTableElement): void {
  // Nhãn cột = ô tiêu đề ở tầng DƯỚI CÙNG phủ cột đó (bảng lương có 2 tầng: nhóm "Thu nhập (+)" ở
  // trên, tên cột "Phụ cấp" ở dưới). Dựng lưới tiêu đề theo rowSpan/colSpan; ô bị trải ngang chỉ
  // mang nhãn ở cột đầu của nó.
  const luoi: (HTMLTableCellElement | undefined)[][] = [];   // ô tiêu đề tại [tầng][cột] — chỉ cột ĐẦU của ô
  const chiem: boolean[][] = [];
  Array.from(bang.tHead?.rows ?? []).forEach((tr, r) => {
    let c = 0;
    for (const th of Array.from(tr.cells)) {
      while (chiem[r]?.[c]) c++;
      for (let i = 0; i < (th.rowSpan || 1); i++) {
        (luoi[r + i] ??= [])[c] = th;
        for (let j = 0; j < (th.colSpan || 1); j++) (chiem[r + i] ??= [])[c + j] = true;
      }
      c += th.colSpan || 1;
    }
  });
  const soCot = Math.max(0, ...chiem.map((h) => h.length));
  const nhan: string[] = [];
  for (let c = 0; c < soCot; c++) {
    let t = "";
    for (let r = luoi.length - 1; r >= 0 && !t; r--) {
      const th = luoi[r]?.[c];
      if (th) t = (th.textContent ?? "").replace(/[↑↓▲▼⇅↕]/g, "").replace(/\s+/g, " ").trim();
    }
    nhan.push(t);
  }

  // Có cột tên "Trạng thái" thì CHỈ cột đó lên góc phải thẻ — không thì chip loại/phòng ban đứng
  // trước (vd "Tạm ứng") chiếm chỗ của trạng thái thật ("Đã duyệt — chờ phiếu chi"). Cột "Hàng" của
  // đơn mua (Nháp / Đã về đủ…) là trạng thái đơn — không có nó thì chip "Theo yêu cầu" lên góc thẻ.
  const cotTt = nhan.findIndex((t) => /^(trạng thái|tình trạng)|^hàng$/i.test(t));

  // Hàng TỔNG (tfoot) gắn nhãn như dòng thường — thẻ tổng cuối danh sách cần tên cột cho từng số.
  for (const tb of [...Array.from(bang.tBodies), ...(bang.tFoot ? [bang.tFoot] : [])]) {
    for (const tr of Array.from(tb.rows)) {
      let viTri = 0;
      let coDau = false;
      let coTt = false;
      let coTen = false;
      for (const td of Array.from(tr.cells)) {
        const span = td.colSpan || 1;
        // Màn tự đặt nhãn cho ô (`data-nhan-the`) khi tiêu đề cột không tự đủ nghĩa — vd lịch nghỉ:
        // tiêu đề 2 tầng "T3" / "30" ⇒ nhãn thẻ "T3 30/9".
        const label = td.dataset.nhanThe ?? (span > 1 ? "" : nhan[viTri] ?? "");
        const chu = chuO(td);
        const coDieuKhien = !!td.querySelector("input, select, textarea, img, svg, button, a, canvas");
        let vai = "";
        // Màn tự khai vai cho ô (`data-vai-the`, "" = ô thường) thì theo màn, không đoán.
        if (td.dataset.vaiThe !== undefined) vai = td.dataset.vaiThe;
        // Ô gộp cột ĐỨNG ĐẦU mà còn ô số theo sau = tiêu đề hàng nhóm (vd "PMH-… · 5 đợt" của công
        // nợ theo đơn mua) ⇒ đầu thẻ. Gộp cả hàng (dòng trống, dòng mở rộng) mới là "toàn hàng".
        else if (span > 1 && !coDau && chu && td.nextElementSibling) {
          vai = "dau";
          coDau = true;
        } else if (span > 1) vai = "toan";
        // Ô tick CHỌN DÒNG luôn đứng trước cột dữ liệu đầu tiên. Checkbox ở giữa dòng là CÔNG TẮC
        // (vd "Đang dùng" của loại nghỉ) — ô thường có nhãn, kéo lên góc trái là đè lên tên.
        else if (!chu && !coDau && td.querySelector("input[type=checkbox]")) vai = "chon";
        else if (!coDau && (chu || coDieuKhien)) {
          // Ô đầu là cột TÊN (Nhân viên, Khách…) chứ không phải mã ⇒ vẫn đứng đầu thẻ nhưng chữ to.
          vai = COT_TEN.test(label) ? "dau-ten" : "dau";
          coDau = true;
          if (vai === "dau-ten") coTen = true;
        } else if (!coTt && (cotTt < 0 || cotTt === viTri) && chu.length <= 32 && laOTrangThai(td, chu)) {
          vai = "tt";
          coTt = true;
        } else if (laONut(td, label, chu)) {
          vai = "nut";
        } else if (!coTen && COT_TEN.test(label)) {
          vai = "ten";
          coTen = true;
        } else if (COT_TIEN.test(label) && /\d/.test(chu)) {
          vai = "tien";
        }
        datNeuKhac(td, "nhan", label || null);
        datNeuKhac(td, "vai", vai || null);
        // `data-luon-hien`: cột số liệu phải thấy cả khi bằng 0 / "—" (vd CN/Lễ của bảng công tháng).
        const anDuoc = vai !== "toan" && td.dataset.luonHien === undefined;
        datNeuKhac(td, "trong", anDuoc && RONG.has(chu) && !coDieuKhien ? "1" : null);
        // Ô chữ DÀI (lý do chi, ghi chú, diễn giải…) ⇒ nhãn một dòng trên, chữ trải cả bề ngang căn trái
        // — để kiểu "nhãn · giá trị" thì chữ dài căn phải gãy thành cột hẹp thụt lề.
        datNeuKhac(td, "dai", !vai && chu.length > 34 ? "1" : null);
        viTri += span;
      }
    }
  }
}

/** Bảng danh sách được đổi thành thẻ trên điện thoại. Thêm lớp ở đây khi rà tới phân hệ có bảng riêng. */
export const BANG_THE = [
  "table.lds-g",
  "table.ns__table",
  "table.ns-table-records",
  "table.cl-table",
  "table.lg-emp-table",
  "table.nqr__table",
  // Phiếu đi muộn/về sớm, yêu cầu chỉnh công, bảng công tháng (thẻ mỗi người — 31 ô ngày ẩn bằng
  // CSS, chạm thẻ mở lịch tháng), lịch nghỉ phép (thẻ mỗi người — chỉ còn những ngày có nghỉ).
  "table.cc-timesheet-table",
  // Tính giá: danh sách sản phẩm trong phiếu + dòng giá vốn (nguyên vật liệu / công đoạn).
  ".tg-complist__wrap > table",
  ".tg-cost__scroll > table",
  // Báo giá: bảng dòng hàng ở chi tiết báo giá (bản in `q-tbl` thì KHÔNG — giữ khuôn giấy).
  "table.bg-dong",
  // Đơn hàng bán: các bảng trong ngăn chi tiết đơn (yêu cầu giao, hàng hoá, hoá đơn…).
  "table.dhb__g",
  // Giao hàng: hàng của một lượt (`gh-hang`), bảng trong ngăn lượt xe (`kt-bang > kt-g`).
  "table.gh-hang",
  ".kt-bang > table",
  // Khách hàng: thống kê sản phẩm đã mua trong ngăn khách.
  "table.khtk__tbl",
].join(", ");

/** Bảng KHÔNG bao giờ thẻ hoá dù tràn: bản in (giữ khuôn giấy), phiếu lương, so sánh phiên bản,
 *  lưới phân ca (có cách bày tuần riêng). */
const KHONG_THE = "table.q-tbl, table.ps-tbl, table.mx-bang, table.cmp-tbl, table.cc-sp-table, table.lg-payslip2__tbl";

/** Có thẻ hoá bảng này không? Bảng khai trong `BANG_THE` thì luôn; bảng khác chỉ khi nó RỘNG HƠN khung
 *  chứa (tức là sẽ phải cuộn ngang) — tự phủ mọi màn chưa kịp khai mà không biến bảng 2–3 cột vừa
 *  khít thành thẻ thừa. Đã thẻ hoá thì giữ (bảng thẻ co lại vừa khung, đo lại sẽ ra "không tràn"). */
function nenTheHoa(b: HTMLTableElement): boolean {
  if (b.closest("[data-khong-the]")) return false;
  // Không có hàng tiêu đề (chữ) ⇒ thẻ không có nhãn nào — vd bảng phép tính "Đang có − Sắp xuất +
  // Sắp về = Dự kiến còn" trong ngăn kho: thành thẻ thì mỗi dòng một thẻ, dấu "−" đứng trơ.
  if (!b.tBodies.length || !(b.tHead?.textContent ?? "").trim()) return false;
  if (b.dataset.the === "1" || b.matches(BANG_THE)) return true;
  if (b.matches(KHONG_THE)) return false;
  const cha = b.parentElement;
  const rong = b.getBoundingClientRect().width;
  if (!cha || !rong) return false;   // đang ẩn (tab khác) — xét lại khi hiện
  return b.scrollWidth > cha.clientWidth + 8 || rong > window.innerWidth;
}

/** Đánh dấu + gắn nhãn mọi bảng thẻ hoá bên trong `goc`. */
export function theHoaTrong(goc: ParentNode): void {
  goc.querySelectorAll<HTMLTableElement>("table").forEach((b) => {
    if (!nenTheHoa(b)) return;
    if (b.dataset.the !== "1") b.dataset.the = "1";
    ganNhanThe(b);
  });
}

/** Dải chip cuộn ngang (tab màn, tab trạng thái, lọc nhanh): chip ĐANG CHỌN phải nằm trong tầm nhìn —
 *  không thì mở màn ở tab thứ 5 mà thấy tab 1–2 sáng… không cái nào sáng. Chỉ cuộn khi chip chọn ĐỔI. */
const DAI_CHIP = [
  ".cc-tabs", ".stabs", ".lds-flt", ".lds-xem", ".thsx-dem", ".cl-subtabs", ".lg-seg", ".np-seg", ".gh-seg", ".kt-seg", ".mh-seg",
  ".ts-seg", ".xa-seg", ".dhb__drawer-tabs", ".khsx-tabs", ".khsx-tabman", ".thsx-b-tabs", ".kcsb-tabs",
  ".bckt__tabs", ".acct-toolbar__tabs", ".rc-drawer__tabs", ".rdx-drawer__tabs", ".lg-modal-tab-nav",
].join(", ");
const CHIP_CHON = ".is-active, .is-on, .stabs__tab--active, button.on, [aria-selected='true'], [aria-pressed='true']";
const daCuon = new WeakMap<Element, Element>();

function cuonChipDangChon(goc: ParentNode): void {
  goc.querySelectorAll<HTMLElement>(DAI_CHIP).forEach((dai) => {
    const chon = dai.querySelector<HTMLElement>(CHIP_CHON);
    if (!chon || daCuon.get(dai) === chon) return;
    daCuon.set(dai, chon);
    if (dai.scrollWidth <= dai.clientWidth) return;
    const rd = dai.getBoundingClientRect();
    const rc = chon.getBoundingClientRect();
    if (rc.left >= rd.left && rc.right <= rd.right) return;
    dai.scrollLeft += rc.left - rd.left - (rd.width - rc.width) / 2;
  });
}

/** Tiêu đề trang (h1) trùng ĐÚNG tên màn trên thanh trên (`.topbar__tieu-de`) ⇒ đánh dấu để CSS ẩn —
 *  điện thoại không đủ chỗ cho cùng một chữ hai lần. Tiêu đề khác tên màn (vd có thêm kỳ, tên khách)
 *  thì giữ nguyên. */
function danhDauTieuDeTrung(): void {
  const ten = document.querySelector(".topbar__tieu-de")?.textContent?.trim().toLowerCase();
  document.querySelectorAll<HTMLElement>(".shell__content h1").forEach((h) => {
    const trung = !!ten && (h.textContent ?? "").trim().toLowerCase() === ten;
    if (trung !== h.hasAttribute("data-trung-tieu-de")) h.toggleAttribute("data-trung-tieu-de", trung);
  });
}

/** Khung app gọi một lần: bật ⇒ quan sát cả trang (gồm hộp thoại / ngăn mở ngoài khung nội dung) và
 *  mỗi khi DOM đổi (gom theo khung hình) thì thẻ hoá bảng + đưa chip đang chọn vào tầm nhìn; tắt (rời
 *  mốc điện thoại) ⇒ gỡ `data-the`. */
export function useTheHoaBang(bat: boolean): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!bat) {
      document.querySelectorAll<HTMLTableElement>("table[data-the]").forEach((b) => delete b.dataset.the);
      document.querySelectorAll("[data-trung-tieu-de]").forEach((h) => h.removeAttribute("data-trung-tieu-de"));
      return;
    }
    let raf = 0;
    const chay = () => {
      raf = 0;
      theHoaTrong(document.body);
      cuonChipDangChon(document.body);
      danhDauTieuDeTrung();
    };
    chay();
    // Chỉ chạy lại khi đổi chạm tới bảng / dải chip — đồng hồ chấm công nhảy từng giây, toast,
    // ô nhập đang gõ… không đáng quét lại mọi bảng.
    const dangKe = (n: Node | null): boolean => {
      const el = n instanceof Element ? n : n?.parentElement;
      if (!el) return false;
      return !!(el.closest(`table, h1, ${DAI_CHIP}`) || el.querySelector(`table, h1, ${DAI_CHIP}`));
    };
    const mo = new MutationObserver((ds) => {
      if (raf) return;
      if (ds.some((d) => dangKe(d.target))) raf = requestAnimationFrame(chay);
    });
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "aria-selected"],
    });
    return () => {
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [bat]);
}
