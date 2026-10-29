"""Local JSON-lines RPC. Training never blocks playback requests.
One coalesced refit runs in a background thread; until ready, the player uses
its real frequency fallback. Immutable fitted models are published atomically.
"""
import argparse,json,threading,time
from pathlib import Path
import sys
import numpy as np
from model import Library,PersonalModel
from guard import ExpertGuard

parser=argparse.ArgumentParser();parser.add_argument('--data',required=True)
folder=Path(parser.parse_args().data)
lock=threading.RLock();output_lock=threading.Lock()
model=key=training=failed_key=processed=None
parameters=None;selected_at=0;last_error=None
guard=ExpertGuard()

def send(value):
    with output_lock:
        print(json.dumps(value,allow_nan=False),flush=True)

def fit_model(fingerprint,offset,chosen,chosen_at):
    global model,key,training,failed_key,parameters,selected_at,last_error
    try:
        begin=time.perf_counter();data=Library(folder,offset)
        if chosen_at and (len(data.y)>=2*chosen_at or len(data.y)<chosen_at):chosen=None
        fitted=PersonalModel(data,parameters=chosen,guard=guard)
        fitted.diagnostics['fitMs']=round((time.perf_counter()-begin)*1000)
        with lock:
            model,key=fitted,fingerprint
            if fitted.model is not None:
                parameters=(fitted.leaf,fitted.clock)
                if chosen is None:selected_at=len(data.y)
            training=failed_key=last_error=None
            send({'event':'ready','diagnostics':fitted.diagnostics})
    except Exception as error:
        with lock:
            training=None;failed_key=fingerprint;last_error=str(error)
            send({'event':'error','error':last_error})

def embedding(track):
    file=folder/'pulseflow/catalog.npz'
    if not file.exists():return None
    with np.load(file,allow_pickle=False) as catalog:
        for i,row in enumerate(json.loads(str(catalog['rows']))):
            if str(row['id'])!=str(track):continue
            vector=catalog['embeddings'][i];source=Path(row['path'])
            fresh=not source.exists() or row.get('signature')==f'{source.stat().st_size}:{source.stat().st_mtime_ns}'
            if fresh and vector.shape==(512,) and np.isfinite(vector).all() and np.linalg.norm(vector)>0:
                return (vector/np.linalg.norm(vector)).tolist()
    return None

for line in sys.stdin:
    request={}
    try:
        if len(line)>2*1024*1024:raise ValueError('Request too large')
        request=json.loads(line)
        if request.get('action')=='abandon':
            guard.abandon();send({'id':request.get('id'),'result':{'abandoned':True}});continue
        if request.get('action')=='embedding':
            send({'id':request.get('id'),'result':{'embedding':embedding(request.get('track'))}});continue
        guard.set_context(request)
        offset=int(request.get('offset',0))
        if not -840<=offset<=840:raise ValueError('Invalid local timezone')
        files=[folder/n for n in ('library.json','stats.json','dj-state.json','pulseflow/catalog.npz')]
        fingerprint=(offset,tuple((p.stat().st_size,p.stat().st_mtime_ns) if p.exists() else None for p in files))
        with lock:
            if fingerprint==failed_key:raise ValueError(last_error)
            if fingerprint!=key:
                if training is None:
                    chosen=parameters if key is None or key[0]==offset else None
                    training=threading.Thread(target=fit_model,args=(fingerprint,offset,chosen,selected_at),daemon=True)
                    training.start()
                # Hold the publication lock through this response: a subsequent
                # ready notification cannot be overwritten by a stale training reply.
                send({'id':request.get('id'),'result':{'preparing':True,'tracks':[],'diagnostics':{'state':'training'}}})
                continue
            active=model
        if active is not processed:
            guard.update(active.data.plays);processed=active
        send({'id':request.get('id'),'result':active.recommend(request)})
    except Exception as error:
        send({'id':request.get('id'),'error':str(error)})
