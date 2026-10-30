# Pallet racking

An interactive, modular pallet racking system you can turn all the way round and load up.

**Live:** https://sufyanahmed1850.github.io/pallet-racking/

- Drag loads from the inbound dock onto any shelf position (green = fits, red = doesn't); drag them to the ship-out lane to remove them. On a phone, tap a load, then tap where it goes.
- Add or remove bays (1–6) and beam levels (1–5), change the level height and the beam rating.
- Beams sag under load (up to L/200 at the rated load, drawn 4x) and bounce when a pallet lands.
- Real rules: 75 mm clearance above every load, no level loaded past its rating, no bay or level removed while loaded.

## Files

- `index.html` — the built, self-contained page (what GitHub Pages serves)
- `racking.html` + `core.js` — the editable source; rebuild with the Colorfigures `build.py`

Built with [Colorfigures](https://april-zhu.com/colorfigures) by April Zhu (MIT, see `LICENSE-colorfigures`).
