# Generates a synthetic two-sheet electrical plan set for testing Voltline:
#   E-101 FIRST FLOOR POWER PLAN    (27 duplex receptacles, 1 panel)
#   E-102 FIRST FLOOR LIGHTING PLAN (50 2x4 troffers, 9 switches, 4 exit signs)
#
# Drawn at a TRUE 1/4" = 1'-0" scale on ARCH D (36x24 in): 1 ft = 18 pt.
# The bottom dimension line's arrow tips are exactly 100'-0" (1800 pt) apart,
# so calibration can be verified precisely. The scale text appears ONLY in the
# title block (once per sheet) so parseDrawingScale has an unambiguous read.
#
# Output: test-assets/sample-plan-E101-E102.pdf
#         test-assets/sample-plan-truth.json
# Ground truth counts are printed at the end — compare AI auto-count to these.

from reportlab.pdfgen import canvas
from reportlab.lib.colors import black, white, Color
import os
import json

W, H = 2592, 1728          # ARCH D landscape, points
S = 18.0                   # points per foot at 1/4" = 1'-0"
BX, BY = 250, 420          # building origin (lower-left, points)
BW, BH = 100 * S, 60 * S   # building: 100 ft x 60 ft

GRAY = Color(0.55, 0.55, 0.55)
LIGHT = Color(0.75, 0.75, 0.75)

counts = {}
current_sheet_symbols = []


def bump(key, n=1):
    counts[key] = counts.get(key, 0) + n


def record_symbol(kind, x, y_reportlab, w, h):
    y_topdown = H - y_reportlab
    current_sheet_symbols.append({
        "kind": kind,
        "x": round(float(x), 4),
        "y": round(float(y_topdown), 4),
        "w": round(float(w), 4),
        "h": round(float(h), 4),
    })


def ft(x):
    return x * S


# ---------------------------------------------------------------- symbols

def duplex(c, x, y):
    """Standard duplex receptacle: circle with two parallel ticks through it."""
    c.setLineWidth(1.6)
    c.circle(x, y, 7, stroke=1, fill=0)
    c.line(x - 3, y - 11, x - 3, y + 11)
    c.line(x + 3, y - 11, x + 3, y + 11)
    bump("duplex receptacle")
    record_symbol("duplex", x, y, 14, 22)


def troffer(c, cx, cy):
    """2'x4' troffer: rectangle with one diagonal."""
    c.setLineWidth(1.2)
    c.rect(cx - 36, cy - 18, 72, 36, stroke=1, fill=0)
    c.line(cx - 36, cy - 18, cx + 36, cy + 18)
    bump("2x4 troffer")
    record_symbol("troffer", cx, cy, 72, 36)


def switch(c, x, y):
    c.setFont("Helvetica-Bold", 16)
    c.drawCentredString(x, y - 6, "S")
    bump("switch")
    record_symbol("switch", x, y, 16, 16)


def exit_sign(c, x, y):
    c.setFillColor(black)
    c.rect(x - 12, y - 6, 24, 12, stroke=1, fill=1)
    c.setFont("Helvetica", 6)
    c.drawCentredString(x, y - 16, "EXIT")
    bump("exit sign")
    record_symbol("exit", x, y, 24, 12)


def panel(c, x, y):
    c.setFillColor(black)
    c.rect(x - 6, y - 30, 12, 60, stroke=1, fill=1)
    c.setFont("Helvetica-Bold", 11)
    c.drawRightString(x - 12, y - 4, "LP-1")
    bump("panel")
    record_symbol("panel", x, y, 12, 60)


# ---------------------------------------------------------------- shell

def wall_segments(x0, x1, gaps):
    """Split the span [x0,x1] into wall segments around door gaps."""
    segs, cur = [], x0
    for g0, g1 in gaps:
        segs.append((cur, g0))
        cur = g1
    segs.append((cur, x1))
    return segs


def draw_shell(c):
    """Building outline, partitions, doors, room labels. Identical both sheets."""
    # exterior walls: double line
    c.setLineWidth(2.5)
    c.rect(BX, BY, BW, BH)
    c.setLineWidth(1.0)
    c.rect(BX + 8, BY + 8, BW - 16, BH - 16)

    y_lo, y_hi = BY + ft(24), BY + ft(32)  # corridor walls

    # bottom offices: 5 @ 20 ft; top rooms: 4 @ 25 ft
    c.setLineWidth(1.8)
    for i in range(1, 5):
        x = BX + ft(20 * i)
        c.line(x, BY + 8, x, y_lo)
    for i in range(1, 4):
        x = BX + ft(25 * i)
        c.line(x, y_hi, x, BY + BH - 8)

    # corridor walls with a 3 ft door gap per room
    lo_gaps = [(BX + ft(20 * i + 2), BX + ft(20 * i + 5)) for i in range(5)]
    hi_gaps = [(BX + ft(25 * i + 2), BX + ft(25 * i + 5)) for i in range(4)]
    for a, b in wall_segments(BX + 8, BX + BW - 8, lo_gaps):
        c.line(a, y_lo, b, y_lo)
    for a, b in wall_segments(BX + 8, BX + BW - 8, hi_gaps):
        c.line(a, y_hi, b, y_hi)

    # door swing arcs (quarter circles at each gap)
    c.setLineWidth(0.6)
    for g0, _ in lo_gaps:
        c.arc(g0 - ft(3), y_lo - ft(3), g0 + ft(3), y_lo + ft(3), 270, 90)
    for g0, _ in hi_gaps:
        c.arc(g0 - ft(3), y_hi - ft(3), g0 + ft(3), y_hi + ft(3), 0, 90)

    # room labels
    c.setFillColor(black)
    c.setFont("Helvetica", 13)
    names_lo = ["OFFICE 101", "OFFICE 102", "OFFICE 103", "OFFICE 104", "OFFICE 105"]
    for i, name in enumerate(names_lo):
        c.drawCentredString(BX + ft(20 * i + 10), (BY + y_lo) / 2, name)
    names_hi = ["OFFICE 106", "CONFERENCE 107", "BREAK ROOM 108", "STORAGE 109"]
    for i, name in enumerate(names_hi):
        c.drawCentredString(BX + ft(25 * i + 12.5), (y_hi + BY + BH) / 2, name)
    c.setFont("Helvetica", 11)
    c.drawCentredString(BX + BW / 2, (y_lo + y_hi) / 2 - 24, "CORRIDOR 100")


def draw_dimensions(c):
    c.setLineWidth(0.8)
    # bottom: 100'-0" — arrow tips are EXACTLY 1800 pt apart (calibrate here)
    yd = 350
    c.line(BX, BY - 10, BX, yd - 10)
    c.line(BX + BW, BY - 10, BX + BW, yd - 10)
    c.line(BX, yd, BX + BW, yd)
    for x, d in ((BX, 1), (BX + BW, -1)):
        p = c.beginPath()
        p.moveTo(x, yd)
        p.lineTo(x + d * 14, yd + 4)
        p.lineTo(x + d * 14, yd - 4)
        p.close()
        c.setFillColor(black)
        c.drawPath(p, stroke=0, fill=1)
    c.setFont("Helvetica", 14)
    c.drawCentredString(BX + BW / 2, yd + 8, "100'-0\"")

    # left: 60'-0"
    xd = 180
    c.line(BX - 10, BY, xd - 10, BY)
    c.line(BX - 10, BY + BH, xd - 10, BY + BH)
    c.line(xd, BY, xd, BY + BH)
    for y, d in ((BY, 1), (BY + BH, -1)):
        p = c.beginPath()
        p.moveTo(xd, y)
        p.lineTo(xd + 4, y + d * 14)
        p.lineTo(xd - 4, y + d * 14)
        p.close()
        c.drawPath(p, stroke=0, fill=1)
    c.saveState()
    c.translate(xd - 8, BY + BH / 2)
    c.rotate(90)
    c.drawCentredString(0, 0, "60'-0\"")
    c.restoreState()

    # graphic scale bar (no scale text here — the text lives in the title block)
    sx, sy = 250, 250
    for i in range(4):
        c.rect(sx + i * ft(4), sy, ft(4), 10, stroke=1, fill=(i % 2 == 0))
    c.setFont("Helvetica", 9)
    for i, label in enumerate(["0", "4'", "8'", "12'", "16'"]):
        c.drawCentredString(sx + i * ft(4), sy + 14, label)


def draw_legend(c, lighting):
    x, y, w, h = 250, 1524, 620, 150
    c.setLineWidth(1.2)
    c.rect(x, y, w, h)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(x + 10, y + h - 22, "SYMBOL LEGEND")
    c.setFont("Helvetica", 10)
    rows = [
        ("duplex", "DUPLEX RECEPTACLE, 20A, 125V, +18\" AFF"),
        ("troffer", "2' x 4' LED TROFFER, CEILING GRID MOUNT"),
        ("switch", "SINGLE-POLE SWITCH, +48\" AFF"),
        ("exit", "LED EXIT SIGN, CEILING MOUNT"),
    ]
    ry = y + h - 48
    for kind, text in rows:
        if kind == "duplex":
            c.setLineWidth(1.6)
            c.circle(x + 30, ry, 6, stroke=1, fill=0)
            c.line(x + 27.5, ry - 9, x + 27.5, ry + 9)
            c.line(x + 32.5, ry - 9, x + 32.5, ry + 9)
        elif kind == "troffer":
            c.setLineWidth(1.0)
            c.rect(x + 12, ry - 8, 36, 16, stroke=1, fill=0)
            c.line(x + 12, ry - 8, x + 48, ry + 8)
        elif kind == "switch":
            c.setFont("Helvetica-Bold", 13)
            c.drawCentredString(x + 30, ry - 5, "S")
            c.setFont("Helvetica", 10)
        else:
            c.setFillColor(black)
            c.rect(x + 20, ry - 5, 20, 10, stroke=1, fill=1)
        c.setFillColor(black)
        c.setFont("Helvetica", 10)
        c.drawString(x + 60, ry - 4, text)
        ry -= 28


def draw_north_arrow(c):
    cx, cy = 2250, 1600
    c.setLineWidth(1.2)
    c.circle(cx, cy, 28, stroke=1, fill=0)
    p = c.beginPath()
    p.moveTo(cx, cy + 22)
    p.lineTo(cx - 10, cy - 14)
    p.lineTo(cx, cy - 4)
    p.lineTo(cx + 10, cy - 14)
    p.close()
    c.setFillColor(black)
    c.drawPath(p, stroke=0, fill=1)
    c.setFont("Helvetica-Bold", 12)
    c.drawCentredString(cx, cy + 34, "N")


def draw_title_block(c, sheet_no, sheet_name_lines):
    x0, x1 = 2352, 2562
    top, bot = 1698, 30
    c.setLineWidth(2)
    c.rect(x0, bot, x1 - x0, top - bot)
    cx = (x0 + x1) / 2
    for y in (1560, 1400, 1240, 1000, 300, 170):
        c.setLineWidth(1)
        c.line(x0, y, x1, y)

    c.setFillColor(black)
    c.setFont("Helvetica-Bold", 24)
    c.drawCentredString(cx, 1642, "VOLTLINE")
    c.setFont("Helvetica", 10)
    c.drawCentredString(cx, 1620, "TEST FIXTURES")
    c.drawCentredString(cx, 1585, "ELECTRICAL ENGINEERING")

    c.setFont("Helvetica", 8)
    c.drawString(x0 + 10, 1540, "PROJECT:")
    c.setFont("Helvetica-Bold", 13)
    c.drawCentredString(cx, 1515, "SAMPLE OFFICE")
    c.drawCentredString(cx, 1497, "BUILDING")
    c.setFont("Helvetica", 9)
    c.drawCentredString(cx, 1470, "123 TEST AVENUE")
    c.drawCentredString(cx, 1455, "SPRINGFIELD, USA")
    c.drawCentredString(cx, 1425, "JOB NO: 2026-001")

    c.setFont("Helvetica", 8)
    c.drawString(x0 + 10, 1382, "REV   DATE          DESCRIPTION")
    c.drawString(x0 + 10, 1366, "0      08/26/2026   ISSUED FOR BID")
    c.setFont("Helvetica-Bold", 10)
    c.drawCentredString(cx, 1330, "ISSUED FOR: BID")
    c.setFont("Helvetica", 9)
    c.drawCentredString(cx, 1300, "DATE: 08/26/2026")
    c.drawCentredString(cx, 1278, "DRAWN: VT    CHK: ES")

    c.setFont("Helvetica-Bold", 12)
    c.drawString(x0 + 10, 1205, "SCALE: 1/4\" = 1'-0\"")
    c.setFont("Helvetica", 7)
    c.drawString(x0 + 10, 1170, "NOTES:")
    c.drawString(x0 + 10, 1155, "1. ALL WORK PER NEC 2023.")
    c.drawString(x0 + 10, 1140, "2. VERIFY ALL DIMENSIONS IN FIELD.")
    c.drawString(x0 + 10, 1125, "3. SYNTHETIC TEST SHEET.")
    c.drawString(x0 + 10, 1110, "    NOT FOR CONSTRUCTION.")

    c.saveState()
    c.setFillColor(GRAY)
    c.translate(cx, 650)
    c.rotate(90)
    c.setFont("Helvetica", 10)
    c.drawCentredString(0, 0, "SYNTHETIC TEST SHEET — NOT FOR CONSTRUCTION")
    c.restoreState()

    c.setFillColor(black)
    c.setFont("Helvetica", 8)
    c.drawString(x0 + 10, 282, "SHEET TITLE:")
    c.setFont("Helvetica-Bold", 13)
    yy = 255
    for line in sheet_name_lines:
        c.drawCentredString(cx, yy, line)
        yy -= 20

    c.setFont("Helvetica", 8)
    c.drawString(x0 + 10, 150, "SHEET NO.")
    c.setFont("Helvetica-Bold", 46)
    c.drawCentredString(cx, 70, sheet_no)


def draw_border_and_furniture(c, sheet_no, name_lines, plan_title, lighting):
    c.setLineWidth(2)
    c.rect(30, 30, W - 60, H - 60)
    draw_shell(c)
    draw_dimensions(c)
    draw_legend(c, lighting)
    draw_north_arrow(c)
    draw_title_block(c, sheet_no, name_lines)
    c.setFont("Helvetica-Bold", 20)
    c.drawCentredString(BX + BW / 2, 190, plan_title)
    c.setLineWidth(1.5)
    tw = c.stringWidth(plan_title, "Helvetica-Bold", 20)
    c.line(BX + BW / 2 - tw / 2, 182, BX + BW / 2 + tw / 2, 182)


# ---------------------------------------------------------------- sheets

def sheet_e101(c):
    draw_border_and_furniture(
        c, "E-101", ["FIRST FLOOR", "POWER PLAN"], "FIRST FLOOR POWER PLAN", False
    )
    # receptacles: bottom offices 3 each on the bottom exterior wall
    for i in range(5):
        left = BX + ft(20 * i)
        for f in (0.25, 0.50, 0.75):
            duplex(c, left + ft(20) * f, BY)
    # top rooms 3 each on the top exterior wall
    for i in range(4):
        left = BX + ft(25 * i)
        for f in (0.25, 0.50, 0.75):
            duplex(c, left + ft(25) * f, BY + BH)
    # panel on the right interior wall at the corridor
    panel(c, BX + BW - 14, BY + ft(28))
    # two homerun curves with circuit labels
    c.setLineWidth(0.9)
    c.bezier(1960, 436, 2090, 620, 2160, 800, BX + BW - 20, BY + ft(28) - 12)
    c.bezier(1825, 1484, 2140, 1300, 2180, 1050, BX + BW - 20, BY + ft(28) + 16)
    c.setFont("Helvetica", 9)
    c.drawString(2100, 700, "LP-1: 2,4")
    c.drawString(2090, 1180, "LP-1: 1,3")


def sheet_e102(c):
    draw_border_and_furniture(
        c, "E-102", ["FIRST FLOOR", "LIGHTING PLAN"], "FIRST FLOOR LIGHTING PLAN", True
    )
    y_lo, y_hi = BY + ft(24), BY + ft(32)
    # bottom offices: 2 x 2 troffers each
    for i in range(5):
        left = BX + ft(20 * i)
        for fx in (ft(20) / 3, 2 * ft(20) / 3):
            for fy in (ft(24) / 3, 2 * ft(24) / 3):
                troffer(c, left + fx, BY + fy)
    # top rooms: 2 x 3 troffers each
    for i in range(4):
        left = BX + ft(25 * i)
        for fx in (ft(25) / 3, 2 * ft(25) / 3):
            for fy in (ft(28) / 4, 2 * ft(28) / 4, 3 * ft(28) / 4):
                troffer(c, left + fx, y_hi + fy)
    # corridor: 6 troffers on the centerline
    for i in range(6):
        troffer(c, BX + ft(10 + 16 * i), (y_lo + y_hi) / 2)
    # switches at each door (inside the room, by the strike side)
    for i in range(5):
        switch(c, BX + ft(20 * i + 6.5), y_lo - 18)
    for i in range(4):
        switch(c, BX + ft(25 * i + 6.5), y_hi + 22)
    # exit signs in the corridor
    for x in (280, 860, 1440, 2020):
        exit_sign(c, x, (y_lo + y_hi) / 2 + 36)


def main():
    out_dir = os.path.join(os.path.dirname(__file__), "..", "test-assets")
    os.makedirs(out_dir, exist_ok=True)
    pdf_out = os.path.abspath(os.path.join(out_dir, "sample-plan-E101-E102.pdf"))
    truth_out = os.path.abspath(os.path.join(out_dir, "sample-plan-truth.json"))

    c = canvas.Canvas(pdf_out, pagesize=(W, H))
    c.setTitle("Sample Office Building — Electrical (Synthetic Test Set)")

    global current_sheet_symbols, counts

    current_sheet_symbols = []
    counts = {}
    sheet_e101(c)
    c.showPage()
    e101_counts = dict(counts)
    e101_symbols = list(current_sheet_symbols)

    current_sheet_symbols = []
    counts = {}
    sheet_e102(c)
    c.showPage()
    e102_counts = dict(counts)
    e102_symbols = list(current_sheet_symbols)

    c.save()

    truth_data = {
        "sheets": [
            {
                "sheet_no": "E-101",
                "sheet_name": "FIRST FLOOR POWER PLAN",
                "page_number": 1,
                "width": W,
                "height": H,
                "symbols": e101_symbols,
            },
            {
                "sheet_no": "E-102",
                "sheet_name": "FIRST FLOOR LIGHTING PLAN",
                "page_number": 2,
                "width": W,
                "height": H,
                "symbols": e102_symbols,
            },
        ]
    }

    with open(truth_out, "w", encoding="utf-8") as f:
        json.dump(truth_data, f, indent=2)

    print(f"Wrote {pdf_out}")
    print(f"Wrote {truth_out}")
    print("\nGROUND TRUTH — E-101 FIRST FLOOR POWER PLAN")
    for k, v in sorted(e101_counts.items()):
        print(f"  {k}: {v}")
    print(f"  Total symbols recorded: {len(e101_symbols)}")
    print("\nGROUND TRUTH — E-102 FIRST FLOOR LIGHTING PLAN")
    for k, v in sorted(e102_counts.items()):
        print(f"  {k}: {v}")
    print(f"  Total symbols recorded: {len(e102_symbols)}")
    print("\nCALIBRATION: bottom dimension arrow tips are exactly 100'-0\" apart.")
    print("SCALE: 1/4\" = 1'-0\" (printed once per sheet, in the title block).")


if __name__ == "__main__":
    main()
