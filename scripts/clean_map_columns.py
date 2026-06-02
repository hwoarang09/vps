#!/usr/bin/env python3
"""Drop unused columns from y_short map files (edges.cfg, station.map).

- Preserves leading '#' comment lines verbatim.
- Uses csv module so quoted fields (e.g. waypoints "[a, b, c]") stay intact.
- Drops columns by NAME (order/position independent).
"""
import csv
import io
import sys

# columns to DROP per file (everything else is kept, original order preserved)
DROP = {
    "edges.cfg": {
        "vcu_direction", "ole", "tle", "fle", "tmpLen",
        "origin_from_x", "origin_from_y", "origin_from_z",
        "origin_to_x", "origin_to_y", "origin_to_z", "rail_id",
    },
    "station.map": {
        "barcode_z", "port_id", "port_type_code", "direction_code",
        "link_sc_id", "buffer_size", "mode_type", "floor", "zone_id",
        "rail_index", "sc_id", "e84", "teached", "look_down", "eq_id",
    },
}


def clean(path, drop_cols):
    with open(path, "r", newline="") as f:
        raw = f.read()

    lines = raw.split("\n")

    # split leading comment lines from the CSV body
    comments = []
    i = 0
    while i < len(lines) and lines[i].lstrip().startswith("#"):
        comments.append(lines[i])
        i += 1

    body = "\n".join(lines[i:])
    reader = csv.reader(io.StringIO(body))
    rows = list(reader)
    # drop trailing empty row produced by a final newline
    while rows and rows[-1] == []:
        rows.pop()

    header = rows[0]
    keep_idx = [j for j, name in enumerate(header) if name.strip() not in drop_cols]
    dropped = [name for name in header if name.strip() in drop_cols]

    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    for row in rows:
        writer.writerow([row[j] for j in keep_idx if j < len(row)])

    result = ""
    if comments:
        result += "\n".join(comments) + "\n"
    result += out.getvalue()

    with open(path, "w", newline="") as f:
        f.write(result)

    print(f"{path}")
    print(f"  kept   ({len(keep_idx)}): {[header[j].strip() for j in keep_idx]}")
    print(f"  dropped({len(dropped)}): {dropped}")
    print(f"  rows (incl header): {len(rows)}")


if __name__ == "__main__":
    base = sys.argv[1] if len(sys.argv) > 1 else "."
    for fname, drop in DROP.items():
        clean(f"{base}/{fname}", drop)
