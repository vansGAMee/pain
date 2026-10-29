import pathlib,sys,unittest,numpy as np
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'src/personal'))
from model import PersonalModel,canonical
from guard import ExpertGuard
class Reliability(unittest.TestCase):
 def test_frequency_marginal_is_exact_for_arbitrary_learned_scores(self):
  m=PersonalModel.__new__(PersonalModel);counts=np.array([0,0,0,2,2,10]);scores=np.array([.01,.5,.98,.1,.9,.2]);weights=np.exp(m.logits(np.array([scores,scores[::-1]]),counts))
  for count in np.unique(counts):self.assertAlmostEqual(weights[counts==count].sum(),(counts==count).sum()*(count+1),places=12)
 def test_bayesian_guard_has_logloss_bound_even_when_learned_expert_is_confident_and_wrong(self):
  g=ExpertGuard();base_loss=mix_loss=0.
  for i in range(200):
   p=np.array([.8,.2]);q=np.array([.01,.99]) if i<100 else np.array([.99,.01]);target=i%5==0
   mixed=g.mix(p,q);base_loss-=np.log(p[int(target)]);mix_loss-=np.log(mixed[int(target)]);g.observe_probability(p[int(target)],q[int(target)])
   self.assertLessEqual(mix_loss,base_loss+np.log(2)+1e-9)
 def test_only_pre_outcome_forecasts_can_learn_and_synced_outcome_is_counted_once(self):
  g=ExpertGuard();g.remember({'kind':'next','seed':1,'now':100},['a','b'],[.5,.5],[.1,.9]);g.update([{'track':'b','started':99,'finished':1}]);self.assertEqual(g.updates,0)
  g.update([{'track':'b','started':101,'finished':1}]*3);self.assertEqual(g.updates,1);self.assertAlmostEqual(np.exp(g.log_weights).sum(),1)
 def test_identity_merges_without_guessing_overlapping_plays(self):
  rows=[{'id':'a','track':'t','started':1,'heard':2},{'id':'b','track':'t','started':2,'heard':3},{'id':'a','track':'t','started':2,'heard':4}];self.assertEqual(len(canonical(rows)),1)
  self.assertEqual(len(canonical(rows[:2])),2)
 def test_overlapping_exposure_cannot_use_a_future_outcome_as_a_feature(self):
  import tempfile,json
  from model import Library
  with tempfile.TemporaryDirectory() as directory:
   folder=pathlib.Path(directory);tracks=[{'id':id,'duration':20000} for id in ['a','b','c']]
   (folder/'library.json').write_text(json.dumps({'tracks':tracks}))
   plays=[{'id':'a','track':'a','started':100000,'duration':20000,'heard':20000,'media_heard':20000,'finished':1},
          {'id':'b','track':'b','started':105000,'duration':20000,'heard':1000,'media_heard':1000,'skipped':1},
          {'id':'c','track':'c','started':130000,'duration':20000,'heard':1000,'media_heard':1000,'skipped':1}]
   (folder/'stats.json').write_text(json.dumps({'plays':plays}))
   data=Library(folder);self.assertEqual(data.X[1,5],0,'a has not ended yet');self.assertEqual(data.X[2,5],1,'a ended after b and is the latest available outcome')
   self.assertEqual(data.state[:,0].sum(),3)
 def test_tree_path_explanation_reconstructs_the_actual_estimator_prediction(self):
  from sklearn.ensemble import RandomForestRegressor
  from explain import decompose
  rng=np.random.default_rng(8);X=rng.normal(size=(80,6));y=X[:,0]**2-X[:,3]
  forest=RandomForestRegressor(random_state=0,n_jobs=1).fit(X,y)
  for row in X[:8]:
   bias,contribution=decompose(forest,row)
   self.assertAlmostEqual(bias+contribution.sum(),forest.predict(row[None,:])[0],places=12)
 def test_switching_intent_discards_old_forecasts_without_penalizing_either_expert(self):
  g=ExpertGuard();g.set_context({'kind':'next','scope':'library','vibe':None});g.remember({'kind':'next','seed':1,'now':100},['a'],[1],[1]);self.assertEqual(len(g.forecasts),1)
  g.set_context({'kind':'next','scope':'library','vibe':{'name':'other'}});self.assertEqual(len(g.forecasts),0);self.assertEqual(g.updates,0)
  g.remember({'kind':'next','seed':1,'now':110},['a'],[1],[1]);g.abandon();self.assertEqual(len(g.forecasts),0);self.assertEqual(g.updates,0)
if __name__=='__main__':unittest.main()
