"""Read-only acceptance checks on the user's real cached CLAP embeddings."""
import argparse
import json
from pathlib import Path
import sys
import time
import hashlib
from collections import Counter
import numpy as np
import faiss

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src' / 'pulseflow'))
from bridge import Recommender
from scripts.generate_playlist import _select_tracks

parser = argparse.ArgumentParser()
parser.add_argument('--data', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
root = Path(args.data)
with np.load(root / 'pulseflow' / 'catalog.npz', allow_pickle=False) as saved:
    vectors = saved['embeddings']
    rows = json.loads(str(saved['rows']))
assert vectors.shape == (len(rows), 512)
assert np.isfinite(vectors).all()
assert (np.linalg.norm(vectors, axis=1) > 0).all()
service = Recommender(root / 'pulseflow')
latencies, comparisons = [], 0
# All real seeds, both upstream policies, full library excluding only the seed.
for n, row in enumerate(rows):
    indices = [i for i in range(len(rows)) if i != n]
    emb = vectors[indices].astype('float32').copy()
    faiss.normalize_L2(emb)
    index = faiss.IndexFlatIP(emb.shape[1]); index.add(emb)
    mapping = [rows[i]['id'] for i in indices]
    for policy in ['smooth', 'contrast']:
        expected = _select_tracks(index, mapping, vectors[n], 20, policy)
        before = time.perf_counter()
        actual = service.recommend(dict(seed=row['id'], eligible=mapping, length=20, policy=policy))
        latencies.append((time.perf_counter()-before)*1000)
        assert [(t['id'], t['score']) for t in actual['tracks']] == expected, (row['id'], policy)
        assert len({t['id'] for t in actual['tracks']}) == len(actual['tracks'])
        comparisons += 1
report = dict(tracks=len(rows), dimensions=512, upstreamComparisons=comparisons,
              exactOrderAndScores=True, queryMedianMs=float(np.median(latencies)),
              queryP95Ms=float(np.percentile(latencies, 95)), queryMaxMs=max(latencies))
# Chronological holdout, same completed-listen target and split as the existing
# benchmark. Content embeddings are measured now, not trained on held-out plays.
library_bytes = (root / 'library.json').read_bytes()
stats_bytes = (root / 'stats.json').read_bytes()
library = json.loads(library_bytes)['tracks']
stats = json.loads(stats_bytes)
known = {str(t['id']) for t in library}
events = {}
complete = lambda p: p.get('finished') in (1, True) or p.get('completed') in (1, True)
for play in stats.get('plays', []):
    stamp = play.get('started') or play.get('timestamp') or 0
    if str(play.get('track')) not in known or not isinstance(stamp, (int, float)) or stamp <= 0:
        continue
    key = (str(play['track']), stamp)
    old = events.get(key)
    value = dict(play, track=key[0], started=stamp)
    if old:
        value['finished'] = int(complete(old) or complete(play))
        value['heard'] = max(old.get('heard', 0), play.get('heard', 0))
    events[key] = value
events = sorted(events.values(), key=lambda p: (p['started'], p['track']))
if len(events) > 1:
    cutoff = events[int(len(events)*.8)]['started']
    excluded_data = json.loads((root/'excluded-tracks.json').read_text()) if (root/'excluded-tracks.json').exists() else []
    excluded = set(map(str, excluded_data if isinstance(excluded_data, list) else excluded_data.get('trackIds', [])))
    def available(track):
        added = track.get('added') or 0
        if added < 100000000000: added *= 1000
        return added <= cutoff and str(track['id']) not in excluded
    catalog = [str(t['id']) for t in library if available(t) and str(t['id']) in {r['id'] for r in rows}]
    counts = Counter()
    train = [p for p in events if p['started'] < cutoff]
    for p in train:
        end = p.get('at') or p.get('timestamp') or 0
        end = end if end > p['started'] else p['started'] + (p.get('heard') or 0)
        if complete(p) and end < cutoff: counts[p['track']] += 1
    hits = {name: {'hit10': 0, 'hit20': 0} for name in ['pulseflowSmooth', 'pulseflowContrast', 'completedFrequency', 'frequencyPulseflowTies']}
    previous, tested = train[-1], 0
    for event in events[len(train):]:
        seed, previous = previous['track'], event
        if not complete(event) or event['track'] not in catalog or seed not in catalog or seed == event['track']:
            continue
        eligible = [tid for tid in catalog if tid != seed]
        baseline = sorted(eligible, key=lambda tid: (-counts[tid], hashlib.sha256(tid.encode()).hexdigest()))[:20]
        rankings = {'completedFrequency': baseline}
        personal = []
        for count in sorted({counts[tid] for tid in eligible}, reverse=True):
            group = [tid for tid in eligible if counts[tid] == count]
            selected = service.recommend(dict(seed=seed,eligible=group,length=20-len(personal),policy='smooth'))
            personal.extend(t['id'] for t in selected['tracks'])
            if len(personal) >= 20: break
        rankings['frequencyPulseflowTies'] = personal
        for name, policy in [('pulseflowSmooth', 'smooth'), ('pulseflowContrast', 'contrast')]:
            result = service.recommend(dict(seed=seed, eligible=eligible, length=20, policy=policy))
            rankings[name] = [t['id'] for t in result['tracks']]
        for name, ranking in rankings.items():
            for k in [10, 20]: hits[name]['hit'+str(k)] += int(event['track'] in ranking[:k])
        tested += 1
    report['history'] = dict(events=len(events), trainEvents=len(train), heldOutEvents=len(events)-len(train),
        completedNextTrackQueries=tested, cutoff=cutoff, candidateCatalog=len(catalog),
        methods={name:{metric:count/tested if tested else None for metric,count in values.items()} for name,values in hits.items()},
        limitations=['Current audio files are assumed to match the historical recordings; historical file versions are unavailable.',
                     'Current exclusions define the scope; historical exclusion changes are unavailable.',
                     'An offline next-track hit is not a listening-satisfaction measurement. No parameters were tuned on the holdout.'])
report['inputHashes'] = dict(library=hashlib.sha256(library_bytes).hexdigest(), stats=hashlib.sha256(stats_bytes).hexdigest())
Path(args.output).write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report))
