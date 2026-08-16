/* ===========================================================================
   Osei Essed — poster grid, flip to player, waveform playback.
   Vanilla JS. No build step, no framework.

   Playback lives outside the panel: a poster can flip shut and the bottom bar
   keeps playing.
   =========================================================================== */
'use strict';

(function () {

  var FLIP_MS  = 520;   // keep in sync with --flip in styles.css
  var FADE_MS  = 260;   // keep in sync with the .panel transition

  var catalog  = document.getElementById('catalog');
  var scrim    = document.getElementById('scrim');
  var sections = [];    // [{id, label, shape, items}]
  var films    = [];    // every item across both sections, flat, index = data-index

  // ── STATE ────────────────────────────────────────────────────────────────
  var open = {            // the film whose panel is showing
    index: null,
    card: null,
    panel: null,
    canvas: null,
    rows: null,
    view: 0,              // track the panel waveform is showing
    nowEl: null,
    curEl: null,
    durEl: null
  };

  var audio = new Audio();
  audio.preload = 'metadata';

  var play = {            // what is audible, independent of any open panel
    film: null,           // film object
    filmIndex: null,
    track: null,
    trackIndex: null,
    mode: 'idle',         // 'audio' once a real file loads, 'sim' when it cannot
    simT: 0,              // simulated playhead, seconds
    playing: false
  };

  var pendingSeek = null;
  var rafId  = null;
  var lastTs = 0;

  // ── BAR ELEMENTS ─────────────────────────────────────────────────────────
  var bar      = document.getElementById('bar');
  var barArt   = document.getElementById('barArt');
  var barTitle = document.getElementById('barTitle');
  var barSeek  = document.getElementById('barSeek');
  var barFill  = document.getElementById('barFill');
  var barCur   = document.getElementById('barCur');
  var barDur   = document.getElementById('barDur');

  // ── DATA ─────────────────────────────────────────────────────────────────
  function loadFilms() {
    return fetch('films.json')
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .catch(function () {
        // Chrome blocks fetch of local files, so fall back to the inline copy
        // when the page is opened straight off disk.
        return window.FILMS_FALLBACK || { films: [] };
      })
      .then(function (data) {
        sections = data.sections || [];
        films = [];
        sections.forEach(function (sec) {
          sec.items.forEach(function (item) {
            item.section = sec.id;
            films.push(item);
          });
        });
      });
  }

  // ── GRID ─────────────────────────────────────────────────────────────────
  function renderGrid() {
    sections.forEach(function (sec) {
      var wrap = document.createElement('section');
      wrap.className = 'catalog-section';
      wrap.id = sec.id;
      wrap.innerHTML =
        '<h2 class="section-label">' + esc(sec.label) + '</h2>' +
        '<div class="poster-grid' + (sec.shape === 'cover' ? ' poster-grid--covers' : '') + '"></div>';
      var grid = wrap.querySelector('.poster-grid');

      sec.items.forEach(function (item) {
        grid.appendChild(buildCard(item, films.indexOf(item)));
      });
      catalog.appendChild(wrap);
    });
  }

  function buildCard(item, i) {
    var card = document.createElement('article');
    card.className = 'poster';
    card.dataset.index = i;
    card.innerHTML =
      '<div class="poster-inner">' +
        '<div class="poster-face poster-front">' +
          '<img src="' + item.poster + '" alt="' + esc(item.title) + ' cover">' +
          '<div class="poster-veil">' +
            '<span class="title">' + esc(item.title) + '</span>' +
            '<span class="meta">' + esc(item.artist || item.year || '') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="poster-face poster-back">' +
          '<span class="title">' + esc(item.title) + '</span>' +
          '<span class="hint">Close</span>' +
        '</div>' +
      '</div>';
    card.addEventListener('click', function () { togglePanel(i); });
    return card;
  }

  function gridOf(card) { return card.parentNode; }

  // ── PANEL ────────────────────────────────────────────────────────────────
  function togglePanel(index) {
    if (open.index === index) { closePanel(); return; }
    if (open.index !== null) closePanel();
    openPanel(index);
  }

  function openPanel(index) {
    var film = films[index];
    var card = catalog.querySelector('.poster[data-index="' + index + '"]');
    card.classList.add('open');

    var panel = buildPanel(film, index);
    gridOf(card).appendChild(panel);   // each section grid holds its own panel

    open.index  = index;
    open.card   = card;
    open.panel  = panel;
    open.canvas = panel.querySelector('.wave');
    open.rows   = panel.querySelectorAll('.track');
    open.nowEl  = panel.querySelector('.player-now');
    open.curEl  = panel.querySelector('.time-cur');
    open.durEl  = panel.querySelector('.time-dur');

    // If this film is the one playing, pick up where it is.
    showTrack(play.filmIndex === index ? play.trackIndex : 0);

    positionPanel();
    scrim.classList.add('on');

    // Fade the panel in over the row at the midpoint of the flip.
    setTimeout(function () {
      if (open.panel !== panel) return;
      positionPanel();
      panel.classList.add('show');
      scrollPanelIntoView();
    }, FLIP_MS / 2);

    startRaf();
  }

  function closePanel() {
    if (open.index === null) return;
    var card  = open.card;
    var panel = open.panel;

    card.classList.remove('open');
    panel.classList.remove('show');
    scrim.classList.remove('on');
    setTimeout(function () { panel.remove(); }, FADE_MS);

    open.index = null;
    open.card = open.panel = open.canvas = open.rows = null;
    open.nowEl = open.curEl = open.durEl = null;
    if (!play.track) stopRaf();
  }

  // Sit the panel on top of the row its poster is in, growing evenly above and
  // below that row when the player is taller than a poster.
  function positionPanel() {
    if (!open.panel || !open.card) return;
    var rowTop = open.card.offsetTop;
    var rowH   = open.card.offsetHeight;
    open.panel.firstElementChild.style.minHeight = rowH + 'px';
    var panelH = Math.max(open.panel.offsetHeight, rowH);
    open.panel.style.top = Math.max(0, rowTop - (panelH - rowH) / 2) + 'px';
  }

  function scrollPanelIntoView() {
    if (!open.panel) return;
    var r      = open.panel.getBoundingClientRect();
    var navEl  = document.querySelector('.nav');
    var nav    = navEl ? navEl.offsetHeight : 62;
    var bottom = window.innerHeight - (bar.classList.contains('on') ? bar.offsetHeight : 0);
    var by     = 0;
    if (r.bottom > bottom - 16)  by = r.bottom - bottom + 16;
    if (r.top - by < nav + 16)   by = r.top - nav - 16;
    if (by) window.scrollBy({ top: by, behavior: 'smooth' });
  }

  function buildPanel(film, filmIndex) {
    var panel = document.createElement('section');
    panel.className = 'panel';
    panel.dataset.film = filmIndex;

    var rows = film.tracks.map(function (t, i) {
      return '' +
        '<li class="track" data-track="' + i + '">' +
          '<span class="track-num">' + (i + 1) + '</span>' +
          '<span class="track-label">' + esc(t.title) + ' / ' + esc(t.artist) + '</span>' +
          '<button class="track-share" type="button" title="Copy link to this track" aria-label="Copy link to this track">' +
            shareIcon() + checkIcon() +
          '</button>' +
        '</li>';
    }).join('');

    panel.innerHTML =
      '<div class="panel-inner">' +
        '<button class="panel-close" type="button" aria-label="Close">' + closeIcon() + '</button>' +
        '<div class="panel-art"><img src="' + film.poster + '" alt="' + esc(film.title) + ' poster"></div>' +
        '<div class="player">' +
          '<div class="player-head">' +
            '<span class="player-film">' + esc(film.title) + '</span>' +
            '<span class="player-now"></span>' +
          '</div>' +
          '<canvas class="wave"></canvas>' +
          '<div class="wave-times"><span class="time-cur">0:00</span><span class="time-dur">0:00</span></div>' +
          '<ol class="tracks">' + rows + '</ol>' +
        '</div>' +
      '</div>';

    panel.querySelector('.panel-close').addEventListener('click', closePanel);

    panel.querySelectorAll('.track').forEach(function (row) {
      row.addEventListener('click', function () {
        var i = parseInt(row.dataset.track, 10);
        if (isCurrent(filmIndex, i)) togglePlay();
        else playTrack(filmIndex, i, true);
      });
      row.querySelector('.track-share').addEventListener('click', function (e) {
        e.stopPropagation();
        copyLink(this, film.id, parseInt(row.dataset.track, 10));
      });
    });

    panel.querySelector('.wave').addEventListener('click', function (e) {
      var rect = this.getBoundingClientRect();
      var pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      if (!isCurrent(filmIndex, open.view)) playTrack(filmIndex, open.view, true);
      seek(pct);
    });

    return panel;
  }

  // Show a track in the open panel. This does not touch playback.
  function showTrack(i) {
    if (open.index === null) return;
    var film  = films[open.index];
    var track = film.tracks[i];
    if (!track) { i = 0; track = film.tracks[0]; }

    open.view = i;
    open.nowEl.textContent = track.title + ' / ' + track.artist;
    markRows();
    loadPeaks(track.peaks);
    drawWave();
  }

  function markRows() {
    if (!open.rows) return;
    open.rows.forEach(function (row, n) {
      row.classList.toggle('current', n === open.view);
      row.classList.toggle('playing', isCurrent(open.index, n) && play.playing);
    });
  }

  // ── PLAYBACK ─────────────────────────────────────────────────────────────
  function isCurrent(filmIndex, trackIndex) {
    return play.filmIndex === filmIndex && play.trackIndex === trackIndex;
  }

  function playTrack(filmIndex, trackIndex, autoplay) {
    var film  = films[filmIndex];
    var track = film && film.tracks[trackIndex];
    if (!track) return;

    play.film       = film;
    play.filmIndex  = filmIndex;
    play.track      = track;
    play.trackIndex = trackIndex;
    play.mode       = 'idle';
    play.simT       = 0;
    play.playing    = false;
    pendingSeek     = null;

    audio.pause();
    audio.src = track.audio;

    barArt.src = film.poster;
    barArt.alt = film.title + ' poster';
    barTitle.textContent = track.title + ' / ' + track.artist;
    barDur.textContent = fmt(track.duration);
    barCur.textContent = '0:00';
    showBar();

    if (open.index === filmIndex) showTrack(trackIndex);
    else markRows();

    if (autoplay) startPlayback();
    startRaf();
  }

  function startPlayback() {
    play.playing = true;
    bar.classList.add('playing');
    var p = audio.play();
    if (p && p.catch) {
      // No audio file yet, so run the playhead on a timer instead. This keeps
      // the player testable until real audio is dropped into audio/.
      p.catch(function () { play.mode = 'sim'; });
    }
  }

  function togglePlay() {
    if (!play.track) return;
    if (play.mode === 'audio') {
      if (audio.paused) startPlayback();
      else { audio.pause(); play.playing = false; bar.classList.remove('playing'); }
    } else {
      play.playing = !play.playing;
      bar.classList.toggle('playing', play.playing);
    }
    markRows();
  }

  function stopAll() {
    audio.pause();
    audio.removeAttribute('src');
    play.film = play.track = null;
    play.filmIndex = play.trackIndex = null;
    play.playing = false;
    play.mode = 'idle';
    play.simT = 0;
    bar.classList.remove('playing');
    hideBar();
    markRows();
    if (open.index !== null) {
      open.curEl.textContent = '0:00';
      drawWave();
    } else {
      stopRaf();
    }
  }

  function nextTrack() {
    if (play.trackIndex === null) return;
    if (play.trackIndex < play.film.tracks.length - 1) {
      playTrack(play.filmIndex, play.trackIndex + 1, true);
    } else {
      play.playing = false;
      play.simT = 0;
      bar.classList.remove('playing');
      markRows();
    }
  }

  function seek(pct) {
    if (!play.track) return;
    if (play.mode === 'audio' && isFinite(audio.duration)) {
      audio.currentTime = pct * audio.duration;
      if (audio.paused) startPlayback();
    } else {
      pendingSeek = pct;                       // applied if a real file loads
      play.simT = pct * play.track.duration;
      if (!play.playing) startPlayback();
    }
  }

  audio.addEventListener('loadedmetadata', function () {
    play.mode = 'audio';
    if (pendingSeek !== null && isFinite(audio.duration)) {
      audio.currentTime = pendingSeek * audio.duration;
    }
    pendingSeek = null;
  });
  audio.addEventListener('error', function () { if (play.track) play.mode = 'sim'; });
  audio.addEventListener('play',  function () {
    play.playing = true;
    bar.classList.add('playing');
    markRows();
  });
  audio.addEventListener('pause', function () {
    if (play.mode !== 'audio') return;
    play.playing = false;
    bar.classList.remove('playing');
    markRows();
  });
  audio.addEventListener('ended', function () { nextTrack(); });

  function duration() {
    if (play.mode === 'audio' && isFinite(audio.duration)) return audio.duration;
    return play.track ? play.track.duration : 0;
  }

  function position() {
    if (play.mode === 'audio' && isFinite(audio.duration)) return audio.currentTime;
    return play.simT;
  }

  function progress() {
    var d = duration();
    return d ? Math.min(1, position() / d) : 0;
  }

  // ── BAR ──────────────────────────────────────────────────────────────────
  function showBar() {
    bar.classList.add('on');
    document.body.classList.add('has-bar');
  }

  function hideBar() {
    bar.classList.remove('on');
    document.body.classList.remove('has-bar');
  }

  document.getElementById('barPlay').addEventListener('click', togglePlay);
  document.getElementById('barClose').addEventListener('click', stopAll);

  barSeek.addEventListener('click', function (e) {
    var rect = barSeek.getBoundingClientRect();
    seek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  });

  barArt.addEventListener('click', function () {
    if (play.filmIndex !== null && open.index !== play.filmIndex) togglePanel(play.filmIndex);
  });

  barTitle.addEventListener('click', function () {
    if (play.filmIndex !== null && open.index !== play.filmIndex) togglePanel(play.filmIndex);
  });

  // ── FRAME LOOP ───────────────────────────────────────────────────────────
  function startRaf() {
    if (rafId) return;
    lastTs = 0;
    rafId = requestAnimationFrame(tick);
  }

  function stopRaf() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function tick(ts) {
    // clamp so a throttled or backgrounded tab does not dump its whole gap
    // into the simulated playhead in one frame
    var dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.25) : 0;
    lastTs = ts;

    if (play.track && play.playing && play.mode !== 'audio') {
      play.simT += dt;
      if (play.simT >= play.track.duration) { play.simT = play.track.duration; nextTrack(); }
    }

    if (play.track) {
      barFill.style.width = (progress() * 100).toFixed(2) + '%';
      barCur.textContent  = fmt(position());
      barDur.textContent  = fmt(duration());
    }

    if (open.index !== null) {
      var viewing = isCurrent(open.index, open.view);
      open.curEl.textContent = fmt(viewing ? position() : 0);
      open.durEl.textContent = fmt(viewing ? duration() : films[open.index].tracks[open.view].duration);
      drawWave();
    }

    rafId = requestAnimationFrame(tick);
  }

  // ── WAVEFORM ─────────────────────────────────────────────────────────────
  var jsonCache = {};   // peaks path  -> parsed JSON
  var barsCache = {};   // path + '-' + bars -> Float32Array
  var pending   = {};

  function loadPeaks(path) {
    if (!path || jsonCache[path] || pending[path]) return;
    pending[path] = true;
    fetch(path)
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (json) {
        if (!json || !Array.isArray(json.data) || !json.data.length) return;
        jsonCache[path] = json;
        // drop any bars derived from the seeded shape for this track
        Object.keys(barsCache).forEach(function (key) {
          if (key.indexOf(path + '-') === 0) delete barsCache[key];
        });
      })
      .catch(function () { /* keep the seeded shape */ })
      .then(function () { delete pending[path]; drawWave(); });
  }

  function getBars(path, n) {
    var key = path + '-' + n;
    if (barsCache[key]) return barsCache[key];
    var json = jsonCache[path];
    var out  = json ? extractPeaks(json, n) : seededPeaks(path, n);
    barsCache[key] = out;
    return out;
  }

  function extractPeaks(json, n) {
    var data  = json.data;
    var scale = (json.bits || 8) === 8 ? 128 : 32768;
    var pairs = Math.floor(data.length / 2);
    var out   = new Float32Array(n);
    for (var j = 0; j < n; j++) {
      var start = Math.floor(j * pairs / n);
      var end   = Math.max(start + 1, Math.ceil((j + 1) * pairs / n));
      var peak  = 0;
      for (var k = start; k < Math.min(end, pairs); k++) {
        var v = Math.max(Math.abs(data[k * 2]), Math.abs(data[k * 2 + 1])) / scale;
        if (v > peak) peak = v;
      }
      out[j] = Math.max(0.05, peak);
    }
    return out;
  }

  function seededPeaks(seed, n) {
    var x   = strHash(seed);
    var out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      x = (x * 1664525 + 1013904223) >>> 0;
      out[i] = 0.15 + (x / 4294967295) * 0.85;
    }
    return out;
  }

  function strHash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function drawWave() {
    var canvas = open.canvas;
    if (!canvas || open.index === null) return;
    var track = films[open.index].tracks[open.view];
    if (!track) return;

    var dpr = window.devicePixelRatio || 1;
    var w = canvas.offsetWidth, h = canvas.offsetHeight;
    if (!w || !h) return;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width  = w * dpr;
      canvas.height = h * dpr;
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var barW = 2, gap = 2, step = barW + gap;
    var n    = Math.max(1, Math.floor(w / step));
    var bars = getBars(track.peaks, n);
    var prog = isCurrent(open.index, open.view) ? progress() : 0;

    for (var i = 0; i < n; i++) {
      var bh = Math.max(1, bars[i] * h);
      ctx.fillStyle = (i / n) < prog ? '#ece8e1' : 'rgba(236,232,225,0.22)';
      ctx.fillRect(i * step, (h - bh) / 2, barW, bh);
    }
  }

  // ── SHARE ────────────────────────────────────────────────────────────────
  function copyLink(btn, filmId, trackIndex) {
    var url = location.href.split('#')[0] + '#' + filmId + '/' + (trackIndex + 1);
    var done = function () {
      btn.classList.add('copied');
      setTimeout(function () { btn.classList.remove('copied'); }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url, done); });
    } else {
      fallbackCopy(url, done);
    }
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* nothing to do */ }
    ta.remove();
  }

  // ── ICONS ────────────────────────────────────────────────────────────────
  function shareIcon() {
    return '<svg class="share" viewBox="0 0 16 16" width="14" height="14" fill="none" ' +
      'stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="3.2" r="2"/><circle cx="12" cy="12.8" r="2"/><circle cx="3.6" cy="8" r="2"/>' +
      '<line x1="5.4" y1="7.1" x2="10.2" y2="4.1"/><line x1="5.4" y1="8.9" x2="10.2" y2="11.9"/></svg>';
  }

  function checkIcon() {
    return '<svg class="check" viewBox="0 0 16 16" width="14" height="14" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<polyline points="2.5,8.5 6.2,12 13.5,4"/></svg>';
  }

  function closeIcon() {
    return '<svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" ' +
      'stroke-width="1.4" stroke-linecap="round">' +
      '<line x1="2" y1="2" x2="12" y2="12"/><line x1="12" y1="2" x2="2" y2="12"/></svg>';
  }

  // ── UTIL ─────────────────────────────────────────────────────────────────
  function fmt(s) {
    if (!s || isNaN(s) || !isFinite(s)) return '0:00';
    var m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;');
  }

  // ── EVENTS ───────────────────────────────────────────────────────────────
  scrim.addEventListener('click', closePanel);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && open.index !== null) closePanel();
  });

  var resizeTimer = null;

  window.addEventListener('resize', function () {
    barsCache = {};
    drawWave();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      positionPanel();
      drawWave();
    }, 120);
  });

  function openFromHash() {
    var m = /^#([a-z0-9_]+)(?:\/(\d+))?$/.exec(location.hash || '');
    if (!m) return;
    for (var i = 0; i < films.length; i++) {
      if (films[i].id === m[1]) {
        openPanel(i);
        if (m[2]) showTrack(Math.max(0, parseInt(m[2], 10) - 1));
        return;
      }
    }
  }

  // ── INIT ─────────────────────────────────────────────────────────────────
  loadFilms().then(function () {
    renderGrid();
    openFromHash();
  });

})();
