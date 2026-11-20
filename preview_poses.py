from pathlib import Path
from PIL import Image, ImageDraw

folder = Path("karakter/uki/poses/sitting/references")
files = sorted(folder.glob("*.png"))

cell_w, cell_h = 300, 350
cols = 4
rows = (len(files) + cols - 1) // cols

sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), "#dddddd")
draw = ImageDraw.Draw(sheet)

for i, path in enumerate(files):
    img = Image.open(path).convert("RGBA")
    img.thumbnail((cell_w - 30, cell_h - 55))

    x = (i % cols) * cell_w
    y = (i // cols) * cell_h

    px = x + (cell_w - img.width) // 2
    py = y + 5

    sheet.paste(img, (px, py), img)
    draw.text((x + 10, y + cell_h - 35), path.stem, fill="black")

sheet.save("pose_contact_sheet.jpg", quality=95)
print("Created: pose_contact_sheet.jpg")