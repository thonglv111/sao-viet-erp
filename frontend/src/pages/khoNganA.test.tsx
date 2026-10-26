import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import type { StockRequest } from "../api/client";
import { NguonA } from "./khoNganA";

const yc = (p: Partial<StockRequest>) =>
  ({ lines: [{ lsx_ma: "LSX26-0042", bai_ghep_ma: null, tu_kcs: false }], ...p }) as unknown as StockRequest;

describe("NguonA — yêu cầu tự lập khi phát hành", () => {
  it("ô Nguồn ghi Tự lập khi phát hành cạnh mã lệnh", () => {
    render(<NguonA r={yc({ san_xuat_tu_lap: true })} />);
    expect(screen.getByText("Tự lập khi phát hành")).toBeInTheDocument();
    expect(screen.getByText("LSX26-0042")).toBeInTheDocument();
  });

  it("tổ tự bấm thì chỉ có mã lệnh", () => {
    render(<NguonA r={yc({ san_xuat_tu_lap: false })} />);
    expect(screen.queryByText("Tự lập khi phát hành")).toBeNull();
    expect(screen.getByText("LSX26-0042")).toBeInTheDocument();
  });
});
