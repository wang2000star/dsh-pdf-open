/**
 * Client half: one icon control in the document-preview header that reopens the
 * same PDF through this plugin's authenticated `/api/pdf-open/raw` route in a new
 * tab, so
 * the browser's own PDF viewer supplies rotation, outline and find.
 *
 * The route is same-origin and already carries the browser's DSH session
 * cookie, which is why a plain navigation works where a Host launch would not.
 */
window.__ModuleLoader__.load({
  id: 'dsh-pdf-open',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const zh = /^zh\b/i.test(navigator.language || '')
    const label = zh ? '在浏览器中打开（旋转 / 大纲 / 查找）' : 'Open in browser (rotate, outline, find)'

    function Icon() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 15,
          height: 15,
          'aria-hidden': true,
          focusable: false,
          style: { display: 'block' },
        },
        h('path', {
          d: 'M12.6 9.4V13a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1V4.8a1 1 0 0 1 1-1h3.4',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': 1.3,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        }),
        h('path', {
          d: 'M9.8 2.2h4v4',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': 1.3,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        }),
        h('path', {
          d: 'M13.6 2.4 7.6 8.4',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': 1.3,
          'stroke-linecap': 'round',
        }),
      )
    }

    function OpenInBrowser(props) {
      const path = props.absolutePath
      if (typeof path !== 'string' || !/\.pdf$/i.test(path)) return null
      const [pressed, setPressed] = React.useState(false)
      return h(
        'button',
        {
          type: 'button',
          title: label,
          'aria-label': label,
          'data-pdf-open-in-browser': 'true',
          onClick(event) {
            event.preventDefault()
            event.stopPropagation()
            setPressed(true)
            window.setTimeout(() => setPressed(false), 400)
            window.open('/api/pdf-open/raw?path=' + encodeURIComponent(path), '_blank', 'noopener')
          },
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '24px',
            height: '24px',
            padding: '0',
            border: 'none',
            borderRadius: '6px',
            background: pressed ? 'color-mix(in srgb, currentColor 14%, transparent)' : 'transparent',
            color: 'inherit',
            cursor: 'pointer',
            opacity: pressed ? 0.75 : 1,
          },
        },
        h(Icon),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.right.tab.document.actions', () =>
          ctx.slots.register(
            {
              name: 'sidebar.right.tab.document.actions',
              id: 'dsh-pdf-open',
              order: 50,
            },
            OpenInBrowser,
          ),
        )
      },
    }
  },
})
