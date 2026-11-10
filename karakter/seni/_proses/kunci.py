import numpy as np
from PIL import Image
def key(path):
    a=np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    r,g,b=a[...,0],a[...,1],a[...,2]
    k=g-np.maximum(r,b)            # hijau dominan
    al=1-np.clip((k-30)/90,0,1)    # k<=30 opaque, k>=120 transparan
    # despill tepi
    gs=np.minimum(g,(r+b)/2+2)
    a2=a.copy(); a2[...,1]=gs
    from PIL import ImageFilter
    al=np.asarray(Image.fromarray((al*255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)),dtype=np.float32)/255.0
    out=np.dstack([a2,al*255]).clip(0,255).astype(np.uint8)
    return Image.fromarray(out,'RGBA')
def runs(mask,minlen=6,gap=6):
    idx=np.where(mask)[0]
    if len(idx)==0: return []
    res=[];s=idx[0];p=idx[0]
    for i in idx[1:]:
        if i-p>gap: 
            if p-s>=minlen: res.append((s,p+1))
            s=i
        p=i
    if p-s>=minlen: res.append((s,p+1))
    return res
if __name__=='__main__':
    import glob,os
    for f in sorted(glob.glob('_mentah/uki_*.png')):
        im=key(f); al=np.asarray(im)[...,3]>128
        rows=runs(al.any(1)); print(os.path.basename(f),im.size,'rows',rows)
        for (y0,y1) in rows:
            print('   cols',runs(al[y0:y1].any(0)))
