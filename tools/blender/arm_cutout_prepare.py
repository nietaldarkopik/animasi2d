"""
Arum cutout v2: duplicate-source compositing.

Body base comes from the raised-arm pose (clear central torso).
Both arm layers come from the neutral pose. The arm mask deliberately
includes a shoulder cap so it overlaps the torso instead of meeting edge-to-edge.

This is an experimental alignment/compositing pass only. No production
character assets are modified and no rig is created.
"""
import bpy, os, sys, argparse
from array import array

def args():
    av = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--character-root", default="karakter/arum")
    p.add_argument("--output-dir", default="tools/blender/output/arum_cutout")
    p.add_argument("--body-source", default="arum_badan_angkat.png")
    p.add_argument("--arm-source", default="arum_badan_diam.png")
    return p.parse_args(av)

def inside(x, y, poly):
    hit, j = False, len(poly)-1
    for i,(xi,yi) in enumerate(poly):
        xj,yj=poly[j]
        if (yi>y)!=(yj>y):
            cross=(xj-xi)*(y-yi)/((yj-yi) or 1e-9)+xi
            if x<cross: hit=not hit
        j=i
    return hit

def load_pixels(path):
    im=bpy.data.images.load(path, check_existing=False)
    w,h=map(int, im.size)
    px=array('f',[0.0])*(w*h*4)
    im.pixels.foreach_get(px)
    return w,h,px

def save(name,w,h,px,path):
    im=bpy.data.images.new(name,width=w,height=h,alpha=True)
    im.pixels.foreach_set(px)
    im.file_format="PNG"; im.filepath_raw=path; im.save(); im.pack()

def main():
    a=args()
    root=os.path.abspath(a.character_root); out=os.path.abspath(a.output_dir)
    os.makedirs(out,exist_ok=True)
    bw,bh,body=load_pixels(os.path.join(root,a.body_source))
    aw,ah,arms=load_pixels(os.path.join(root,a.arm_source))
    if (bw,bh)!=(aw,ah):
        raise RuntimeError("Body and arm source canvases differ: %s vs %s"%((bw,bh),(aw,ah)))
    w,h=bw,bh
    if (w,h)!=(800,1400):
        raise RuntimeError("Expected 800x1400 canvas, got %sx%s"%(w,h))

    # Polygons in top-left image coordinates.
    # These remove the raised arms from the body donor image.
    raised_arm_masks={
      "left":[(75,155),(180,160),(245,245),(300,300),(365,365),(355,430),(300,470),(220,465),(150,430),(105,350)],
      "right":[(725,155),(620,160),(555,245),(500,300),(435,365),(445,430),(500,470),(580,465),(650,430),(695,350)]
    }
    # Neutral-pose arm cutouts. Shoulder caps overlap into torso by design.
    neutral_arm_masks={
      "left":[(265,300),(305,310),(330,345),(330,405),(315,470),(300,535),(285,600),(270,665),(255,730),(250,775),(240,815),(215,820),(195,795),(195,750),(202,700),(210,640),(220,575),(232,510),(245,445),(252,375)],
      "right":[(535,300),(495,310),(470,345),(470,405),(485,470),(500,535),(515,600),(530,665),(545,730),(550,775),(560,815),(585,820),(605,795),(605,750),(598,700),(590,640),(580,575),(568,510),(555,445),(548,375)]
    }

    body_clean=array('f',body)
    arm_layers={s:array('f',[0.0])*(w*h*4) for s in ("left","right")}
    # Remove raised arms from body donor.
    for yt in range(h):
      yb=h-1-yt
      for x in range(w):
        if any(inside(x+.5,yt+.5,p) for p in raised_arm_masks.values()):
          k=(yb*w+x)*4
          body_clean[k+3]=0.0

    # Extract neutral arms from a duplicated source; original source remains intact.
    for yt in range(h):
      yb=h-1-yt
      for x in range(w):
        side=next((s for s,p in neutral_arm_masks.items() if inside(x+.5,yt+.5,p)),None)
        if side is None: continue
        k=(yb*w+x)*4
        if arms[k+3] <= 0.001: continue
        dst=arm_layers[side]
        dst[k:k+4]=arms[k:k+4]

    # Alpha composite: torso donor at back, neutral arms above it.
    comp=array('f',body_clean)
    for side in ("left","right"):
      layer=arm_layers[side]
      for k in range(0,len(comp),4):
        sa=layer[k+3]
        if sa<=0.001: continue
        da=comp[k+3]; oa=sa+da*(1-sa)
        if oa>1e-8:
          for ch in range(3):
            comp[k+ch]=(layer[k+ch]*sa+comp[k+ch]*da*(1-sa))/oa
        comp[k+3]=oa

    files=[
      ("arum_body_clean.png","ARUM_BODY_BASE",body_clean),
      ("arum_arm_left.png","ARUM_ARM_LEFT",arm_layers["left"]),
      ("arum_arm_right.png","ARUM_ARM_RIGHT",arm_layers["right"]),
      ("arum_cutout_composite.png","ARUM_CUTOUT_COMPOSITE",comp),
      ("arum_cutout_source_neutral.png","ARUM_SOURCE_NEUTRAL",arms)
    ]
    for fn,n,px in files:
      save(n,w,h,px,os.path.join(out,fn))
      print("[Cutout v2] Wrote",os.path.join(out,fn))
    print("[Cutout v2] Body donor:",a.body_source)
    print("[Cutout v2] Arm donor:",a.arm_source)
    print("[Cutout v2] Shoulder overlap retained in arm layers.")
    print("[Cutout v2] Experimental only; inspect composite before rigging.")

if __name__=="__main__": main()
