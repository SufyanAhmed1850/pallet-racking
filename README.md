# Warehouse builder

Lay out a warehouse or cold store in 3D, fill it with racks and loads, and place temperature data loggers.

**Live:** https://sufyanahmed1850.github.io/pallet-racking/

- **Start from an empty space:** drag to draw a floor and walls (ends snap to the grid and to other walls), or add walls around a floor in one click.
- **Object library:** collapsible categories with 3D thumbnails, search, tooltips; click an object to place it, or drag it straight into the view. Pallet rack, door, horizontal sliding door, vertical roller door, and loads (cartons, sacks, drums, totes, crate, mesh box, empty pallet).
- **Placement rules:** objects must stand on the floor, may not overlap walls, racks or loads, and may not block the clear space in front of a door. The ghost and its floor outline turn green or red, with the reason shown; a move that ends somewhere invalid goes back (or is nudged clear of a shallow overlap). Resizing the floor moves the walls on its edges and pulls objects in.
- **Precise editing:** snap step, rotation snap and grid size; snap guides to neighbouring edges and centres and live distance measurements while dragging; X/Y/Z and rotation fields; move/rotate/scale handles; X or Z while dragging locks the axis; arrows nudge.
- **Multiple objects:** Shift/Ctrl+click or Shift+drag to box-select; move together; align (left, right, top, bottom, centres) and distribute; group; copy, paste, duplicate; lock, hide; an object list with show/lock toggles.
- **Camera:** orbit by dragging empty space, pan with the middle or right button or the Pan tool, zoom with the wheel; Top, Bottom, Front, Back, Left, Right and Isometric views; Fit and Reset.
- **Racks and loads:** bays, levels, level pitch and beam rating; loads checked against the rating and the 75 mm clearance; beams sag under load and bounce when a pallet is set down.
- **Data loggers:** a 3D Elitech RC-5; in logger mode click a rack (or a wall) to place one; numbered DL-01, DL-02…; clicking one shows its number, a live simulated reading and where it is.
- **Saving:** autosaves in the browser; Export/Import a layout as a JSON file (older files load as before); Undo/Redo for every edit.

Press `?` in the app for all keyboard shortcuts.

## Files

- `index.html`, `src/` — the builder (three.js r180 from jsDelivr, no build step): `main.js` (app), `rules.js` (placement rules), `models.js`, `logger.js`, `library.js`
- `rack-figure.html` — the earlier single-rack illustrated figure; `racking.html` + `core.js` are its source, built with [Colorfigures](https://april-zhu.com/colorfigures) by April Zhu (MIT, see `LICENSE-colorfigures`)
