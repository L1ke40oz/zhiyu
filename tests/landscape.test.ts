import test from 'node:test';
import assert from 'node:assert/strict';
import { createLandscape, fitsOnLand } from '../shared/landscape.ts';
import type { IslandShape } from '../shared/types.ts';

test('三种岛形：生成稳定、保留三个生长区，地面元素不相交且不越岸', () => {
  const themes = new Set<string>(),
    counts = new Set<number>();
  for (const shape of ['bean', 'polygon', 'crescent'] as IslandShape[])
    for (let seed = 0; seed < 100; seed++) {
      const layout = createLandscape(`course-${seed}`, shape);
      assert.deepEqual(layout, createLandscape(`course-${seed}`, shape));
      themes.add(layout.theme);
      counts.add(layout.elements.length);
      assert.equal(layout.elements.filter((item) => item.kind === 'growth').length, 3, `${shape}:${seed}`);
      assert.equal(
        layout.elements.some((item) => item.kind === 'house'),
        layout.theme === 'village',
      );
      for (const [index, element] of layout.elements.entries()) {
        assert.ok(fitsOnLand(element, element.radius + 0.02, layout.polygon));
        for (const other of layout.elements.slice(index + 1))
          assert.ok(
            Math.hypot(element.x - other.x, element.z - other.z) >= element.radius + other.radius + 0.045,
          );
      }
    }
  assert.equal(themes.size, 2);
  assert.ok(counts.size > 3);
});
