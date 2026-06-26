import { useMemo } from "react";
import { useAppStore } from "../../store/useAppStore";
import { OptionGroup, type OptionItem } from "./OptionGroup";

type GenerationMode =
  | "single"
  | "multi2"
  | "multi3"
  | "multi4"
  | "multi5"
  | "sequence2"
  | "sequence4";

const GENERATION_MODE_ITEMS: ReadonlyArray<OptionItem<GenerationMode>> = [
  { value: "single", label: "1장" },
  { value: "multi2", label: "멀티 2" },
  { value: "multi3", label: "멀티 3" },
  { value: "multi4", label: "멀티 4" },
  { value: "multi5", label: "멀티 5" },
  { value: "sequence2", label: "단계 2" },
  { value: "sequence4", label: "단계 4" },
];

export function GenerationModePicker() {
  const count = useAppStore((s) => s.count);
  const setCount = useAppStore((s) => s.setCount);
  const multimode = useAppStore((s) => s.multimode);
  const setMultimode = useAppStore((s) => s.setMultimode);
  const multimodeMaxImages = useAppStore((s) => s.multimodeMaxImages);
  const setMultimodeMaxImages = useAppStore((s) => s.setMultimodeMaxImages);

  const value = useMemo<GenerationMode>(() => {
    if (multimode) return multimodeMaxImages <= 2 ? "sequence2" : "sequence4";
    if (count >= 5) return "multi5";
    if (count >= 4) return "multi4";
    if (count >= 3) return "multi3";
    if (count >= 2) return "multi2";
    return "single";
  }, [count, multimode, multimodeMaxImages]);

  function apply(next: GenerationMode) {
    if (next === "single") {
      setMultimode(false);
      setCount(1);
      return;
    }
    if (next === "multi2") {
      setMultimode(false);
      setCount(2);
      return;
    }
    if (next === "multi3") {
      setMultimode(false);
      setCount(3);
      return;
    }
    if (next === "multi4") {
      setMultimode(false);
      setCount(4);
      return;
    }
    if (next === "multi5") {
      setMultimode(false);
      setCount(5);
      return;
    }
    setMultimode(true);
    setMultimodeMaxImages(next === "sequence2" ? 2 : 4);
  }

  return (
    <div className="generation-mode-picker">
      <OptionGroup<GenerationMode>
        items={GENERATION_MODE_ITEMS}
        value={value}
        onChange={apply}
      />
    </div>
  );
}
