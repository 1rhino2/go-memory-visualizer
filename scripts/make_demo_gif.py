# one-off script to bake docs/demo.gif - not part of the extension runtime
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

W, H = 880, 420
BG = (24, 26, 28)
PANEL = (32, 35, 38)
BORDER = (55, 60, 65)
TEXT = (220, 222, 225)
MUTED = (140, 145, 150)
ACCENT = (0, 173, 216)  # Go cyan
PAD = (74, 74, 74)
GREEN = (76, 175, 80)
FIELD_COLORS = [
    (61, 139, 253),
    (32, 201, 151),
    (253, 126, 20),
    (204, 93, 232),
]

OUT = Path(__file__).resolve().parent.parent / 'docs' / 'demo.gif'


def font(size, bold=False):
    candidates = [
        'C:/Windows/Fonts/consola.ttf',
        'C:/Windows/Fonts/CascadiaMono.ttf',
        'C:/Windows/Fonts/lucon.ttf',
        'C:/Windows/Fonts/arial.ttf',
    ]
    if bold:
        candidates = [
            'C:/Windows/Fonts/consolab.ttf',
            'C:/Windows/Fonts/arialbd.ttf',
        ] + candidates
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


F_TITLE = font(22, bold=True)
F_BODY = font(16)
F_SMALL = font(13)
F_CODE = font(15)


def new_frame():
    img = Image.new('RGB', (W, H), BG)
    draw = ImageDraw.Draw(img)
    return img, draw


def draw_header(draw, title, subtitle):
    draw.rectangle([0, 0, W, 52], fill=PANEL)
    draw.line([0, 52, W, 52], fill=BORDER, width=1)
    draw.text((20, 14), title, fill=ACCENT, font=F_TITLE)
    draw.text((W - 20, 18), subtitle, fill=MUTED, font=F_SMALL, anchor='ra')


def draw_struct_code(draw, x, y, lines, highlight=None):
    draw.rounded_rectangle([x, y, x + 360, y + 210], radius=6, fill=PANEL, outline=BORDER)
    draw.text((x + 14, y + 10), 'type Sparse struct {', fill=TEXT, font=F_CODE)
    for i, (name, typ, note) in enumerate(lines):
        yy = y + 40 + i * 28
        if highlight == i:
            draw.rectangle([x + 8, yy - 4, x + 352, yy + 22], fill=(45, 55, 62))
        draw.text((x + 28, yy), f'{name:<8}{typ}', fill=TEXT, font=F_CODE)
        if note:
            draw.text((x + 200, yy), note, fill=MUTED, font=F_SMALL)
    draw.text((x + 14, y + 40 + len(lines) * 28 + 8), '}', fill=TEXT, font=F_CODE)


def draw_map(draw, x, y, cells, label, pack, size, pad):
    # cells: list of color indices, -1 = padding
    draw.text((x, y), label, fill=MUTED, font=F_SMALL)
    cell = 14
    cols = 16
    for i, c in enumerate(cells):
        r, col = divmod(i, cols)
        xx = x + col * (cell + 2)
        yy = y + 22 + r * (cell + 2)
        color = PAD if c < 0 else FIELD_COLORS[c % len(FIELD_COLORS)]
        draw.rectangle([xx, yy, xx + cell, yy + cell], fill=color)

    stats_y = y + 22 + ((len(cells) + cols - 1) // cols) * (cell + 2) + 10
    draw.text((x, stats_y), f'{size}B  pad {pad}B  pack {pack}%', fill=TEXT, font=F_BODY)


def draw_legend(draw, x, y, items):
    for i, name in enumerate(items):
        xx = x + i * 95
        draw.rectangle([xx, y, xx + 12, y + 12], fill=FIELD_COLORS[i])
        draw.text((xx + 18, y - 1), name, fill=MUTED, font=F_SMALL)
    draw.rectangle([x + len(items) * 95, y, x + len(items) * 95 + 12, y + 12], fill=PAD)
    draw.text((x + len(items) * 95 + 18, y - 1), 'pad', fill=MUTED, font=F_SMALL)


def frame_intro():
    img, draw = new_frame()
    draw_header(draw, 'Go Memory Layout Visualizer', 'v1.1')
    draw.text((W // 2, 160), 'See the padding Go hides in your structs', fill=TEXT, font=F_TITLE, anchor='mm')
    draw.text((W // 2, 210), 'byte map  ·  pack score  ·  one-click reorder', fill=MUTED, font=F_BODY, anchor='mm')
    draw.text((W // 2, 280), 'open a .go file → annotations appear instantly', fill=ACCENT, font=F_SMALL, anchor='mm')
    return img


def frame_bad_struct():
    img, draw = new_frame()
    draw_header(draw, 'Before: Sparse', 'pack 65%')
    lines = [
        ('Active', 'bool', '+7B pad'),
        ('ID', 'uint64', ''),
        ('Tag', 'uint8', '+7B pad'),
        ('Name', 'string', ''),
    ]
    draw_struct_code(draw, 30, 80, lines)
    # map: A....... BBBBBBBB C....... DDDDDDDD DDDDDDDD  = 40 bytes
    cells = [0] + [-1] * 7 + [1] * 8 + [2] + [-1] * 7 + [3] * 16
    draw_map(draw, 430, 90, cells, 'memory map', 65, 40, 14)
    draw_legend(draw, 430, 360, ['Active', 'ID', 'Tag', 'Name'])
    return img


def frame_codelens():
    img, draw = new_frame()
    draw_header(draw, 'CodeLens', 'save 8B · pack 65%')
    # fake codelens bar
    draw.rounded_rectangle([40, 90, 420, 122], radius=4, fill=(40, 70, 85), outline=ACCENT)
    draw.text((54, 98), 'Optimize Layout (save 8B · pack 65%)', fill=ACCENT, font=F_BODY)
    lines = [
        ('Active', 'bool', '+7B pad'),
        ('ID', 'uint64', ''),
        ('Tag', 'uint8', '+7B pad'),
        ('Name', 'string', ''),
    ]
    draw_struct_code(draw, 40, 140, lines)
    draw.text((480, 200), 'click to preview', fill=MUTED, font=F_BODY)
    draw.text((480, 240), 'then confirm reorder', fill=TEXT, font=F_TITLE)
    return img


def frame_after():
    img, draw = new_frame()
    draw_header(draw, 'After: reordered', 'pack 85%')
    lines = [
        ('ID', 'uint64', ''),
        ('Name', 'string', ''),
        ('Active', 'bool', ''),
        ('Tag', 'uint8', '+6B pad'),
    ]
    draw_struct_code(draw, 30, 80, lines)
    # optimized: ID(8) Name(16) Active(1) Tag(1) +6 final = 32
    # wait - ID uint64(8) + Name string(16) + Active bool(1) + Tag uint8(1) + 6 pad = 32
    # cells: BBBBBBBB DDDDDDDDDDDDDDDD A C ......
    cells = [1] * 8 + [3] * 16 + [0, 2] + [-1] * 6
    draw_map(draw, 430, 90, cells, 'memory map', 85, 32, 6)
    draw_legend(draw, 430, 340, ['Active', 'ID', 'Tag', 'Name'])
    draw.rounded_rectangle([430, 365, 700, 400], radius=4, fill=(30, 50, 35), outline=GREEN)
    draw.text((445, 374), 'saved 8 bytes  (40B → 32B)', fill=GREEN, font=F_BODY)
    return img


def frame_status():
    img, draw = new_frame()
    draw_header(draw, 'Always on', 'status bar · problems · hover')
    # status bar mock
    draw.rectangle([0, H - 36, W, H], fill=PANEL)
    draw.text((16, H - 26), '$(symbol-struct) Save 8B · 65% packed', fill=ACCENT, font=F_SMALL)
    draw.text((W // 2, 160), 'pack score on every struct', fill=TEXT, font=F_TITLE, anchor='mm')
    draw.text((W // 2, 210), 'time.Time · sync.Mutex · atomic.* sized correctly', fill=MUTED, font=F_BODY, anchor='mm')
    draw.text((W // 2, 260), 'amd64 / arm64 / 386', fill=ACCENT, font=F_BODY, anchor='mm')
    return img


def main():
    frames = [
        (frame_intro(), 1800),
        (frame_bad_struct(), 2800),
        (frame_codelens(), 2200),
        (frame_after(), 3000),
        (frame_status(), 2200),
    ]
    images = [f for f, _ in frames]
    durations = [d for _, d in frames]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    images[0].save(
        OUT,
        save_all=True,
        append_images=images[1:],
        duration=durations,
        loop=0,
        optimize=True,
    )
    print(f'wrote {OUT} ({OUT.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
