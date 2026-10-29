#!/usr/bin/env python3
"""Real-data chronological audit. Run only against an isolated snapshot directory.
No server, training-data writes, pickle files, or user-library mutation.
"""
import os
os.environ['OPENBLAS_NUM_THREADS']='1';os.environ['OMP_NUM_THREADS']='1'
import argparse,hashlib,json,pathlib,sys,time,heapq,subprocess
import numpy as np
from scipy.special import logsumexp
from sklearn.metrics import mean_squared_error,roc_auc_score
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'src/personal'))
from model import Library,PersonalModel
from guard import ExpertGuard
p=argparse.ArgumentParser();p.add_argument('--data',required=True);p.add_argument('--output',required=True);args=p.parse_args()
folder=pathlib.Path(args.data).resolve()
source=pathlib.Path(__file__).resolve().parents[1]/'data'
if folder==source.resolve():raise SystemExit('Use a copied library, never the live data directory')
destination=pathlib.Path(args.output).resolve()
if folder in destination.parents or source.resolve() in destination.parents or destination.name in {'library.json','stats.json','dj-state.json','catalog.npz'}:
 raise SystemExit('Write the audit to a separate report outside live and copied inputs')
def hashes():return {str(p.relative_to(folder)):hashlib.sha256(p.read_bytes()).hexdigest() for p in folder.rglob('*') if p.is_file()}
before=hashes();start=time.perf_counter();data=Library(folder,offset=-240);
# Use the player's exact recording/edition identity, not an approximate rewrite.
identity_script="const fs=require('node:fs'),M=require(process.argv[2]);process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(process.argv[1])).tracks.map(t=>M.recordingIdentity(t))))"
recordings=np.array(json.loads(subprocess.check_output(['node','-e',identity_script,str(folder/'library.json'),str(pathlib.Path(__file__).resolve().parents[1]/'src/recommendation-model.js')],text=True)))
n=len(data.plays);cut=int(n*.8)
full=(data.plays,data.y.copy(),data.complete.copy(),data.indices.copy(),data.X.copy(),data.ready.copy())
cutoff=full[0][cut]['started'];train_indices=np.flatnonzero((np.arange(n)<cut)&(data.ready<=cutoff))
# Current likes have no historical timestamp. Hide them for the historical audit.
for t in data.tracks:t['favorite']=False
data.plays=[data.plays[i] for i in train_indices];data.y=data.y[train_indices];data.complete=data.complete[train_indices];data.indices=data.indices[train_indices];data.X=data.X[train_indices];data.ready=data.ready[train_indices];data.as_of=cutoff
model=PersonalModel(data,likes=False);guard=ExpertGuard();fit=time.perf_counter()-start
baseline_pred=[];predictions=[];frequency=[];outcomes=[];complete=[]
rank_rows={'frequency':[],'personal':[]};neglog={'frequency':[],'personal':[]};latencies=[]
for j in range(cut):
 if full[5][j]>cutoff:data.schedule(full[0][j],full[3][j],full[1][j],full[5][j])
all_indices=np.arange(len(data.tracks));previous=data.indices[-1] if len(data.indices) else None
chosen=[];pending_feedback=[];feedback_sequence=0;delayed_feedback=0
for j in range(cut,n):
 event,idx,reward=full[0][j],full[3][j],full[1][j];data.advance(event['started']);
 while pending_feedback and pending_feedback[0][0]<=event['started']:
  _,_,bp,lp=heapq.heappop(pending_feedback);guard.observe_probability(bp,lp)
 begin=time.perf_counter()
 posterior=model.posterior_rewards(all_indices,event['started']);mean=posterior.mean(axis=0);latencies.append((time.perf_counter()-begin)*1000)
 counts=data.state[:,2];frequency.append(counts[idx]);predictions.append(mean[idx]);outcomes.append(reward);complete.append(bool(event.get('finished')))
 state=data.state[idx];baseline_pred.append(state[1]/state[0] if state[0] else data.y.mean())
 learned_logits=model.logits(posterior,counts)
 baseline=np.exp(np.log1p(counts)-logsumexp(np.log1p(counts)))
 learned=np.exp(learned_logits-logsumexp(learned_logits))
 logits=np.log(guard.mix(baseline,learned))
 if event.get('finished') and (previous is None or recordings[idx]!=recordings[previous]):
  eligible=all_indices[recordings!=recordings[previous]] if previous is not None else all_indices
  if not len(eligible):eligible=all_indices
  baseline=np.zeros(len(all_indices));learned=np.zeros(len(all_indices))
  baseline[eligible]=np.exp(np.log1p(counts[eligible])-logsumexp(np.log1p(counts[eligible])))
  eligible_logits=model.logits(posterior[:,eligible],counts[eligible]);learned[eligible]=np.exp(eligible_logits-logsumexp(eligible_logits))
  mixture=guard.mix(baseline,learned)
  logits=np.full(len(all_indices),-np.inf);logits[eligible]=np.log(mixture[eligible])
  for name,scores in [('frequency',np.log1p(counts)),('personal',logits)]:
   order=eligible[np.lexsort((-mean[eligible],-counts[eligible]))] if name=='personal' else eligible[np.argsort(-scores[eligible],kind='stable')];rank=int(np.flatnonzero(order==idx)[0])+1
   rank_rows[name].append(rank);neglog[name].append(float(logsumexp(scores[eligible])-scores[idx]))
  chosen.append(int(np.argmax(logits)))
  feedback_sequence+=1
  heapq.heappush(pending_feedback,(full[5][j],feedback_sequence,baseline[idx],learned[idx]))
  delayed_feedback+=int(len(pending_feedback)>1)
 data.schedule(event,idx,reward,full[5][j]);previous=idx
while pending_feedback:
 _,_,bp,lp=heapq.heappop(pending_feedback);guard.observe_probability(bp,lp)
metrics={}
for name,values in rank_rows.items():
 metrics[name]={'nextChoices':len(values),'recall@10':float(np.mean(np.array(values)<=10)),'recall@50':float(np.mean(np.array(values)<=50)),
                'ndcg@50':float(np.mean([1/np.log2(r+1) if r<=50 else 0 for r in values])), 'nextChoiceLogLoss':float(np.mean(neglog[name]))}
for name,values in [('previous-mean',baseline_pred),('personal',predictions),('frequency',frequency)]:
 metrics.setdefault(name,{})['completionAUC']=float(roc_auc_score(complete,values)) if len(set(complete))>1 else None
 if name!='frequency':metrics[name]['fractionMSE']=float(mean_squared_error(outcomes,values))
# A stochastic policy is audited as a distribution, not a manufactured top-k list.
data.state_at(len(data.plays));model.guard=ExpertGuard();draws=[]
for seed in range(100):
 r=model.recommend({'eligible':[str(t['id']) for t in data.tracks], 'seed':seed,'now':full[0][cut]['started'],'length':6})
 draws.extend(row['id'] for row in r['tracks'])
report={'split':{'training':len(train_indices),'test':n-cut,'embargoedCrossBoundary':cut-len(train_indices),'outcomesAvailableAt':'max(started+heard, timestamp, slice end)','likesHidden':True,'orderedBy':'started','catalog':'fixed snapshot; historical availability unknown', 'auditNote':'development replay; this period previously rejected the unconstrained prototype; not an untouched test', 'sameRecordingAliasesExcluded':True, 'rankDefinition':'frequency first, learned ordering within equal-count tiers; log loss uses actual stochastic policy'},
        'model':model.diagnostics,'metrics':metrics,'performance':{'fitSeconds':fit,'warmFullLibraryP50Ms':float(np.median(latencies)),'warmFullLibraryP95Ms':float(np.quantile(latencies,.95))},
        'guard':{'updates':guard.updates,'overlappingPendingOutcomes':delayed_feedback,'immediateFeedbackTheoremNotClaimedForPlayback':True,'learnedShare':float(np.exp(guard.log_weights[1]))},
        'sampling':{'draws':len(draws),'uniqueTracks':len(set(draws))},'unchanged':before==hashes()}
pathlib.Path(args.output).write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False))
assert report['unchanged'],'snapshot was mutated'
