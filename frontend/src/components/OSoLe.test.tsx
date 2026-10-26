// Ô số giữ chữ đang gõ (26/10/2026, L-SX-06 / L-SX-35): dựng lại chữ từ số mỗi phím là nuốt dấu phẩy, dấu trừ.
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { docSoLe, OSoLe } from "./OSoLe";

describe("docSoLe", () => {
  it("dấu phẩy là thập phân, dấu chấm là nghìn", () => {
    expect(docSoLe("1,")).toEqual({ chu: "1,", so: 1 });
    expect(docSoLe("12,47")).toEqual({ chu: "12,47", so: 12.47 });
    expect(docSoLe("1234567")).toEqual({ chu: "1.234.567", so: 1234567 });
  });
  it("chỉ nhận số âm khi bật am", () => {
    expect(docSoLe("-310552", 0, true)).toEqual({ chu: "-310.552", so: -310552 });
    expect(docSoLe("-", 0, true)).toEqual({ chu: "-", so: 0 });
    expect(docSoLe("-310552", 0, false)).toEqual({ chu: "310.552", so: 310552 });
  });
});

function Khung() {
  const [v, setV] = useState(0);
  return (<><OSoLe aria-label="SL" value={v} onChange={setV} /><output>{v}</output></>);
}

describe("OSoLe", () => {
  it("gõ \"1,\" ô vẫn giữ dấu phẩy, gõ tiếp \"1,5\" ra 1,5", () => {
    render(<Khung />);
    const o = screen.getByLabelText("SL") as HTMLInputElement;
    fireEvent.change(o, { target: { value: "1," } });
    expect(o.value).toBe("1,");
    fireEvent.change(o, { target: { value: "1,5" } });
    expect(o.value).toBe("1,5");
    expect(screen.getByRole("status").textContent).toBe("1.5");
  });
});
