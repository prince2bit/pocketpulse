"""Rasterise the SVGs in docs/images to 2x PNGs with headless Chromium (Playwright).

    python3 scripts/svg-to-png.py [folder]

Needs `pip install playwright` and a Chromium build; it is only used to produce the
README images, not by the app itself.
"""
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

folder = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "docs/images").resolve()
with sync_playwright() as p:
    browser = p.chromium.launch()
    for svg in sorted(folder.glob("*.svg")):
        text = svg.read_text()
        width, height = (int(float(v)) for v in re.search(r'width="([\d.]+)" height="([\d.]+)"', text).groups())
        page = browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=2)
        page.goto(svg.as_uri())
        page.screenshot(path=str(svg.with_suffix(".png")), omit_background=True)
        page.close()
        print(f"{svg.stem}.png  {width * 2}x{height * 2}")
    browser.close()
