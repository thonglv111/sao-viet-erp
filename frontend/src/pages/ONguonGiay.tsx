import { useState } from "react";
import { Button } from "../components/Button";
import { Select, type SelectOption } from "../components/Select";

/** Ô "Nguồn giấy" của lệnh (spec 2026-10-24-chuan-bi-giay §7). Máy đã chọn nguồn theo tồn lúc lập lệnh;
 *  người kế hoạch đổi được — máy chủ gỡ Cắt giấy cuộn / Tề giấy in rồi dựng lại, giấy chuyển sang bước
 *  đầu mới. Cuộn phải kèm rộng cuộn (mm) nên chờ bấm Áp dụng; ba nguồn kia gửi ngay khi chọn. */
export type NguonGiay = "to_in" | "to_nguyen" | "cuon" | "mua";

export interface DoiNguonGiay {
  nguon: NguonGiay;
  rong_cuon: number | null;
}

const LUA_CHON: SelectOption<string>[] = [
  { value: "to_in", label: "Tờ đúng khổ in" },
  { value: "to_nguyen", label: "Tờ khổ nguyên" },
  { value: "cuon", label: "Cuộn" },
  { value: "mua", label: "Mua mới" },
];

interface Props {
  nguon: string | null | undefined;
  /** Lý do không đổi được (đang giữ chỗ, không có quyền…); null = đổi được. */
  khoa: string | null;
  onDoi: (body: DoiNguonGiay) => Promise<void>;
}

export function ONguonGiay({ nguon, khoa, onDoi }: Props) {
  const [chon, setChon] = useState<string>(nguon ?? "");
  const [rong, setRong] = useState("");
  const [dang, setDang] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);

  const gui = async (body: DoiNguonGiay) => {
    setDang(true);
    setLoi(null);
    try {
      await onDoi(body);
    } catch (e: unknown) {
      setLoi(e instanceof Error ? e.message : String(e));
      setChon(nguon ?? "");
    } finally {
      setDang(false);
    }
  };

  const doi = (v: string) => {
    setChon(v);
    setLoi(null);
    if (v !== "cuon" && v !== (nguon ?? "")) void gui({ nguon: v as NguonGiay, rong_cuon: null });
  };

  const soRong = Number(rong);
  const choRong = chon === "cuon" && nguon !== "cuon";
  return (
    <div className="khsx-plan-form__row">
      <label className="khsx-field khsx-field--flex1" title={khoa ?? undefined}>
        <span className="khsx-field__label">Nguồn giấy</span>
        <Select
          options={LUA_CHON}
          value={chon}
          onChange={doi}
          ariaLabel="Nguồn giấy"
          placeholder="Chưa chọn"
          disabled={!!khoa || dang}
        />
      </label>
      {choRong && (
        <label className="khsx-field khsx-field--flex1">
          <span className="khsx-field__label">Rộng cuộn (mm)</span>
          <input
            aria-label="Rộng cuộn (mm)"
            inputMode="numeric"
            value={rong}
            disabled={!!khoa || dang}
            onChange={(e) => setRong(e.target.value.replace(/\D/g, ""))}
          />
        </label>
      )}
      {choRong && (
        <Button
          variant="secondary"
          disabled={!!khoa || dang || !(soRong > 0)}
          onClick={() => void gui({ nguon: "cuon", rong_cuon: soRong })}
        >
          Áp dụng
        </Button>
      )}
      {loi && <div className="khsx-note-banner khsx-note-banner--error" role="alert">{loi}</div>}
    </div>
  );
}
