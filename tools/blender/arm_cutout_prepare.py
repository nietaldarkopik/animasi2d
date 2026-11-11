"""
Arum arm cutout v8 — remove full neutral-pose arm silhouettes.

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
        (306,326),(286,338),(269,365),(257,405),(246,450),
        (234,500),(222,550),(211,600),(201,650),(196,700),
        (198,748),(209,790),(229,830),(250,840),(265,817),
        (275,782),(282,744),(291,704),(300,660),(308,615),
        (315,570),(320,525),(324,480),(326,435),(323,390)
      ],
      "right":[
        (494,326),(514,338),(531,365),(543,405),(554,450),
        (566,500),(578,550),(589,600),(599,650),(604,700),
        (602,748),(591,790),(571,830),(550,840),(535,817),
        (525,782),(518,744),(509,704),(500,660),(492,615),
        (485,570),(480,525),(476,480),(474,435),(477,390)
      ]
    }

    # Raised-pose arm silhouettes. Each mask follows one complete sleeve and
    # hand, ending just inside the shoulder to retain a small overlap cap.
    raised_arm_masks={
      "left":[
        (78,169),(101,179),(126,202),(151,226),(170,251),
        (174,278),(163,300),(148,309),(139,333),(142,370),
        (151,407),(171,433),(198,449),(218,449),(238,438),
        (256,421),(273,401),(287,383),(294,369),(286,364),
        (270,370),(251,382),(231,397),(211,407),(193,406),
        (176,394),(160,371),(151,344),(143,316),(132,291),
        (118,269),(103,246),(89,222),(80,197)
      ],
      "right":[
        (722,169),(699,179),(674,202),(649,226),(630,251),
        (626,278),(637,300),(652,309),(661,333),(658,370),
        (649,407),(629,433),(602,449),(582,449),(562,438),
        (544,421),(527,401),(513,383),(506,369),(514,364),
        (530,370),(549,382),(569,397),(589,407),(607,406),
        (624,394),(640,371),(649,344),(657,316),(668,291),
        (682,269),(697,246),(711,222),(720,197)
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
        print("[Cutout v8] Wrote",os.path.join(out,fn))
    print("[Cutout v5] Body source:",body_path)
    print("[Cutout v5] Arm source:",arm_path)
    print("[Cutout v5] Preview combines neutral body with raised-pose arms.")
    print("[Cutout v5] Inspect shoulder seams and mask edges before rigging.")

if __name__=="__main__": main()
