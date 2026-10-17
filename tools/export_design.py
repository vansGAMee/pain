"""Convert decoded Figma Kiwi JSON to compact native vector scenes, preserving source geometry."""
import json,struct,sys,pathlib,collections
j=json.load(open(sys.argv[1]));out=pathlib.Path(__file__).resolve().parents[1];children=collections.defaultdict(list)
key=lambda g:f"{g['sessionID']}:{g['localID']}"
for n in j['nodeChanges']:
 if 'parentIndex'in n:children[key(n['parentIndex']['guid'])].append(n)
def path(i):
 b=bytes(j['blobs'][i]['bytes'].values());p=0;ret=[]
 while p<len(b):
  op=b[p];p+=1;c={0:0,1:2,2:2,3:4,4:6}[op];v=struct.unpack_from('<'+'f'*c,b,p);p+=c*4;ret.append([op,*[round(x,4) for x in v]])
 return ret
def node(n):
 keep=['name','type','visible','opacity','size','transform','fontSize','fontName','letterSpacing','lineHeight','textAlignHorizontal','textAlignVertical','cornerRadius','strokeWeight','strokeAlign','dashPattern','fillPaints','strokePaints','effects']
 r={k:n[k] for k in keep if k in n};r['id']=key(n['guid']);r['text']=n.get('textData',{}).get('characters','')
 for k in ['fillPaints','strokePaints']:
  for p in r.get(k,[]):
   for kk in list(p):
    if kk not in ['type','color','opacity','visible','stops','transform']:p.pop(kk)
 for k in ['fillGeometry','strokeGeometry']:
  r[k]=[{'path':path(g['commandsBlob']),'rule':g.get('windingRule','NONZERO')} for g in n.get(k,[])]
 r['children']=[node(c) for c in sorted(children[r['id']],key=lambda c:c['parentIndex']['position'])]
 return r
scenes=[node(n) for n in children['0:1'] if n['type']=='FRAME' and n.get('size',{}).get('x')==390]
(out/'app/src/main/assets/scenes.json').write_text(json.dumps(scenes,separators=(',',':')))
leaf=next(n for n in j['nodeChanges'] if key(n['guid'])=='31:4')
ops={0:'Z',1:'M',2:'L',3:'Q',4:'C'}
d=' '.join(ops[c[0]]+' '.join(str(v) for v in c[1:]) for c in path(leaf['fillGeometry'][0]['commandsBlob']))
(out/'app/src/main/res/drawable/ic_maple.xml').write_text(f'<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="330" android:viewportHeight="330"><path android:fillColor="#EFEDE6" android:pathData="M0,0 H330 V330 H0 Z"/><group android:translateX="62" android:translateY="38"><path android:fillColor="#11110F" android:pathData="{d}"/></group></vector>')
print('Exported',len(scenes),'screens; original vectors retained')
