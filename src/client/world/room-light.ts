import * as THREE from 'three';

// The room's own light at the TV, as numbers: how much of it the switch's three settings take away,
// and the warm white they leave in the middle one. Kept apart from the scene it lights so the sky's
// shader input can be worked out — and tested — on its own, without a browser (see client/world/sky.ts
// for how it is used, and client/features/tv/lighting.ts for the settings themselves).

/**
 * How much of the room's own light the switch by the TV takes away at full (see `levelFor`): enough
 * that the picture on the TV is clearly the brightest thing in the office, and the people in it are
 * lit by it, but a shape by the window is still a shape and not a hole in the dark. The middle
 * setting asks for part of it, and warms what's left towards ROOM_WARM.
 */
export const ROOM_DIM = 0.84;
/** The room's own light with nothing asked of it: every colour the same, and every one of them full. */
export const ROOM_LIT = new THREE.Color(1, 1, 1);
/**
 * The warm white the room's own light goes in the middle setting: a lamp turned down, not a blue
 * screen, and only a shade off white so it reads as warmth rather than as an orange room. Normalised
 * to its own brightness (see `luma`), so the tint costs no light of its own and ROOM_DIM is the only
 * thing that says how much of the room is left.
 */
export const ROOM_WARM = new THREE.Color('#fff0e4');
/** How much light a linear colour has, the way the eye weighs it. */
export const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
ROOM_WARM.multiplyScalar(1 / luma(ROOM_WARM.r, ROOM_WARM.g, ROOM_WARM.b));

/**
 * How much of the room's light is left with `down` (0–1) of it gone: what the shader's `skyRoom`
 * scales by, and the one number the halos and your own hands are given, so the two can't drift apart.
 *
 * Worked out from the setting asked for rather than off what the last frame left, which is what lets
 * the office's lights come back exactly as they were however often the switch is thrown.
 */
export const levelFor = (down: number) => 1 - Math.min(1, Math.max(0, down)) * ROOM_DIM;
/**
 * The colour the shader's `skyRoom` is set to for a setting: the warm tint over however much of the
 * room's light is left. One pure expression, so the frame loop and the tests use the same arithmetic.
 */
export const roomColor = (down: number, warm: number) => ROOM_WARM.clone().lerp(ROOM_LIT, 1 - warm).multiplyScalar(levelFor(down));
