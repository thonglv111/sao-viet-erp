"""Kiểm mọi liên kết sang PDF khác trong cuốn Kế hoạch SX trỏ tới một đích có thật."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pylib"))
from pypdf import PdfReader

goc = sys.argv[1]  # thư mục docs
nguon = os.path.join(goc, "huong-dan-ke-hoach-sx", "huong-dan-ke-hoach-san-xuat.pdf")
r = PdfReader(nguon)
lk = []
for trang in r.pages:
    for a in trang.get("/Annots") or []:
        a = a.get_object()
        act = a.get("/A")
        if act and act.get("/S") == "/GoToR":
            f = act["/F"]
            f = f.get("/F", f) if hasattr(f, "get") else f
            lk.append((str(f), str(act["/D"])))
dich = {}
loi = 0
for f, d in sorted(set(lk)):
    p = os.path.normpath(os.path.join(goc, "huong-dan-ke-hoach-sx", f))
    if p not in dich:
        dich[p] = set(PdfReader(p).named_destinations.keys())
    ok = d in dich[p]
    loi += not ok
    print("OK " if ok else "HONG", os.path.basename(p), d)
print("tong", len(set(lk)), "hong", loi)
