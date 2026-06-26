import { useAppStore } from "../../store/useAppStore";
import { OptionGroup, type OptionItem } from "./OptionGroup";
import type { SizePreset } from "../../types";

const SIZE_ITEMS: ReadonlyArray<OptionItem<SizePreset>> = [
  { value: "auto", label: "자동", sub: "auto" },
  { value: "2048x1152", label: "2048x1152", sub: "16:9" },
  { value: "1872x1248", label: "1872x1248", sub: "3:2" },
  { value: "1248x1872", label: "1248x1872", sub: "2:3" },
  { value: "1152x2048", label: "1152x2048", sub: "9:16" },
  { value: "1536x1536", label: "1536x1536", sub: "1:1" },
  { value: "3840x2160", label: "3840x2160", sub: "16:9" },
  { value: "3520x2352", label: "3520x2352", sub: "3:2" },
  { value: "2352x3520", label: "2352x3520", sub: "2:3" },
  { value: "2160x3840", label: "2160x3840", sub: "9:16" },
  { value: "2880x2880", label: "2880x2880", sub: "1:1" },
];

export function SizePicker() {
  const sizePreset = useAppStore((s) => s.sizePreset);
  const setSizePreset = useAppStore((s) => s.setSizePreset);

  return (
    <div className="option-group size-picker">
      <OptionGroup<SizePreset>
        items={SIZE_ITEMS}
        value={sizePreset}
        onChange={setSizePreset}
      />
    </div>
  );
}
