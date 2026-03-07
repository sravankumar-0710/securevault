"""
Run this once from the backend folder to generate placeholder images
for the image points authentication feature.

Usage:
    cd backend
    python generate_images.py

Requires: pip install pillow
"""

import os
import random

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("Installing Pillow...")
    os.system("pip install pillow")
    from PIL import Image, ImageDraw, ImageFont

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "static", "images")
os.makedirs(OUTPUT_DIR, exist_ok=True)

IMAGES = {
    "city.jpg": {
        "bg":      (15, 20, 35),
        "label":   "CITY",
        "shapes": [
            # Buildings
            ("rect", (50,  150, 120, 300), (40, 50, 80)),
            ("rect", (130, 100, 200, 300), (50, 60, 90)),
            ("rect", (210, 170, 270, 300), (35, 45, 75)),
            ("rect", (280, 80,  350, 300), (45, 55, 85)),
            ("rect", (360, 130, 420, 300), (40, 50, 80)),
            # Windows
            ("rect", (60,  160, 80,  180), (255, 240, 150)),
            ("rect", (90,  200, 110, 220), (255, 240, 150)),
            ("rect", (140, 120, 160, 140), (255, 240, 150)),
            ("rect", (170, 160, 190, 180), (200, 200, 255)),
            ("rect", (290, 100, 310, 120), (255, 240, 150)),
            ("rect", (320, 150, 340, 170), (200, 200, 255)),
            # Moon
            ("ellipse", (500, 30, 560, 90), (255, 250, 200)),
            # Ground
            ("rect", (0, 290, 640, 320), (20, 25, 40)),
        ]
    },
    "nature.jpg": {
        "bg":    (20, 40, 20),
        "label": "NATURE",
        "shapes": [
            # Sky gradient (simulate with rect)
            ("rect", (0, 0, 640, 160), (30, 80, 120)),
            # Mountains
            ("poly", [(0,200),(150,60),(300,200)],   (40, 70, 50)),
            ("poly", [(200,200),(380,40),(560,200)],  (50, 80, 60)),
            ("poly", [(400,200),(560,80),(640,200)],  (45, 75, 55)),
            # Ground
            ("rect", (0, 190, 640, 320), (30, 90, 40)),
            # Trees
            ("poly", [(80,190),(100,120),(120,190)],  (20, 60, 20)),
            ("poly", [(500,190),(525,110),(550,190)], (20, 60, 20)),
            # Sun
            ("ellipse", (560, 30, 620, 90), (255, 220, 50)),
            # River
            ("rect", (250, 200, 390, 230), (40, 100, 150)),
        ]
    },
    "room.jpg": {
        "bg":    (35, 30, 25),
        "label": "ROOM",
        "shapes": [
            # Floor
            ("rect", (0, 220, 640, 320), (60, 45, 30)),
            # Wall
            ("rect", (0, 0, 640, 220), (50, 45, 40)),
            # Window
            ("rect", (240, 20, 400, 140), (100, 140, 180)),
            ("rect", (245, 25, 395, 135), (120, 160, 200)),
            # Window frame
            ("rect", (315, 20, 325, 140), (60, 55, 50)),
            ("rect", (240, 78, 400, 86),  (60, 55, 50)),
            # Table
            ("rect", (150, 200, 490, 215), (90, 70, 50)),
            ("rect", (170, 215, 190, 280), (80, 60, 40)),
            ("rect", (460, 215, 480, 280), (80, 60, 40)),
            # Lamp
            ("poly", [(480,50),(520,50),(510,130),(490,130)], (200,180,100)),
            ("rect", (498, 130, 502, 200), (150, 130, 80)),
            # Picture frame on wall
            ("rect", (60, 40, 180, 140),  (70, 65, 60)),
            ("rect", (65, 45, 175, 135),  (100, 80, 60)),
        ]
    },
    "map.jpg": {
        "bg":    (180, 160, 120),
        "label": "MAP",
        "shapes": [
            # Grid lines
            ("rect", (0, 80, 640, 84),   (160, 140, 100)),
            ("rect", (0, 160, 640, 164), (160, 140, 100)),
            ("rect", (0, 240, 640, 244), (160, 140, 100)),
            ("rect", (160, 0, 164, 320), (160, 140, 100)),
            ("rect", (320, 0, 324, 320), (160, 140, 100)),
            ("rect", (480, 0, 484, 320), (160, 140, 100)),
            # Water areas
            ("rect", (0, 0, 155, 75),    (100, 140, 180)),
            ("rect", (330, 170, 475, 315),(100, 140, 180)),
            # Forest
            ("rect", (170, 90, 315, 155), (60, 110, 60)),
            # Roads
            ("rect", (0, 118, 640, 124), (220, 200, 150)),
            ("rect", (198, 0, 204, 320), (220, 200, 150)),
            # Location pins
            ("ellipse", (310, 70,  330, 90),  (220, 50, 50)),
            ("ellipse", (100, 200, 120, 220), (50, 100, 220)),
            ("ellipse", (460, 60,  480, 80),  (50, 180, 80)),
        ]
    },
    "abstract.jpg": {
        "bg":    (10, 10, 20),
        "label": "ABSTRACT",
        "shapes": [
            ("ellipse", (50,  30,  250, 200), (80,  20,  120)),
            ("ellipse", (300, 80,  580, 280), (20,  80,  160)),
            ("ellipse", (150, 150, 400, 310), (160, 40,  40)),
            ("ellipse", (400, 10,  600, 160), (40,  160, 80)),
            ("ellipse", (0,   200, 200, 320), (160, 120, 20)),
            ("rect",    (280, 130, 360, 200), (200, 200, 40)),
            ("poly",    [(320,20),(420,80),(380,180),(260,180),(220,80)], (100,20,180)),
        ]
    }
}

def draw_shape(draw, shape):
    kind = shape[0]
    if kind == "rect":
        draw.rectangle([shape[1][:2], shape[1][2:]], fill=shape[2])
    elif kind == "ellipse":
        draw.ellipse([shape[1][:2], shape[1][2:]], fill=shape[2])
    elif kind == "poly":
        draw.polygon(shape[1], fill=shape[2])

for filename, spec in IMAGES.items():
    img  = Image.new("RGB", (640, 320), spec["bg"])
    draw = ImageDraw.Draw(img)

    for shape in spec["shapes"]:
        try:
            draw_shape(draw, shape)
        except Exception as e:
            print(f"  Shape error in {filename}: {e}")

    # Label
    try:
        font = ImageFont.truetype("arial.ttf", 18)
    except Exception:
        font = ImageFont.load_default()

    draw.text((10, 10), spec["label"], fill=(200, 200, 200), font=font)

    path = os.path.join(OUTPUT_DIR, filename)
    img.save(path, "JPEG", quality=85)
    print(f"Created: {path}")

print(f"\nDone — {len(IMAGES)} images saved to {OUTPUT_DIR}")
print("Restart your Flask server to serve them.")
