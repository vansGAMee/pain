"""Local content-aware reward learning and guarded choice (no user-set score weights).

CART random forests: Breiman (2001), sklearn RandomForestRegressor.
Bootstrap Thompson sampling: Chapelle & Li (2011), Cortes (2018).
Selection: bootstrap posterior probability matching (Thompson sampling).
Frequency strata preserve the actual baseline marginal; no audio score weights.
The target is measured UNIQUE listened fraction; a skip flag is never a penalty.
"""
import json
import math
import heapq
from pathlib import Path
import time
import numpy as np
from scipy.special import logsumexp
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_squared_error, roc_auc_score
from explain import factors


def profile_vector(profile):
    if not isinstance(profile, dict) or profile.get('version') != 4 or profile.get('analysis', {}).get('method') == 'metadata-fallback-v1' or not 20 <= profile.get('frames', 0) <= 360 or profile.get('seconds', 0) < 10:
        return None
    result = []
    for name, size, maximum, root in [('vector',6,1,False),('variance',6,.25,True),('timbre',12,1,False),('timbreVariance',12,.25,True)]:
        values = profile.get(name, [])
        if len(values) != size or not all(isinstance(v,(int,float)) and math.isfinite(v) and 0 <= v <= maximum for v in values):
            return None
        result.extend(math.sqrt(v) if root else v for v in values)
    return np.array(result)


def canonical(plays):
    parents, groups, aliases = [], [], {}
    def find(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i
    for p in plays:
        if not isinstance(p, dict) or p.get('track') is None:
            continue
        track = str(p['track'])
        links = p.get('syncAliases', {})
        ids = ([str(p['id'])] if p.get('id') else []) + [v for v in links.get('ids', [])[:512] if isinstance(v,str) and 0 < len(v) <= 1024]
        starts = [p.get('started',0)] + links.get('starts', [])[:512]
        keys = [('id',track,id) for id in ids] + [('start',track,at) for at in starts if isinstance(at,(int,float)) and math.isfinite(at) and at>0]
        linked = [find(aliases[k]) for k in keys if k in aliases]
        i = linked[0] if linked else len(groups)
        if not linked:
            groups.append([])
            parents.append(i)
        for j in linked:
            parents[find(j)] = find(i)
        groups[i].append(p)
        for k in keys:
            aliases[k] = i
    result = {}
    for i, rows in enumerate(groups):
        result.setdefault(find(i), []).extend(rows)
    out = []
    for rows in result.values():
        p = dict(rows[0])
        for q in rows:
            for k in ('heard', 'media_heard', 'duration', 'finished', 'skipped', 'at', 'timestamp'):
                if k in q:
                    p[k] = max(p.get(k, 0), q[k])
            if q.get('started', 0) > 0:
                p['started'] = min(p.get('started') or q['started'], q['started'])
        out.append(p)
    return sorted(out, key=lambda p: (p.get('started', 0), str(p['track'])))


class Library:
    def __init__(self, folder, offset=0):
        self.folder = Path(folder)
        self.tracks = json.loads((self.folder / 'library.json').read_text(encoding='utf-8'))['tracks']
        self.ids = {str(t['id']): i for i, t in enumerate(self.tracks)}
        self.offset = offset
        profiles = json.loads((self.folder / 'dj-state.json').read_text(encoding='utf-8')).get('profiles', {}) if (self.folder / 'dj-state.json').exists() else {}
        self.embeddings = np.full((len(self.tracks), 512), np.nan)
        catalog = self.folder / 'pulseflow/catalog.npz'
        if catalog.exists():
            with np.load(catalog, allow_pickle=False) as saved:
                rows = json.loads(str(saved['rows']))
                for row, vector in zip(rows, saved['embeddings']):
                    i = self.ids.get(str(row['id']))
                    if i is not None and vector.shape == (512,) and np.isfinite(vector).all():
                        # Reject stale measurements of a replaced file.
                        file = Path(row['path'])
                        if file.exists() and row.get('signature') != f'{file.stat().st_size}:{file.stat().st_mtime_ns}':
                            continue
                        norm = np.linalg.norm(vector)
                        if norm > 0:
                            self.embeddings[i] = vector / norm
        acoustic = []
        self.has_acoustic = []
        for t in self.tracks:
            p = profiles.get(str(t['id']), {})
            expected = [t.get('duration') or 0,t.get('bytes') or 0,t.get('mime') or '',t.get('modified') or t.get('dateModified') or t.get('lastModified') or 0,t.get('uri') or t.get('path') or '']
            try:
                fresh = json.loads(p.get('signature','null')) == expected
            except (TypeError,ValueError):
                fresh = False
            usable = fresh and profile_vector(p) is not None
            self.has_acoustic.append(usable)
            if not usable:
                p = {}
            row = []
            for name, size, root in [('vector', 6, False), ('variance', 6, True), ('timbre', 12, False), ('timbreVariance', 12, True)]:
                values = p.get(name, [])
                row.extend([(math.sqrt(max(0, v)) if root else v) if isinstance(v, (int, float)) and math.isfinite(v) else np.nan for v in values] if len(values) == size else [np.nan] * size)
            detail = p.get('detail', {}).get('mean', [])
            row.extend(detail if len(detail) == 7 else [np.nan] * 7)
            acoustic.append(row)
        self.has_acoustic = np.array(self.has_acoustic)
        self.sound = np.column_stack([self.embeddings, np.array(acoustic, dtype=float)])
        # Median imputation is fitted on the catalog, never on future outcomes.
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', RuntimeWarning)
            med = np.nanmedian(self.sound, axis=0)
        self.sound = np.where(np.isfinite(self.sound), self.sound, np.nan_to_num(med))
        stats = json.loads((self.folder / 'stats.json').read_text(encoding='utf-8')) if (self.folder / 'stats.json').exists() else {}
        self.plays = [p for p in canonical(stats.get('plays', []))
                      if str(p['track']) in self.ids and p.get('duration', 0) > 0 and p.get('started', 0) > 0
                      and p['started'] <= time.time() * 1000 and (p.get('finished') or p.get('skipped'))]
        # Feedback becomes available at the END of an exposure. Crossfades,
        # pauses and parallel devices must not leak a later outcome backwards.
        slice_end = {}
        for row in stats.get('slices',[]):
            if isinstance(row,dict) and isinstance(row.get('at'),(int,float)) and isinstance(row.get('ms'),(int,float)) and row['ms']>0:
                key = str(row.get('play',''))
                slice_end[key] = max(slice_end.get(key,0),row['at']+row['ms'])
        def available(p):
            aliases = [str(p.get('id',''))] + (p.get('syncAliases') or {}).get('ids',[])
            return max(p['started']+max(0,p.get('heard',0)),p.get('at',0),p.get('timestamp',0),max((slice_end.get(id,0) for id in aliases),default=0))
        self.plays = [p for p in self.plays if available(p) <= time.time()*1000]
        self.ready = np.array([available(p) for p in self.plays])
        self.as_of = time.time()*1000
        self.y = np.array([np.clip(p.get('media_heard', p.get('heard', 0)) / p['duration'], 0, 1) for p in self.plays])
        self.complete = np.array([bool(p.get('finished')) for p in self.plays])
        self.indices = np.array([self.ids[str(p['track'])] for p in self.plays], dtype=int)
        self.state = np.zeros((len(self.tracks), 4))
        self.X = []
        self.previous = 0.
        self.pending = []
        self.pending_sequence = 0
        for p, i, reward, ready in zip(self.plays,self.indices,self.y,self.ready):
            self.advance(p['started'])
            self.X.append(self.features([i],p['started'])[0])
            self.schedule(p,i,reward,ready)
        self.X = np.array(self.X)
        self.advance(self.as_of)

    def schedule(self,p,index,reward,ready):
        self.pending_sequence += 1
        heapq.heappush(self.pending,(ready,self.pending_sequence,p,index,reward))

    def advance(self,now):
        while self.pending and self.pending[0][0] <= now:
            ready,_,p,index,reward = heapq.heappop(self.pending)
            self.observe(index,reward,bool(p.get('finished')),p)
            self.state[index,3] = ready

    def observe(self, i, reward, complete, p):
        self.state[i, 0] += 1
        self.state[i, 1] += reward
        self.state[i, 2] += complete
        self.state[i, 3] = p['started'] + max(0, p.get('heard', 0))
        self.previous = reward

    def state_at(self,end):
        self.state.fill(0)
        self.previous = 0.
        self.pending = []
        self.pending_sequence = 0
        for p,i,reward,ready in zip(self.plays[:end],self.indices[:end],self.y[:end],self.ready[:end]):
            self.schedule(p,i,reward,ready)
        self.advance(self.as_of)

    def features(self, indices, now):
        state = self.state[indices]
        angle = ((now / 60000 - self.offset) % 1440) * (2 * np.pi / 1440)
        behavior = np.column_stack([np.log1p(state[:, 0]), np.divide(state[:, 1], state[:, 0], out=np.zeros(len(indices)), where=state[:, 0] > 0), state[:, 0] > 0,
                                   np.log1p(state[:, 2]), np.log1p(np.maximum(0, now - state[:, 3]) / 3600000) * (state[:, 0] > 0),
                                   np.full(len(indices), self.previous)])
        return np.column_stack([behavior, self.sound[indices], np.full(len(indices), np.sin(angle)), np.full(len(indices), np.cos(angle))])


class PersonalModel:
    def __init__(self, library, *, parameters=None, likes=True, validation_end=None, guard=None):
        self.data = library
        self.guard = guard
        n = len(library.y)
        self.diagnostics = {'events': n, 'measuredTracks': int(np.isfinite(library.embeddings).all(axis=1).sum())}
        self.model = None
        if n < 4 or len(np.unique(library.y)) < 2:
            self.diagnostics['method'] = 'insufficient-evidence'
            return
        end = n if validation_end is None else validation_end
        split = int(end * .75)
        # Time-ordered validation only. Leaf sizes are a logarithmic search grid,
        # not music scores. 100 trees and sqrt feature sampling follow RF practice.
        trials = []
        candidates = [parameters] if parameters else [(leaf, clock) for leaf in (1, 4, 16, 64) for clock in (False, True)]
        for leaf, clock in candidates:
            columns = slice(None) if clock else slice(None, -2)
            forest = RandomForestRegressor(max_features='sqrt', min_samples_leaf=leaf, n_jobs=1, random_state=0)
            train = np.flatnonzero(library.ready[:split] <= library.plays[split]['started'])
            if len(train)<2:continue
            forest.fit(library.X[train, columns], library.y[train])
            pred = forest.predict(library.X[split:end, columns])
            auc = roc_auc_score(library.complete[split:end], pred) if len(np.unique(library.complete[split:end])) > 1 else .5
            trials.append((auc, -mean_squared_error(library.y[split:end], pred), leaf, clock, forest, pred))
        if not trials:
            self.diagnostics['method']='insufficient-evidence';return
        best = max(trials, key=lambda r: (r[0], r[1], -r[2], not r[3]))
        _, _, self.leaf, self.clock, initial, pred = best
        self.columns = slice(None) if self.clock else slice(None, -2)
        self.diagnostics.update({'leaf': self.leaf, 'clock': self.clock, 'validationAUC': best[0], 'validationMSE': -best[1],
                                 'method': 'bootstrap-thompson-frequency-strata', 'validationEvents': end - split})
        # No fitted sum of frequency and reward scores. The frequency marginal
        # selects a stratum; canonical bootstrap Thompson sampling selects within
        # that stratum. Every tree is a CART fit to a bootstrap resample.
        self.diagnostics['frequencyMarginalPreserved'] = True
        # Refit selected structure on all available outcomes; the evaluation
        # runner passes only the prefix, so the held-out suffix cannot leak here.
        X, y = library.X, library.y
        library.state_at(n)
        if likes:
            liked = [i for i, t in enumerate(library.tracks) if t.get('favorite')]
            if liked:
                # Each explicit like is one positive observation, never a score bonus.
                X = np.vstack([X, library.features(liked, time.time() * 1000)])
                y = np.r_[y, np.ones(len(liked))]
        self.model = RandomForestRegressor(max_features='sqrt', min_samples_leaf=self.leaf, n_jobs=1, random_state=0).fit(X[:, self.columns], y)
        self.diagnostics['trainingRows'] = len(y)
        self.diagnostics['bootstrapModels'] = len(self.model.estimators_)

    def predict(self, indices, now):
        if self.model is None:
            state = self.data.state[indices]
            return np.divide(state[:, 1], state[:, 0], out=np.full(len(indices), self.data.y.mean() if len(self.data.y) else .5), where=state[:, 0] > 0)
        X = self.data.features(indices, now)[:, self.columns]
        return self.model.predict(X)

    def posterior_rewards(self, indices, now):
        if self.model is None:
            return self.predict(indices,now)[None,:]
        X = self.data.features(indices,now)[:,self.columns]
        return np.array([tree.predict(X) for tree in self.model.estimators_])

    def logits(self, posterior, counts):
        if posterior.ndim == 1:
            posterior = posterior[None,:]
        logits = np.full(len(counts), -np.inf)
        for count in np.unique(counts):
            group = counts == count
            values = posterior[:,group]
            # Each bootstrap model chooses its argmax; exact ties split uniformly.
            tied = values == values.max(axis=1,keepdims=True)
            # Laplace/Dirichlet(1) posterior predictive for finite bootstrap
            # votes: zero Monte Carlo wins are not proof of impossibility.
            votes = (tied/tied.sum(axis=1,keepdims=True)).sum(axis=0)
            probability = (votes+1)/(len(values)+int(group.sum()))
            positive = probability > 0
            local = np.full(group.sum(),-np.inf)
            local[positive] = np.log1p(count) + np.log(group.sum()) + np.log(probability[positive])
            logits[group] = local
        return logits

    def recommend(self, request):
        eligible = list(dict.fromkeys(str(i) for i in request.get('eligible', []) if str(i) in self.data.ids))
        indices = np.array([self.data.ids[i] for i in eligible], dtype=int)
        if not len(indices):
            return {'tracks': [], 'diagnostics': self.diagnostics}
        rng = np.random.default_rng(int(request.get('seed', 0)) & 0xffffffff)
        now = float(request.get('now') or time.time() * 1000)
        posterior = self.posterior_rewards(indices,now)
        reward = posterior.mean(axis=0)
        likes = np.array([bool(self.data.tracks[i].get('favorite')) for i in indices])
        counts = self.data.state[indices, 2] + likes
        frequency = np.log1p(counts)
        logits = self.logits(posterior, counts)
        vibe_likelihood = np.zeros(len(indices))
        vibe = request.get('vibe') or {}
        vibe_applied = False
        anchor = np.asarray(vibe.get('embedding', []), dtype=float)
        if anchor.shape != (512,) or not np.isfinite(anchor).all() or np.linalg.norm(anchor) == 0:
            source = self.data.ids.get(str(vibe.get('trackId')))
            anchor = self.data.embeddings[source] if source is not None else np.array([])
        vectors = self.data.embeddings
        measured = np.isfinite(vectors).all(axis=1)
        if vibe and (anchor.shape != (512,) or not np.isfinite(anchor).all()):
            acoustic_anchor = profile_vector(vibe.get('profile'))
            if acoustic_anchor is not None:
                anchor = acoustic_anchor
                vectors = self.data.sound[:,512:548]
                measured = self.data.has_acoustic
        if vibe and anchor.ndim == 1 and anchor.shape[0] == vectors.shape[1] and np.isfinite(anchor).all():
            # Canonical Gaussian likelihood, Scott bandwidth, diagonal catalog
            # covariance. Applied only to an explicitly pinned, measured vibe.
            selected_measured = measured[indices]
            catalog = vectors[measured]
            variance = np.var(catalog, axis=0, ddof=1) if len(catalog) > 1 else np.zeros(vectors.shape[1])
            dims = variance > 0
            if selected_measured.any() and dims.any():
                h = len(catalog) ** (-1 / (int(dims.sum()) + 4))
                center = anchor / np.linalg.norm(anchor) if anchor.shape == (512,) else anchor
                distances = np.sum((vectors[indices[selected_measured]][:,dims] - center[dims]) ** 2 / variance[dims],axis=1)
                vibe_likelihood[selected_measured] = -distances / (2*h*h)
                vibe_likelihood[~selected_measured] = -np.inf
                logits += vibe_likelihood
                vibe_applied = True
        learned_probabilities = np.exp(logits - logsumexp(logits))
        baseline_logits = frequency + vibe_likelihood
        baseline_probabilities = np.exp(baseline_logits - logsumexp(baseline_logits))
        probabilities = self.guard.mix(baseline_probabilities,learned_probabilities) if self.guard else learned_probabilities
        if self.guard:
            self.guard.remember({**request,'now':time.time()*1000},eligible,baseline_probabilities,learned_probabilities)
        learned_weight = float(np.exp(self.guard.log_weights[1])) if self.guard else 1.

        length = min(int(np.isfinite(vibe_likelihood).sum()), max(1, min(50, int(request.get('length', 1)))))
        # Recompute the same chain rule after each removal. No fixed quota or
        # top-percent pool. Seeded categorical choices keep prefetch reproducible.
        remaining = np.arange(len(indices))
        order = []
        selected_probabilities = {}
        for _ in range(length):
            current_logits = self.logits(posterior[:,remaining], counts[remaining]) + vibe_likelihood[remaining]
            learned_now = np.exp(current_logits - logsumexp(current_logits))
            baseline_now_logits = frequency[remaining] + vibe_likelihood[remaining]
            baseline_now = np.exp(baseline_now_logits - logsumexp(baseline_now_logits))
            probabilities_now = self.guard.mix(baseline_now,learned_now) if self.guard else learned_now
            selected = int(rng.choice(len(remaining), p=probabilities_now))
            order.append(int(remaining[selected]))
            selected_probabilities[int(remaining[selected])] = float(probabilities_now[selected])
            remaining = np.delete(remaining, selected)
        result = []
        for at in order:
            i = indices[at]
            state = self.data.state[i]
            vector = self.data.embeddings[i]
            reference = []
            if np.isfinite(vector).all():
                candidates = np.flatnonzero(((self.data.state[:, 2] > 0) | np.array([bool(t.get('favorite')) for t in self.data.tracks])) & np.isfinite(self.data.embeddings).all(axis=1))
                candidates = candidates[candidates != i]
                nearest = candidates[np.argsort(-(self.data.embeddings[candidates] @ vector))[:3]]
                reference = [{'id': str(self.data.tracks[k]['id']), 'title': self.data.tracks[k].get('title'), 'similarity': float(self.data.embeddings[k] @ vector)} for k in nearest]
            details = {'method': 'personal-taste', 'evidenceReason': self.diagnostics.get('method'), 'historyEvents': self.diagnostics['events'], 'listens': int(state[0]), 'completed': int(state[2]),
                       'heardFraction': float(state[1] / state[0]) if state[0] else None, 'predictedFraction': float(reward[at]),
                       'liked': bool(likes[at]), 'clock': bool(getattr(self, 'clock', False)), 'anchors': reference,

                       'factors': factors(self.model,self.data.features([i],now)[:,self.columns][0]) if self.model is not None else [], 'hasClap': bool(np.isfinite(self.data.embeddings[i]).all()), 'hasAcoustic': bool(self.data.has_acoustic[i]), 'audioUsed': bool(self.model is not None and learned_weight > 0), 'frequencyTier': int(counts[at]), 'learnedShare': learned_weight, 'guardUpdates': self.guard.updates if self.guard else 0, 'vibe': vibe_applied, 'vibeName': str(vibe.get('name') or vibe.get('source') or '')[:100] if vibe_applied else None, 'probability': selected_probabilities[at]}
            result.append({'id': eligible[at], 'score': float(np.log(selected_probabilities[at])), 'reasons': ['Весь ваш вкус'], 'explanation': details})
        return {'tracks': result, 'diagnostics': self.diagnostics}
