"""Turn the company's Excel offer template into SYNCHRO offer templates (sections + preset lines).

Usage: python tools/import_offer_template.py <offer_template.xlsx> server/seed/offer_templates.json

Rules (from the workbook's own structure, see OFFER_TEMPLATE_NOTES.md):
- an offer sheet has a header row with "No" in column A and "Описание на СМР" / "Вид материал" in column B
- a section starts at a long text in column A that is not a number and not a totals row; it ends at "Общо, € без ДДС"
- a line is a row whose column A is an integer; columns: B description, E unit, F qty, I material, J delivery,
  L man-days (or "Монтаж" = installation amount per unit when that header says so), M day rate, S profit, P overhead (ratio inside the formula)
- a unit price typed as a sum of numbers (e.g. =12.52+2.56+7.67) is kept as a manual price
- formulas pointing to other sheets or broken references (#REF!) are not values: left empty for the user
"""
import json, re, sys
import openpyxl

OFFER_SHEETS = ["Equipment", "Play", "Sport", "Padel", "SBR Tiles", "КСС", "GreenSet", "Grass"]

def num(v):
    if v is None or isinstance(v, bool): return None
    if isinstance(v, (int, float)): return float(v)
    s = str(v).strip()
    if re.fullmatch(r"=?\s*-?\d+(\.\d+)?", s): return float(s.lstrip("="))
    return None

def summed(v):
    s = str(v or "")
    if re.fullmatch(r"=\s*\d+(\.\d+)?(\s*\+\s*\d+(\.\d+)?)+", s): return round(sum(float(x) for x in re.findall(r"\d+(?:\.\d+)?", s)), 2)
    return None

def text(v):
    return re.sub(r"\s+", " ", str(v)).strip() if v is not None else ""

def main(src, dst):
    wb = openpyxl.load_workbook(src)
    out, skipped = [], []
    for name in OFFER_SHEETS:
        ws = wb[name]
        header = None
        sec = None
        def close():
            nonlocal sec
            if sec and sec["lines"]: out.append(sec)
            sec = None
        for row in ws.iter_rows(min_row=1, max_row=ws.max_row):
            c = {cell.column_letter: cell.value for cell in row if cell.value is not None}
            a = c.get("A")
            if text(a) == "No" and ("Описание" in text(c.get("B")) or "Вид материал" in text(c.get("B"))):
                header = {k: text(v) for k, v in c.items()}
                continue
            if header is None: continue
            joined = " ".join(text(v) for v in c.values())
            if "Общо, € без ДДС" in joined or "Общо, € с ДДС" in joined or "ДДС 20%" in joined:
                close(); continue
            if a is not None and num(a) is None and len(text(a)) > 25:
                close()
                sec = {"family": name, "description": text(a), "lines": []}
                continue
            if num(a) is not None and text(c.get("B")):
                if sec is None: sec = {"family": name, "description": "", "lines": []}
                install_header = header.get("L", "") == "Монтаж"
                p = str(c.get("O" if install_header else "P", ""))  # Режийни column shifts left by one on the installation-amount layout
                m = re.search(r"\*\s*(0\.\d+)", p)
                line = {"description": text(c.get("B")), "unit": text(c.get("E")) or "бр", "qty": num(c.get("F")) or 1,
                        "material_cost": num(c.get("I")), "delivery_cost": num(c.get("J")),
                        "install_cost": num(c.get("L")) if install_header else None,
                        "labour_days": None if install_header else num(c.get("L")),
                        "day_rate": None if install_header else num(c.get("M")),
                        "overhead_pct": round(float(m.group(1)) * 100, 4) if m else None,
                        "profit_pct": round(num(c.get("R" if install_header else "S")) * 100, 4) if num(c.get("R" if install_header else "S")) is not None else None,
                        "manual_price": summed(c.get("G"))}
                if (c.get("L") and str(c.get("L")).startswith("=")) or (c.get("M") and str(c.get("M")).startswith("=")):
                    skipped.append(f"{name}!row {row[0].row}: labour from another sheet left empty")
                sec["lines"].append({k: v for k, v in line.items() if v is not None})
        close()
    # titles: the quoted system name in the description, else the first line
    for i, s in enumerate(out):
        q = re.search(r"\"([^\"]+)\"|„([^“]+)“|система\s+([A-Za-z][\w\s-]+)", s["description"])
        first_sentence = re.split(r"(?<=[.!?])\s", s["description"])[0][:80] if s["description"] else ""
        title = next((g for g in (q.groups() if q else []) if g), None) or first_sentence or s["lines"][0]["description"][:70]
        s["title"] = f"{s['family']}: {title.strip()}" if not q else title.strip()
        s.update({"code": f"T{i + 1:03d}", "alternative": s["family"] in ("Padel", "GreenSet", "SBR Tiles")})
    json.dump(out, open(dst, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"templates={len(out)} lines={sum(len(s['lines']) for s in out)}")
    for s in out: print(f"  {s['code']} {s['family']:9} {s['title'][:48]:48} lines={len(s['lines'])} alt={s['alternative']}")
    print("notes:", len(skipped), "(labour formulas pointing to other sheets left empty)")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])