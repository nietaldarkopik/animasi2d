# Hitung geser-x kepala per pose agar leher kepala jatuh di leher badan (badan 3/4, kepala frontal)
import json, numpy as np
from PIL import Image
STUB_C=402     # pusat leher kepala pada kanvas badan saat kepala ditempel di (200,0)
NECK_W=72      # lebar efektif (tepi kanan stub dijaga di dalam tepi leher badan, tidak menimpa kerah putih)
def run_right(row):
    idx=np.where(row)[0]; return int(idx.max()) if len(idx) else None
J=json.load(open('character.json',encoding='utf-8')); dx={}
for p in J['body']['poses']:
    b=np.asarray(Image.open(f'uki_badan_{p}.png')).astype(int)
    r=b[266,300:460]; skin=(r[:,3]>128)&(r[:,0]>r[:,1])&(r[:,1]>r[:,2])&(r[:,0]-r[:,2]>35)
    right=run_right(skin)+300
    dx[p]=int(round(right-NECK_W/2-STUB_C))
J['body']['head_dx']=dx
json.dump(J,open('character.json','w',encoding='utf-8'),indent=1,ensure_ascii=False)
print(dx)
