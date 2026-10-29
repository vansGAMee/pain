"""Bayesian aggregation under log loss, uniform prior over two experts.

w_m <- w_m * p_m(observed choice); predict sum_m w_m*p_m.
With immediate feedback its cumulative log loss is bounded by the baseline
expert's loss + log(2). Playback feedback is delayed: this theorem is NOT a
live accuracy guarantee. Frequency-stratum mass is preserved separately.
Only forecasts made BEFORE an outcome are eligible; never hindsight training.
"""
import json
import numpy as np
from scipy.special import logsumexp

class ExpertGuard:
    def __init__(self):
        self.log_weights = np.full(2, -np.log(2.))
        self.forecasts = {}
        self.observed = {}
        self.updates = 0
        self.context = None

    def abandon(self):
        self.forecasts.clear()
        self.context = None

    def set_context(self,request):
        if request.get('kind') != 'next':
            return
        context = json.dumps([request.get('scope'),request.get('vibe')],sort_keys=True,separators=(',',':'))
        if self.context is not None and context != self.context:
            self.forecasts.clear()
        self.context = context

    def mix(self, baseline, learned):
        weight = np.exp(self.log_weights - logsumexp(self.log_weights))
        return weight[0] * baseline + weight[1] * learned

    def observe_probability(self, baseline, learned):
        tiny = np.finfo(float).tiny
        self.log_weights += np.log(np.maximum(tiny, [baseline, learned]))
        self.log_weights -= logsumexp(self.log_weights)
        self.updates += 1

    def remember(self, request, ids, baseline, learned):
        if request.get('kind') != 'next':
            return
        key = (request.get('seed'), tuple(ids), request.get('now'))
        if key in self.forecasts:
            return
        # Operational memory bound; no effect on rankings or musical scores.
        while len(self.forecasts) >= 64:
            del self.forecasts[next(iter(self.forecasts))]
        self.forecasts[key] = (float(request['now']), dict(zip(ids, zip(baseline, learned))))

    def update(self, plays):
        for play in plays:
            track = str(play['track'])
            links = play.get('syncAliases') or {}
            identities = [(track,'start',at) for at in [play['started']]+links.get('starts',[])]
            identities += [(track,'id',str(id)) for id in ([play['id']] if play.get('id') else [])+links.get('ids',[])]
            if any(key in self.observed for key in identities) or not play.get('finished'):
                continue
            matched = [(key, when, values) for key, (when, values) in self.forecasts.items()
                       if when < play['started'] and str(play['track']) in values]
            if not matched:
                continue
            # One outcome, one most-recent actual pre-outcome forecast.
            key, _, values = max(matched, key=lambda row: row[1])
            self.observe_probability(*values[str(play['track'])])
            for identity in identities:
                self.observed[identity] = play['started']
            for old_key, when, _ in matched:
                del self.forecasts[old_key]
        if len(self.observed) > 10000:
            # A process-local feedback cursor, not a listening database.
            self.observed = dict(sorted(self.observed.items(),key=lambda row:row[1])[-5000:])
