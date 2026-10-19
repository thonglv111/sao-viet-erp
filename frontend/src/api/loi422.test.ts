import { describe, expect, it } from "vitest";

import { ApiError, authed } from "./client";

/** Bọc một Response giả cho `fetch` — chỉ cần `ok`/`status`/`json`. */
function gia(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

async function batLoi(status: number, body: unknown): Promise<ApiError> {
  const cu = globalThis.fetch;
  globalThis.fetch = (async () => gia(status, body)) as typeof fetch;
  try {
    await authed("/api/thu", "tok");
    throw new Error("đáng lẽ phải ném ApiError");
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    return e;
  } finally {
    globalThis.fetch = cu;
  }
}

describe("thông báo lỗi 422", () => {
  it("nêu TÊN TRƯỜNG sai, không nói trống không", async () => {
    // 422 của FastAPI: `detail` là MẢNG. Trước 15/08/2026 chỉ nhánh chuỗi được xử ⇒ mọi lỗi kiểm
    // dữ liệu của cả app hiện đúng câu chung "Request failed (422)." (nay là "Yêu cầu thất bại (mã 422).") — người dùng không biết sửa ô nào.
    const e = await batLoi(422, {
      detail: [
        { type: "greater_than", loc: ["body", "nang_suat"], msg: "Input should be greater than 0" },
      ],
    });
    expect(e.status).toBe(422);
    expect(e.message).toContain("nang_suat");
    expect(e.message).not.toContain("Yêu cầu thất bại");
  });

  // #5 (E2E 18/10/2026): nhập Định lượng giấy bằng 0 thì máy chủ chặn đúng, nhưng người dùng đọc
  // được nguyên câu tiếng Anh của pydantic "gsm: Input should be greater than 0".
  it("`greater_than` dịch thành câu tiếng Việt kèm nhãn ô, không còn chữ Anh của pydantic", async () => {
    const e = await batLoi(422, {
      detail: [
        { type: "greater_than", loc: ["body", "gsm"], msg: "Input should be greater than 0", input: 0, ctx: { gt: 0 } },
      ],
    });
    expect(e.message).toBe("Định lượng phải lớn hơn 0");
    expect(e.message).not.toMatch(/Input should/);
  });

  it("các loại pydantic thường gặp đều ra câu tiếng Việt; trường lạ giữ tên trường", async () => {
    const e = await batLoi(422, {
      detail: [
        { type: "missing", loc: ["body", "ten"], msg: "Field required" },
        { type: "less_than_equal", loc: ["body", "gsm"], msg: "Input should be less than or equal to 1000", ctx: { le: 1000 } },
        { type: "float_parsing", loc: ["body", "don_gia"], msg: "Input should be a valid number, unable to parse string as a number" },
      ],
    });
    expect(e.message).toBe(
      "Tên không được để trống · Định lượng phải từ 1.000 trở xuống · Đơn giá phải là số",
    );
    const la = await batLoi(422, {
      detail: [{ type: "greater_than_equal", loc: ["body", "nang_suat"], msg: "x", ctx: { ge: 1 } }],
    });
    expect(la.message).toBe("nang_suat phải từ 1 trở lên");
  });

  it("gộp nhiều lỗi nhưng CẮT ở 3 — form sai chục ô thì banner dài hơn cả form", async () => {
    const e = await batLoi(422, {
      detail: Array.from({ length: 5 }, (_, i) => ({
        loc: ["body", "dau_viec_dinh_muc", i, "nang_suat_nguoi_gio"],
        msg: "Field required",
      })),
    });
    expect(e.message.split(" · ")).toHaveLength(3);
    expect(e.message).toContain("+2 lỗi nữa");
    // Đường dẫn giữ cả chỉ số dòng — sai ở đầu việc thứ mấy là thứ phải nói ra.
    expect(e.message).toContain("dau_viec_dinh_muc › 0 › nang_suat_nguoi_gio");
  });

  it("`detail` là CHUỖI (lỗi nghiệp vụ 400/409) thì giữ nguyên câu tiếng Việt", async () => {
    const e = await batLoi(409, { detail: "Mã đã tồn tại." });
    expect(e.message).toBe("Mã đã tồn tại.");
  });

  it("thân không phải JSON thì mới rơi về câu chung", async () => {
    const cu = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: false, status: 500,
      json: async () => { throw new Error("not json"); },
    }) as unknown as Response) as typeof fetch;
    try {
      await authed("/api/thu", "tok");
      throw new Error("đáng lẽ phải ném");
    } catch (e) {
      expect((e as ApiError).message).toContain("500");
    } finally {
      globalThis.fetch = cu;
    }
  });
});
