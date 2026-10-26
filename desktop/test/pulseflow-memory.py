"""Check crop-before-copy equivalence using real audio, the real CLAP and RNG."""
import argparse
import json
from pathlib import Path
import resource
import subprocess
import sys
import tempfile
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src' / 'pulseflow'))
from bridge import embed_bounded
from scripts import embed_clap as ec
import torch
torch.set_num_threads(2)
parser = argparse.ArgumentParser()
parser.add_argument('--audio', required=True)
parser.add_argument('--work', required=True)
args = parser.parse_args()
model = ec._load_clap()
with tempfile.TemporaryDirectory(dir=args.work) as directory:
    wav = Path(directory) / 'real.wav'
    # Canonical PCM input makes this a check of the memory adaptation itself,
    # independent of codec/resampler differences.
    subprocess.run(['ffmpeg','-v','error','-nostdin','-i',args.audio,'-ac','1','-ar','48000','-c:a','pcm_f32le',str(wav)],check=True)
    y, sr = ec.read_mono(wav, target_sr=48000)
    np.random.seed(1977)
    expected = ec._embed_with_model(model, y, sr)
    np.random.seed(1977)
    actual = embed_bounded(model, wav, Path(directory))
    np.testing.assert_array_equal(expected, actual)
    print(json.dumps(dict(exactEmbeddingMatch=True, actualAudioSeconds=len(y)/sr,
                          peakRSSMiB=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024)))
