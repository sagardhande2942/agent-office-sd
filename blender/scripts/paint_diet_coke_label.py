"""Paint a small label from text and vector shapes; no reference photo is embedded."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import random
OUT=Path(__file__).resolve().parents[1]/'textures'/'diet-coke-label.png'
W,H=1024,256
im=Image.new('RGB',(W,H),'#f5f5f1'); d=ImageDraw.Draw(im)
rng=random.Random(23)
for i in range(2400):
 x,y=rng.randrange(W),rng.randrange(H); c=rng.randrange(224,246); d.point((x,y),fill=(c,c,c))
def font(size,italic=False):
 paths=([r'C:/Windows/Fonts/timesbi.ttf','/usr/share/fonts/truetype/liberation2/LiberationSerif-BoldItalic.ttf'] if italic else [r'C:/Windows/Fonts/arial.ttf','/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf'])
 for p in paths:
  if Path(p).exists(): return ImageFont.truetype(p,size)
 return ImageFont.load_default(size=size)
# Print both sides so the held bottle and shelf bottle have the same readable sleeve.
for cx in [256,768]:
 d.text((cx+80,8),'Diet',font=font(34,True),anchor='mt',fill='#c41628')
 d.text((cx,24),'Coke',font=font(158,True),anchor='mt',fill='#c41628',stroke_width=1)
 d.text((cx,180),'NO SUGAR',font=font(17),anchor='mt',fill='#b61a2b')
 d.text((cx,201),'NO CALORIES',font=font(17),anchor='mt',fill='#b61a2b')
 d.text((cx,222),'CRISP TASTE',font=font(17),anchor='mt',fill='#b61a2b')
im.resize((512,128),Image.Resampling.LANCZOS).save(OUT,optimize=True)
print(OUT)
