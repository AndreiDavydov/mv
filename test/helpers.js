import 'fake-indexeddb/auto';
import { Catalog } from '../app/src/core/repo.js';

let dbCounter = 0;

/** A fresh, isolated catalog with a controllable clock. */
export async function freshCatalog() {
  const clock = { t: 1_700_000_000_000 };
  const catalog = await Catalog.open({
    name: `test-catalog-${dbCounter++}`,
    now: () => (clock.t += 1000),
  });
  return { catalog, clock };
}

export const types = (events) => events.map((e) => e.type);
