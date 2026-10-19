import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { BienLoiGoc } from "./components/BienLoiGoc";
import { chanLanChuotDoiSo } from "./lib/chanLanChuotDoiSo";
import "./styles/global.css";
// Nạp CUỐI: `import { App }` ở trên chạy trước nên CSS của từng màn đã được chèn xong, rồi
// mới tới global.css và file này — nhờ vậy luật ở đây thắng khi cùng độ đặc hiệu. Mọi luật
// trong đó đều nằm trong @media hẹp nên màn rộng không đổi một pixel; xem đầu file.
import "./styles/responsive.css";
// Sàn chữ 12px cho điện thoại — SINH TỰ ĐỘNG từ chính CSS của dự án (xem đầu file).
import "./styles/responsive-chu.css";
// GIAO DIỆN ĐIỆN THOẠI RIÊNG (≤ 639px, 14/10/2026 — docs/thiet-ke-mobile.md). Mọi luật trong
// `styles/mobile/` bọc đúng mốc điện thoại (guard `mobile.test.ts`) ⇒ iPad / laptop / PC không đổi.
import "./styles/mobile/nen.css";
import "./styles/mobile/the.css";
import "./styles/mobile/ds.css";
import "./styles/mobile/chung.css";
import "./styles/mobile/ke-toan.css";
import "./styles/mobile/nhan-su-luong.css";
import "./styles/mobile/kinh-doanh.css";
import "./styles/mobile/san-xuat.css";
import "./styles/mobile/thu-mua-kho.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

chanLanChuotDoiSo();

createRoot(rootEl).render(
  <StrictMode>
    <BienLoiGoc>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BienLoiGoc>
  </StrictMode>,
);
