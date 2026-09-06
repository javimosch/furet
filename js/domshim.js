// domshim.js — a real DOM over the page's parsed tree, inside QuickJS.
// globalThis.__NODES is the arena furet's MFL parser produced:
//   node = { k:1|2 (elem|text), t:tag, x:text, a:[[name,val],...], c:[childIdx,...] }
// This builds document.querySelector[All], element.textContent/getAttribute/etc.
// Selection semantics mirror furet's native CSS-lite engine.
(function () {
  var N = globalThis.__NODES || [];
  var ELEM = 1, TEXT = 2;
  function tagOf(i) { return N[i].t; }
  function kids(i) { return N[i].c || []; }
  function attrsOf(i) { return N[i].a || []; }
  function getAttr(i, name) { var a = attrsOf(i); for (var j = 0; j < a.length; j++) if (a[j][0] === name) return a[j][1]; return null; }
  function hasAttr(i, name) { var a = attrsOf(i); for (var j = 0; j < a.length; j++) if (a[j][0] === name) return true; return false; }
  function classList(i) { var c = getAttr(i, 'class') || ''; return c.split(/\s+/).filter(Boolean); }
  function isBlock(t) { return /^(div|p|section|article|header|footer|main|aside|nav|ul|ol|li|table|tr|h[1-6]|br|hr|blockquote|pre|figure)$/.test(t); }
  function textOf(i) {
    var n = N[i];
    if (n.k === TEXT) return n.x || '';
    if (n.t === 'script' || n.t === 'style') return '';
    var s = '', c = kids(i);
    for (var j = 0; j < c.length; j++) {
      var ci = c[j], kt = textOf(ci);
      if (N[ci].k === ELEM && isBlock(N[ci].t)) s += ' ' + kt + ' '; else s += kt;
    }
    return s;
  }
  function collapse(s) { return s.replace(/\s+/g, ' ').trim(); }

  function parseSimple(tok) {
    var s = { tag: '', id: '', cls: [], attr: '' }, i = 0, ts = '';
    while (i < tok.length && '#.['.indexOf(tok[i]) < 0) { ts += tok[i]; i++; }
    s.tag = ts.toLowerCase();
    while (i < tok.length) {
      var c = tok[i];
      if (c === '#') { i++; var v = ''; while (i < tok.length && '#.['.indexOf(tok[i]) < 0) { v += tok[i]; i++; } s.id = v; }
      else if (c === '.') { i++; var v2 = ''; while (i < tok.length && '#.['.indexOf(tok[i]) < 0) { v2 += tok[i]; i++; } s.cls.push(v2); }
      else if (c === '[') { i++; var v3 = ''; while (i < tok.length && tok[i] !== ']') { v3 += tok[i]; i++; } if (i < tok.length) i++; s.attr = v3.toLowerCase(); }
      else i++;
    }
    return s;
  }
  function parseSel(sel) { return sel.trim().split(/\s+/).filter(Boolean).map(parseSimple); }
  function matchSimple(i, s) {
    if (N[i].k !== ELEM) return false;
    if (s.tag && s.tag !== '*' && s.tag !== N[i].t) return false;
    if (s.id && getAttr(i, 'id') !== s.id) return false;
    for (var j = 0; j < s.cls.length; j++) if (classList(i).indexOf(s.cls[j]) < 0) return false;
    if (s.attr && !hasAttr(i, s.attr)) return false;
    return true;
  }
  var parent = {};
  for (var pi = 0; pi < N.length; pi++) { var pc = kids(pi); for (var pj = 0; pj < pc.length; pj++) parent[pc[pj]] = pi; }
  function par(i) { return parent[i] === undefined ? -1 : parent[i]; }
  function matchChain(i, chain, ci) {
    if (!matchSimple(i, chain[ci])) return false;
    if (ci === 0) return true;
    var p = par(i);
    while (p >= 0) { if (matchChain(p, chain, ci - 1)) return true; p = par(p); }
    return false;
  }
  function descendants(root, out) { var c = kids(root); for (var j = 0; j < c.length; j++) { out.push(c[j]); descendants(c[j], out); } }

  function El(i) { this._i = i; }
  Object.defineProperty(El.prototype, 'textContent', { get: function () { return collapse(textOf(this._i)); } });
  Object.defineProperty(El.prototype, 'innerText', { get: function () { return collapse(textOf(this._i)); } });
  Object.defineProperty(El.prototype, 'tagName', { get: function () { return (N[this._i].t || '').toUpperCase(); } });
  Object.defineProperty(El.prototype, 'className', { get: function () { return getAttr(this._i, 'class') || ''; } });
  Object.defineProperty(El.prototype, 'id', { get: function () { return getAttr(this._i, 'id') || ''; } });
  El.prototype.getAttribute = function (name) { return getAttr(this._i, name); };
  El.prototype.hasAttribute = function (name) { return hasAttr(this._i, name); };
  El.prototype.getAttributeNames = function () { return attrsOf(this._i).map(function (a) { return a[0]; }); };
  El.prototype.querySelectorAll = function (sel) { return queryFrom(this._i, sel); };
  El.prototype.querySelector = function (sel) { var r = queryFrom(this._i, sel); return r.length ? r[0] : null; };

  function queryFrom(root, sel) {
    var chain = parseSel(sel); if (!chain.length) return [];
    var last = chain.length - 1, scope = [];
    if (root < 0) { for (var i = 0; i < N.length; i++) scope.push(i); } else descendants(root, scope);
    var res = [];
    for (var k = 0; k < scope.length; k++) {
      var idx = scope[k];
      if (N[idx].k === ELEM && N[idx].t !== '#root' && matchChain(idx, chain, last)) res.push(new El(idx));
    }
    return res;
  }
  globalThis.El = El;
  globalThis.document = {
    querySelectorAll: function (sel) { return queryFrom(-1, sel); },
    querySelector: function (sel) { var r = queryFrom(-1, sel); return r.length ? r[0] : null; },
    get title() { var r = queryFrom(-1, 'title'); return r.length ? r[0].textContent : ''; },
    get body() { var r = queryFrom(-1, 'body'); return r.length ? r[0] : null; }
  };
})();
