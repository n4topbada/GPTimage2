export type PosePreset = {
  id: string;
  title: string;
  body: string;
};

export const DEFAULT_POSE_PRESETS: PosePreset[] = [
  {
    id: "standing-basic",
    title: "01 기본 정면 스탠딩 포즈",
    body: [
      "[pose]",
      "01 기본 정면 스탠딩 포즈",
      "",
      "Front-facing full-body neutral standing pose for a character photoshoot.",
      "Weight balanced on both feet, spine upright, shoulders relaxed, chin level.",
      "One hand rests lightly near the waist or hip, the other arm hangs naturally beside the body.",
      "Keep both hands visible and avoid covering the torso, outfit details, or main silhouette.",
    ].join("\n"),
  },
  {
    id: "front-contrapposto",
    title: "02 한손 허리 콘트라포스토 포즈",
    body: [
      "[pose]",
      "02 한손 허리 콘트라포스토 포즈",
      "",
      "Front-facing contrapposto pose with the body weight shifted onto one leg.",
      "One knee relaxed inward, hips tilted subtly, shoulders counterbalanced for an elegant S-curve.",
      "One hand is placed clearly on the waist or high hip, elbow angled outward.",
      "The other hand rests near the upper thigh or lightly touches a costume edge without hiding the body line.",
    ].join("\n"),
  },
  {
    id: "hair-touch-stance",
    title: "03 머리 쓸어넘기는 스탠딩 포즈",
    body: [
      "[pose]",
      "03 머리 쓸어넘기는 스탠딩 포즈",
      "",
      "Three-quarter front standing pose with a soft editorial fashion stance.",
      "One hand is raised beside the head, fingers lightly touching or sweeping back the hair.",
      "The other hand rests low at the hip, thigh, belt, or costume strap.",
      "One leg crosses slightly in front of the other to create a clean diagonal body line.",
    ].join("\n"),
  },
  {
    id: "arms-crossed-shift",
    title: "04 팔짱 비대칭 스탠딩 포즈",
    body: [
      "[pose]",
      "04 팔짱 비대칭 스탠딩 포즈",
      "",
      "Standing pose with arms loosely crossed below the chest or over the upper waist.",
      "Do not cover the face, neck, or main outfit details; keep the hands and wrists visible.",
      "Body weight shifts onto one leg, the opposite knee relaxed, with a confident asymmetrical stance.",
      "Camera remains mostly front-facing so the pose reads as arm placement rather than a side-view duplicate.",
    ].join("\n"),
  },
  {
    id: "kneeling-seated",
    title: "05 무릎 앉은 양손 허벅지 포즈",
    body: [
      "[pose]",
      "05 무릎 앉은 양손 허벅지 포즈",
      "",
      "Kneeling seated pose for a character photoshoot.",
      "Both knees on the ground or one knee grounded with the other leg angled forward.",
      "Torso upright or slightly angled, shoulders open, waist line still visible.",
      "Both hands rest clearly on the thighs or knees, fingers visible and relaxed.",
      "Avoid hiding the abdomen, chest line, belt, or major costume shape with the arms.",
    ].join("\n"),
  },
  {
    id: "reclining-lean",
    title: "06 한팔 기대 누운 포즈",
    body: [
      "[pose]",
      "06 한팔 기대 누운 포즈",
      "",
      "Reclining leaning pose on a simple sofa, bench, low platform, or implied surface.",
      "Upper body supported by one elbow or palm behind the body, creating a long diagonal line.",
      "The other hand rests on the waist, stomach, upper thigh, or lightly touches the surface.",
      "Legs angle diagonally across the frame, one knee bent and the other extended or relaxed.",
      "Keep the face, torso, hands, and outfit readable; do not crop the pose into a close-up.",
    ].join("\n"),
  },
  {
    id: "chair-seated",
    title: "07 의자 앉은 팔걸이 포즈",
    body: [
      "[pose]",
      "07 의자 앉은 팔걸이 포즈",
      "",
      "Seated pose on a simple chair or stool for a character fashion photoshoot.",
      "Torso upright, one leg angled forward and the other tucked, crossed, or set back naturally.",
      "One hand holds the chair edge, armrest, or seat rim; the other hand rests on the thigh or hip.",
      "Hands must be visible and separated from the torso silhouette.",
      "Keep the chair simple and secondary so the character pose remains the focus.",
    ].join("\n"),
  },
  {
    id: "low-seat",
    title: "08 낮게 앉은 한무릎 세운 포즈",
    body: [
      "[pose]",
      "08 낮게 앉은 한무릎 세운 포즈",
      "",
      "Low seated pose on a step, block, or low platform.",
      "One knee is raised close to the body, the other leg extends outward or angles to the side.",
      "One hand rests on the raised knee, wrist, or shin; the other hand supports the body on the floor or platform.",
      "Torso leans slightly forward with a strong diagonal line from shoulder to hip to leg.",
      "Keep the hands, knee, waist, and full outfit silhouette readable.",
    ].join("\n"),
  },
  {
    id: "back-over-shoulder",
    title: "09 뒤태 오버숄더 한손 목선 포즈",
    body: [
      "[pose]",
      "09 뒤태 오버숄더 한손 목선 포즈",
      "",
      "Back-view over-shoulder photoshoot pose.",
      "Character turned mostly away from the camera, looking back over one shoulder.",
      "One hand lifts near the neck, collar, hair, or shoulder line; the other hand rests at the lower back, hip, or side.",
      "Hips and shoulders twist in opposite directions to show the back silhouette and waist curve.",
      "This is the only strong back-view preset; avoid making other presets look like side/back duplicates.",
    ].join("\n"),
  },
  {
    id: "walking-motion",
    title: "10 걷는 동작 손끝 흐름 포즈",
    body: [
      "[pose]",
      "10 걷는 동작 손끝 흐름 포즈",
      "",
      "Mid-step walking pose with dynamic forward motion.",
      "One foot planted and the other stepping through, with hips and shoulders naturally counterbalanced.",
      "One arm swings forward with relaxed fingers visible, the other arm moves back or lightly holds a costume edge.",
      "Cloth, hair, or accessories may trail subtly in the direction of motion.",
      "Show a clean moving full-body silhouette without turning the character into a side-profile pose.",
    ].join("\n"),
  },
];

const POSE_HEADER_PATTERN = /^\s*\[pose\]\s*$/im;
const SECTION_HEADER_PATTERN = /^\s*\[[^\]\r\n]+\]\s*$/m;
const GLOBAL_SECTION_HEADER_PATTERN = /^\s*\[[^\]\r\n]+\]\s*$/gm;

export function normalizePosePresets(value: unknown): PosePreset[] {
  if (!Array.isArray(value)) return DEFAULT_POSE_PRESETS;
  const normalized = value
    .map((item): PosePreset | null => {
      if (!item || typeof item !== "object") return null;
      const source = item as Record<string, unknown>;
      const id = typeof source.id === "string" ? source.id.trim() : "";
      const title = typeof source.title === "string" ? source.title.trim() : "";
      const body = typeof source.body === "string" ? source.body.trim() : "";
      if (!id || !title || !body) return null;
      return { id, title, body };
    })
    .filter((item): item is PosePreset => Boolean(item));
  return normalized.length > 0 ? normalized : DEFAULT_POSE_PRESETS;
}

export function replacePoseSection(prompt: string, preset: PosePreset): string {
  const section = preset.body.trim();
  const source = prompt.trim();
  if (!source) return section;

  const match = POSE_HEADER_PATTERN.exec(source);
  if (!match) return `${source}\n\n${section}`;

  const afterPoseStart = match.index + match[0].length;
  const rest = source.slice(afterPoseStart);
  const nextHeader = SECTION_HEADER_PATTERN.exec(rest);
  const end = nextHeader ? afterPoseStart + nextHeader.index : source.length;

  const before = source.slice(0, match.index).trimEnd();
  const after = source.slice(end).trimStart();
  return [before, section, after].filter(Boolean).join("\n\n");
}

export function jitterPoseSectionOrderForRetry(
  prompt: string,
  retryAttempt: number,
): { prompt: string; strategy: "none" | "pose-first" | "pose-after-first-reversed" } {
  if (retryAttempt <= 0) return { prompt, strategy: "none" };
  const source = prompt.trim();
  const matches = Array.from(source.matchAll(GLOBAL_SECTION_HEADER_PATTERN));
  if (matches.length < 2) return { prompt, strategy: "none" };

  const firstIndex = matches[0].index ?? 0;
  const preamble = source.slice(0, firstIndex).trim();
  const sections = matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? source.length : source.length;
    return source.slice(start, end).trim();
  });
  const poseIndex = sections.findIndex((section) =>
    /^\s*\[pose\]\s*$/i.test(section.split(/\r?\n/, 1)[0] ?? ""),
  );
  if (poseIndex < 0) return { prompt, strategy: "none" };

  const pose = sections[poseIndex];
  const others = sections.filter((_, index) => index !== poseIndex);
  if (retryAttempt === 1) {
    return {
      prompt: [preamble, pose, ...others].filter(Boolean).join("\n\n"),
      strategy: "pose-first",
    };
  }

  const [first, ...rest] = others;
  return {
    prompt: [preamble, first, pose, ...rest.reverse()].filter(Boolean).join("\n\n"),
    strategy: "pose-after-first-reversed",
  };
}
