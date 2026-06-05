/**
 * @cece/engine — server-authoritative snooker engine.
 *
 * Phase 2 (hybrid): tracks score, frame, striker and break, and applies the
 * in-frame actions `pot` / `foul` / `endVisit`. Frame/match completion, concede
 * and undo are orchestrated at the match level.
 */
export const ENGINE_VERSION = '0.0.0' as const;

export { EngineError } from './error';
export { initialFrameState, applyScoringAction, type FrameAction } from './frame';
export { initialMatchState, reduceMatch, type NewMatchParams } from './match';
