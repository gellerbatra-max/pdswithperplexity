import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from './uiStore';

const state = () => useUiStore.getState();

beforeEach(() => {
  useUiStore.setState({
    activeTool: 'select',
    selection: [],
    dockTab: 'piece',
    statusMessage: null,
  });
});

describe('tools and dock', () => {
  it('starts on the select tool and the piece tab', () => {
    expect(state().activeTool).toBe('select');
    expect(state().dockTab).toBe('piece');
  });

  it('switches tool', () => {
    state().setTool('buttSlide');
    expect(state().activeTool).toBe('buttSlide');
  });

  it('switches dock tab', () => {
    state().setDockTab('options');
    expect(state().dockTab).toBe('options');
  });
});

describe('selection', () => {
  it('replaces the selection wholesale', () => {
    state().setSelection(['a', 'b']);
    expect(state().selection).toEqual(['a', 'b']);
    state().setSelection(['c']);
    expect(state().selection).toEqual(['c']);
  });

  it('appends in click order', () => {
    state().addToSelection('a');
    state().addToSelection('b');
    expect(state().selection).toEqual(['a', 'b']);
  });

  it('ignores a piece that is already selected', () => {
    state().addToSelection('a');
    state().addToSelection('a');
    expect(state().selection).toEqual(['a']);
  });

  it('clears', () => {
    state().setSelection(['a', 'b']);
    state().clearSelection();
    expect(state().selection).toEqual([]);
  });
});

describe('status messages', () => {
  it('starts with nothing to say', () => {
    expect(state().statusMessage).toBeNull();
  });

  it('carries level and text', () => {
    state().setStatus('warn', 'Piece overlaps a defect zone');
    expect(state().statusMessage).toEqual({
      level: 'warn',
      text: 'Piece overlaps a defect zone',
    });
  });

  it('replaces the previous message', () => {
    state().setStatus('error', 'Nest failed');
    state().setStatus('ok', 'Nested 24 pieces');
    expect(state().statusMessage?.level).toBe('ok');
  });
});
