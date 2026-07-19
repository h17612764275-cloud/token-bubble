export interface LiquidPhysicsState {
  tilt: number;
  tiltVelocity: number;
  wave: number;
  waveVelocity: number;
  phase: number;
}

export const initialLiquidPhysics = (): LiquidPhysicsState => ({
  tilt: 0,
  tiltVelocity: 0,
  wave: 0,
  waveVelocity: 0,
  phase: 0,
});

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

export function applyLiquidMotion(state: LiquidPhysicsState, deltaX: number, deltaY: number): LiquidPhysicsState {
  const horizontal = clamp(deltaX, -48, 48);
  const energy = clamp(Math.abs(deltaX) + Math.abs(deltaY) * 0.72, 0, 64);
  return {
    ...state,
    tiltVelocity: clamp(state.tiltVelocity - horizontal * 0.24, -12, 12),
    waveVelocity: clamp(state.waveVelocity + energy * 0.12, -14, 14),
  };
}

export function stepLiquidPhysics(state: LiquidPhysicsState, elapsedSeconds: number, animate = true): LiquidPhysicsState {
  const dt = clamp(elapsedSeconds, 0, 0.034);
  if (!animate) return { ...initialLiquidPhysics(), phase: state.phase };

  const tiltAcceleration = -34 * state.tilt - 8.5 * state.tiltVelocity;
  const waveAcceleration = -46 * state.wave - 7.2 * state.waveVelocity;
  const tiltVelocity = state.tiltVelocity + tiltAcceleration * dt;
  const waveVelocity = state.waveVelocity + waveAcceleration * dt;
  const activity = clamp(
    Math.abs(state.tilt) * 0.35 + Math.abs(state.tiltVelocity) * 0.06 + Math.abs(state.wave) * 0.28 + Math.abs(state.waveVelocity) * 0.045,
    0,
    1,
  );

  return {
    tilt: state.tilt + tiltVelocity * dt,
    tiltVelocity,
    wave: state.wave + waveVelocity * dt,
    waveVelocity,
    phase: state.phase + dt * 2.35 * activity,
  };
}
