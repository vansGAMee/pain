"""Process boundary for the UNMODIFIED vendored PulseFlow inference functions.

Only file discovery, incremental storage and player eligibility live here.
No learned substitutes, metadata embeddings, score adjustments or reranking.
"""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import subprocess
import signal
import sys
import tempfile
import time

UPSTREAM = Path(__file__).resolve().parents[1] / 'vendor' / 'pulseflow'
sys.path.insert(0, str(UPSTREAM))
REVISION = 'd1fedcd4e1a676c0838ab2f7eb9ba6934676bcff'
CHECKPOINT_SHA256 = '8053c9775516af2f4902e1e8281e356cc1bf7a85e8b761908170767b77c3f037'


def atomic_json(path, value):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
    os.replace(tmp, path)


def signature(path):
    s = Path(path).stat()
    return f'{s.st_size}:{s.st_mtime_ns}'


def publish(root, rows, vectors):
    import numpy as np
    if not rows:
        return
    tmp = root / 'catalog.tmp'
    with tmp.open('wb') as stream:
        np.savez(stream, embeddings=np.vstack(vectors).astype('float32'),
                 rows=json.dumps(rows), revision=REVISION)
    os.replace(tmp, root / 'catalog.npz')


def embed_bounded(model, file, root):
    """Stream long recordings to disk; use LAION's own rand_trunc sampler.

    The stock non-fusion CLAP path quantizes/copies the entire recording before
    retaining only 480000 samples. Cropping first commutes with its pointwise
    quantization and avoids OOM on this library's five-hour recording. This is
    decoding/storage adaptation; the sampler and inference remain upstream.
    """
    import numpy as np
    import torch
    from laion_clap.training.data import get_audio_features
    from scripts import embed_clap as ec
    with tempfile.TemporaryDirectory(dir=root) as temp:
        pcm = Path(temp) / 'audio.f32'
        subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-threads', '1', '-i', str(file),
                        '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', str(pcm)],
                       check=True, capture_output=True, timeout=600)
        mapped = np.memmap(pcm, dtype='float32', mode='c')
        if not len(mapped):
            raise ValueError('Empty decoded audio')
        features = get_audio_features({}, torch.from_numpy(mapped), 480000,
                                     data_truncating='rand_trunc', data_filling='repeatpad',
                                     audio_cfg=model.model_cfg['audio_cfg'])
        crop = features['waveform'].numpy().copy()
        del features, mapped
        return ec._embed_with_model(model, crop, 48000).astype('float32')


def index_library(root, manifest):
    import numpy as np
    from scripts import embed_clap as ec
    # A CPU thread budget is an operational limit, never a ranking parameter.
    import torch
    torch.set_num_threads(1)
    try:
        os.nice(10)
    except (AttributeError, OSError):
        pass
    items = json.loads(Path(manifest).read_text(encoding='utf-8'))
    cache = root / 'vectors'
    cache.mkdir(exist_ok=True)
    rows, vectors, errors, unavailable = [], [], [], []
    identical_files = {}
    had_catalog = (root / 'catalog.npz').exists()
    state = dict(state='indexing', total=len(items), indexed=0, indexedIds=[], failed=0, revision=REVISION)
    atomic_json(root / 'status.json', state)
    model = None
    loading_model = False
    for item in items:
        if not item.get('path'):
            unavailable.append(item['id'])
            state.update(unavailableIds=unavailable, processed=len(rows)+len(errors)+len(unavailable))
            atomic_json(root / 'status.json', state)
            continue
        state.update(current=item.get('title', item['id']), processed=len(rows)+len(errors))
        atomic_json(root / 'status.json', state)
        try:
            file = Path(item['path'])
            sig = signature(file)
            stat = file.stat()
            file_identity = (stat.st_dev, stat.st_ino if stat.st_ino else str(file), sig)
            key = hashlib.sha256((REVISION+'\0'+str(file)+'\0'+sig).encode()).hexdigest()
            target = cache / (key+'.npy')
            if file_identity in identical_files:
                emb = identical_files[file_identity]
            elif target.exists():
                emb = np.load(target, allow_pickle=False)
            else:
                if model is None:
                    loading_model = True
                    state['state'] = 'loading'
                    atomic_json(root / 'status.json', state)
                    model = ec._load_clap()
                    import laion_clap
                    checkpoint = Path(laion_clap.__file__).parent / '630k-audioset-best.pt'
                    with checkpoint.open('rb') as stream:
                        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
                    if digest != CHECKPOINT_SHA256:
                        raise ValueError('The downloaded CLAP checkpoint differs from the validated model')
                    loading_model = False
                state['state'] = 'indexing'
                atomic_json(root / 'status.json', state)
                import soundfile as sf
                try:
                    info = sf.info(file)
                    # 128 MiB decoded-input RAM budget; not a musical parameter.
                    bounded = info.frames * info.channels * 8 > 128 * 1024 * 1024
                except Exception:
                    bounded = True
                if bounded:
                    emb = embed_bounded(model, file, root)
                else:
                    try:
                        y, sr = ec.read_mono(file, target_sr=48000)
                    except Exception:
                    # Some phone cache files are MP4/EAC3 despite a .mp3 suffix.
                    # Decode their original samples to WAV; upstream still does
                    # the mono conversion and 48 kHz resampling itself.
                        with tempfile.TemporaryDirectory(dir=root) as temp:
                            wav = Path(temp) / 'decoded.wav'
                            subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-threads', '1',
                                            '-i', str(file), '-vn', '-c:a', 'pcm_f32le', str(wav)],
                                           check=True, capture_output=True, timeout=180)
                            y, sr = ec.read_mono(wav, target_sr=48000)
                    emb = ec._embed_with_model(model, y, sr).astype('float32')
                    del y
                if signature(file) != sig:
                    raise ValueError('Audio file changed during analysis; retry indexing')
                if emb.shape != (512,) or not np.isfinite(emb).all() or not np.linalg.norm(emb):
                    raise ValueError('CLAP returned an invalid embedding')
                with target.with_suffix('.tmp').open('wb') as stream:
                    np.save(stream, emb)
                os.replace(target.with_suffix('.tmp'), target)
            # Hard links / aliases are the very same audio file, so reuse its
            # canonical cached CLAP output without loading the model twice.
            identical_files[file_identity] = emb
            rows.append(dict(id=str(item['id']), path=str(file), signature=sig))
            vectors.append(emb)
        except Exception as error:
            errors.append(dict(id=item['id'], error=str(error)))
            print(f"{item['id']}: {error}", file=sys.stderr, flush=True)
            # Model initialization failure affects every file; do not retry
            # downloading/loading it hundreds of times.
            if loading_model:
                state.update(state='error', error=str(error))
                atomic_json(root / 'status.json', state)
                raise
        state.update(indexed=len(rows), indexedIds=[row['id'] for row in rows], failed=len(errors), processed=len(rows)+len(errors)+len(unavailable))
        atomic_json(root / 'status.json', state)
        # Batch disk writes, not a model hyperparameter. Per-file vectors are
        # already durable, so interrupted runs resume without re-inference.
        if not had_catalog and len(rows) and len(rows) % 10 == 0:
            publish(root, rows, vectors)
    publish(root, rows, vectors)
    atomic_json(root / 'errors.json', errors)
    state.update(state='ready' if rows else 'error', current='', error=None)
    atomic_json(root / 'status.json', state)


class Recommender:
    def __init__(self, root):
        self.root, self.version, self.rows, self.embeddings = root, None, [], None

    def recommend(self, request):
        import numpy as np
        import faiss
        from scripts.generate_playlist import _select_tracks
        policy = request.get('policy', 'smooth')
        if policy not in ('smooth', 'contrast'):
            raise ValueError('Unknown PulseFlow policy')
        length = request.get('length', 20)
        if not isinstance(length, int) or not 1 <= length <= 100:
            raise ValueError('Playlist length must be 1..100')
        catalog = self.root / 'catalog.npz'
        version = signature(catalog)
        if self.version != version:
            with np.load(catalog, allow_pickle=False) as saved:
                if str(saved['revision']) != REVISION:
                    raise ValueError('Rebuild the index for this PulseFlow revision')
                self.embeddings = saved['embeddings']
                self.rows = json.loads(str(saved['rows']))
            self.version = version
        eligible = request.get('eligible')
        if not isinstance(eligible, list) or len(eligible) > 100000:
            raise ValueError('An explicit queue scope is required')
        eligible = set(map(str, eligible))
        seed, selected = None, []
        for i, row in enumerate(self.rows):
            if row['id'] != str(request.get('seed')) and row['id'] not in eligible:
                continue
            try:
                if signature(row['path']) != row['signature']:
                    continue
            except OSError:
                continue
            if row['id'] == str(request.get('seed')):
                seed = self.embeddings[i]
            if row['id'] in eligible:
                selected.append(i)
        if seed is None:
            raise ValueError('PulseFlow has no current CLAP embedding for the seed; index the library')
        if not selected:
            return dict(tracks=[], method='pulseflow-clap-faiss', policy=policy, revision=REVISION)
        vectors = self.embeddings[selected].copy().astype('float32')
        faiss.normalize_L2(vectors)
        index = faiss.IndexFlatIP(vectors.shape[1])
        index.add(vectors)
        mapping = [self.rows[i]['id'] for i in selected]
        # The actual function used by upstream CLI and web_app. Do not port,
        # reweight, personalize or post-sort its output.
        result = _select_tracks(index, mapping, seed, length, policy)
        return dict(tracks=[dict(id=tid, score=score) for tid, score in result],
                    method='pulseflow-clap-faiss', policy=policy, revision=REVISION)


def serve(root):
    recommender = Recommender(root)
    # Keep diagnostics out of the JSON protocol.
    output = sys.stdout
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            with contextlib.redirect_stdout(sys.stderr):
                result = recommender.recommend(request)
            response = dict(id=request.get('id'), result=result)
        except Exception as error:
            response = dict(id=request.get('id'), error=str(error))
        print(json.dumps(response), file=output, flush=True)


if __name__ == '__main__':
    def stop(signum, frame):
        raise KeyboardInterrupt('PulseFlow stopped')
    signal.signal(signal.SIGTERM, stop)
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['index', 'serve'])
    parser.add_argument('--data', required=True)
    parser.add_argument('--manifest')
    args = parser.parse_args()
    root = Path(args.data)
    root.mkdir(parents=True, exist_ok=True)
    if args.command == 'index':
        index_library(root, args.manifest)
    else:
        serve(root)
