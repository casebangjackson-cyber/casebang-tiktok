from PIL import Image, ImageDraw, ImageFilter
import os

root = r"C:\Users\Administrator\XiaomiMiMoProjects\2026-09-23\tiktok-gmvmax"
assets = os.path.join(root, "assets")
os.makedirs(assets, exist_ok=True)
src_path = r"C:\Users\Administrator\Desktop\597845091_122100549411156498_6985066128266369860_n.png"

src = Image.open(src_path).convert("RGB")
W, H = src.size  # 512x512

# Detect wordmark bounding box (non-near-white pixels)
px = src.load()
minx, miny, maxx, maxy = W, H, -1, -1
for y in range(H):
    for x in range(W):
        r, g, b = px[x, y]
        if r < 240 or g < 240 or b < 240:
            if x < minx:
                minx = x
            if x > maxx:
                maxx = x
            if y < miny:
                miny = y
            if y > maxy:
                maxy = y
print("bbox", minx, miny, maxx, maxy)

pad = 8
crop = src.crop((max(0, minx - pad), max(0, miny - pad), min(W, maxx + 1 + pad), min(H, maxy + 1 + pad)))
print("crop", crop.size)

# 1) Client header logo: tight wordmark on transparent-ish white, keep readable at 48px
# Use white background square with wordmark centered (header sits on light UI)
def fit_on_square(img, size, margin_ratio=0.14, bg=(255, 255, 255)):
    canvas = Image.new("RGBA", (size, size), (*bg, 255))
    max_w = int(size * (1 - 2 * margin_ratio))
    max_h = int(size * 0.42)  # wordmark is wide; keep it slim in the square
    iw, ih = img.size
    scale = min(max_w / iw, max_h / ih)
    nw, nh = int(iw * scale), int(ih * scale)
    r = img.resize((nw, nh), Image.LANCZOS)
    x = (size - nw) // 2
    y = (size - nh) // 2
    # paste with alpha if any
    if r.mode != "RGBA":
        r = r.convert("RGBA")
    canvas.alpha_composite(r, (x, y))
    return canvas

logo = fit_on_square(crop, 512, margin_ratio=0.12)
logo.save(os.path.join(assets, "logo-casebang.png"), "PNG")
logo.resize((256, 256), Image.LANCZOS).save(
    os.path.join(assets, "logo-casebang-256.png"), "PNG"
)

# 2) App / shortcut icon: soft light card with wordmark + red accent bar (matches logo DNA)
def make_icon(size):
    # rounded white card with subtle warm tint
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    radius = int(size * 0.22)
    # background: very light gray-white rounded square
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=(250, 250, 250, 255))
    # subtle border
    draw.rounded_rectangle(
        [1, 1, size - 2, size - 2], radius=radius - 1, outline=(230, 230, 230, 255), width=max(1, size // 256)
    )

    # wordmark centered upper-middle
    max_w = int(size * 0.78)
    max_h = int(size * 0.34)
    iw, ih = crop.size
    scale = min(max_w / iw, max_h / ih)
    nw, nh = max(1, int(iw * scale)), max(1, int(ih * scale))
    mark = crop.resize((nw, nh), Image.LANCZOS).convert("RGBA")
    mx = (size - nw) // 2
    my = (size - nh) // 2
    canvas.alpha_composite(mark, (mx, my))
    return canvas


icon = make_icon(1024)
icon_path = os.path.join(assets, "app-icon.png")
icon.save(icon_path, "PNG")
icon.resize((256, 256), Image.LANCZOS).save(
    os.path.join(assets, "app-icon-256.png"), "PNG"
)

sizes = [16, 24, 32, 48, 64, 128, 256]
base = icon.resize((256, 256), Image.LANCZOS)
ico_imgs = [base.copy()] + [icon.resize((s, s), Image.LANCZOS) for s in sizes if s != 256]
ico_path = os.path.join(assets, "app-icon.ico")
base.save(
    ico_path,
    format="ICO",
    sizes=[(s, s) for s in sizes],
    append_images=ico_imgs[1:],
)

print("logo", os.path.getsize(os.path.join(assets, "logo-casebang.png")))
print("icon", os.path.getsize(icon_path))
print("ico", os.path.getsize(ico_path))
