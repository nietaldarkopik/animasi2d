"""
Arum arm cutout v4 — full sleeve/hand mask coverage on one neutral sprite.

The body and arm layers are pixel-aligned copies of the SAME neutral source.
This guarantees the reconstructed neutral composite matches the source exactly.
Shoulder caps are intentionally included in the arm layers; the torso-side edge
is a straight-ish overlap boundary to be refined after visual inspection.

No original character asset is modified. No rig is created.
"""
import bpy, os, sys, argparse
from array import array

def parse_args():
    av=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
    p=argparse.ArgumentParser()
    p.add_argument("--character-root",default="karakter/arum")
    p.add_argument("--output-dir",default="tools/blender/output/arum_cutout")
    p.add_argument("--source",default="arum_badan_diam.png")
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

def save_image(name,w,h,pixels,path):
    im=bpy.data.images.new(name,width=w,height=h,alpha=True)
    im.pixels.foreach_set(pixels)
    im.file_format="PNG"; im.filepath_raw=path; im.save(); im.pack()

def main():
    a=parse_args()
    root=os.path.abspath(a.character_root); out=os.path.abspath(a.output_dir)
    os.makedirs(out,exist_ok=True)
    src_path=os.path.join(root,a.source)
    if not os.path.isfile(src_path): raise FileNotFoundError(src_path)
    src=bpy.data.images.load(src_path,check_existing=False)
    w,h=map(int,src.size)
    if (w,h)!=(800,1400): raise RuntimeError("Expected 800x1400, got %sx%s"%(w,h))
    original=array('f',[0.0])*(w*h*4); src.pixels.foreach_get(original)

    # Polygons follow the visible sleeves + hands in the neutral pose.
    # Screen-left/right are named by viewer perspective.
    # The upper inner corners extend into the shoulder seam for overlap.
    # Full sleeve + hand silhouettes. The previous mask stopped too far
    # toward the outside edge of the torso, leaving narrow sleeve/hand strips
    # on the body layer. These contours extend to the visible inner sleeve edge.
    masks={
      "left":[
        (292,300),(330,312),(360,340),(372,380),(368,425),
        (355,475),(342,530),(328,585),(314,640),(300,690),
        (286,735),(276,775),(263,812),(245,830),(222,822),
        (207,800),(201,770),(202,735),(207,695),(213,650),
        (220,600),(230,545),(241,490),(252,435),(265,380),
        (278,335)
      ],
      "right":[
        (508,300),(470,312),(440,340),(428,380),(432,425),
        (445,475),(458,530),(472,585),(486,640),(500,690),
        (514,735),(524,775),(537,812),(555,830),(578,822),
        (593,800),(599,770),(598,735),(593,695),(587,650),
        (580,600),(570,545),(559,490),(548,435),(535,380),
        (522,335)
      ]
    }

    body=array('f',original)
    arms={s:array('f',[0.0])*(w*h*4) for s in masks}
    # Partition each source pixel once; arm layer owns the shoulder overlap area.
    for y_top in range(h):
      y_bottom=h-1-y_top
      for x in range(w):
        side=next((s for s,p in masks.items() if inside(x+.5,y_top+.5,p)),None)
        if side is None: continue
        k=(y_bottom*w+x)*4
        if original[k+3] <= 0.001: continue
        arms[side][k:k+4]=original[k:k+4]
        body[k+3]=0.0

    # Recompose exact partition; this is expected to match neutral source.
    comp=array('f',body)
    for side in ("left","right"):
      layer=arms[side]
      for k in range(0,len(comp),4):
        sa=layer[k+3]
        if sa<=0.001: continue
        da=comp[k+3]; oa=sa+da*(1-sa)
        if oa>1e-8:
          for ch in range(3):
            comp[k+ch]=(layer[k+ch]*sa+comp[k+ch]*da*(1-sa))/oa
        comp[k+3]=oa

    outputs=[
      ("arum_body_clean.png","ARUM_BODY_CLEAN",body),
      ("arum_arm_left.png","ARUM_ARM_LEFT",arms["left"]),
      ("arum_arm_right.png","ARUM_ARM_RIGHT",arms["right"]),
      ("arum_cutout_composite.png","ARUM_CUTOUT_COMPOSITE",comp),
      ("arum_cutout_source_neutral.png","ARUM_SOURCE_NEUTRAL",original)
    ]
    for fn,name,pixels in outputs:
      save_image(name,w,h,pixels,os.path.join(out,fn))
      print("[Cutout v3] Wrote",os.path.join(out,fn))
    print("[Cutout v3] Single source:",src_path)
    print("[Cutout v3] Source duplicated conceptually, then partitioned into body + two arms.")
    print("[Cutout v3] Neutral composite should reconstruct source pixel-for-pixel.")
    print("[Cutout v3] This is a cutout QC pass only; no rig or source modification.")

if __name__=="__main__": main()
