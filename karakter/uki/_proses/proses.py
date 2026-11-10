import sys,json,os; sys.path.insert(0,os.path.dirname(__file__))
import numpy as np
from PIL import Image, ImageFilter
from kunci import key, runs
OUT='.'; M='_mentah/'
FH=0.763          # skala kepala sheet -> kanvas
FB=1.794          # skala badan sheet -> kanvas
CHIN_SHEET=262    # y dagu pada kepala sheet (relatif bbox)
HEAD_BOTTOM=323   # bbox bawah kepala di kanvas kepala (400x400)
FEET=1375; NECK_CUT=250; CHIN_BODY=275
def bbox(al):
    ys=np.where(al.any(1))[0]; xs=np.where(al.any(0))[0]; return xs[0],ys[0],xs[-1]+1,ys[-1]+1
def paste(canvas,im,xy):
    canvas.alpha_composite(im,(int(round(xy[0])),int(round(xy[1])))) if xy[0]>=0 and xy[1]>=0 else canvas.paste(im,(int(round(xy[0])),int(round(xy[1]))),im)
# ---------- KEPALA ----------
H=key(M+'uki_lembar_kepala.png'); al=np.asarray(H)[...,3]>128
rows=[(28,353),(414,738)]
cols=[[(26,271),(295,540),(564,810),(832,1080),(1103,1349)],[(29,271),(299,539),(569,809),(838,1081),(1108,1349)]]
names=['netral','senang','kaget','sinis','sedih','marah','bingung','mengantuk','sombong','malu']
heads={}; k=0
for r,(y0,y1) in enumerate(rows):
    for (x0,x1) in cols[r]:
        cell=H.crop((x0-4,y0-4,x1+4,y1+4)); a=np.asarray(cell)[...,3]>128
        bx0,by0,bx1,by1=bbox(a); hd=cell.crop((bx0,by0,bx1,by1)); w,h=hd.size
        # potong leher: pangkas di dagu+12 dengan fade
        arr=np.asarray(hd).copy().astype(np.float32)
        # buang leher kepala: potong tepat di bawah garis rahang (piksel gelap terbawah per kolom)
        lum=arr[...,:3].mean(2); dark=(lum<75)&(arr[...,3]>200)
        yc=np.full(w,np.nan)
        for xc in range(w):
            ys=np.where(dark[CHIN_SHEET-45:CHIN_SHEET+18,xc])[0]
            if len(ys): yc[xc]=CHIN_SHEET-45+ys.max()+2
        known=np.where(~np.isnan(yc))[0]
        if len(known): yc=np.interp(np.arange(w),known,yc[known])
        else: yc[:]=CHIN_SHEET+2
        yy=np.arange(h)[:,None]; fade=np.clip((yc[None,:]+1.5-yy)/1.5,0,1); arr[...,3]*=fade
        hd=Image.fromarray(arr.astype(np.uint8),'RGBA')
        hd=hd.resize((max(1,round(w*FH)),max(1,round(h*FH))),Image.LANCZOS)
        can=Image.new('RGBA',(400,400),(0,0,0,0))
        x=round(200-hd.size[0]/2); y=round(HEAD_BOTTOM-round(h*FH))
        can.alpha_composite(hd,(x,y)); heads[names[k]]=(can,(w,h)); can.save(f'uki_kepala_{names[k]}.png'); k+=1
# warna kulit kepala netral (pipi kiri)
n=np.asarray(H.crop((26+60,28+190,26+82,28+206))).reshape(-1,4); n=n[n[:,3]>200][:,:3]; skin_h=np.median(n,0)
# ---------- MULUT ----------
Mo=key(M+'uki_lembar_mulut.png'); mcols=[(10,275),(283,548),(556,820),(829,1093),(1102,1366)]
K_M=0.18; mouths={}
for name,(x0,x1) in zip('aiueo',mcols):
    cell=Mo.crop((x0,237,x1,532)); c=np.asarray(cell).astype(np.float32)
    sk=c[120:160,20:60,:3].reshape(-1,3); skin_c=np.median(sk,0)
    diff=np.abs(c[...,:3]-skin_c).sum(2); inner=np.zeros(diff.shape,bool); inner[70:250,25:240]=True
    mask=(diff>70)&inner&(c[...,3]>128)
    ys,xs=np.where(mask); cx,cy=(xs.min()+xs.max())/2,(ys.min()+ys.max())/2
    # alpha: mask didilasi + elips minimum (menutup mulut asli)
    m=Image.fromarray((mask*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(21))
    yy,xx=np.mgrid[:diff.shape[0],:diff.shape[1]]
    ell=(((xx-cx)/78)**2+((yy-cy)/36)**2<=1)
    base=np.maximum(np.asarray(m)>0,ell).astype(np.uint8)*255
    al_=Image.fromarray(base).filter(ImageFilter.GaussianBlur(7))
    rgb=c[...,:3]*(skin_h/skin_c); rgb=rgb.clip(0,255).astype(np.uint8)
    # warna mulut asli dipertahankan di area mask, kulit disesuaikan
    rgb=np.where(mask[...,None],c[...,:3],rgb).clip(0,255).astype(np.uint8)
    p=Image.fromarray(np.dstack([rgb,np.asarray(al_)]),'RGBA')
    # crop sekitar pusat lalu skala
    box=(int(cx-90),int(cy-48),int(cx+90),int(cy+48)); p=p.crop(box)
    p=p.resize((round(p.size[0]*K_M),round(p.size[1]*K_M)),Image.LANCZOS)
    can=Image.new('RGBA',(120,80),(0,0,0,0)); can.alpha_composite(p,(60-p.size[0]//2,40-p.size[1]//2))
    can.save(f'uki_mulut_{name}.png'); mouths[name]=can
# ---------- KELOPAK ----------
L=key(M+'uki_lembar_kelopak.png'); lc=[(130,579),(797,1247)]
K_L=0.085; kel=Image.new('RGBA',(400,400),(0,0,0,0)); EYE_Y=199; EYES=[171,234]
for (x0,x1),ex in zip(lc,EYES):
    p=L.crop((x0-2,262-2,x1+2,506+2)); a=np.asarray(p).astype(np.float32)
    sk=a[10:60,150:300,:3].reshape(-1,3)  # sekitar kelopak (perkiraan kulit)
    sk=a[(a[...,3]>200)][:,:3]; skin_l=np.median(sk,0)
    a[...,:3]=np.where((np.abs(a[...,:3]-skin_l).sum(2)<60)[...,None],(a[...,:3]*(skin_h/skin_l)).clip(0,255),a[...,:3])
    p=Image.fromarray(a.astype(np.uint8),'RGBA'); p=p.resize((round(p.size[0]*K_L),round(p.size[1]*K_L)),Image.LANCZOS)
    kel.alpha_composite(p,(ex-p.size[0]//2,EYE_Y-p.size[1]//2))
kel.save('uki_kelopak.png')
# ---------- BADAN ----------
poses={'A':['diam','tunjuk','angkat'],'B':['lambai','pinggang','pelipis'],'C':['dagu','jempol','silang']}
bcols={'A':[(156,360),(502,799),(957,1297)],'B':[(90,358),(572,832),(990,1242)],'C':[(153,344),(541,799),(1061,1252)]}
info={}
for g in 'ABC':
    B=key(M+f'uki_badan_{g}.png'); arr=np.asarray(B); a=arr[...,3]>128
    for pose,(x0,x1) in zip(poses[g],bcols[g]):
        sub=arr[:,max(0,x0-6):x1+6]; sa=sub[...,3]>128
        bx0,by0,bx1,by1=bbox(sa); crop=Image.fromarray(sub[by0:by1,bx0:bx1],'RGBA')
        # pusat: tengah rentang sepatu (60 px dari bawah)
        row=sa[by1-45]; xs=np.where(row)[0]; cxs=(xs.min()+xs.max())/2-bx0
        # leher: piksel teratas pada kolom dekat pusat badan (torso)
        col=sa[:,int(bx0+cxs)-8:int(bx0+cxs)+8].any(1); neck=np.where(col)[0][0]-by0
        info[pose]=dict(h=int(by1-by0),neck=int(neck))
        s=FB; im=crop.resize((round(crop.size[0]*s),round(crop.size[1]*s)),Image.LANCZOS)
        can=Image.new('RGBA',(800,1400),(0,0,0,0))
        ox=round(400-cxs*s); assert ox>=0 and ox+im.size[0]<=800,(pose,ox,im.size)
        can.alpha_composite(im,(ox,FEET-im.size[1]))
        can.save(f'uki_badan_{pose}.png')
json.dump(info,open('_proses/info_badan.json','w'),indent=1)
# ---------- PRATINJAU ----------
def rakit(pose,ex,mo=None,lid=False):
    c=Image.open(f'uki_badan_{pose}.png').copy(); h=Image.open(f'uki_kepala_{ex}.png').copy()
    if mo: h.alpha_composite(Image.open(f'uki_mulut_{mo}.png'),(198-60,244-40))
    if lid: h.alpha_composite(Image.open('uki_kelopak.png'))
    c.alpha_composite(h,(200,0)); return c
if __name__=='__main__':
    ps=[('diam','netral',None,False),('tunjuk','senang','a',False),('angkat','kaget','o',False),('lambai','senang','i',False),('pinggang','sombong',None,False),('pelipis','bingung','e',False),('dagu','netral','u',False),('jempol','senang',None,True),('silang','sinis',None,False)]
    sh=Image.new('RGBA',(9*400,700),(190,200,230,255))
    for i,(p,e,m,l) in enumerate(ps):
        c=rakit(p,e,m,l).resize((400,700)); sh.alpha_composite(c,(i*400,0))
    sh.convert('RGB').save('_proses/pratinjau_rakit.jpg',quality=85)
    json.dump(info,sys.stdout) 
