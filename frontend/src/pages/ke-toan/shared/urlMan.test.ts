/** Trạng thái lọc + kỳ của màn lên URL (đặc tả A.18): đọc lúc mở, ghi lại khi đổi, giữ khoá lạ. */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { boThamSoMan, docThamSoMan, ghiThamSoMan, manTrenUrl, useDongBoUrl } from "./urlMan";

const MAN = "ke-toan-phieu-chi";

afterEach(() => window.history.replaceState(null, "", "/"));

describe("ghiThamSoMan / docThamSoMan", () => {
  it("ghi rồi đọc lại đúng giá trị; giá trị rỗng thì bỏ khoá", () => {
    const s = ghiThamSoMan("", MAN, { ky: "nam", so: "1", tien_tu: "5000000", nguon: "po,khac", hinh_thuc: undefined });
    expect(s).toBe("?man=ke-toan-phieu-chi&ky=nam&so=1&tien_tu=5000000&nguon=po%2Ckhac");
    const p = docThamSoMan(MAN, s);
    expect(p?.get("ky")).toBe("nam");
    expect(p?.get("nguon")).toBe("po,khac");
    expect(p?.has("hinh_thuc")).toBe(false);
  });

  it("khoá lạ (của ai khác) giữ nguyên, kể cả khi ghi đè và khi bỏ khoá của màn", () => {
    const s = ghiThamSoMan("?abc=1&ky=thang", MAN, { ky: "quy" });
    const p = new URLSearchParams(s);
    expect(p.get("abc")).toBe("1");
    expect(p.get("ky")).toBe("quy");
    const bo = new URLSearchParams(boThamSoMan(s, MAN, ["ky"]));
    expect(bo.get("abc")).toBe("1");
    expect(bo.has("ky")).toBe(false);
    expect(bo.has("man")).toBe(false);
  });

  it("URL của màn khác thì không đọc (khoá trùng tên không lọt sang màn này)", () => {
    expect(docThamSoMan(MAN, "?man=ke-toan-phieu-thu&ky=nam")).toBeNull();
    expect(docThamSoMan(MAN, "?ky=nam")).toBeNull();
  });

  it("bỏ khoá của màn KHÁC thì không xoá dấu `man` đang thuộc màn hiện tại", () => {
    const s = boThamSoMan("?man=ke-toan-phieu-thu&ky=nam", MAN, ["ky"]);
    expect(new URLSearchParams(s).get("man")).toBe("ke-toan-phieu-thu");
  });

  it("manTrenUrl chỉ nhận mã màn hợp lệ", () => {
    expect(manTrenUrl("?man=ke-toan-phieu-chi&ky=nam")).toBe("ke-toan-phieu-chi");
    expect(manTrenUrl("?man=<script>")).toBeNull();
    expect(manTrenUrl("")).toBeNull();
  });
});

describe("useDongBoUrl", () => {
  it("ghi lên URL bằng replaceState, giữ hash và khoá lạ; gỡ màn thì dọn khoá của mình", () => {
    window.history.replaceState(null, "", "/?abc=1#lsx=5");
    const dau = window.history.length;
    const { rerender, unmount } = renderHook(({ g }) => useDongBoUrl(MAN, g), {
      initialProps: { g: { ky: "nam" } as Record<string, string | undefined> },
    });
    expect(window.location.search).toBe("?abc=1&man=ke-toan-phieu-chi&ky=nam");
    expect(window.location.hash).toBe("#lsx=5");
    act(() => rerender({ g: { ky: undefined } }));
    expect(window.location.search).toBe("?abc=1&man=ke-toan-phieu-chi");
    expect(window.history.length).toBe(dau);
    unmount();
    // Dấu `man` là của AppShell (nó biết màn nào đang mở); hook chỉ dọn khoá của mình.
    expect(window.location.search).toBe("?abc=1&man=ke-toan-phieu-chi");
  });

  it("#2 đổi tab con giữ ?man=: tab có hook gỡ ra, tab không có hook thế vào, URL vẫn còn man", () => {
    window.history.replaceState(null, "", "/");
    const tabLoc = renderHook(() => useDongBoUrl("luong", { ky: "thang" }));
    expect(window.location.search).toBe("?man=luong&ky=thang");
    // Rời tab "Bảng lương" sang tab "Nhân viên" (không dùng hook): trước đây `man` bị xoá ⇒ URL `/`.
    tabLoc.unmount();
    expect(new URLSearchParams(window.location.search).get("man")).toBe("luong");
    expect(new URLSearchParams(window.location.search).has("ky")).toBe(false);
  });
});
