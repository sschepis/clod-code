import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMessages } from './useMessages';

const AGENT_ID = 'foreground';

describe('useMessages', () => {
  it('starts with an empty event list and idle phase', () => {
    const { result } = renderHook(() => useMessages());
    expect(result.current.focusedSlice.events).toHaveLength(0);
    expect(result.current.focusedSlice.phase.phase).toBe('idle');
    expect(result.current.isProcessing).toBe(false);
  });

  it('appendToken creates a new assistant event', () => {
    const { result } = renderHook(() => useMessages());
    act(() => result.current.appendToken(AGENT_ID, 'Hello', 'evt-1'));
    expect(result.current.focusedSlice.events).toHaveLength(1);
    expect(result.current.focusedSlice.events[0].role).toBe('assistant');
    expect(result.current.focusedSlice.events[0].content).toBe('Hello');
  });

  it('appendToken extends an existing assistant event with the same id', () => {
    const { result } = renderHook(() => useMessages());
    act(() => result.current.appendToken(AGENT_ID, 'Hello', 'evt-1'));
    act(() => result.current.appendToken(AGENT_ID, ' world', 'evt-1'));
    expect(result.current.focusedSlice.events).toHaveLength(1);
    expect(result.current.focusedSlice.events[0].content).toBe('Hello world');
  });

  it('addEvent adds to the correct agent slice', () => {
    const { result } = renderHook(() => useMessages());
    const event = { id: 'u1', role: 'user' as const, content: 'test', timestamp: '12:00' };
    act(() => result.current.addEvent(AGENT_ID, event));
    expect(result.current.focusedSlice.events).toHaveLength(1);
    expect(result.current.focusedSlice.events[0].content).toBe('test');
  });

  it('updateToolStatus patches a tool event', () => {
    const { result } = renderHook(() => useMessages());
    const toolEvent = {
      id: 't1', role: 'tool' as const, toolName: 'shell', command: 'ls',
      status: 'running' as const, timestamp: '12:00',
    };
    act(() => result.current.addEvent(AGENT_ID, toolEvent));
    act(() => result.current.updateToolStatus(AGENT_ID, 't1', 'success', 'file.txt', '0.1s'));
    const updated = result.current.focusedSlice.events[0] as any;
    expect(updated.status).toBe('success');
    expect(updated.output).toBe('file.txt');
    expect(updated.duration).toBe('0.1s');
  });

  it('sync replaces slice state entirely', () => {
    const { result } = renderHook(() => useMessages());
    act(() => result.current.addEvent(AGENT_ID, { id: 'u1', role: 'user', content: 'old', timestamp: '12:00' }));
    const newEvents = [{ id: 'u2', role: 'user' as const, content: 'new', timestamp: '12:01' }];
    const phase = { phase: 'thinking' as const, message: 'working' };
    const cost = { totalTokens: 100, totalCost: 0.01 };
    const model = { provider: 'openai', model: 'gpt-4o', isLocal: false };
    act(() => result.current.sync(AGENT_ID, newEvents, phase, cost, model, 'act'));
    expect(result.current.focusedSlice.events).toHaveLength(1);
    expect(result.current.focusedSlice.events[0].content).toBe('new');
    expect(result.current.focusedSlice.phase.phase).toBe('thinking');
    expect(result.current.focusedSlice.cost.totalTokens).toBe(100);
  });

  it('clearEvents empties events and resets phase', () => {
    const { result } = renderHook(() => useMessages());
    act(() => result.current.addEvent(AGENT_ID, { id: 'u1', role: 'user', content: 'hi', timestamp: '12:00' }));
    act(() => result.current.setPhase(AGENT_ID, { phase: 'thinking', message: '' }));
    act(() => result.current.clearEvents(AGENT_ID));
    expect(result.current.focusedSlice.events).toHaveLength(0);
    expect(result.current.focusedSlice.phase.phase).toBe('idle');
  });

  it('revertTo truncates event history to the given event', () => {
    const { result } = renderHook(() => useMessages());
    act(() => {
      result.current.addEvent(AGENT_ID, { id: 'e1', role: 'user', content: 'a', timestamp: '12:00' });
      result.current.addEvent(AGENT_ID, { id: 'e2', role: 'assistant', content: 'b', timestamp: '12:01' });
      result.current.addEvent(AGENT_ID, { id: 'e3', role: 'user', content: 'c', timestamp: '12:02' });
    });
    act(() => result.current.revertTo(AGENT_ID, 'e2'));
    expect(result.current.focusedSlice.events).toHaveLength(2);
    expect(result.current.focusedSlice.events[1].id).toBe('e2');
  });

  it('deleteEvent removes a specific event', () => {
    const { result } = renderHook(() => useMessages());
    act(() => {
      result.current.addEvent(AGENT_ID, { id: 'e1', role: 'user', content: 'a', timestamp: '12:00' });
      result.current.addEvent(AGENT_ID, { id: 'e2', role: 'user', content: 'b', timestamp: '12:01' });
    });
    act(() => result.current.deleteEvent(AGENT_ID, 'e1'));
    expect(result.current.focusedSlice.events).toHaveLength(1);
    expect(result.current.focusedSlice.events[0].id).toBe('e2');
  });

  it('setPhase updates processing state correctly', () => {
    const { result } = renderHook(() => useMessages());
    expect(result.current.isProcessing).toBe(false);
    act(() => result.current.setPhase(AGENT_ID, { phase: 'thinking', message: 'planning' }));
    expect(result.current.isProcessing).toBe(true);
    act(() => result.current.setPhase(AGENT_ID, { phase: 'complete', message: '' }));
    expect(result.current.isProcessing).toBe(false);
  });
});
