from PIL import Image
import colorsys

ORIG = r"C:\Users\Raymond\.cursor\projects\d-Cursor\assets\c__Users_Raymond_AppData_Roaming_Cursor_User_workspaceStorage_a341569a2ce64db111a85c378bc2bdc6_images_foundex_logo-5594e0f1-4457-4a97-a597-18e9edd3760c.png"
OUT_DARK = r"d:\Cursor\agent-quote-platform\public\images\foundex-logo.png"
OUT_LIGHT = r"d:\Cursor\agent-quote-platform\public\images\foundex-logo-light.png"

# 浅色底：原色深色字标（透明底）
base = Image.open(ORIG).convert("RGBA")
pixels = base.load()
w, h = base.size
for y in range(h):
    for x in range(w):
        r, g, b, a = pixels[x, y]
        if r > 235 and g > 235 and b > 235:
            pixels[x, y] = (r, g, b, 0)

bbox = base.getbbox()
if bbox:
    base = base.crop(bbox)

base.save(OUT_DARK, optimize=True)
print("dark-on-light logo:", base.size)

# 深色底：浅色字标（透明底）
light = base.copy()
lp = light.load()
lw, lh = light.size
ACCENT = (147, 197, 253)  # #93C5FD
MUTED = (203, 213, 225)   # #CBD5E1

for y in range(lh):
    for x in range(lw):
        r, g, b, a = lp[x, y]
        if a == 0:
            continue
        h_val, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        if v > 0.82 and s < 0.15:
            lp[x, y] = (255, 255, 255, a)
        elif s > 0.35 and 0.52 <= h_val <= 0.72:
            lp[x, y] = (*ACCENT, a)
        elif s < 0.2 and 0.45 <= v <= 0.82:
            lp[x, y] = (*MUTED, a)
        elif v < 0.55 or (s < 0.55 and v < 0.7):
            lp[x, y] = (255, 255, 255, a)

light.save(OUT_LIGHT, optimize=True)
print("light-on-dark logo:", light.size)
