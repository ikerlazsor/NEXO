import sys, glob, os
from PIL import Image, ImageDraw
files = sys.argv[2:]
ims = [Image.open(f).convert("RGB") for f in files]
w, h = 360, 640
cols = min(6, len(ims)); rows = (len(ims)+cols-1)//cols
sheet = Image.new("RGB", (cols*w, rows*(h+24)), "white"); d = ImageDraw.Draw(sheet)
for i,(f,im) in enumerate(zip(files, ims)):
    im = im.resize((w,h)); x=(i%cols)*w; y=(i//cols)*(h+24)
    sheet.paste(im,(x,y)); d.text((x+4,y+h+4), os.path.basename(f), fill="black")
sheet.save(sys.argv[1], quality=85)
