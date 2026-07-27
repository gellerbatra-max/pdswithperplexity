import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, useViewportStore } from './viewportStore';

const state = () => useViewportStore.getState();

beforeEach(() => {
  useViewportStore.setState({
    zoom: DEFAULT_ZOOM,
    panX: 0,
    panY: 0,
    stageWidth: 0,
    stageHeight: 0,
  });
});

describe('setZoom', () => {
  it('sets the scale', () => {
    state().setZoom(5);
    expect(state().zoom).toBe(5);
  });

  it('clamps to the usable range', () => {
    state().setZoom(1000);
    expect(state().zoom).toBe(MAX_ZOOM);
    state().setZoom(0);
    expect(state().zoom).toBe(MIN_ZOOM);
  });
});

describe('setPan', () => {
  it('sets both offsets, including negatives', () => {
    state().setPan(-120, 40);
    expect(state().panX).toBe(-120);
    expect(state().panY).toBe(40);
  });
});

describe('zoomToFit', () => {
  it('does nothing before the stage has been measured', () => {
    state().zoomToFit(500, 150);
    expect(state().zoom).toBe(DEFAULT_ZOOM);
    expect(state().panX).toBe(0);
  });

  it('does nothing for an empty marker', () => {
    state().setStageSize(1000, 600);
    state().zoomToFit(0, 150);
    expect(state().zoom).toBe(DEFAULT_ZOOM);
  });

  it('fits to whichever axis is tighter', () => {
    state().setStageSize(1000, 600);
    // 1000/500 = 2 across, 600/150 = 4 down; the length is the constraint.
    state().zoomToFit(500, 150);
    expect(state().zoom).toBeCloseTo(2 * 0.9, 10);
  });

  it('fits to fabric width when that is the tighter axis', () => {
    state().setStageSize(1000, 300);
    // 1000/200 = 5 across, 300/150 = 2 down; the width is the constraint.
    state().zoomToFit(200, 150);
    expect(state().zoom).toBeCloseTo(2 * 0.9, 10);
  });

  it('centres the marker in the stage', () => {
    state().setStageSize(1000, 600);
    state().zoomToFit(500, 150);
    const { zoom, panX, panY } = state();
    expect(panX).toBeCloseTo((1000 - 500 * zoom) / 2, 10);
    expect(panY).toBeCloseTo((600 - 150 * zoom) / 2, 10);
  });

  it('leaves a margin rather than filling the stage edge to edge', () => {
    state().setStageSize(1000, 600);
    state().zoomToFit(500, 150);
    expect(state().zoom * 500).toBeLessThan(1000);
    expect(state().panX).toBeGreaterThan(0);
  });

  it('never exceeds the zoom ceiling on a tiny marker', () => {
    state().setStageSize(4000, 4000);
    state().zoomToFit(1, 1);
    expect(state().zoom).toBe(MAX_ZOOM);
  });
});
