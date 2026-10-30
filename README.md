# Warehouse builder

Lay out a warehouse or cold store in 3D, fill it with racks and loads, and place temperature data loggers.

**Live:** https://sufyanahmed1850.github.io/pallet-racking/

- **Empty space to start:** drag to draw a floor, then drag to draw walls (ends snap to the grid and to other walls), or add walls around a floor in one click. Select anything to type exact sizes and positions.
- **Templates:** pallet rack (bays, beam levels, level pitch, beam rating), swing door, horizontal sliding door, vertical roller door, and loads: cartons, sacks, drums, totes, crate, mesh box, empty pallet.
- **Loads:** drop them on the floor or onto rack positions; drag them between positions, racks and the floor. The rack refuses loads over the beam rating or too tall for the level (75 mm clearance).
- **Data loggers:** a 3D Elitech RC-5. In logger mode, click any point on a rack (or a wall) to put a logger there. Loggers are numbered DL-01, DL-02… Clicking one shows its number, a live simulated reading and where it is (rack, bay, level).
- **Doors** open and close with a double-click; open doors warm the loggers near them.
- **Saving:** autosaves in the browser; Export/Import a layout as a JSON file; Undo/Redo.

Keys: V select, F floor, W wall, L logger, R rotate, Delete remove, Ctrl+D duplicate, Ctrl+Z / Ctrl+Y undo/redo, Esc stop.

## Files

- `index.html`, `src/` — the builder (three.js r180 from jsDelivr, no build step)
- `rack-figure.html` — the earlier single-rack illustrated figure; `racking.html` + `core.js` are its source, built with [Colorfigures](https://april-zhu.com/colorfigures) by April Zhu (MIT, see `LICENSE-colorfigures`)
