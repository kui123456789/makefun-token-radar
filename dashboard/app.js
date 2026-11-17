// Early Radar dashboard: renders window.RADAR (written by main.ts).
// Sortable, filterable board; click any row for its value breakdown and
// farm plan. No network: every byte it shows comes from data.js.
(function () {
  var D = window.RADAR;
  if (!D) { document.body.textContent = 'No radar data loaded.'; return; }
  var rows = D.rows, meta = D.meta;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function short(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    return '$' + Math.round(n / 1e3) + 'K';
  }
  function growth(g) {
    if (g === null || g === undefined) return '<span>—</span>';
    var c = g >= 0 ? 'pos' : 'neg';
    return '<span class="' + c + '">' + (g >= 0 ? '+' : '') + g.toFixed(1) + '%</span>';
  }
  function age(a) {
    if (a === null || a === undefined) return '—';
    if (a >= 365) return (a / 365).toFixed(1) + 'y';
    return a + 'd';
  }

  // Header stats and model formula.
  var wl = rows.filter(function (r) { return r.watchlist; }).length;
  document.getElementById('stats').innerHTML =
    '<div class="stat"><b>' + rows.length + '</b><span>ranked</span></div>' +
    '<div class="stat"><b>' + wl + '</b><span>watchlist</span></div>' +
    '<div class="stat"><b>' + meta.pre_token_total + '</b><span>pre-token in snapshot</span></div>' +
    '<div class="stat"><b>' + esc(meta.as_of) + '</b><span>snapshot date</span></div>';
  document.getElementById('formula').textContent = meta.formula;

  // Filter options from the rows themselves.
  function fillSelect(id, values) {
    var el = document.getElementById(id);
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v; o.textContent = v; el.appendChild(o);
    });
  }
  var chains = [], cats = [];
  rows.forEach(function (r) {
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
  });
  fillSelect('chain', chains.sort());
  fillSelect('cat', cats.sort());

  var state = { q: '', chain: '', cat: '', scope: 'all', sort: 'rank', sel: null };

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.scope === 'watchlist' && !r.watchlist) return false;
      if (state.scope === 'early' && r.watchlist) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var k = state.sort;
    out.sort(function (a, b) {
      if (k === 'implied') return b.implied_value_usd - a.implied_value_usd;
      if (k === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (k === 'growth') return (b.change_7d || 0) - (a.change_7d || 0);
      if (k === 'age') return (b.age_days || 0) - (a.age_days || 0);
      if (k === 'name') return a.name.localeCompare(b.name);
      return a.rank - b.rank;
    });
    return out;
  }

  function render() {
    var list = filtered();
    document.getElementById('count').textContent = list.length + ' of ' + rows.length + ' shown';
    var html = '';
    list.forEach(function (r) {
      html += '<tr data-slug="' + esc(r.slug) + '"' + (state.sel === r.slug ? ' class="open"' : '') + '>' +
        '<td>' + r.rank + '</td><td><b>' + esc(r.name) + '</b><br><span class="fine">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td><td>' + esc(r.chains.join(', ')) + '</td>' +
        '<td class="num">' + short(r.tvl_usd) + '</td><td class="num">' + growth(r.change_7d) + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td><td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td>' + (r.watchlist ? '<span class="wl">watchlist</span>' : '<span class="early">early</span>') + '</td></tr>';
    });
    document.getElementById('rows').innerHTML = html || '<tr><td colspan="9">Nothing matches these filters.</td></tr>';
  }

  function showDetail(slug) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    var panel = document.getElementById('detail');
    if (!r) { panel.hidden = true; state.sel = null; render(); return; }
    state.sel = slug;
    panel.hidden = false;
    document.getElementById('d-title').textContent = '#' + r.rank + ' ' + r.name + ' — implied value ' + money(r.implied_value_usd);
    var m = r.model;
    function row(label, v) { return '<tr><td>' + label + '</td><td>' + v + '</td></tr>'; }
    document.getElementById('d-break').innerHTML =
      row('TVL', short(r.tvl_usd)) +
      row('7d growth', (r.change_7d === null ? 'not reported' : r.change_7d.toFixed(2) + '%')) +
      row('Age since listing', age(r.age_days)) +
      row('Size factor', 'sqrt(TVL / 1M) × $4,000,000 = ' + money(m.size_mult)) +
      row('Growth factor', m.growth_mult.toFixed(4)) +
      row('Maturity factor', m.maturity_mult.toFixed(4)) +
      row('Chain factor (' + r.chains.length + ' chains)', m.chain_mult.toFixed(4)) +
      row('Category factor (' + (r.category || 'none') + ')', m.category_mult.toFixed(4)) +
      row('Implied value', '<b>' + money(r.implied_value_usd) + '</b>');
    document.getElementById('d-formula').textContent = meta.formula;
    document.getElementById('d-steps').innerHTML = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    render();
    panel.scrollIntoView({ block: 'nearest' });
  }

  document.getElementById('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) showDetail(tr.getAttribute('data-slug'));
  });
  document.querySelectorAll('#board thead th[data-k]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      state.sort = (k === 'name') ? 'name' : k;
      document.getElementById('sort').value = state.sort;
      render();
    });
  });
  function bind(id, key, ev) {
    document.getElementById(id).addEventListener(ev || 'input', function (e) { state[key] = e.target.value; render(); });
  }
  bind('q', 'q'); bind('chain', 'chain', 'change'); bind('cat', 'cat', 'change');
  bind('scope', 'scope', 'change'); bind('sort', 'sort', 'change');

  // Live-token table (contrast only, never ranked).
  document.getElementById('live-rows').innerHTML = D.live.map(function (r) {
    return '<tr><td><b>' + esc(r.name) + '</b><br><span class="fine">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category || '—') + '</td><td class="num">' + short(r.tvl_usd) + '</td>' +
      '<td class="num">' + (r.mcap_usd === null ? '—' : short(r.mcap_usd)) + '</td></tr>';
  }).join('');

  // Deep links for screenshots: ?view=detail&slug=X, ?view=filtered&chain=X&category=Y&scope=Z
  var p = new URLSearchParams(location.search);
  if (p.get('chain')) { state.chain = p.get('chain'); document.getElementById('chain').value = state.chain; }
  if (p.get('category')) { state.cat = p.get('category'); document.getElementById('cat').value = state.cat; }
  if (p.get('scope')) { state.scope = p.get('scope'); document.getElementById('scope').value = state.scope; }
  if (p.get('sort')) { state.sort = p.get('sort'); document.getElementById('sort').value = state.sort; }
  render();
  if (p.get('view') === 'detail' && p.get('slug')) showDetail(p.get('slug'));
})();
