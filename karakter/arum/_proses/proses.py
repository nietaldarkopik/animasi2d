# Proses aset ARUM (rambut panjang + kerah pelaut). Jalankan dari folder karakter\arum
import sys,json,os; sys.path.insert(0,os.path.dirname(__file__))
import numpy as np
from PIL import Image, ImageFilter
from kunci import key, runs
M='_mentah/'
FH=0.90; FB=1.862; HAIR_TOP=75; FEET=1375; CHIN_SHEET=232; CHIN_CANVAS=284
FACE_CX=112                 # pusat wajah pada kepala sheet (relatif bbox)
MOUTH_N=(111,203); EYES_N=((71,155),(148,155))
K_M=0.23; K_L=0.093
def bbox(al):
    ys=np.where(al.any(1))[0]; xs=np.where(al.any(0))[0]; return xs[0],ys[0],xs[-1]+1,ys[-1]+1
def to_canvas(xs,ys): return (200+(xs-FACE_CX)*FH, HAIR_TOP+ys*FH)
# ---------- KEPALA ----------
H=key(M+'uki_x') if False else key(M+'arum_lembar_kepala.png')
rows=[(23,361),(407,736)]
cols=[[(27,251),(302,527),(577,801),(853,1076),(1127,1351)],[(26,253),(303,530),(576,803),(850,1076),(1126,1352)]]
names=['netral','senang','kaget','sinis','sedih','marah','bingung','mengantuk','sombong','malu']
k=0
for r,(y0,y1) in enumerate(rows):
    for (x0,x1) in cols[r]:
        cell=H.crop((x0-4,y0-4,x1+4,y1+4)); a=np.asarray(cell)[...,3]>128
        bx0,by0,bx1,by1=bbox(a); hd=cell.crop((bx0,by0,bx1,by1)); w,h=hd.size
        arr=np.asarray(hd).copy().astype(np.float32); rgb=arr[...,:3]; lum=rgb.mean(2)
        hair=(lum<125)&(rgb[...,2]>=rgb[...,0]+4)                     # ungu gelap
        dark=(lum<100)&(arr[...,3]>200)
        cx=w/2.0; yc=np.full(w,np.nan)
        for xc in range(int(cx-45),int(cx+46)):
            ys=np.where(dark[200:250,xc]&~hair[200:250,xc])[0]          # garis rahang (cokelat), bukan rambut
            if len(ys): yc[xc]=200+ys.max()+2
        kn=np.where(~np.isnan(yc))[0]
        if len(kn)>5: yc[:]=np.interp(np.arange(w),kn,yc[kn])           # luar rentang = nilai tepi
        else: yc[:]=CHIN_SHEET+2
        yc=np.minimum(yc,CHIN_SHEET+8)
        yy=np.arange(h)[:,None]
        below=yy>yc[None,:]+0.5
        keep=(~below)|hair
        al=arr[...,3]*keep
        al=np.asarray(Image.fromarray(al.astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6)),dtype=np.float32)
        arr[...,3]=np.where(keep,np.maximum(al,arr[...,3]*0),0)+np.where(keep,0,0)
        arr[...,3]=np.where(keep,arr[...,3] if False else 255*0+ (hd.getchannel('A') if False else 0),0)  # placeholder diganti di bawah
        # alpha asli di area keep
        a0=np.asarray(hd)[...,3].astype(np.float32); arr[...,3]=np.where(keep,a0,0)
        hd=Image.fromarray(arr.astype(np.uint8),'RGBA')
        hd=hd.resize((max(1,round(w*FH)),max(1,round(h*FH))),Image.LANCZOS)
        can=Image.new('RGBA',(400,400),(0,0,0,0)); can.alpha_composite(hd,(round(200-hd.size[0]/2),HAIR_TOP))
        can.save(f'arum_kepala_{names[k]}.png'); k+=1
n=np.asarray(H.crop((27+40,23+168,27+60,23+185))).reshape(-1,4); n=n[n[:,3]>200][:,:3]; skin_h=np.median(n,0)
# ---------- MULUT ----------
Mo=key(M+'arum_lembar_mulut.png'); mcols=[(38,278),(303,543),(568,808),(833,1073),(1098,1338)]
for name,(x0,x1) in zip('aiueo',mcols):
    cell=Mo.crop((x0,265,x1,503)); c=np.asarray(cell).astype(np.float32)
    skin_c=np.median(c[75:100,30:55,:3].reshape(-1,3),0)
    diff=np.abs(c[...,:3]-skin_c).sum(2); inner=np.zeros(diff.shape,bool); inner[60:205,22:218]=True
    mask=(diff>70)&inner&(c[...,3]>128)
    ys,xs=np.where(mask); cx,cy=(xs.min()+xs.max())/2,(ys.min()+ys.max())/2
    m=Image.fromarray((mask*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(17))
    yy,xx=np.mgrid[:diff.shape[0],:diff.shape[1]]; ell=(((xx-cx)/62)**2+((yy-cy)/28)**2<=1)
    base=np.maximum(np.asarray(m)>0,ell).astype(np.uint8)*255
    al_=Image.fromarray(base).filter(ImageFilter.GaussianBlur(6))
    rgb=(c[...,:3]*(skin_h/skin_c)).clip(0,255); rgb=np.where(mask[...,None],c[...,:3],rgb).astype(np.uint8)
    p=Image.fromarray(np.dstack([rgb,np.asarray(al_)]),'RGBA').crop((int(cx-75),int(cy-40),int(cx+75),int(cy+40)))
    p=p.resize((round(p.size[0]*K_M),round(p.size[1]*K_M)),Image.LANCZOS)
    can=Image.new('RGBA',(120,80),(0,0,0,0)); can.alpha_composite(p,(60-p.size[0]//2,40-p.size[1]//2)); can.save(f'arum_mulut_{name}.png')
# ---------- KELOPAK ----------
L=key(M+'arum_lembar_kelopak.png'); lc=[(168,554),(824,1209)]
kel=Image.new('RGBA',(400,400),(0,0,0,0)); ey=[to_canvas(*e) for e in EYES_N]
for (x0,x1),(ex,ey_) in zip(lc,ey):
    p=L.crop((x0-2,272-2,x1+2,487+2)); a=np.asarray(p).astype(np.float32)
    sk=a[(a[...,3]>200)][:,:3]; skin_l=np.median(sk,0)
    near=(np.abs(a[...,:3]-skin_l).sum(2)<60)[...,None]
    a[...,:3]=np.where(near,(a[...,:3]*(skin_h/skin_l)).clip(0,255),a[...,:3])
    p=Image.fromarray(a.astype(np.uint8),'RGBA'); p=p.resize((round(p.size[0]*K_L),round(p.size[1]*K_L)),Image.LANCZOS)
    kel.alpha_composite(p,(round(ex-p.size[0]/2),round(ey_-p.size[1]/2)))
kel.save('arum_kelopak.png')
# ---------- BADAN ----------
poses={'A':['diam','tunjuk','angkat'],'B':['lambai','pinggang','pelipis'],'C':['dagu','jempol','silang']}
bcols={'A':[(170,373),(540,790),(943,1292)],'B':[(191,424),(564,816),(935,1164)],'C':[(262,437),(553,809),(936,1111)]}
info={}; neckx={}
for g in 'ABC':
    B=key(M+f'arum_badan_{g}.png'); arr=np.asarray(B)
    for pose,(x0,x1) in zip(poses[g],bcols[g]):
        sub=arr[:,max(0,x0-6):x1+6]; sa=sub[...,3]>128
        bx0,by0,bx1,by1=bbox(sa); crop=Image.fromarray(sub[by0:by1,bx0:bx1],'RGBA')
        row=sa[by1-45]; xs=np.where(row)[0]; cxs=(xs.min()+xs.max())/2-bx0
        col=sa[:,int(bx0+cxs)-8:int(bx0+cxs)+8].any(1); neck=int(np.where(col)[0][0]-by0)
        info[pose]=dict(h=int(by1-by0),neck=neck)
        FBp=FB*(0.845 if g=='C' else 1.0)
        im=crop.resize((round(crop.size[0]*FBp),round(crop.size[1]*FBp)),Image.LANCZOS)
        can=Image.new('RGBA',(800,1400),(0,0,0,0)); ox=round(400-cxs*FBp); assert ox>=0 and ox+im.size[0]<=800,(pose,ox,im.size)
        can.alpha_composite(im,(ox,FEET-im.size[1])); can.save(f'arum_badan_{pose}.png')
json.dump(info,open('_proses/info_badan.json','w'),indent=1)
print(info)
