"""Draws the app's sign-up and welcome pictures as flat SVG (WhatsApp colours, no gradients).
Run: python3 gen.py <outDir>; then node render.cjs <outDir> <pngDir>."""
import math
import os
import sys

G = '#008069'   # action green (Brand.blue)
G2 = '#00A884'
B = '#25D366'   # bright green (Brand.green)
L = '#D9FDD3'   # bubble (Brand.bubble)
L2 = '#E7FCE3'  # soft green (Brand.blueSoft)
CH = '#EFEAE2'  # chat background
N = '#111B21'
T2 = '#3B4A54'
M = '#667781'
F = '#8696A0'
BR = '#D1D7DB'
LN = '#E9EDEF'
W = '#FFFFFF'

DEFS = '''<defs>
<filter id="sh" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#0B141A" flood-opacity="0.11"/></filter>
<filter id="sh2" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#0B141A" flood-opacity="0.10"/></filter>
</defs>'''


def svg(w, h, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">{DEFS}{body}</svg>'


def rect(x, y, w, h, rx=0, fill=W, extra=''):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" {extra}/>'


def circle(cx, cy, r, fill=W, extra=''):
    return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}" {extra}/>'


def text(x, y, s, size=8, weight=400, fill=N, anchor='start', extra=''):
    s = s.replace('&', '&amp;')
    return f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}" {extra}>{s}</text>'


def g(x, y, body, extra=''):
    return f'<g transform="translate({x},{y})" {extra}>{body}</g>'


def card(x, y, w, h, rx=12, fill=W, body='', shadow='sh'):
    return g(x, y, rect(0, 0, w, h, rx, fill, f'filter="url(#{shadow})"') + body)


def star(cx, cy, r, fill=G2):
    pts = []
    for k in range(10):
        a = math.radians(-90 + k * 36)
        rr = r if k % 2 == 0 else r * 0.45
        pts.append(f'{cx + rr * math.cos(a):.2f},{cy + rr * math.sin(a):.2f}')
    return f'<polygon points="{" ".join(pts)}" fill="{fill}"/>'


def check(x, y, s, stroke=W, width=1.8):
    return f'<path d="M{x} {y + s * 0.5} L{x + s * 0.38} {y + s * 0.86} L{x + s} {y + s * 0.12}" fill="none" stroke="{stroke}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"/>'


def ticks(x, y, color=G2):
    # WhatsApp's two ticks (read)
    return check(x, y, 6, color, 1.2) + check(x + 3.5, y, 6, color, 1.2)


def sparkle(cx, cy, r, fill=B):
    k = r * 0.28
    return f'<path d="M{cx} {cy - r} Q{cx + k} {cy - k} {cx + r} {cy} Q{cx + k} {cy + k} {cx} {cy + r} Q{cx - k} {cy + k} {cx - r} {cy} Q{cx - k} {cy - k} {cx} {cy - r} Z" fill="{fill}"/>'


def line(x, y, w, h=4, fill=LN):
    return rect(x, y, w, h, h / 2, fill)


def receipt_path(w, h, r=12, tooth=6):
    # Rounded top, zig-zag bottom (a printed bill)
    d = f'M{r} 0 H{w - r} Q{w} 0 {w} {r} V{h - tooth}'
    x = w
    up = True
    while x > 0:
        x2 = max(0, x - tooth)
        d += f' L{x2} {h if up else h - tooth}'
        up = not up
        x = x2
    d += f' V{r} Q0 0 {r} 0 Z'
    return d


def receipt(x, y, w, h, body):
    return g(x, y, f'<path d="{receipt_path(w, h)}" fill="{W}" filter="url(#sh)"/>' + body)


def top_rounded(x, y, w, h, r, fill):
    return f'<path d="M{x} {y + h} V{y + r} Q{x} {y} {x + r} {y} H{x + w - r} Q{x + w} {y} {x + w} {y + r} V{y + h} Z" fill="{fill}"/>'


def shop_glyph(x, y, s, body=W, awning=B, window=G):
    """The app's shop front (logo) as a small glyph, s = width."""
    u = s / 10
    out = rect(x + u * 1, y + u * 3.2, u * 8, u * 5.6, u * 0.4, body)
    for i in range(4):
        out += f'<path d="M{x + u * (0.6 + i * 2.2)} {y + u * 1.4} h{u * 2.2} v{u * 1.3} a{u * 1.1} {u * 1.1} 0 0 1 {-u * 2.2} 0 Z" fill="{awning if i % 2 == 0 else body}"/>'
    out += rect(x + u * 2, y + u * 4.6, u * 3.6, u * 2.6, u * 0.4, window)
    out += rect(x + u * 6.3, y + u * 4.6, u * 1.6, u * 4.2, u * 0.3, awning)
    return out


def bag(x, y, s, fill=G, handle=G):
    return (f'<path d="M{x + s * 0.3} {y + s * 0.4} V{y + s * 0.26} a{s * 0.2} {s * 0.2} 0 0 1 {s * 0.4} 0 V{y + s * 0.4}" fill="none" stroke="{handle}" stroke-width="{s * 0.1}" stroke-linecap="round"/>'
            + rect(x + s * 0.12, y + s * 0.32, s * 0.76, s * 0.62, s * 0.1, fill))


def bell(cx, cy, s, fill=W):
    return (f'<path d="M{cx - s * 0.42} {cy + s * 0.25} Q{cx - s * 0.3} {cy + s * 0.12} {cx - s * 0.3} {cy - s * 0.08} Q{cx - s * 0.3} {cy - s * 0.42} {cx} {cy - s * 0.45} '
            f'Q{cx + s * 0.3} {cy - s * 0.42} {cx + s * 0.3} {cy - s * 0.08} Q{cx + s * 0.3} {cy + s * 0.12} {cx + s * 0.42} {cy + s * 0.25} Z" fill="{fill}"/>'
            + circle(cx, cy + s * 0.37, s * 0.11, fill))


def calendar(x, y, s, top=G, body=W, dots=G):
    out = rect(x, y, s, s, s * 0.18, body)
    out += top_rounded(x, y, s, s * 0.3, s * 0.18, top)
    for r in range(2):
        for c in range(3):
            out += circle(x + s * (0.25 + c * 0.25), y + s * (0.52 + r * 0.24), s * 0.06, dots)
    return out


# ───────────────────────── Welcome (sign-in) ─────────────────────────
def welcome():
    w, h = 360, 250
    b = circle(180, 130, 112, L2)
    b += circle(46, 38, 9, L) + circle(326, 220, 13, L) + circle(320, 26, 5, L)
    b += sparkle(100, 24, 6) + sparkle(276, 138, 5, G2) + sparkle(38, 140, 4, G2)
    # Phone
    b += rect(120, 12, 120, 230, 22, N, 'filter="url(#sh)"')
    b += '<clipPath id="scr"><rect x="126" y="18" width="108" height="218" rx="17"/></clipPath>'
    scr = rect(126, 18, 108, 218, 0, CH)
    scr += rect(126, 18, 108, 38, 0, G)
    scr += circle(143, 39, 10, W) + shop_glyph(136.5, 32.5, 13, body=G, awning=B, window=W)
    scr += text(158, 37, 'Your business', 8, 700, W) + text(158, 47, 'online', 6.5, 400, '#CFEDE6')
    # The customer says hi; the business (its AI) answers with every service it offers, as a WhatsApp list
    scr += rect(132, 62, 30, 15, 7, W) + text(139, 72.5, 'Hi', 7.2, 400, N)
    scr += rect(144, 81, 84, 24, 8, L) + text(150, 91, 'Hi! How can we help?', 7.2, 700, N) + text(150, 100.5, 'Pick one, any time:', 6.2, 400, T2)
    scr += rect(132, 109, 96, 104, 9, W)
    services = [('cal', 'Book an appointment'), ('bag', 'Order products'), ('robot', 'Ask a question · AI'), ('receipt', 'Get my bill'), ('truck', 'Track my order'), ('person', 'Talk to our team')]
    for i, (icon, label) in enumerate(services):
        y = 113 + i * 16.6
        scr += circle(143, y + 7, 6.2, L2) + glyph(icon, 143, y + 7, 7.4, G)
        scr += text(153, y + 9.4, label, 6.6, 500, N)
        scr += f'<path d="M{221} {y + 5} l2.4 2 l-2.4 2" fill="none" stroke="{F}" stroke-width="0.9" stroke-linecap="round"/>'
        if i < len(services) - 1:
            scr += rect(150, y + 15.6, 74, 0.6, 0, LN)
    # typing bar
    scr += rect(130, 216, 86, 16, 8, W) + text(138, 227, 'Message', 6.5, 400, F)
    scr += circle(223, 224, 8, G) + rect(221, 219.5, 4, 6.5, 2, W) + f'<path d="M219.5 224 a3.5 3.5 0 0 0 7 0" fill="none" stroke="{W}" stroke-width="1"/>'
    b += f'<g clip-path="url(#scr)">{scr}</g>'
    # Bill paid
    bill = circle(18, 18, 10, L2)
    bill += f'<path d="M13.5 12 h9 v12 l-1.5 -1 l-1.5 1 l-1.5 -1 l-1.5 1 l-1.5 -1 l-1.5 1 Z" fill="{G}"/>' + line(15.5, 15.5, 5, 1.4, W) + line(15.5, 18.5, 5, 1.4, W)
    bill += text(34, 16, 'Bill paid', 7.8, 700) + text(34, 26, 'GST invoice sent', 6.2, 400, M)
    bill += text(10, 52, '₹1,250', 15, 700) + rect(10, 59, 30, 11, 5.5, L) + text(25, 66.8, 'PAID', 5.8, 700, G, 'middle')
    bill += circle(80, 63, 7, B) + check(76.8, 59.8, 6.4, W, 1.5)
    b += card(14, 46, 98, 78, 12, W, bill)
    # New order
    order = rect(10, 10, 26, 26, 7, L2) + bag(14, 13, 18)
    order += text(42, 20, 'New order', 7.8, 700) + text(42, 30, '#1024 · 2 items', 6.2, 400, M)
    order += text(10, 58, '₹899', 13, 700) + rect(54, 49, 32, 13, 6.5, G) + text(70, 58, 'UPI', 6.5, 700, W, 'middle')
    b += card(250, 30, 96, 72, 12, W, order)
    # Review
    rev = ''.join(star(14 + i * 11, 16, 4.6) for i in range(5)) + text(10, 35, '"Loved it!"', 7, 400, T2)
    b += card(254, 152, 88, 46, 12, W, rev)
    # Reminder
    rem = circle(17, 17, 11, G) + bell(17, 17, 12) + text(34, 15, 'Reminder sent', 7, 700) + text(34, 25, 'Tomorrow, 10 am', 6.2, 400, M)
    b += card(16, 156, 100, 34, 17, W, rem)
    return w, h, b


# ───────────────────────── Front Desk ─────────────────────────
def desk():
    w, h = 360, 232
    b = circle(180, 118, 108, L2) + circle(40, 40, 8, L) + circle(330, 210, 11, L)
    b += sparkle(214, 16, 6) + sparkle(22, 120, 4, G2)
    cal = top_rounded(0, 0, 168, 40, 16, G)
    cal += text(14, 18, 'Today', 9.5, 700, W) + text(14, 30, 'Saturday, 29 Nov', 6.8, 400, '#CFEDE6')
    cal += calendar(138, 10, 18, top=W, body='#1A8F79', dots=W)
    rows = [
        ('10:00', 'Haircut · Ravi', LN, N, False),
        ('11:30', 'Facial · Asha', L, N, False),
        ('1:00', 'Free', None, F, False),
        ('5:00', 'Hair spa · Kiran', G, W, True),
    ]
    y = 48
    for t, label, fill, color, done in rows:
        cal += text(14, y + 14, t, 7, 700, M)
        if fill:
            cal += rect(46, y + 2, 110, 21, 6, fill)
        else:
            cal += f'<rect x="46" y="{y + 2}" width="110" height="21" rx="6" fill="none" stroke="{BR}" stroke-dasharray="3 2"/>'
        cal += text(54, y + 15.5, label, 7, 500 if fill else 400, color)
        if done:
            cal += circle(146, y + 12.5, 5.5, B) + check(143.4, y + 10, 5.2, W, 1.3)
        y += 28
    b += card(30, 20, 168, 172, 16, W, cal)
    # reminder bubble
    rem = text(10, 15, 'Reminder', 7, 700, G) + text(10, 27, 'See you today at 5 pm!', 7, 400, N) + text(96, 39, '9:00', 5.2, 400, F, 'end') + ticks(99, 34)
    b += card(212, 22, 120, 44, 12, L, rem)
    # bill
    bill = text(12, 18, 'Bill #0142', 7.8, 700) + text(12, 28, 'GST invoice', 6.2, 400, M)
    yy = 42
    for label, amt in [('Hair spa', '₹1,000'), ('Head massage', '₹200'), ('GST 18%', '₹216')]:
        bill += text(12, yy, label, 6.4, 400, T2) + text(100, yy, amt, 6.4, 500, N, 'end')
        yy += 11
    bill += f'<line x1="12" y1="{yy - 4}" x2="100" y2="{yy - 4}" stroke="{BR}" stroke-dasharray="2 2"/>'
    bill += text(12, yy + 8, 'Total', 7.5, 700) + text(100, yy + 8, '₹1,416', 9, 700, N, 'end')
    bill += rect(12, yy + 15, 34, 11, 5.5, L) + text(29, yy + 22.8, 'PAID', 5.8, 700, G, 'middle')
    b += receipt(218, 80, 112, 128, bill)
    # rating chip
    rate = ''.join(star(15 + i * 10.5, 15, 4.3) for i in range(5)) + text(70, 18.5, '4.9', 8.5, 700)
    b += card(112, 180, 92, 30, 15, W, rate)
    return w, h, b


# ───────────────────────── E-commerce ─────────────────────────
def shop():
    w, h = 360, 232
    b = circle(180, 118, 108, L2) + circle(330, 30, 8, L) + circle(30, 210, 10, L)
    b += sparkle(212, 14, 6) + sparkle(20, 40, 4, G2)
    st = rect(10, 10, 124, 20, 10, LN) + f'<circle cx="21" cy="20" r="3.6" fill="none" stroke="{F}" stroke-width="1.3"/><path d="M23.6 22.6 l2.4 2.4" stroke="{F}" stroke-width="1.3" stroke-linecap="round"/>'
    st += text(30, 22.5, 'Search products', 6.6, 400, F)
    st += bag(142, 9, 20) + circle(160, 11, 6, B) + text(160, 13.4, '3', 6.5, 700, W, 'middle')
    st += '<clipPath id="ban"><rect x="10" y="38" width="156" height="36" rx="9"/></clipPath>'
    st += rect(10, 38, 156, 36, 9, G) + f'<g clip-path="url(#ban)">{circle(156, 62, 24, G2)}{circle(132, 36, 10, "#1A8F79")}</g>'
    st += text(20, 53, 'Festival sale', 8.8, 700, W) + text(20, 65, 'Up to 30% off', 6.8, 400, '#CFEDE6')
    tiles = [
        (10, 82, L2, 'shirt', '₹499'),
        (91, 82, CH, 'bottle', '₹249'),
        (10, 140, CH, 'pot', '₹349'),
        (91, 140, L2, 'bag', '₹899'),
    ]
    for tx, ty, fill, kind, price in tiles:
        st += rect(tx, ty, 75, 34, 8, fill)
        cx, cy = tx + 37.5, ty + 17
        if kind == 'shirt':
            st += f'<path d="M{cx - 11} {cy - 8} l6 -4 h10 l6 4 l-3.5 6 l-3 -1.6 v12.6 h-9 v-12.6 l-3 1.6 Z" fill="{G}"/>'
        elif kind == 'bottle':
            st += rect(cx - 5, cy - 6, 10, 18, 3, G) + rect(cx - 3, cy - 11, 6, 6, 1.5, G2) + rect(cx - 5, cy, 10, 5, 0, W, 'opacity="0.6"')
        elif kind == 'pot':
            st += f'<path d="M{cx - 8} {cy + 1} h16 l-2.2 11 h-11.6 Z" fill="{G}"/>' + circle(cx - 4, cy - 5, 5, B) + circle(cx + 4, cy - 6, 5.5, G2) + circle(cx, cy - 10, 4.5, B)
        else:
            st += bag(cx - 10, cy - 12, 20, G, G)
        st += line(tx + 2, ty + 40, 46, 3.6) + text(tx + 2, ty + 54, price, 7.6, 700)
        st += circle(tx + 68, ty + 49, 6.5, G) + f'<path d="M{tx + 65} {ty + 49} h6 M{tx + 68} {ty + 46} v6" stroke="{W}" stroke-width="1.4" stroke-linecap="round"/>'
    b += card(28, 16, 176, 200, 16, W, st)
    od = circle(18, 18, 11, L2) + bag(10, 9, 16)
    od += text(36, 16, 'Order placed', 7.6, 700) + text(36, 26, '3 items · ₹1,297', 6.2, 400, M)
    b += card(214, 22, 122, 36, 18, W, od)
    pay = text(12, 21, 'Paid by UPI', 7.8, 700, W) + text(12, 41, '₹1,297', 13, 700, W)
    pay += circle(94, 29, 11, B) + check(89.5, 24.5, 9, W, 1.8)
    b += card(222, 72, 114, 56, 12, G, pay)
    dl = rect(10, 11, 22, 14, 3, G) + f'<path d="M32 15 h6 l4 5 v5 h-10 Z" fill="{G2}"/>' + circle(16, 27, 3.2, N) + circle(36, 27, 3.2, N)
    dl += text(48, 17, 'On the way', 7.6, 700) + text(48, 27, 'Reaches tomorrow', 6.2, 400, M)
    dl += line(10, 38, 98, 5) + line(10, 38, 68, 5, G) + circle(78, 40.5, 4, G)
    b += card(216, 142, 120, 52, 12, W, dl)
    return w, h, b


# ───────────────────────── Without WhatsApp (₹300) ─────────────────────────
def nowa():
    w, h = 360, 232
    b = circle(180, 118, 108, L2) + circle(28, 200, 9, L) + circle(334, 24, 7, L)
    b += sparkle(208, 18, 6) + sparkle(330, 120, 4, G2)
    msg = rect(10, 10, 22, 22, 6, G) + shop_glyph(13, 13.5, 16, body=W, awning=B, window=G)
    msg += text(38, 19, 'Booking confirmed', 7.6, 700) + text(38, 29, 'sent for you', 6.2, 400, M)
    msg += rect(10, 38, 156, 30, 8, L) + text(16, 50, 'Hi Ravi, see you on Sat at 11 am.', 6.6, 400, N) + text(16, 61, 'Show this message at the counter.', 6.6, 400, T2)
    msg += ticks(152, 58)
    b += card(24, 18, 176, 78, 14, W, msg)
    inv = text(12, 18, 'Invoice', 8, 700) + text(12, 28, 'INV/26-27/0042', 6, 400, M)
    yy = 40
    for wdt in (60, 48, 66):
        inv += line(12, yy, wdt, 3.6) + line(86, yy, 22, 3.6)
        yy += 10
    inv += text(12, yy + 8, 'Total', 7.4, 700) + text(108, yy + 8, '₹2,360', 8.6, 700, N, 'end')
    inv += rect(12, yy + 15, 96, 16, 8, L2) + text(60, yy + 26, 'Open bill link', 6.6, 700, G, 'middle')
    b += receipt(48, 106, 120, 116, inv)
    rep = text(12, 18, 'Sales this week', 7.4, 700) + text(12, 34, '₹48,200', 12, 700)
    rep += rect(78, 24, 34, 13, 6.5, L) + text(95, 33, '+18%', 6.6, 700, G, 'middle')
    bars = [22, 30, 18, 36, 28, 44, 52]
    for i, bh in enumerate(bars):
        rep += rect(14 + i * 14, 104 - bh, 9, bh, 3, G if i >= 5 else L)
    rep += f'<line x1="10" y1="105" x2="114" y2="105" stroke="{LN}" stroke-width="1.5"/>'
    b += card(212, 40, 124, 112, 14, W, rep)
    b += circle(286, 190, 33, W, 'filter="url(#sh)"') + circle(286, 190, 28, G)
    b += text(286, 192, '₹300', 13, 700, W, 'middle') + text(286, 202, 'a month', 6.2, 500, '#CFEDE6', 'middle')
    return w, h, b


# ───────────────────────── Our team: ads and social media ─────────────────────────
def team():
    w, h = 120, 88
    b = circle(60, 46, 40, L2) + sparkle(104, 14, 5) + sparkle(14, 70, 3.5, G2)
    # post card
    post = rect(6, 6, 34, 26, 5, L) + circle(16, 16, 4, B) + f'<path d="M8 30 l9 -9 l6 6 l5 -5 l10 8 Z" fill="{G2}"/>'
    post += f'<path d="M12 41 c-2 -2 -4 -3 -4 -5 a2 2 0 0 1 4 -0.6 a2 2 0 0 1 4 0.6 c0 2 -2 3 -4 5 Z" fill="{G}"/>' + line(20, 36, 18, 3)
    b += card(8, 14, 46, 48, 8, W, post, 'sh2')
    # reel / video
    b += card(62, 8, 40, 52, 8, G, circle(20, 26, 9, W) + f'<path d="M17.5 21.5 v9 l7.5 -4.5 Z" fill="{G}"/>', 'sh2')
    # results chip
    chip = f'<path d="M8 16 l6 -5 l5 3 l8 -7" fill="none" stroke="{G}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' + text(32, 15, 'Ads', 7.5, 700)
    b += card(52, 58, 56, 22, 11, W, chip, 'sh2')
    return w, h, b


# ───────────────────────── Sign-up ─────────────────────────
def signup():
    w, h = 360, 176
    b = f'<ellipse cx="180" cy="98" rx="150" ry="76" fill="{L2}"/>' + circle(52, 30, 7, L) + circle(318, 150, 9, L)
    b += sparkle(106, 26, 6) + sparkle(262, 30, 5, G2) + sparkle(300, 92, 3.5)
    # shop front
    sx, sy, sw = 126, 34, 108
    shop_b = rect(sx + 6, sy + 40, sw - 12, 92, 6, W, 'filter="url(#sh)"')
    n = 5
    sw_i = sw / n
    for i in range(n):
        x = sx + i * sw_i
        fill = G if i % 2 == 0 else L
        shop_b += f'<path d="M{x} {sy + 10} h{sw_i} v22 a{sw_i / 2} {sw_i / 2} 0 0 1 {-sw_i} 0 Z" fill="{fill}"/>'
    shop_b += rect(sx - 2, sy + 4, sw + 4, 8, 4, N)
    shop_b += rect(sx + 16, sy + 62, 46, 38, 5, G) + f'<path d="M{sx + 31} {sy + 70} h16 v20 l-2.6 -1.8 l-2.6 1.8 l-2.6 -1.8 l-2.6 1.8 l-2.6 -1.8 l-2.6 1.8 Z" fill="{W}"/>'
    shop_b += line(sx + 34, sy + 75, 10, 2, G) + line(sx + 34, sy + 80, 10, 2, G)
    shop_b += rect(sx + 70, sy + 62, 22, 70, 3, L) + circle(sx + 87, sy + 98, 1.8, G)
    shop_b += rect(sx + 24, sy + 44, 30, 12, 6, B) + text(sx + 39, sy + 52.5, 'OPEN', 6.4, 700, W, 'middle')
    b += shop_b
    # chat bubble with ticks
    chat = text(10, 15, 'New booking', 7.2, 700) + text(10, 25, 'Today, 4:30 pm', 6.2, 400, M) + ticks(74, 20)
    b += card(28, 58, 92, 34, 10, W, chat)
    # free trial badge
    badge = calendar(10, 8, 18, top=G, body=L2, dots=G) + text(34, 16, 'Free trial', 7.4, 700) + text(34, 26, 'No card needed', 6.2, 400, M)
    b += card(244, 104, 98, 34, 10, W, badge)
    # bill coin
    b += circle(268, 64, 15, G, 'filter="url(#sh2)"') + text(268, 68.5, '₹', 13, 700, W, 'middle')
    b += circle(92, 128, 12, B, 'filter="url(#sh2)"') + check(86.5, 122.5, 11, W, 2)
    return w, h, b


# ───────────────────────── Email code ─────────────────────────
def code():
    w, h = 360, 150
    b = f'<ellipse cx="180" cy="80" rx="140" ry="64" fill="{L2}"/>' + sparkle(92, 30, 6) + sparkle(276, 40, 5, G2) + sparkle(258, 126, 3.5)
    ex, ey, ew, eh = 110, 46, 140, 88
    b += rect(ex, ey, ew, eh, 12, G, 'filter="url(#sh)"')
    # letter coming out
    b += rect(ex + 14, ey - 30, ew - 28, 74, 8, W, 'filter="url(#sh2)"')
    b += text(180, ey - 14, 'Your code', 7.4, 700, M, 'middle')
    for i in range(6):
        bx = ex + 22 + i * 16.5
        b += rect(bx, ey - 6, 13, 17, 4, L2) + circle(bx + 6.5, ey + 2.5, 2.4, G)
    # envelope front
    b += f'<path d="M{ex} {ey + 20} L{ex + ew / 2} {ey + 58} L{ex + ew} {ey + 20} V{ey + eh - 12} Q{ex + ew} {ey + eh} {ex + ew - 12} {ey + eh} H{ex + 12} Q{ex} {ey + eh} {ex} {ey + eh - 12} Z" fill="{G2}"/>'
    b += f'<path d="M{ex} {ey + eh - 8} L{ex + ew / 2 - 18} {ey + 50} M{ex + ew} {ey + eh - 8} L{ex + ew / 2 + 18} {ey + 50}" stroke="{G}" stroke-width="2" fill="none"/>'
    b += circle(ex + ew - 4, ey + 6, 14, B, 'filter="url(#sh2)"') + check(ex + ew - 10.5, ey - 0.5, 13, W, 2.2)
    return w, h, b


# ───────────────────────── No internet ─────────────────────────
def offline():
    w, h = 240, 150
    b = f'<ellipse cx="120" cy="80" rx="100" ry="62" fill="{L2}"/>' + sparkle(52, 30, 5) + sparkle(196, 120, 4, G2)
    b += rect(78, 14, 84, 128, 16, N, 'filter="url(#sh)"') + rect(83, 19, 74, 118, 12, W)
    for i, r in enumerate([30, 20, 10]):
        b += f'<path d="M{120 - r} {84 - r * 0.15} a{r} {r} 0 0 1 {2 * r} 0" fill="none" stroke="{BR if i < 2 else F}" stroke-width="5" stroke-linecap="round" transform="translate(0,{-r * 0.6})"/>'
    b += circle(120, 84, 4.5, F)
    b += circle(150, 110, 13, W, 'filter="url(#sh2)"') + f'<path d="M145 105 l10 10 M155 105 l-10 10" stroke="#B91C1C" stroke-width="2.4" stroke-linecap="round"/>'
    return w, h, b



# ───────────────────────── One picture per kind of business (welcome screen) ─────────────────────────
def glyph(kind, cx, cy, s, c=W):
    """A small flat icon centred at (cx, cy), about s wide."""
    u = s / 10
    if kind == 'cross':
        return rect(cx - u * 1.3, cy - u * 4, u * 2.6, u * 8, u * 0.6, c) + rect(cx - u * 4, cy - u * 1.3, u * 8, u * 2.6, u * 0.6, c)
    if kind == 'dumbbell':
        return rect(cx - u * 4.6, cy - u * 2.6, u * 1.6, u * 5.2, u * 0.5, c) + rect(cx + u * 3, cy - u * 2.6, u * 1.6, u * 5.2, u * 0.5, c) + rect(cx - u * 3.4, cy - u * 0.7, u * 6.8, u * 1.4, u * 0.5, c)
    if kind == 'bowl':
        return f'<path d="M{cx - u * 4.5} {cy - u * 0.5} h{u * 9} a{u * 4.5} {u * 4} 0 0 1 {-u * 9} 0 Z" fill="{c}"/>' + rect(cx - u * 3, cy + u * 3.6, u * 6, u * 1.1, u * 0.5, c) + f'<path d="M{cx - u * 1.5} {cy - u * 1.6} q{u * 0.8} {-u * 1.4} 0 {-u * 2.8} M{cx + u * 1} {cy - u * 1.6} q{u * 0.8} {-u * 1.4} 0 {-u * 2.8}" stroke="{c}" stroke-width="{u * 0.8}" fill="none" stroke-linecap="round"/>'
    if kind == 'shirt':
        return f'<path d="M{cx - u * 4.5} {cy - u * 3} l{u * 2.5} -{u * 1.6} h{u * 4} l{u * 2.5} {u * 1.6} l-{u * 1.4} {u * 2.4} l-{u * 1.2} -{u * 0.6} v{u * 5.4} h-{u * 4.8} v-{u * 5.4} l-{u * 1.2} {u * 0.6} Z" fill="{c}"/>'
    if kind == 'basket':
        return f'<path d="M{cx - u * 4.8} {cy - u * 1} h{u * 9.6} l-{u * 1.2} {u * 5.2} h-{u * 7.2} Z" fill="{c}"/>' + f'<path d="M{cx - u * 3} {cy - u * 1} l{u * 1.8} -{u * 3.4} M{cx + u * 3} {cy - u * 1} l-{u * 1.8} -{u * 3.4}" stroke="{c}" stroke-width="{u * 0.9}" stroke-linecap="round"/>'
    if kind == 'cap':
        return f'<path d="M{cx} {cy - u * 4} l{u * 5} {u * 2.4} l-{u * 5} {u * 2.4} l-{u * 5} -{u * 2.4} Z" fill="{c}"/>' + f'<path d="M{cx - u * 3} {cy - u * 0.2} v{u * 2.6} q{u * 3} {u * 1.8} {u * 6} 0 v-{u * 2.6}" fill="{c}"/>'
    if kind == 'wrench':
        return f'<path d="M{cx + u * 2.6} {cy - u * 4.2} a{u * 2.4} {u * 2.4} 0 1 0 {u * 1.6} {u * 3.4} l-{u * 5.6} {u * 5.6} a{u * 1} {u * 1} 0 0 1 -{u * 1.6} -{u * 1.6} l{u * 5.6} -{u * 5.6} Z" fill="{c}"/>'
    if kind == 'house':
        return f'<path d="M{cx} {cy - u * 4.6} l{u * 5} {u * 4} h-{u * 1.2} v{u * 4.6} h-{u * 7.6} v-{u * 4.6} h-{u * 1.2} Z" fill="{c}"/>'
    if kind == 'robot':
        return rect(cx - u * 4, cy - u * 2.6, u * 8, u * 6.4, u * 1.6, c) + circle(cx - u * 1.7, cy + u * 0.4, u * 0.9, G) + circle(cx + u * 1.7, cy + u * 0.4, u * 0.9, G) + rect(cx - u * 0.4, cy - u * 4.6, u * 0.8, u * 2, 0, c) + circle(cx, cy - u * 4.8, u * 0.8, c)
    if kind == 'shop':
        return shop_glyph(cx - s * 0.5, cy - s * 0.55, s, body=G, awning=B, window=W)
    if kind == 'receipt':
        return f'<path d="M{cx - u * 3} {cy - u * 4} h{u * 6} v{u * 8} l-{u} -{u * 0.7} l-{u} {u * 0.7} l-{u} -{u * 0.7} l-{u} {u * 0.7} l-{u} -{u * 0.7} l-{u} {u * 0.7} Z" fill="{c}"/>' + line(cx - u * 1.6, cy - u * 1.8, u * 3.2, u * 0.9, W if c != W else G) + line(cx - u * 1.6, cy + u * 0.2, u * 3.2, u * 0.9, W if c != W else G)
    if kind == 'bag':
        return bag(cx - s / 2, cy - s / 2, s, c, c)
    if kind == 'truck':
        return rect(cx - u * 5, cy - u * 3, u * 6, u * 4.6, u * 0.6, c) + f'<path d="M{cx + u * 1.4} {cy - u * 1.4} h{u * 2} l{u * 1.6} {u * 2} v{u * 1} h-{u * 3.6} Z" fill="{c}"/>' + circle(cx - u * 2.6, cy + u * 2.4, u * 1.1, c) + circle(cx + u * 2.6, cy + u * 2.4, u * 1.1, c)
    if kind == 'bell':
        return bell(cx, cy, s, c)
    if kind == 'chat':
        return f'<path d="M{cx - u * 4.5} {cy - u * 3.5} h{u * 9} v{u * 6} h-{u * 5} l-{u * 2.5} {u * 2} v-{u * 2} h-{u * 1.5} Z" fill="{c}"/>'
    if kind == 'book':
        return f'<path d="M{cx - u * 4.6} {cy - u * 3.6} q{u * 2.4} -{u * 0.8} {u * 4.4} {u * 0.4} v{u * 7.2} q-{u * 2} -{u * 1.2} -{u * 4.4} -{u * 0.4} Z M{cx + u * 4.6} {cy - u * 3.6} q-{u * 2.4} -{u * 0.8} -{u * 4.4} {u * 0.4} v{u * 7.2} q{u * 2} -{u * 1.2} {u * 4.4} -{u * 0.4} Z" fill="{c}"/>'
    if kind == 'pill':
        return f'<g transform="rotate(-35 {cx} {cy})">' + rect(cx - u * 4.4, cy - u * 1.8, u * 8.8, u * 3.6, u * 1.8, c) + rect(cx, cy - u * 1.8, u * 4.4, u * 3.6, u * 1.8, B) + rect(cx, cy - u * 1.8, u * 1.2, u * 3.6, 0, B) + '</g>'
    if kind == 'check':
        return check(cx - u * 3.4, cy - u * 3.4, u * 6.8, c, u * 1.4)
    if kind == 'chart':
        return rect(cx - u * 4, cy, u * 2, u * 3.6, u * 0.4, c) + rect(cx - u * 1, cy - u * 2, u * 2, u * 5.6, u * 0.4, c) + rect(cx + u * 2, cy - u * 4, u * 2, u * 7.6, u * 0.4, c)
    if kind == 'person':
        return circle(cx, cy - u * 2, u * 2.2, c) + f'<path d="M{cx - u * 4} {cy + u * 4} a{u * 4} {u * 3.6} 0 0 1 {u * 8} 0 Z" fill="{c}"/>'
    if kind == 'translate':
        return text(cx - u * 2.4, cy + u * 0.6, 'A', s * 0.55, 700, c, 'middle') + text(cx + u * 2.2, cy + u * 3.4, 'अ', s * 0.5, 700, c, 'middle')
    return calendar(cx - s / 2, cy - s / 2, s, top=G, body=L2, dots=G)



ART = {'welcome': welcome, 'desk': desk, 'shop': shop, 'nowa': nowa, 'team': team, 'signup': signup, 'code': code, 'offline': offline}

if __name__ == '__main__':
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for name, fn in ART.items():
        w, h, body = fn()
        with open(os.path.join(out, name + '.svg'), 'w') as f:
            f.write(svg(w, h, body))
        print('wrote', name)
