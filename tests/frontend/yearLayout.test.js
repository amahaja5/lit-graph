import test from "node:test";
import assert from "node:assert/strict";

import { buildYearLayout, hasValidYear, yearToX } from "../../frontend/src/yearLayout.js";

test("buildYearLayout spaces observed years evenly instead of compressing dense recent years", () => {
  const layout = buildYearLayout([1993, 1995, 2000, 2005, 2010, 2015, 2020, 2022, 2026], 1200);

  assert.ok(layout);
  const gap1993To1995 = yearToX(1995, layout, 1200) - yearToX(1993, layout, 1200);
  const gap2022To2026 = yearToX(2026, layout, 1200) - yearToX(2022, layout, 1200);

  assert.ok(Math.abs(gap1993To1995 - gap2022To2026) < 0.001);
  assert.deepEqual(layout.tickYears, [1993, 1995, 2000, 2005, 2010, 2015, 2020, 2022, 2026]);
});

test("buildYearLayout reduces visible tick labels when the viewport is narrow", () => {
  const layout = buildYearLayout([1993, 1995, 2000, 2005, 2010, 2015, 2020, 2022, 2026], 640);

  assert.ok(layout);
  assert.ok(layout.tickYears.length < layout.knownYears.length);
  assert.equal(layout.tickYears[0], 1993);
  assert.equal(layout.tickYears[layout.tickYears.length - 1], 2026);
});

test("yearToX keeps unknown-year nodes aligned to a dedicated left-side lane", () => {
  const layout = buildYearLayout([2018, 2020, 2022], 1000);

  assert.ok(layout);
  assert.ok(layout.unknownX < yearToX(2018, layout, 1000));
  assert.equal(yearToX(null, layout, 1000), layout.unknownX);
});

test("hasValidYear accepts positive integers only", () => {
  assert.equal(hasValidYear(2024), true);
  assert.equal(hasValidYear(0), false);
  assert.equal(hasValidYear(null), false);
  assert.equal(hasValidYear(2024.5), false);
});
