from PIL import Image, ImageDraw, ImageFont
F=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',16); FB=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',20)
R=(230,40,60,255); B=(40,110,230,255); G=(30,160,80,255); GR=(150,150,150,255); K=(0,0,0,255)
def grid(d,w,h):
    for x in range(0,w,50): d.line([(x,0),(x,h)],fill=(220,220,220,255))
    for y in range(0,h,50): d.line([(0,y),(w,y)],fill=(220,220,220,255))
    d.rectangle([0,0,w-1,h-1],outline=K,width=2); d.line([(w//2,0),(w//2,h)],fill=B,width=2); d.text((w//2+4,4),'tengah x=%d'%(w//2),fill=B,font=F)
def lab(d,y,t,c,w):
    d.line([(0,y),(w,y)],fill=c,width=3); d.text((6,y-22),t,fill=c,font=F)
def save(im,n,w,h): im.save('panduan_'+n+'.png'); Image.new('RGBA',(w,h),(0,0,0,0)).save('kosong_'+n+'.png')
# badan 600x1400
im=Image.new('RGBA',(600,1400),(255,255,255,255)); d=ImageDraw.Draw(im); grid(d,600,1400)
d.rectangle([100,0,500,400],outline=GR,width=3); d.multiline_text((115,150),'AREA KEPALA 400x400\n(file kepala terpisah,\nditempel di x=100,y=0)\nJANGAN gambar kepala.\nTangan terangkat boleh\nmasuk area ini.',fill=GR,font=F)
lab(d,310,'leher / bahu y=310',G,600); lab(d,700,'pinggang/pangkal paha y~700 (patokan)',GR,600); lab(d,1375,'TELAPAK KAKI y=1375',R,600)
d.multiline_text((10,760),'badan 6,5 kepala: bahu-sepatu\nlatar transparan\ngaris tepi tipis tapi >= 8 px',fill=K,font=F); save(im,'badan_600x1400',600,1400)
# kepala 400x400
im=Image.new('RGBA',(400,400),(255,255,255,255)); d=ImageDraw.Draw(im); grid(d,400,400)
d.ellipse([95,50,305,335],outline=GR,width=3); d.text((130,22),'contoh bentuk kepala',fill=GR,font=F)
lab(d,190,'garis mata y=190',B,400); lab(d,330,'dagu y=330',G,400); d.rectangle([140,222,260,302],outline=R,width=3); d.text((268,250),'zona mulut\n120x80\npusat (200,262)',fill=R,font=F); save(im,'kepala_400x400',400,400)
# mulut 120x80
im=Image.new('RGBA',(120,80),(255,255,255,255)); d=ImageDraw.Draw(im); d.rectangle([0,0,119,79],outline=K,width=2); d.line([(60,0),(60,80)],fill=B); d.line([(0,40),(120,40)],fill=B); save(im,'mulut_120x80',120,80)
# kelopak 400x400
im=Image.new('RGBA',(400,400),(255,255,255,255)); d=ImageDraw.Draw(im); grid(d,400,400)
for x in (135,265): d.ellipse([x-38,168,x+38,212],outline=R,width=3)
d.multiline_text((60,260),'kelopak tertutup (kedip)\nhanya area mata, sisanya transparan\nmata di x=135 dan x=265, y=190',fill=R,font=F); save(im,'kelopak_400x400',400,400)
# skema susunan
s=Image.new('RGBA',(900,560),(235,238,245,255)); d=ImageDraw.Draw(s)
sc=0.38; bw,bh=int(600*sc),int(1400*sc)
d.rectangle([20,20,20+bw,20+bh],outline=K,width=2); d.text((20,4),'badan 600x1400',fill=K,font=F)
d.rectangle([20+int(100*sc),20,20+int(500*sc),20+int(400*sc)],outline=R,width=2); d.text((260,40),'<- kepala 400x400 ditempel di (100,0)',fill=R,font=FB)
d.rectangle([20+int(140*sc)+int(100*sc),20+int(222*sc),20+int(260*sc)+int(100*sc),20+int(302*sc)],outline=B,width=2)
d.multiline_text((260,120),'mulut 120x80 ditempel di (140,222)\npada kanvas KEPALA\n(pusat mulut 200,262)\n\nkelopak 400x400 ditempel di (0,0)\npada kanvas kepala\n\ntelapak kaki y=1375',fill=K,font=F)
s.convert('RGB').save('contoh_susunan_anime.png')
