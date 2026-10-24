/* Честный рекомендатор: только Граф, Звук, Лайки и Ранг. БЕЗ ШТРАФОВ ЗА СКИПЫ. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TasteModel = factory();
})(globalThis, () => {
  const Sound = typeof module === 'object' && module.exports ? require('./audio-profile') : globalThis.AudioProfile;

  class TasteModel {
    constructor(tracks = [], plays = [], now = Date.now(), audioProfiles = {}, options = {}) {
      this.tracks = tracks;
      this.now = now;
      this.excluded = options.excludedTracks || new Set();
      this.audioProfiles = audioProfiles || {};
      
      // 1. Собираем историю (связь строим, если послушал хотя бы 30 сек или закончил трек)
      this.history = plays.filter(p => p && p.track).map(p => {
        const heard = Number(p.media_heard ?? p.heard) || 0;
        const finished = p.finished === 1 || p.finished === true || p.completed === 1 || p.completed === true;
        // Мгновенный скип (меньше 30 секунд) не создает связь в графе
        const isQuickSkipped = !finished && heard < 30000;
        return {
          id: String(p.track),
          started: Number(p.started || p.timestamp || 0),
          skipped: isQuickSkipped 
        };
      }).sort((a, b) => a.started - b.started);

      // 2. Граф (Кто играл после кого, считаем количество раз)
      this.nextMap = new Map();
      for (let i = 0; i < this.history.length - 1; i++) {
        const current = this.history[i].id;
        const next = this.history[i + 1].id;
        // Связь строим только если трек не был скипнут мгновенно (хотя бы чуть-чуть послушал)
        if (current !== next && !this.history[i].skipped) {
          if (!this.nextMap.has(current)) this.nextMap.set(current, new Map());
          const transitions = this.nextMap.get(current);
          transitions.set(next, (transitions.get(next) || 0) + 1);
        }
      }

      // 3. Считаем прослушивания для Ранга
      this.playCounts = new Map();
      for (const p of plays) {
        if (p && p.track) {
          const id = String(p.track);
          this.playCounts.set(id, (this.playCounts.get(id) || 0) + 1);
        }
      }
      
      const sortedPlays = Array.from(this.playCounts.entries()).sort((a, b) => b[1] - a[1]);
      this.playRanks = new Map();
      sortedPlays.forEach(([id], index) => {
        this.playRanks.set(id, { rank: index, total: sortedPlays.length });
      });
    }

    // Главный метод выбора
    choose(currentTrack, candidates, cache = {}, context = {}) {
      const excluded = context.excludedTracks || this.excluded;
      let pool = candidates.filter(t => !excluded.has(String(t.id)));
      if (!pool.length) return null;

      const currentId = currentTrack ? String(currentTrack.id) : null;
      if (currentId && pool.some(t => String(t.id) !== currentId)) {
        pool = pool.filter(t => String(t.id) !== currentId);
      }

      // Оцениваем каждый трек
      const scored = pool.map(track => {
        return { track, ...this.score(currentTrack, track, cache, context) };
      });

      // Сортируем от лучшего к худшему
      scored.sort((a, b) => b.score - a.score);

      // Анти-пузырь: берем топ-20% (минимум 5 треков, но не больше доступных) и выбираем случайного
      const topCount = Math.max(1, Math.min(scored.length, Math.max(5, Math.ceil(scored.length * 0.2))));
      const finalists = scored.slice(0, topCount);
      
      return finalists[Math.floor(Math.random() * finalists.length)];
    }

    // Метод оценки (ТОЛЬКО ПЛЮСЫ, НИКАКИХ МИНУСОВ)
    score(current, candidate, cache = {}, context = {}) {
      let score = 0;
      let reasons = [];
      const currentId = current ? String(current.id) : null;
      const candidateId = String(candidate.id);

      // 1. Граф сессий (считаем реальные повторения)
      let transitionCount = 0;
      if (currentId && this.nextMap.has(currentId)) {
        transitionCount = this.nextMap.get(currentId).get(candidateId) || 0;
      }

      if (transitionCount >= 2) {
        score += 50;
        reasons.push('Часто играет после текущего трека');
      } else if (transitionCount === 1) {
        score += 15;
        reasons.push('Играл после текущего трека');
      }

      // 2. Звучание (Спектр) или Вайб
      const candidateProfile = this.audioProfiles[candidateId] || (Sound?.get ? Sound.get(this.audioProfiles, candidate, true) : null);
      const vibeProfile = context.vibeProfile;
      const currentProfile = current ? (this.audioProfiles[currentId] || (Sound?.get ? Sound.get(this.audioProfiles, current, true) : null)) : null;

      if (Sound && candidateProfile && (Sound.texture(candidateProfile) || Sound.valid(candidateProfile))) {
        if (vibeProfile && (Sound.texture(vibeProfile) || Sound.valid(vibeProfile))) {
          const sim = Sound.similarity(vibeProfile, candidateProfile, true) || 0;
          if (sim > 0.6) {
            score += (sim * 30);
            reasons.push('Звучание сохранённого вайба');
          }
        } else if (currentProfile && (Sound.texture(currentProfile) || Sound.valid(currentProfile))) {
          const sim = Sound.similarity(currentProfile, candidateProfile, true) || 0;
          if (sim > 0.6) {
            score += (sim * 30);
            reasons.push('Похоже по звучанию');
          }
        }
      }

      // 3. Лайки
      if (candidate.favorite === 1 || candidate.favorite === true) {
        score += 20;
        reasons.push('Вы лайкнули этот трек');
      }

      // 4. Ранг прослушиваний
      const rankInfo = this.playRanks.get(candidateId);
      if (rankInfo) {
        const isTop1 = rankInfo.total > 10 ? (rankInfo.rank / rankInfo.total < 0.01) : rankInfo.rank === 0;
        const isTop5 = rankInfo.total > 10 ? (rankInfo.rank / rankInfo.total < 0.05) : rankInfo.rank < 3;
        if (isTop1) {
          score += 25;
          reasons.push('Твой самый частый трек');
        } else if (isTop5) {
          score += 15;
          reasons.push('Часто слушаемый трек');
        }
      }

      return {
        track: candidate,
        score: Math.max(0, score),
        bpm: candidate.bpm || null,
        dist: null,
        reasons: reasons.length ? reasons.slice(0, 2) : ['Случайный трек из библиотеки'],
        probability: score / 100,
        affinity: 0,
        soundSimilarity: null,
        soundPreference: 0,
        skipPenalty: 0,
        rejectionPenalty: 0,
        explanation: { 
          referenceTitle: reasons[0] || 'Случайный трек', 
          referenceBpm: null, 
          liked: candidate.favorite === 1 || candidate.favorite === true
        }
      };
    }

    canReference() { return true; }
    rankCandidates(pool) { return pool; }
  }

  TasteModel.artistIdentity = track => track?.artist || '';
  TasteModel.recordingIdentity = track => (track?.artist && track?.title) ? JSON.stringify([track.artist, track.title]) : '';
  TasteModel.knownBpm = (track, cache) => {
    const n = Number(cache?.[track?.id] || track?.bpm);
    return n >= 40 && n <= 240 ? n : null;
  };
  
  return TasteModel;
});
