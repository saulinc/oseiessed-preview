# oseiessed

Single page site for Osei Essed. Plain HTML, CSS, and vanilla JS. No build step.

## Preview

Double click `index.html` to open it in Chrome, or serve the folder so that
`films.json` and the waveform JSON files load over http:

    cd ~/Desktop/oseiessed && python3 -m http.server 8000

then open http://localhost:8000

Chrome blocks `fetch` of local files, so when the page is opened straight off
disk it falls back to `films-fallback.js` for the film data and to seeded
placeholder shapes for the waveforms. Everything still works, it just does not
read the JSON files.

## Two sections

`films.json` holds a `sections` array and the page builds one grid per section,
four across on desktop:

    films   Osei as composer. Six real films with their real poster art.
            Track titles and durations are stand ins until the cue sheets
            and audio arrive. Shape "poster", cropped to 2:3.
    songs   Osei as songwriter. Items are his band's records, square cover art,
            shape "cover". Each item carries an `artist` field (The Woes, Big
            Hands Rhythm & Blues Band) which shows on the cover and on hover.

A section's `id` is also its anchor, so the Film and Songs links in the nav
point at `#films` and `#songs`. Adding a third section means adding an entry to
the array, nothing else.

## How the player behaves

Clicking a poster flips it and lays a landscape panel over that poster row,
graying out the rest of the page. Playback lives outside the panel: once a
track starts, a bar pins to the bottom of the window with the poster thumb,
play and pause, a seek bar and the times. Closing the panel (the X, the grayed
area, or Escape) flips the poster back and leaves the bar playing. Clicking the
thumb or the title in the bar reopens that film. The X at the right of the bar
stops playback and hides it.

## Files

    index.html          page markup
    styles.css          all styles
    app.js              poster grid, flip to player, waveform, playback
    films.json          sections, items and track data (source of truth)
    films-fallback.js   generated copy of films.json for the file:// case
    posters/            placeholder poster and cover art (SVG)
    photos/Osei.jpeg    hero portrait
    waveforms/          placeholder peak data, one JSON per track
    audio/              empty, drop real audio here

## Swapping in real assets

1. Poster and cover art: drop a JPG into `posters/` and point that item's
   `poster` field at it in `films.json`. Film art is cropped to 2:3, record
   covers to a square. Keep the committed files around 900px tall, which is
   sharp at twice the size they render. Full size originals live in
   `posters/originals/`, which git ignores.
2. Portrait: `photos/Osei.jpeg`, set as the hero `src` in `index.html`.
3. Audio: drop files into `audio/<item>/` matching each track's `audio` field.
4. Waveforms: generate real peaks with
   `audiowaveform -i track.m4a -o track.json --pixels-per-second 20 -b 8`
   and replace the file named in each track's `peaks` field.

Until real audio exists the player runs its playhead on a timer using the
`duration` field in `films.json`, so the waveform and track list can be tested.

After editing `films.json`, regenerate `films-fallback.js` so the two stay in
step (it is the same JSON assigned to `window.FILMS_FALLBACK`).

## Contact form

Marked up for Netlify Forms (`data-netlify="true"` plus the hidden `form-name`
field). No backend is wired up. It starts collecting once the site is deployed
to Netlify.
