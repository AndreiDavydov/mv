import { h, plural } from '../dom.js';
import { displayName, icon, thumbnail } from '../components.js';
import { urlPool } from '../../platform/images.js';
import { buildPayload } from '../../../../shared/payload.js';
import { toSVG } from '../../../../shared/qr-svg.js';

/**
 * A printable contents list to tape inside the lid. Redundancy for the day the
 * phone is dead or the digital layer is simply in the way — the box should be
 * legible on its own.
 */
export function manifestView(app, { container, contents, trail }) {
  const pool = urlPool();
  const qr = h('div.manifest__qr');
  qr.innerHTML = toSVG(buildPayload(container.id), { sizeMm: 24 });

  const view = h('section.view.view--manifest', null,
    h('div.manifest__toolbar.no-print', null,
      h('button.btn', { type: 'button', onClick: () => app.open(container.id) }, 'Back'),
      h('button.btn.btn--primary', { type: 'button', onClick: () => window.print() }, 'Print'),
    ),

    h('article.manifest__page', null,
      h('header.manifest__head', null,
        h('div', null,
          h('h1.manifest__title', null, `${icon(container)} ${displayName(container)}`),
          h('p.manifest__sub', null,
            [container.container_kind, container.room, trail.map((t) => displayName(t)).join(' → ')]
              .filter(Boolean).join(' · ')),
        ),
        h('div.manifest__ident', null, qr, h('code.manifest__id', null, container.id)),
      ),

      h('div.manifest__count', null,
        plural(contents.length, 'item'),
        h('span.manifest__date', null, new Date().toLocaleDateString()),
      ),

      contents.length
        ? h('ol.manifest__list', null, contents.map((thing) =>
            h('li.manifest__item', null,
              thumbnail(thing, pool, { size: 'sm' }),
              h('div.manifest__item-text', null,
                h('strong', null, displayName(thing)),
                thing.tags?.length ? h('span.muted', null, ` ${thing.tags.map((t) => `#${t}`).join(' ')}`) : null,
              ),
              h('code', null, thing.id),
            )))
        : h('p.muted', null, 'Empty.'),
    ),
  );

  view.destroy = () => pool.release();
  return view;
}
