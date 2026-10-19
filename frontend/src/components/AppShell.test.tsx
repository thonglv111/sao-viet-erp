// Task 14 (deep link QR), sửa vòng 1 P3 — bài canh trước vòng này DỪNG Ở HAI ĐẦU: hàm phân tích
// hash thuần (`appShellDeepLink.test.ts`) và, TỪ PHÍA BÊN KIA, `LenhSanXuatPage.test.tsx` (chỉ
// canh từ chỗ prop đã tới tay component, tự truyền `openHoSoId` bằng tay không qua `AppShell` một
// bước nào). KHÚC NỐI HAI ĐẦU — `AppShell` tự đọc `window.location.hash` lúc mount/khi hash đổi
// (P2) rồi bơm đúng `openHoSoId`/`openHoSoPv` vào nhánh `case "lenh-san-xuat"` của `renderContent()`
// — TRƯỚC ĐÓ KHÔNG CÓ LƯỚI NÀO CANH: xoá cả effect đọc hash, hoặc gõ nhầm khoá
// `navParams?.openHoSoLsxId` thành thứ khác, hai bài canh kia vẫn xanh 100%.
//
// `HoSoCuaToiPage` (màn mở mặc định từ 06/10/2026, trước là Dashboard; đích tạm lúc mount, trước
// khi effect kịp điều hướng) và `LenhSanXuatPage` (đích cuối) đều bị THAY bằng bản dò (probe): `LenhSanXuatPage` thật kéo theo cả một trang tra cứu with
// nhiều fetch riêng của nó (đã canh riêng ở `LenhSanXuatPage.test.tsx`); mount `AppShell` thật đã
// kéo theo hàng chục side-effect khác không liên quan (badge tổ/kho, kênh SSE...). Mock để cô lập
// ĐÚNG khúc dây chuyền cần canh, không phải bắt nó thoả luôn thân từng trang con.
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Bản dò "Hồ sơ của tôi" (màn mở mặc định, ô quyền `self_service` mọi vai đều có) kèm một nút gọi `useReloadPermissions` — đứng thay cho màn Phòng ban (lưu vai
// trò xong thì gọi đúng hàm này), khỏi mount cả màn Phòng ban thật chỉ để bấm một nút Lưu.
vi.mock("../pages/nhan-su-luong/ho-so-cua-toi", async () => {
  const { useReloadPermissions } = await import("../auth/permissions");
  return {
    HoSoCuaToiPage: () => {
      const reload = useReloadPermissions();
      return (
        <div data-testid="probe-ho-so-cua-toi">
          <button type="button" onClick={reload}>probe-tai-lai-quyen</button>
        </div>
      );
    },
  };
});

vi.mock("../pages/nhan-su-luong/luong", () => ({ LuongPage: () => <div data-testid="probe-luong" /> }));

vi.mock("../pages/LenhSanXuatPage", () => ({
  LenhSanXuatPage: (props: { openHoSoId: number | null; openHoSoPv: number | null }) => (
    <div
      data-testid="probe-lenh-san-xuat"
      data-open-ho-so-id={String(props.openHoSoId)}
      data-open-ho-so-pv={String(props.openHoSoPv)}
    />
  ),
}));

// `connectQuoteEvents` (mọi tài khoản đăng nhập đều mở) là một vòng lặp `fetch` streaming TỰ VIẾT
// TAY (không phải `EventSource`), có watchdog 50s. Test này không cần kênh đó chạy thật, chỉ cần nó
// không mở một kết nối/hẹn giờ treo lại sau khi bài test đã xong — giữ nguyên MỌI export khác qua
// `importOriginal`, chỉ thay riêng hàm này. Hàm thay giữ lại bộ xử lý sự kiện mới nhất để bài
// "quyền đổi" tự bắn sự kiện như máy chủ đẩy.
const kenh = vi.hoisted(() => ({
  phat: null as null | ((e: import("../api/client").QuoteEvent) => void),
}));
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    connectQuoteEvents: (_token: string, onEvent: (e: import("../api/client").QuoteEvent) => void) => {
      kenh.phat = onEvent;
      return () => {};
    },
  };
});

import { AppShell } from "./AppShell";
import { AuthContext, type AuthState } from "../auth/AuthContext";

const AUTH: AuthState = {
  status: "authenticated", user: null, token: "t",
  login: async () => {}, logout: async () => {},
  updateUser: () => {}, notice: null, setNotice: () => {},
};

/** Fetch giả cho ĐÚNG BA nguồn còn lại chạy KHÔNG ĐIỀU KIỆN lúc `AppShell` mount, bất kể
 *  `readable` chứa module gì (đã dò trong `AppShell.tsx`): `myAccess` (dựng `readable`/`caps`),
 *  `moduleNotifications.summary` (trong `reloadBadges`, chỉ gác `!token || readable===null`) và
 *  `attendance.notifySummary` (unconditional). Thiếu một trong ba
 *  thì promise rơi vào nhánh `.catch` — vô hại cho bài này, nhưng để tránh nhiễu log lúc chạy vẫn
 *  khai đủ. */
function stubApi(
  quyen: { modules: string[] } = { modules: ["self_service", "lenh_san_xuat"] },
  thongBao: { kenh: Record<string, unknown> } = { kenh: {} },
  daGoi: string[] = [],
) {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    daGoi.push(`${init?.method ?? "GET"} ${url}`);
    let data: unknown = {};
    if (url.includes("/api/auth/permissions")) {
      // Đọc `quyen.modules` LÚC GỌI, không chụp lúc dựng stub — bài tải lại quyền đổi nó giữa chừng.
      data = { modules: quyen.modules, permissions: [] };
    } else if (url.includes("/api/module-notifications/summary")) {
      data = thongBao;
    } else if (url.includes("/mark-read")) {
      // Máy chủ đã dời mốc ⇒ lượt tóm tắt sau không còn kênh vừa xem.
      const k = url.split("/api/module-notifications/")[1].split("/")[0];
      delete thongBao.kenh[k];
      return Promise.resolve({ ok: true, status: 204, headers: new Headers(), json: async () => null, text: async () => "" } as Response);
    }
    return Promise.resolve({
      ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }),
      json: async () => data, text: async () => JSON.stringify(data),
    } as Response);
  }));
}

function ve() {
  return render(
    <AuthContext.Provider value={AUTH}>
      <AppShell />
    </AuthContext.Provider>,
  );
}

describe("AppShell · deep link QR nối hash → props của LenhSanXuatPage (Task 14, sửa vòng 1 P3)", () => {
  beforeEach(() => {
    window.location.hash = "";
  });
  afterEach(() => {
    window.location.hash = "";
  });

  it("⭐ hash #lsx=77&pv=2 SẴN CÓ lúc mount ⇒ LenhSanXuatPage tự mount với đúng openHoSoId/openHoSoPv", async () => {
    window.location.hash = "#lsx=77&pv=2";
    stubApi();
    ve();

    const probe = await screen.findByTestId("probe-lenh-san-xuat");
    expect(probe.dataset.openHoSoId).toBe("77");
    expect(probe.dataset.openHoSoPv).toBe("2");
  });

  it("không có hash ⇒ ở lại Hồ sơ của tôi, LenhSanXuatPage không mount (hành vi mặc định không đổi)", async () => {
    stubApi();
    ve();

    await screen.findByTestId("probe-ho-so-cua-toi");
    expect(screen.queryByTestId("probe-lenh-san-xuat")).not.toBeInTheDocument();
  });

  // Sửa vòng 1, P2: quét mã THỨ HAI trong lúc tab đã mở sẵn (AppShell đã mount, đang đứng ở
  // Hồ sơ của tôi) chỉ đổi phần fragment của URL — same-document navigation, KHÔNG reload/remount.
  // Bài này giả lập đúng việc trình duyệt tự làm: đổi `location.hash` rồi bắn sự kiện
  // `hashchange`, không unmount/mount lại `<AppShell>`.
  it("⭐ quét mã QR lúc tab đã mở sẵn (hashchange, không remount) ⇒ vẫn nhảy đúng lệnh vừa quét", async () => {
    stubApi();
    ve();
    await screen.findByTestId("probe-ho-so-cua-toi");

    act(() => {
      window.location.hash = "#lsx=88&pv=5";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    const probe = await screen.findByTestId("probe-lenh-san-xuat");
    expect(probe.dataset.openHoSoId).toBe("88");
    expect(probe.dataset.openHoSoPv).toBe("5");
  });
});

// #2 (E2E 18/10/2026): đi sang màn không tự ghi `?man=` (Chấm công qua "Đặt ca nền", Tính giá mở một
// phiếu) thì URL trơ về `/` — tải lại trang rơi về màn mặc định thay vì màn đang xem. Dấu `man` là
// việc của AppShell vì chỉ nó biết màn nào đang mở; màn con chỉ ghi khoá lọc của mình.
describe("AppShell · URL luôn mang ?man= của màn đang mở", () => {
  afterEach(() => {
    window.location.hash = "";
    window.history.replaceState(null, "", "/");
  });

  it("#2 điều hướng sang màn không dùng bộ lọc URL vẫn ghi ?man=<màn>; gỡ AppShell thì dọn", async () => {
    window.history.replaceState(null, "", "/");
    stubApi();
    const { unmount } = ve();
    await screen.findByTestId("probe-ho-so-cua-toi");
    expect(new URLSearchParams(window.location.search).get("man")).toBe("ho-so-cua-toi");

    // Bản dò LenhSanXuatPage KHÔNG gọi hook ghi URL — đúng như Chấm công / chi tiết phiếu tính giá.
    act(() => {
      window.location.hash = "#lsx=88&pv=5";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await screen.findByTestId("probe-lenh-san-xuat");
    expect(new URLSearchParams(window.location.search).get("man")).toBe("lenh-san-xuat");

    unmount();
    expect(new URLSearchParams(window.location.search).has("man")).toBe(false);
  });
});

// Lưu ma trận vai trò của CHÍNH mình xong mà menu vẫn giữ quyền cũ tới khi F5 (16/09/2026: tắt Xem
// cả 9 dòng tổ của vai Giám đốc, menu vẫn bày đủ bàn tổ). Menu phải đi theo lượt hỏi quyền mới.
describe("AppShell · tải lại quyền không cần F5", () => {
  it("⭐ gọi tải lại quyền ⇒ menu thêm mục vừa được cấp và bỏ mục vừa bị rút", async () => {
    const quyen = { modules: ["self_service"] };
    stubApi(quyen);
    ve();
    await screen.findByTestId("probe-ho-so-cua-toi");
    expect(screen.queryByText("Hồ sơ lệnh sản xuất")).not.toBeInTheDocument();

    quyen.modules = ["self_service", "lenh_san_xuat"];
    act(() => screen.getByRole("button", { name: "probe-tai-lai-quyen" }).click());
    expect(await screen.findByText("Hồ sơ lệnh sản xuất")).toBeInTheDocument();

    quyen.modules = ["self_service"];
    act(() => screen.getByRole("button", { name: "probe-tai-lai-quyen" }).click());
    await waitFor(() =>
      expect(screen.queryByText("Hồ sơ lệnh sản xuất")).not.toBeInTheDocument(),
    );
  });
});

// Lượt hỏi quyền ĐẦU TIÊN hỏng (máy chủ khởi động lại, mạng chập): trước 28/09/2026 app gán menu
// rỗng im lặng — người dùng tưởng bị rút hết quyền. Nay phải báo lỗi + có nút Thử lại.
describe("AppShell · lượt hỏi quyền đầu tiên hỏng", () => {
  it("⭐ hiện lỗi + Thử lại; bấm Thử lại thì vào được app", async () => {
    let lan = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      let status = 200;
      let data: unknown = {};
      if (url.includes("/api/auth/permissions")) {
        lan += 1;
        if (lan === 1) {
          status = 500;
          data = { detail: "Lỗi máy chủ thử nghiệm." };
        } else {
          data = { modules: ["self_service"], permissions: [] };
        }
      } else if (url.includes("/api/module-notifications/summary")) {
        data = { kenh: {} };
      } else if (url.includes("/api/attendance/notify-summary")) {
        data = { unseen_shift_changes: 0 };
      }
      return Promise.resolve({
        ok: status < 400, status, headers: new Headers({ "content-type": "application/json" }),
        json: async () => data, text: async () => JSON.stringify(data),
      } as Response);
    }));
    ve();
    expect(await screen.findByText(/Không tải được quyền truy cập/)).toBeInTheDocument();
    expect(screen.getByText(/Lỗi máy chủ thử nghiệm\./)).toBeInTheDocument();
    act(() => screen.getByRole("button", { name: "Thử lại" }).click());
    await screen.findByTestId("probe-ho-so-cua-toi");
  });
});

// Người KHÁC đổi quyền của mình (lưu ma trận vai mình đang giữ, gán/gỡ vai, đổi phòng) ⇒ máy chủ đẩy
// `quyen_doi`. Bắt đầu bằng tài khoản chỉ có Hồ sơ của tôi: trước 17/09/2026 kênh SSE không mở cho tài
// khoản như vậy, nên được gán vai xong vẫn nhìn menu trống tới khi F5.
describe("AppShell · máy chủ đẩy quyen_doi", () => {
  beforeEach(() => {
    kenh.phat = null;
  });

  it("⭐ tài khoản không có module thời gian thực vẫn nghe kênh, nhận quyen_doi là menu đổi + báo", async () => {
    const quyen = { modules: ["self_service"] };
    stubApi(quyen);
    ve();
    await screen.findByTestId("probe-ho-so-cua-toi");
    await waitFor(() => expect(kenh.phat).not.toBeNull());
    expect(screen.queryByText("Hồ sơ lệnh sản xuất")).not.toBeInTheDocument();

    quyen.modules = ["self_service", "lenh_san_xuat"];
    act(() => kenh.phat!({ type: "quyen_doi" }));
    expect(await screen.findByText("Hồ sơ lệnh sản xuất")).toBeInTheDocument();
    expect(screen.getByText("Quyền của bạn vừa được cập nhật.")).toBeInTheDocument();
  });

  it("bộ quyền hỏi lại y hệt ⇒ không báo, không nối lại kênh", async () => {
    stubApi({ modules: ["self_service"] });
    ve();
    await screen.findByTestId("probe-ho-so-cua-toi");
    await waitFor(() => expect(kenh.phat).not.toBeNull());
    const phatTruoc = kenh.phat;

    act(() => phatTruoc!({ type: "quyen_doi" }));
    // Đợi lượt hỏi lại về tới nơi (fetch giả trả ngay) rồi mới kết luận.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByText("Quyền của bạn vừa được cập nhật.")).not.toBeInTheDocument();
    expect(kenh.phat).toBe(phatTruoc);
  });
});

// Chấm đỏ = có bản ghi mới kể từ lần mở màn trước; mở màn là mất (29/09/2026).
describe("AppShell · chấm đỏ thanh bên", () => {
  it("⭐ kênh có bản ghi mới ⇒ mục có chấm; mở màn ⇒ đánh dấu đã xem và chấm biến mất", async () => {
    const daGoi: string[] = [];
    stubApi(
      { modules: ["self_service", "luong"] },
      { kenh: { luong: { id: 5, loai: "tam_ung_moi", ma: null } } },
      daGoi,
    );
    const { container } = ve();
    const muc = (await screen.findByText("Lương")).closest("button, a") as HTMLElement;
    await waitFor(() => expect(muc.querySelector(".sidebar__badge")).not.toBeNull());

    act(() => muc.click());
    await screen.findByTestId("probe-luong");
    await waitFor(() =>
      expect(daGoi.some((g) => g.startsWith("POST") && g.includes("/luong/mark-read"))).toBe(true),
    );
    await waitFor(() => expect(container.querySelector(".sidebar__badge")).toBeNull());
  });
});

// Đo tải 30/09/2026: mở app bắn 8–9 lượt tóm tắt liền nhau. Đang có lượt bay thì mọi lời gọi thêm
// gộp thành ĐÚNG MỘT lượt hỏi lại khi lượt đó xong.
describe("AppShell · tóm tắt chấm đỏ không gọi dồn", () => {
  beforeEach(() => {
    kenh.phat = null;
  });

  it("⭐ nhiều nguồn kích trong lúc lượt đầu chưa về ⇒ chỉ thêm một lượt", async () => {
    const tra: Array<() => void> = [];
    let soLuot = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      let data: unknown = {};
      if (url.includes("/api/auth/permissions")) {
        data = { modules: ["self_service", "luong"], permissions: [] };
      } else if (url.includes("/api/module-notifications/summary")) {
        soLuot += 1;
        const res = {
          ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ kenh: {} }), text: async () => JSON.stringify({ kenh: {} }),
        } as Response;
        return new Promise<Response>((r) => tra.push(() => r(res)));
      }
      return Promise.resolve({
        ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }),
        json: async () => data, text: async () => JSON.stringify(data),
      } as Response);
    }));
    ve();
    await screen.findByTestId("probe-ho-so-cua-toi");
    await waitFor(() => expect(kenh.phat).not.toBeNull());
    await waitFor(() => expect(soLuot).toBe(1));
    // Hai nhóm hoãn KHÁC khoá ⇒ hai lời gọi riêng sau ~800ms, cả hai rơi vào lúc lượt đầu còn bay.
    act(() => {
      kenh.phat!({ type: "thong_bao_man" } as never);
      kenh.phat!({ type: "advance_pending_changed" } as never);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1000));
    });
    expect(soLuot).toBe(1);
    await act(async () => {
      tra.shift()!();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(soLuot).toBe(2);
    await act(async () => {
      tra.shift()!();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(soLuot).toBe(2);
  });
});
