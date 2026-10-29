/* Player navigation around upstream playlists; optional uniform sampling, no new scores. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PulseFlowPlayer = factory();
})(globalThis, () => {
  async function request(payload) {
    const response = await fetch('/api/pulseflow/recommend', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Pain-Update': 'pulseflow' }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'PulseFlow unavailable');
    return result;
  }
  const isLive = q => q.pulseflowPolicy === 'live';
  const policyOf = q => q.pulseflowPolicy === 'contrast' ? 'contrast' : 'smooth';
  function seedOf(q, tracks) {
    if (q.pulseflowVibe) {
      const vibe = q.pulseflowVibe;
      const match = vibe.trackId != null ? (tracks.find(t => String(t.id) === String(vibe.trackId)) || {id:vibe.trackId,title:vibe.source})
        : tracks.find(t => [t.title, t.artist].filter(Boolean).join(' — ').slice(0, 300) === vibe.source);
      if (!match) throw new Error('The saved vibe source is unavailable; select a library track');
      return match;
    }
    return q.getCurrentTrack() || tracks[0];
  }
  function choice(q, row, seed, policy) {
    const index = q.tracks.findIndex(t => String(t.id) === String(row.id));
    const personal = q.pulseflowPolicy === 'personal';
    return { index, track: q.tracks[index], reasons: [isLive(q) ? 'Живой Smart DJ' : personal ? 'История + PulseFlow' : policy === 'contrast' ? 'PulseFlow: contrast' : 'PulseFlow: smooth'],
      explanation: { method: isLive(q) ? 'pulseflow-uniform' : personal ? 'frequency-pulseflow-ties' : 'pulseflow-clap-faiss', policy,
        ...(personal ? {plays:q.completedCounts().get(String(row.id)) || 0} : {}), score: row.score, seedId: seed.id, referenceTitle: seed.title } };
  }
  // Uniform sampling without replacement using the queue's existing seeded RNG.
  // Copy the RNG cursor so preview/prefetch never advances real navigation.
  function sample(rows, q, length) {
    const remaining = [...new Map(rows.map(row=>[String(row.id),row])).values()], selected = [];
    const rng = { smartSeed:q.smartSeed, smartStep:q.smartStep, randomChoice:q.randomChoice };
    while (remaining.length && selected.length < length) {
      const index = rng.randomChoice(remaining.map((_,i)=>i));
      selected.push(remaining.splice(index,1)[0]); rng.smartStep++;
    }
    return selected;
  }
  async function next(q, query = request) {
    if(q.previewChoice()){const track=q.next();return {trackId:track?.id??null,navigation:q.navigationSnapshot()};}
    q.forwardHistory = q.forwardHistory.filter(i => !q.isExcluded(q.tracks[i]?.id));
    if (q.loopMode === 'one' || q.forwardHistory.length || !q.smartCandidates().length) {
      // These are navigation operations, not recommendations.
      const track = q.next({ fallback: true });
      return { trackId: track?.id ?? null, navigation: q.navigationSnapshot() };
    }
    const policy = policyOf(q), vibeKey = JSON.stringify(q.pulseflowVibe || null);
    const counts = q.completedCounts(), personal = q.pulseflowPolicy === 'personal';
    let candidates = q.smartCandidates().map(i => String(q.tracks[i].id));
    const allEligible = new Set(candidates);
    // Lexicographic order: the measured completed-listen count is primary.
    // Unmodified PulseFlow orders only equal-count candidates. No coefficients.
    if (personal) {
      const best = Math.max(...candidates.map(id => counts.get(id) || 0));
      candidates = candidates.filter(id => (counts.get(id) || 0) === best);
    }
    const eligible = new Set(candidates);
    let plan = q.pulseflowPlan;
    if (!plan || plan.policy !== policy || plan.vibeKey !== vibeKey || Boolean(plan.personal) !== personal) plan = null;
    if (isLive(q) && !plan?.preview) plan = null;
    if (plan) plan = { ...plan, remaining: plan.remaining.filter(t => allEligible.has(String(t.id))) };
    // A Home playlist was explicitly chosen by the listener: finish its displayed
    // order, then continue normal selection over the rest of the library.
    if (plan?.preview) for (const row of plan.remaining) eligible.add(String(row.id));
    if (plan?.remaining.length && !eligible.has(String(plan.remaining[0].id))) plan = null;
    if (!plan?.remaining.length) {
      const seed = seedOf(q, q.tracks);
      if (!seed) return { trackId: null, navigation: q.navigationSnapshot() };
      // Upstream default playlist length is 20. Keep the returned sequence:
      // requesting length=1 on every Next would erase the contrast alternation.
      const result = await query({ seed: String(seed.id), eligible: [...eligible], length: 20, policy });
      const rows = isLive(q) ? sample(result.tracks.filter(row=>eligible.has(String(row.id))), q, 1) : result.tracks;
      plan = { seed, policy, personal, vibeKey, remaining: rows };
    }
    const row = plan.remaining[0];
    if (!row) throw new Error('No indexed audio in the eligible queue');
    const chosen = choice(q, row, plan.seed, policy);
    if (chosen.index < 0 || !eligible.has(String(row.id))) throw new Error('PulseFlow returned an ineligible track');
    q.pulseflowPlan = { ...plan, remaining: plan.remaining.slice(1) };
    q.smartChoose = () => chosen;
    const track = q.next();
    return { trackId: track?.id ?? null, navigation: q.navigationSnapshot() };
  }
  async function mix(tracks, q, length, query = request) {
    const seed = seedOf(q, tracks); if (!seed) return [];
    const policy = policyOf(q);
    const allowed = tracks.filter(t => !q.isExcluded(t.id) && String(t.id) !== String(seed.id));
    if (!allowed.length) return [];
    if (q.pulseflowPolicy === 'personal') {
      const counts = q.completedCounts(), levels = [...new Set(allowed.map(t => counts.get(String(t.id)) || 0))].sort((a,b)=>b-a);
      const result = [];
      for (const count of levels) {
        const group = allowed.filter(t => (counts.get(String(t.id)) || 0) === count);
        const selected = await query({seed:String(seed.id),eligible:group.map(t=>String(t.id)),length:length-result.length,policy});
        for (const row of selected.tracks) {
          const track=group.find(t=>String(t.id)===String(row.id));
          if(!track)throw new Error('PulseFlow returned an ineligible track');
          const chosen=choice(q,row,seed,policy);
          result.push({track,decision:{fromTrack:seed,toTrack:track,reasons:chosen.reasons,explanation:chosen.explanation}});
        }
        if(result.length>=length)break;
      }
      return result;
    }
    const result = await query({ seed: String(seed.id), eligible: allowed.map(t => String(t.id)), length: isLive(q) ? 20 : length, policy });
    const library = new Map(allowed.map(t => [String(t.id), t]));
    const rows = isLive(q) ? sample(result.tracks.filter(row=>library.has(String(row.id))),q,length) : result.tracks;
    return rows.map(row => {
      const track = library.get(String(row.id));
      if (!track) throw new Error('PulseFlow returned an ineligible track');
      const chosen = choice(q, row, seed, policy);
      return { track, decision: { fromTrack: seed, toTrack: track, reasons: chosen.reasons, explanation: chosen.explanation } };
    });
  }
  return { next, mix };
});
