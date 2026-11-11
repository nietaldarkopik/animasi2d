"""
Arum arm cutout v5 — separate neutral body and raised-arm donor.

- Clean body: neutral pose with only the original down arms removed.
- Arm layers: extracted from raised pose; torso/body pixels are excluded.
- A small shoulder overlap is retained on each arm layer.
This is a cutout preparation/QC script only; no rig is created.
"""
import bpy, os, sys, argparse
from array import array

def parse_args():
    av=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
    p=argparse.ArgumentParser()
    p.add_argument("--character-root",default="karakter/arum")
    p.add_argument("--output-dir",default="tools/blender/output/arum_cutout")
    p.add_argument("--body-source",default="arum_badan_diam.png")
    p.add_argument("--arm-source",default="arum_badan_angkat.png")
    return p.parse_args(av)

def inside(x,y,poly):
    hit=False; j=len(poly)-1
    for i,(xi,yi) in enumerate(poly):
        xj,yj=poly[j]
        if (yi>y)!=(yj>y):
            cross=(xj-xi)*(y-yi)/((yj-yi) or 1e-9)+xi
            if x<cross: hit=not hit
        j=i
    return hit

def load_pixels(path, expected=(800,1400)):
    im=bpy.data.images.load(path,check_existing=False)
    w,h=map(int,im.size)
    if (w,h)!=expected:
        raise RuntimeError("Expected %sx%s, got %sx%s for %s"%(expected[0],expected[1],w,h,path))
    px=array('f',[0.0])*(w*h*4)
    im.pixels.foreach_get(px)
    return w,h,px

def save_image(name,w,h,pixels,path):
    im=bpy.data.images.new(name,width=w,height=h,alpha=True)
    im.pixels.foreach_set(pixels)
    im.file_format="PNG"; im.filepath_raw=path; im.save(); im.pack()

def clear_polygon(source,w,h,poly):
    out=array('f',source)
    for yt in range(h):
        yb=h-1-yt
        for x in range(w):
            if inside(x+.5,yt+.5,poly):
                k=(yb*w+x)*4
                out[k+3]=0.0
    return out

def extract_polygon(source,w,h,poly):
    out=array('f',[0.0])*(w*h*4)
    for yt in range(h):
        yb=h-1-yt
        for x in range(w):
            if inside(x+.5,yt+.5,poly):
                k=(yb*w+x)*4
                if source[k+3] > 0.001:
                    out[k:k+4]=source[k:k+4]
    return out

def composite_over(base,overlay):
    out=array('f',base)
    for k in range(0,len(out),4):
        sa=overlay[k+3]
        if sa<=0.001: continue
        da=out[k+3]; oa=sa+da*(1-sa)
        if oa>1e-8:
            for ch in range(3):
                out[k+ch]=(overlay[k+ch]*sa+out[k+ch]*da*(1-sa))/oa
        out[k+3]=oa
    return out

def main():
    a=parse_args()
    root=os.path.abspath(a.character_root); out=os.path.abspath(a.output_dir)
    os.makedirs(out,exist_ok=True)
    body_path=os.path.join(root,a.body_source)
    arm_path=os.path.join(root,a.arm_source)
    if not os.path.isfile(body_path): raise FileNotFoundError(body_path)
    if not os.path.isfile(arm_path): raise FileNotFoundError(arm_path)

    w,h,body_src=load_pixels(body_path)
    aw,ah,arm_src=load_pixels(arm_path)
    if (w,h)!=(aw,ah): raise RuntimeError("Body and arm donor dimensions differ")

    # Neutral-pose arm silhouettes only. These contours hug the sleeves/hands;
    # they deliberately avoid the broad torso area removed by v4.
    neutral_arm_masks={
      "left":[
        (294,337),(278,350),(267,380),(259,420),(250,465),
        (239,510),(228,555),(218,600),(211,645),(207,690),
        (207,735),(212,770),(222,798),(237,814),(250,806),
        (261,780),(268,745),(277,705),(286,660),(294,615),
        (301,570),(306,525),(310,480),(313,435),(314,392),
        (309,360)
      ],
      "right":[
        (506,337),(522,350),(533,380),(541,420),(550,465),
        (561,510),(572,555),(582,600),(589,645),(593,690),
        (593,735),(588,770),(578,798),(563,814),(550,806),
        (539,780),(532,745),(523,705),(514,660),(506,615),
        (499,570),(494,525),(490,480),(487,435),(486,392),
        (491,360)
      ]
    }

    # Raised-pose arm silhouettes. Each mask follows one complete sleeve and
    # hand, ending just inside the shoulder to retain a small overlap cap.
    raised_arm_masks={
      "left":[
        (78,169),(101,179),(126,202),(151,226),(170,251),
        (174,278),(163,300),(148,309),(139,333),(142,370),
        (151,407),(171,433),(198,449),(224,451),(249,438),
        (272,416),(296,391),(317,367),(312,344),(288,342),
        (267,355),(243,369),(218,377),(194,374),(174,359),
        (159,336),(151,309),(139,287),(123,267),(106,245),
        (91,222),(80,197)
      ],
      "right":[
        (722,169),(699,179),(674,202),(649,226),(630,251),
        (626,278),(637,300),(652,309),(661,333),(658,370),
        (649,407),(629,433),(602,449),(576,451),(551,438),
        (528,416),(504,391),(483,367),(488,344),(512,342),
        (533,355),(557,369),(582,377),(606,374),(626,359),
        (641,336),(649,309),(661,287),(677,267),(694,245),
        (709,222),(720,197)
      ]
    }

    body_clean=array('f',body_src)
    for poly in neutral_arm_masks.values():
        body_clean=clear_polygon(body_clean,w,h,poly)

    arm_layers={}
    for side,poly in raised_arm_masks.items():
        arm_layers[side]=extract_polygon(arm_src,w,h,poly)

    # Preview only: neutral body + raised arms. This is intentionally NOT
    # expected to reconstruct either source image pixel-for-pixel.
    preview=composite_over(body_clean,arm_layers["left"])
    preview=composite_over(preview,arm_layers["right"])

    outputs=[
      ("arum_body_clean.png","ARUM_BODY_CLEAN",body_clean),
      ("arum_arm_left.png","ARUM_ARM_LEFT",arm_layers["left"]),
      ("arum_arm_right.png","ARUM_ARM_RIGHT",arm_layers["right"]),
      ("arum_cutout_composite.png","ARUM_CUTOUT_PREVIEW",preview),
      ("arum_cutout_source_neutral.png","ARUM_SOURCE_NEUTRAL",body_src),
      ("arum_cutout_source_raised.png","ARUM_SOURCE_RAISED",arm_src)
    ]
    for fn,name,pixels in outputs:
        save_image(name,w,h,pixels,os.path.join(out,fn))
        print("[Cutout v5] Wrote",os.path.join(out,fn))
    print("[Cutout v5] Body source:",body_path)
    print("[Cutout v5] Arm source:",arm_path)
    print("[Cutout v5] Preview combines neutral body with raised-pose arms.")
    print("[Cutout v5] Inspect shoulder seams and mask edges before rigging.")

if __name__=="__main__": main()
