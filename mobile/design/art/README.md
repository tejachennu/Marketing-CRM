# App pictures (sign-in, sign-up, welcome pages)

Flat drawings in the app's WhatsApp colours (no gradients), made from code so they stay sharp and small.

- `gen.py` draws each picture as SVG (`welcome`, `desk`, `shop`, `nowa`, `team`, `signup`, `code`, `offline`).
- `render.cjs` turns them into PNG at 1x, 2x and 3x with the Chromium that Playwright uses (Roboto from the Flutter SDK).
- `google.svg` is Google's "G" for the "Continue with Google" button (Google's sign-in rules ask for it).

To change a picture:

```bash
cd mobile/design/art
python3 gen.py svg
node render.cjs svg png
for d in . 2.0x 3.0x; do mkdir -p ../../assets/images/$d; for f in png/$d/*.png; do pngquant --quality=88-100 --speed 1 --strip --force --output ../../assets/images/$d/$(basename $f) $f; done; done
rm -rf svg png
```

The Google G is rendered the same way from a 20 × 20 copy of `google.svg` (`google_g`).
Text inside the pictures is sample data only (no brand name, so a rename needs no new pictures).
