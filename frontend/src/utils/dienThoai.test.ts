// Theo dõi bàn phím ảo (theoDoiBanPhim): đánh dấu "đang gõ" + đo phần màn bàn phím che. Trình duyệt máy
// tính không có bàn phím ảo nên chỉ kiểm được bằng giả lập `visualViewport` ở đây.
import { afterEach, describe, expect, it } from "vitest";
import { laOGo, theoDoiBanPhim } from "./dienThoai";

function giaVisualViewport(h: number, offsetTop = 0) {
  const nghe: Record<string, (() => void)[]> = {};
  const vv = {
    height: h,
    offsetTop,
    addEventListener: (t: string, f: () => void) => { (nghe[t] ??= []).push(f); },
    removeEventListener: (t: string, f: () => void) => { nghe[t] = (nghe[t] ?? []).filter((x) => x !== f); },
    bao: (t: string) => (nghe[t] ?? []).forEach((f) => f()),
  };
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
  return vv;
}

afterEach(() => {
  document.body.innerHTML = "";
  Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true });
});

describe("laOGo", () => {
  it("ô chữ / số / textarea là ô gõ; checkbox, nút, select thì không", () => {
    const mk = (html: string) => {
      const d = document.createElement("div");
      d.innerHTML = html;
      return d.firstElementChild;
    };
    expect(laOGo(mk('<input type="text">'))).toBe(true);
    expect(laOGo(mk("<input>"))).toBe(true);
    expect(laOGo(mk('<input type="number">'))).toBe(true);
    expect(laOGo(mk("<textarea></textarea>"))).toBe(true);
    expect(laOGo(mk('<input type="checkbox">'))).toBe(false);
    expect(laOGo(mk("<button></button>"))).toBe(false);
    expect(laOGo(mk("<select></select>"))).toBe(false);
    expect(laOGo(mk('<input inputmode="none">'))).toBe(false);
  });
});

describe("theoDoiBanPhim", () => {
  it("focus ô gõ ⇒ html.dang-go; rời ô ⇒ gỡ; --ban-phim = phần màn bàn phím che", async () => {
    const vv = giaVisualViewport(window.innerHeight);
    const goc = document.createElement("div");
    const go = theoDoiBanPhim(goc);
    expect(goc.style.getPropertyValue("--ban-phim")).toBe("0px");

    const o = document.createElement("input");
    document.body.appendChild(o);
    o.focus();
    expect(goc.classList.contains("dang-go")).toBe(true);

    // Bàn phím bật (iPhone: trang không co, khung nhìn thấp đi 300px).
    vv.height = window.innerHeight - 300;
    vv.bao("resize");
    expect(goc.style.getPropertyValue("--ban-phim")).toBe("300px");

    o.blur();
    await new Promise((r) => setTimeout(r, 0));
    expect(goc.classList.contains("dang-go")).toBe(false);

    go();
    expect(goc.style.getPropertyValue("--ban-phim")).toBe("");
  });

  it("focus nút / checkbox không bật cờ đang gõ", () => {
    const goc = document.createElement("div");
    const go = theoDoiBanPhim(goc);
    const b = document.createElement("button");
    document.body.appendChild(b);
    b.focus();
    expect(goc.classList.contains("dang-go")).toBe(false);
    go();
  });
});
