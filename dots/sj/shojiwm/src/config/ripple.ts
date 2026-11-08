import {
  COMPOSITOR,
  signal,
  createPollForEachOutput,
  type PollHandle,
} from "shoji_wm";

const LIQUID_RIPPLE_FALLBACK_REFRESH_RATE = 120;
const liquidRippleTime = signal(0);
let liquidRipplePoll: PollHandle | null = null;
let liquidRippleStartedAtMs = Date.now();

export const LIQUID_RIPPLE_UNIFORMS = {
  time: liquidRippleTime,
  wave_speed: 0.2,
  wave_speed_x: 0.3,
  wave_speed_y: 0.3,
  emboss: 0.4,
  intensity: 2.0,
  frequency: 6.0,
  refraction_strength: 1.5,
  reflection_gain: 500.0,
  reflection_cutoff: 0.012,
  reflection_intensity: 150000.0,
  water_tint: 0.92,
};

function maxHz(): number {
  const refreshRates = COMPOSITOR.output.outputs
    .map((output) => output.resolution?.refreshRate)
    .filter((r): r is number => typeof r === "number" && r > 0);
  return refreshRates.length === 0
    ? LIQUID_RIPPLE_FALLBACK_REFRESH_RATE
    : Math.max(...refreshRates);
}

function restartRipple(): void {
  const elapsedMs = liquidRippleTime.peek() * 1000;
  liquidRippleStartedAtMs = Date.now() - elapsedMs;
  liquidRipplePoll?.cancel();
  liquidRipplePoll = createPollForEachOutput(1000 / maxHz(), () => {
    liquidRippleTime.value = (Date.now() - liquidRippleStartedAtMs) / 1000;
  });
}

restartRipple();

COMPOSITOR.onDisable(() => {
  liquidRipplePoll?.cancel();
  liquidRipplePoll = null;
});

COMPOSITOR.onEnable(() => {
  restartRipple();
});
