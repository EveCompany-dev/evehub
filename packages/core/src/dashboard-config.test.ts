import { describe, expect, it } from 'vitest';
import { parseDashboardConfig } from './dashboard-config';

describe('parseDashboardConfig', () => {
  it('drops the removed canvas/mode/density fields', () => {
    const config = parseDashboardConfig({ mode: 'grid', density: 'compact', canvas: { nodes: [] }, layout: [] });
    expect(config).not.toHaveProperty('mode');
    expect(config).not.toHaveProperty('canvas');
    expect(config).not.toHaveProperty('density');
  });

  it('moves the modules of someone who was on the canvas onto their grid, once each', () => {
    const config = parseDashboardConfig({
      mode: 'canvas',
      layout: [{ i: 'notes', x: 0, y: 0, w: 6, h: 6 }],
      widgets: { chart: { title: 'Vendas', clientOverride: null, viewConfig: null } },
      canvas: {
        nodes: [
          { kind: 'widget', id: 'n1', instanceId: 'notes' },
          { kind: 'widget', id: 'n2', instanceId: 'chart' },
          { kind: 'widget', id: 'n3', instanceId: 'chart' },
          { kind: 'text', id: 'n4', text: 'Titulo solto' },
        ],
      },
    });

    expect(config.layout.map((item) => item.i)).toEqual(['notes', 'chart']);
    // The per-instance settings the canvas shared with the grid survive the move.
    expect(config.widgets.chart?.title).toBe('Vendas');
  });

  it('leaves a grid user alone even if an old canvas is still stored', () => {
    const config = parseDashboardConfig({
      mode: 'grid',
      layout: [],
      canvas: { nodes: [{ kind: 'widget', id: 'n1', instanceId: 'notes' }] },
    });
    expect(config.layout).toEqual([]);
  });
});
