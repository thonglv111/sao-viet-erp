// Bằng chứng THẬT cho ô soạn công thức (`FormulaField`) — khoá lại vụ TRẮNG MÀN 14/08/2026.
//
// Ô này vừa đổi từ `textarea` sang "ô chip inline". Bản đổi bỏ ba hàm mà JSX vẫn gọi
// (`handleRemoveToken`, `handleInlineBlur`, `insertVar`) ⇒ ReferenceError NGAY LÚC RENDER ⇒ React
// gỡ cả cây ⇒ bấm "Công thức" ở drawer Đơn vị là trắng bong. Vite dev dùng esbuild, KHÔNG
// type-check, nên lỗi này lọt tới tận trình duyệt.
//
// Vì thế test ở đây phải RENDER và BẤM thật, không grep chuỗi: chỉ cần một identifier trong JSX
// mất chỗ dựa là cả bộ này đỏ.
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FormulaField } from "./RebuildCatalogPage";
import { AuthContext, type AuthState } from "../auth/AuthContext";

// Token null ⇒ `useBienCongThuc` không gọi API (từ điển rỗng, chip hiện MÃ thay nhãn). Whitelist
// đã truyền thẳng qua `bienGoiY` — đúng cách màn Đơn vị & quy đổi đang dùng.
const AUTH: AuthState = {
  status: "anonymous", user: null, token: null,
  login: async () => {}, logout: async () => {},
  updateUser: () => {}, notice: null, setNotice: () => {},
};

const BIEN = ["dinh_luong", "dai_in", "rong_in", "so_mau", "so_mau_pha"];

/** Cha giữ `value` — đúng như drawer thật, để thấy chuỗi công thức thay đổi ra sao. */
function Harness({
  dau = "", bien = BIEN, auth = AUTH,
}: {
  dau?: string; bien?: string[]; auth?: AuthState;
}) {
  const [v, setV] = useState(dau);
  return (
    <AuthContext.Provider value={auth}>
      <FormulaField
        id="ct-test" value={v} onChange={setV} configPrefix="/api/don-vi" bienGoiY={bien}
      />
      <output data-testid="ct">{v}</output>
    </AuthContext.Provider>
  );
}

const ct = () => screen.getByTestId("ct").textContent;
const o = () => screen.getByRole("textbox") as HTMLInputElement;

// 25/08/2026 — chuỗi công thức nay được CHUẨN HOÁ: token nối lại bằng đúng một dấu cách, không
// còn khoảng trắng thừa ở đuôi ("dai_in " → "dai_in"). Đây là hệ quả bắt buộc của việc cho ô gõ
// chạy vào GIỮA dãy chip: chỉ số chip phải khớp một-một với chuỗi, mà chuỗi còn khoảng trắng lạc
// thì mỗi lần cắt token ra một kiểu. Backend `safe_eval` phân tích bằng Python nên khoảng trắng
// không đổi kết quả tính — công thức cũ đã lưu vẫn chạy y như trước.

describe("ô soạn công thức không được trắng màn", () => {
  it("render được với công thức có sẵn — chip + ô gõ đều có mặt", () => {
    render(<Harness dau="dinh_luong * dai_in" />);
    expect(o()).toBeInTheDocument();
    expect(screen.getByTitle("Xoá biến dinh_luong")).toBeInTheDocument();
  });

  it("render được khi công thức TRỐNG — đây chính là lúc bấm nút “Công thức” ở drawer Đơn vị", () => {
    render(<Harness />);
    expect(o()).toBeInTheDocument();
    expect(ct()).toBe("");
  });
});

describe("thao tác trên ô công thức", () => {
  it("bấm chip biến rồi bấm toán tử → công thức nối thêm (insertVar)", async () => {
    const user = userEvent.setup();
    render(<Harness dau="dinh_luong" />);
    await user.click(screen.getByTitle("Nhân"));
    expect(ct()).toBe("dinh_luong *");
  });

  it("bấm × trên chip → đúng token đó biến mất, phần còn lại giữ nguyên (handleRemoveToken)", async () => {
    const user = userEvent.setup();
    render(<Harness dau="dinh_luong * dai_in" />);
    await user.click(screen.getByTitle("Xoá biến dinh_luong"));
    expect(ct()).toBe("* dai_in");
  });

  it("gõ số rồi rời ô → số được chốt vào công thức chứ không bay mất (handleInlineBlur)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(o(), "1000");
    expect(ct()).toBe("");        // còn nằm trong ô gõ, chưa vào công thức
    await user.tab();
    expect(ct()).toBe("1000");
  });

  it("gõ đúng tên biến → tự hoá chip ngay", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(o(), "dai_in");
    expect(ct()).toBe("dai_in");
    expect(o().value).toBe("");
  });

  it("KHÔNG chốt sớm khi còn mã dài hơn: gõ hết “so_mau_pha” phải ra so_mau_pha", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(o(), "so_mau");
    expect(ct()).toBe("");        // `so_mau_pha` còn đó ⇒ chưa được chốt
    await user.type(o(), "_pha");
    expect(ct()).toBe("so_mau_pha");
  });
});

// Chỗ khó chịu 25/08/2026: ô gõ đóng đinh ở CUỐI công thức. Gõ nhầm một dấu ở giữa thì không có
// cách nào lùi vào đó — nút "×" chỉ mọc trên chip BIẾN, còn Backspace chỉ ăn chip cuối cùng, nên
// muốn bỏ dấu "×" ở giữa là phải xoá sạch mọi thứ đứng sau nó rồi gõ lại. Nay ô gõ chạy được.
describe("con trỏ chạy được trong dãy chip", () => {
  it("← rồi Backspace → xoá đúng chip Ở GIỮA, hai đầu giữ nguyên", async () => {
    const user = userEvent.setup();
    render(<Harness dau="dinh_luong * dai_in" />);
    await user.click(o());
    await user.keyboard("{ArrowLeft}{Backspace}");   // lùi qua `dai_in`, xoá dấu `*`
    expect(ct()).toBe("dinh_luong dai_in");
  });

  it("Home rồi gõ → chèn vào ĐẦU công thức chứ không nối vào đuôi", async () => {
    const user = userEvent.setup();
    render(<Harness dau="dinh_luong * dai_in" />);
    await user.click(o());
    await user.keyboard("{Home}");
    await user.type(o(), "1000");
    await user.tab();                                 // blur = chốt chữ đang gõ
    expect(ct()).toBe("1000 dinh_luong * dai_in");
  });

  it("Home rồi Delete → xoá chip BÊN PHẢI con trỏ", async () => {
    const user = userEvent.setup();
    render(<Harness dau="dinh_luong * dai_in" />);
    await user.click(o());
    await user.keyboard("{Home}{Delete}");
    expect(ct()).toBe("* dai_in");
  });

  it("bấm vào chip → con trỏ nhảy tới đó, không bị nền ô kéo về cuối", async () => {
    const user = userEvent.setup();
    render(<Harness dau="dinh_luong * dai_in" />);
    await user.click(screen.getByTitle("Mã: dinh_luong"));
    await user.type(o(), "1000");
    await user.tab();
    // Bấm nửa trái chip thì đứng trước, nửa phải thì đứng sau — jsdom không có kích thước thật nên
    // không chốt được nửa nào. Điều PHẢI đúng: số mới nằm cạnh chip vừa bấm, không rơi xuống cuối.
    expect(["1000 dinh_luong * dai_in", "dinh_luong 1000 * dai_in"]).toContain(ct());
  });
});

// Chỗ khó chịu 03/09/2026: con trỏ CHỈ đặt được bằng cách bấm trúng một chip. Kẽ 6px giữa hai
// chip (`gap` của `.rc-formula__row`) và cả dải trắng bên phải mỗi dòng đều là NỀN ô, mà nền ô lúc
// ấy quăng thẳng con trỏ về CUỐI công thức — nhắm vào kẽ giữa hai chip để chen một dấu là bị đá về
// đuôi, nhìn như bấm chẳng ăn thua gì.
//
// jsdom không tự tính layout: mọi `getBoundingClientRect` đều là 0. Phải bịa hình học thì mới thử
// được phép dò khe — chip thứ i chiếm x [50i, 50i+40] (kẽ 10px sau mỗi chip), dòng thứ j chiếm
// y [30j, 30j+30] và rộng hết 600px.
const HCN = (left: number, right: number, top: number, bottom: number) =>
  ({ left, right, top, bottom, x: left, y: top, width: right - left, height: bottom - top,
     toJSON() {} }) as DOMRect;

function biaHinhHoc() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains("rc-formula__row")) {
      const j = Array.prototype.indexOf.call(this.parentElement?.children ?? [], this);
      return HCN(0, 600, j * 30, j * 30 + 30);
    }
    const idx = this.dataset?.idx;
    if (idx != null) {
      const i = Number(idx);
      return HCN(i * 50, i * 50 + 40, 0, 30);
    }
    return HCN(0, 0, 0, 0);
  });
}

/** Bấm vào NỀN của dòng thứ `j` tại hoành độ `x` — đúng thứ chuột người dùng làm khi nhắm vào kẽ
 *  giữa hai chip: `mousedown` rồi `click`, cả hai đều mang toạ độ. */
function bamNenDong(j: number, x: number) {
  const dong = document.querySelectorAll<HTMLElement>(".rc-formula__row")[j];
  const toaDo = { clientX: x, clientY: j * 30 + 15 };
  fireEvent.mouseDown(dong, toaDo);
  fireEvent.click(dong, toaDo);
}

describe("bấm vào khoảng trống giữa các chip", () => {
  afterEach(() => vi.restoreAllMocks());

  it("bấm đúng KẼ giữa hai chip → con trỏ vào giữa, không rơi về cuối công thức", async () => {
    const user = userEvent.setup();
    render(<Harness dau="dinh_luong * dai_in" />);
    biaHinhHoc();
    bamNenDong(0, 95);            // kẽ giữa chip `*` (50–90) và chip `dai_in` (100–140)
    await user.type(o(), "1000");
    await user.tab();
    expect(ct()).toBe("dinh_luong * 1000 dai_in");
  });

  it("bấm dải trắng bên phải một dòng → con trỏ về CUỐI DÒNG ĐÓ, không nhảy xuống cuối công thức", async () => {
    const user = userEvent.setup();
    render(<Harness dau="if ( dinh_luong , dai_in" />);
    biaHinhHoc();
    // Bậc thang (29/09/2026): `if (` đi chung dòng với điều kiện ⇒ 2 dòng: [if · ( · dinh_luong · ,]
    // · [dai_in]. Bấm mãi bên phải dòng đầu ⇒ con trỏ đứng sau dấu phẩy, không nhảy về cuối.
    bamNenDong(0, 590);
    await user.type(o(), "1000");
    await user.tab();
    expect(ct()).toBe("if ( dinh_luong , 1000 dai_in");
  });
});

// BẬC THANG + HAI CHẾ ĐỘ (29/09/2026 — docs/superpowers/specs/2026-09-29-o-cong-thuc-bac-thang-hai-che-do-design.md).
// Chế độ xem nhớ trong localStorage ⇒ mỗi test tự dọn, không thì test trước để lại "Dạng chữ".
describe("bậc thang, hai chế độ, dán, hoàn tác", () => {
  afterEach(() => { localStorage.clear(); });

  const BAC = "if ( dai_in <= 3000 , 1 , if ( dai_in <= 10000 , 2 , 3 ) )";

  it("chuyển sang Dạng chữ, sửa chữ ⇒ chuỗi lưu vẫn đúng định dạng token; quay lại Trực quan giữ nguyên", async () => {
    const user = userEvent.setup();
    render(<Harness dau="dinh_luong * 2" />);
    await user.click(screen.getByRole("button", { name: "Dạng chữ" }));
    const ta = screen.getByRole("textbox", { name: "Công thức dạng chữ" }) as HTMLTextAreaElement;
    expect(ta.value).toBe("dinh_luong * 2");
    await user.clear(ta);
    await user.type(ta, "max(dai_in,{Enter}   rong_in)");
    expect(ct()).toBe("max ( dai_in , rong_in )");
    await user.click(screen.getByRole("button", { name: "Trực quan" }));
    expect(ct()).toBe("max ( dai_in , rong_in )");
    expect(screen.getByTitle("Mã: dai_in")).toBeInTheDocument();
  });

  it("Dạng chữ: dán `;` của Excel ⇒ KHÔNG tự sửa, báo lỗi kèm dòng", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Dạng chữ" }));
    const ta = screen.getByRole("textbox", { name: "Công thức dạng chữ" });
    await user.click(ta);
    await user.paste("if(dai_in > 1; 2; 3)");
    expect(ct()).toBe("if ( dai_in > 1 ; 2 ; 3 )");
    expect(screen.getByText(/dùng dấu phẩy/)).toBeInTheDocument();
    expect(screen.getByText(/dòng 1/)).toBeInTheDocument();
  });

  it("Trực quan: Ctrl+V dán chuỗi thành chip ngay tại con trỏ", async () => {
    const user = userEvent.setup();
    render(<Harness dau="dinh_luong" />);
    await user.click(o());
    await user.keyboard("{Home}");
    await user.paste("max(dai_in, 2) *");
    expect(ct()).toBe("max ( dai_in , 2 ) * dinh_luong");
  });

  it("xoá nhầm chip ⇒ Ctrl+Z lấy lại, Ctrl+Y làm lại", async () => {
    const user = userEvent.setup();
    render(<Harness dau="dinh_luong * dai_in" />);
    await user.click(screen.getByTitle("Xoá biến dinh_luong"));
    expect(ct()).toBe("* dai_in");
    await user.click(o());
    await user.keyboard("{Control>}z{/Control}");
    expect(ct()).toBe("dinh_luong * dai_in");
    await user.keyboard("{Control>}y{/Control}");
    expect(ct()).toBe("* dai_in");
  });

  it("chuỗi if thành bảng Khi | Lấy; bấm nút bậc ⇒ chọn bậc; Nhân đôi bậc rồi Xoá bậc — IF lồng vẫn hợp lệ", async () => {
    const user = userEvent.setup();
    render(<Harness dau={BAC} />);
    expect(screen.getByText("Khi")).toBeInTheDocument();
    expect(screen.getByText("Còn lại")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "bậc 2" }));
    await user.click(screen.getByRole("button", { name: "Nhân đôi bậc" }));
    expect(ct()).toBe(
      "if ( dai_in <= 3000 , 1 , if ( dai_in <= 10000 , 2 , if ( dai_in <= 10000 , 2 , 3 ) ) )");
    await user.click(screen.getByRole("button", { name: "bậc 1" }));
    await user.click(screen.getByRole("button", { name: "Xoá bậc" }));
    expect(ct()).toBe("if ( dai_in <= 10000 , 2 , if ( dai_in <= 10000 , 2 , 3 ) )");
  });

  it("gõ vài chữ ⇒ gợi ý biến, Enter chèn chip", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(o(), "ron");
    expect(screen.getByRole("listbox", { name: "Gợi ý biến" })).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(ct()).toBe("rong_in");
  });

  it("số hiện nhóm nghìn bằng khoảng trắng hẹp, chuỗi lưu vẫn liền", () => {
    render(<Harness dau="dai_in * 700000" />);
    expect(document.querySelector(".rc-formula__chip-token--num")?.textContent).toBe("700 000");
    expect(ct()).toBe("dai_in * 700000");
  });
});

// PHƯƠNG ÁN C (22/10/2026 — docs/mockups/o-cong-thuc-de-doc-3-phuong-an.html).
describe("tách phần và phần chung", () => {
  afterEach(() => { localStorage.clear(); });

  const BIEN_C = ["chay_tiep", "gia_co_dinh", "sl_ghi", "tu_tro", "don_gia_khoan", "metaline", "muc_uv",
    "sl_vao", "so_mau_in", "so_mau_pha", "so_kem"];
  const KHOAN = "( ( 1 - chay_tiep ) * gia_co_dinh + max ( 0 , sl_ghi * ( 1 + tu_tro ) - ( 1 - chay_tiep ) * 3000 ) "
    + "* don_gia_khoan ) * if ( metaline > 0 , 3 , if ( muc_uv > 0 , 2 , 1 ) )";
  const bac = (a: string, b: string) => "490000 * ( so_mau_in - so_mau_pha ) + ( sl_vao - 3000 ) * "
    + `( ${a} * ( so_mau_in - so_mau_pha ) + so_mau_pha * ${b} ) + so_mau_pha * 950000 + so_kem * 150000`;
  const IN02 = "if ( sl_vao <= 3000 , 490000 * ( so_mau_in - so_mau_pha ) + so_mau_pha * 950000 + 150000 * so_kem , "
    + `if ( sl_vao <= 10000 , ${bac("130", "260")} , if ( sl_vao <= 20000 , ${bac("123", "250")} , ${bac("113", "230")} ) ) )`;

  it("công thức dài ⇒ dòng khung Kết quả = ( A + B ) × C; bấm chữ B rồi gõ ⇒ chèn vào ĐẦU phần B", async () => {
    const user = userEvent.setup();
    render(<Harness dau={KHOAN} bien={BIEN_C} />);
    expect(screen.getByText("Kết quả =")).toBeInTheDocument();
    expect(screen.getAllByText("B")).toHaveLength(2);       // ở dòng khung + đầu khối phần B
    fireEvent.mouseDown(screen.getAllByText("B")[0]);
    await user.type(o(), "2");
    await user.keyboard("*");
    expect(ct()).toContain("gia_co_dinh + 2 * max ( 0");
  });

  it("các bậc giống nhau ⇒ dòng P; Sửa phần chung áp cho mọi bậc", async () => {
    const user = userEvent.setup();
    render(<Harness dau={IN02} bien={BIEN_C} />);
    expect(screen.getByText("phần chung, có ở mọi bậc")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sửa phần chung" }));
    const oP = screen.getByRole("textbox", { name: "Sửa phần chung" }) as HTMLInputElement;
    expect(oP.value).toBe("490000 * (so_mau_in - so_mau_pha) + so_mau_pha * 950000 + 150000 * so_kem");
    await user.clear(oP);
    await user.type(oP, "490000 * (so_mau_in - so_mau_pha) + so_mau_pha * 960000 + 150000 * so_kem{Enter}");
    expect(ct()?.match(/960000/g)).toHaveLength(4);
    expect(ct()).not.toContain("950000");
  });

  it("bảng giấu chữ if / ngoặc / dấu phẩy; ← đi qua chúng không dừng, Backspace không xoá chúng", async () => {
    const user = userEvent.setup();
    render(<Harness dau="if ( dai_in <= 3000 , 1 , 2 )" />);
    expect(document.querySelectorAll(".rc-formula__chip-token.is-an")).toHaveLength(5);
    await user.click(o());
    await user.keyboard("{Home}{Delete}");                  // Home ⇒ trước `if`; Delete chỉ bước qua khung
    expect(ct()).toBe("if ( dai_in <= 3000 , 1 , 2 )");
    await user.keyboard("{Home}{ArrowRight}");              // qua `if (` giấu + đúng một chip `dai_in`
    await user.type(o(), "9");
    await user.tab();
    expect(ct()).toBe("if ( dai_in 9 <= 3000 , 1 , 2 )");
    await user.click(o());
    await user.keyboard("{End}{Backspace}{Backspace}");     // lần đầu chỉ bước qua `)`, lần hai xoá số 2
    expect(ct()).toBe("if ( dai_in 9 <= 3000 , 1 , )");
  });

  it("Thêm phần (−) ⇒ hiện phần D rỗng, gõ vào là thành D", async () => {
    const user = userEvent.setup();
    render(<Harness dau={KHOAN} bien={BIEN_C} />);
    await user.click(screen.getByTitle("Trừ đi phần D ở cuối công thức"));
    expect(screen.getAllByText("D")).toHaveLength(2);
    await user.type(o(), "500");
    await user.tab();
    expect(ct()).toBe(`${KHOAN} - 500`);
    expect(screen.getByText("Kết quả =")).toBeInTheDocument();
  });
});
