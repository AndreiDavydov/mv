import { openDB, deleteDB } from '../../../vendor/idb.js';

export const DB_NAME = 'moving-catalog';
export const DB_VERSION = 1;

export const STORE = {
  things: 'things',
  events: 'events',
  session: 'session',
  meta: 'meta',
};

export const SESSION_KEY = 'current';

/**
 * `things.is_container` is a boolean because that is what the data model calls
 * for, but IndexedDB keys may only be numbers, strings, dates, binaries or
 * arrays — a boolean cannot be indexed. `container_flag` mirrors it as 0/1 so
 * the container index exists. The repo maintains both on every write; nothing
 * outside `db.js`/`repo.js` should ever read `container_flag`.
 */
export function containerFlag(isContainer) {
  return isContainer ? 1 : 0;
}

export function openCatalog({ name = DB_NAME } = {}) {
  return openDB(name, DB_VERSION, {
    upgrade(db) {
      const things = db.createObjectStore(STORE.things, { keyPath: 'id' });
      // parent_id is null for anything not inside a container; IndexedDB skips
      // null keys, so this index holds exactly the packed things.
      things.createIndex('by_parent', 'parent_id');
      things.createIndex('by_status', 'status');
      things.createIndex('by_container', 'container_flag');
      things.createIndex('by_name', 'name_lc');

      const events = db.createObjectStore(STORE.events, { keyPath: 'id', autoIncrement: true });
      events.createIndex('by_thing', 'thing_id');
      events.createIndex('by_ts', 'ts');

      db.createObjectStore(STORE.session, { keyPath: 'key' });
      db.createObjectStore(STORE.meta, { keyPath: 'key' });
    },
  });
}

export function deleteCatalog(name = DB_NAME) {
  return deleteDB(name);
}
