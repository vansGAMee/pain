/* Local listening presets shared by desktop and Android. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./audio-profile'), require('./taste-model'));
  else root.MoodMix = factory(root.AudioProfile, root.TasteModel);
})(globalThis, (Audio, Taste) => {
  const presets = [
    {id: 'calm', ru: ['Спокойно', 'Мягкое, неторопливое звучание'], en: ['Calm', 'Soft, unhurried sounds'],
      tags: 'ambient|dark ambient|drone|new age|meditation|relaxation|chillout|sleep|soft piano|эмбиент|эмбиэнт|медитация|чиллаут'},
    {id: 'focus', ru: ['Фокус', 'Инструментальная музыка и ровный фон'], en: ['Focus', 'Instrumentals and steady background music'],
      tags: 'lo fi|lofi|lo fi hip hop|chillhop|instrumental hip hop|minimalism|minimal music|binaural|study music|лофай|лоу фай|чиллхоп',
      general: 'instrumental|classical|klassik|neoclassical|инструментальная музыка|классика|классическая музыка|неоклассика'},
    {id: 'melancholy', ru: ['Меланхолия', 'От задумчивых баллад до дарквейва'], en: ['Melancholy', 'From reflective ballads to darkwave'],
      tags: 'melancholic|melancholy|sad|sadcore|slowcore|ballad|darkwave|dark wave|coldwave|cold wave|gothic rock|doom metal|funeral doom metal|меланхолия|грустная музыка|грустная|баллада|дарквейв|колдвейв|готик рок|дум метал',
      general: 'post punk|постпанк|пост панк'},
    {id: 'dance', ru: ['Танцы', 'Диско, хаус и танцевальная поп-музыка'], en: ['Dance', 'Disco, house and dance pop'],
      tags: 'dance|dance music|dance pop|dance rock|dance punk|disco|nu disco|house|deep house|tech house|progressive house|electro house|techno|trance|edm|eurodance|electro swing|funk|soul & funk|synth funk|reggaeton|танцевальная|танцевальная музыка|диско|хаус|техно|транс|фанк|евродэнс|дэнс панк',
      general: 'electropop|электропоп'},
    {id: 'drive', ru: ['Драйв', 'Напор, быстрый темп и тяжёлые гитары'], en: ['Drive', 'Fast tempos and heavy guitars'],
      tags: 'hard rock|heavy metal|speed metal|power metal|punk rock|pop punk|drum and bass|drum & bass|хард рок|хеви метал|панк рок|поп панк|драм энд бейс',
      general: 'metal|punk|grunge|garage rock|метал|металл|панк|гранж'},
    {id: 'night', ru: ['Ночной город', 'Синтвейв, трип-хоп и приглушённый бит'], en: ['Night drive', 'Synthwave, trip-hop and muted beats'],
      tags: 'synthwave|retrowave|outrun|trip hop|witch house|vaporwave|future garage|illbient|синтвейв|ретровейв|трип хоп|вейпорвейв',
      general: 'synth pop|synthpop|downtempo|даунтемпо|синти поп'},
    {id: 'cinema', ru: ['Кино без экрана', 'Саундтреки и музыка с размахом'], en: ['Cinema without a screen', 'Soundtracks and sweeping arrangements'],
      tags: 'soundtrack|film score|filmmusik|filme|videospiele|video game music|trailer music|cinematic|orchestral|саундтрек|музыка из игр|музыка из кино|оркестровая музыка',
      general: 'post rock|symphonic metal|progressive rock|пост рок|симфонический метал|прогрессивный рок'},
    {id: 'unplugged', ru: ['У костра', 'Акустика, фолк и песни под гитару'], en: ['Around the fire', 'Acoustic, folk and stripped-back songs'],
      tags: 'acoustic|acoustic pop|acoustic folk|unplugged|folk|contemporary folk|indie folk|americana|bluegrass|singer songwriter|singer & songwriter|акустика|акустический фолк|фолк|авторская песня',
      general: 'folk rock|country|фолк рок|кантри'},
    {id: 'warmup', ru: ['Мягкий разгон', 'От ровного ритма к более быстрому'], en: ['Gradual warm-up', 'From a steady beat to a faster pace'],
      tags: 'running|warmup|jogging|workout|бег|разминка|тренировка',
      general: 'pop rock|indie rock|alternative rock|new wave|поп рок|инди рок|альтернативный рок|нью вейв'},
    {id: 'release', ru: ['Выпустить пар', 'Хардкор, тяжёлые риффы и плотные ударные'], en: ['Let off steam', 'Hardcore, heavy riffs and pounding drums'],
      tags: 'thrash metal|death metal|black metal|industrial metal|metalcore|hardcore punk|hardstyle|breakcore|grindcore|трэш метал|дэт метал|блэк метал|металкор|хардкор панк|брейккор',
      general: 'alternative metal|nu metal|industrial rock|альтернативный метал|ню метал|индастриал рок'},
    {id: 'curious', ru: ['Странные звуки', 'Ломаные ритмы и необычная фактура'], en: ['Strange sounds', 'Offbeat rhythms and unusual textures'],
      tags: 'experimental|avant garde|idm|glitch|sound collage|krautrock|electroacoustic|chiptune|экспериментальная музыка|авангард|глитч|краутрок|чиптюн',
      general: 'experimental rock|art rock|art pop|экспериментальный рок|арт рок|арт поп'},
    {id: 'sunny', ru: ['Солнечно', 'Лёгкий поп, регги и тёплый грув'], en: ['Sunny side', 'Light pop, reggae and warm grooves'],
      tags: 'reggae|ska|afrobeat|afrobeats|bossa nova|tropicalia|sunshine pop|twee pop|регги|ска|афробит|босса нова',
      general: 'indie pop|dream pop|soul|britpop|europop|инди поп|дрим поп|соул|брит поп'}
  ].map(mood => ({...mood, tags: new Set(mood.tags.split('|')), general: new Set(mood.general?.split('|'))}));

  function genreTags(...sources) {
    return new Set(sources.flat().filter(value => typeof value === 'string').flatMap(value =>
      value.normalize('NFKC').toLowerCase().replaceAll('ё', 'е').split(/[;,/|\u0000]+/)
        .map(tag => tag.replace(/[\p{Pd}_]+/gu, ' ').replace(/\s+/g, ' ').trim())
    ));
  }

  function soundScores(profile, bpm) {
    if (!profile) return {};
    const [, bass, , high, brightness, flatness] = profile.vector;
    const dynamics = Audio.variation(profile);
    const highVariation = dynamics?.[3] ?? 1;
    const transient = Audio.detail(profile)?.[6];
    const slow = !bpm || bpm <= 112;
    // Require multiple measured properties when genre tags are absent.
    // Tempo and spectral measurements alone cannot identify melancholy.
    return {
      calm: slow && high < .075 && brightness < .09 && highVariation < .12
        ? 1 - brightness * 5 : 0,
      focus: high < .12 && highVariation < .065 && transient < .37
        ? 1 - highVariation * 6 : 0,
      dance: bpm >= 110 && bpm <= 145 && bass >= .55 && transient >= .38
        ? 1 - Math.abs(126 - bpm) / 60 : 0,
      drive: high >= .105 && brightness >= .095 && (bpm >= 130 || (flatness >= .042 && transient >= .41))
        ? .55 + Math.min(.3, brightness * 1.4) : 0,
      release: high >= .16 && brightness >= .125 && flatness >= .065 && transient >= .4
        ? .85 + Math.min(.12, flatness) : 0,
      night: bpm >= 65 && bpm <= 112 && bass >= .6 && high < .085 && transient >= .36
        ? .6 + (bass - .6) * .7 : 0,
      warmup: bpm >= 90 && bpm <= 155 && high >= .06 && transient >= .34 && transient <= .43
        ? .53 + Math.min(.15, brightness) : 0
    };
  }

  function tagScore(mood, tags) {
    let score = 0;
    for (const tag of tags) {
      if (mood.tags.has(tag)) return 3;
      if (mood.general.has(tag)) score = 1.4;
    }
    return score;
  }

  function order(mood, primary, secondary) {
    const byScore = (a, b) => b.score - a.score || a.id.localeCompare(b.id);
    const candidates = [...primary.sort(byScore), ...secondary.sort(byScore)];
    const seen = new Set();
    const unique = candidates.filter(row => {
      if (seen.has(row.recording)) return false;
      seen.add(row.recording);
      return true;
    });
    const limit = Math.min(40, Math.max(5, primary.length));
    const selected = [];
    let artist = '';
    while (unique.length && selected.length < limit) {
      const top = unique[0];
      const alternative = top.artist && top.artist === artist
        ? unique.findIndex(row => row.primary === top.primary && row.score >= top.score - .65 && row.artist !== artist) : -1;
      const [row] = unique.splice(Math.max(0, alternative), 1);
      selected.push(row);
      artist = row.artist;
    }
    if (mood.id === 'warmup') selected.sort((a, b) => (a.bpm || Infinity) - (b.bpm || Infinity));
    return selected.map(row => row.id);
  }

  function build(tracks, {genres = {}, profiles, tempos = {}, excluded = [], lang = 'en'} = {}) {
    const ranked = new Map(presets.map(mood => [mood.id, {primary: [], secondary: []}]));
    const seen = new Set(excluded.map(String));
    for (const track of tracks) {
      if (track?.id == null || String(track.id) === '' || seen.has(String(track.id))) continue;
      const id = String(track.id);
      seen.add(id);
      const local = genreTags(track.genre);
      const cached = genreTags(Object.hasOwn(genres, id) ? genres[id] : []);
      const tempo = Number((Object.hasOwn(tempos, id) ? tempos[id] : null) || track.bpm);
      const bpm = tempo >= 55 && tempo <= 220 ? tempo : 0;
      const scores = soundScores(Audio.get(profiles, track), bpm);
      const matches = [];
      for (const mood of presets) {
        const tag = Math.max(tagScore(mood, local) * 1.2, tagScore(mood, cached));
        const sound = scores[mood.id] || 0;
        if (tag || sound) matches.push({mood: mood.id, tag, sound, score: tag + sound});
      }
      if (!matches.length) continue;
      matches.sort((a, b) => b.score - a.score);
      const [best, ...alternatives] = matches;
      const base = {id, bpm, recording: Taste.recordingIdentity(track) || id, artist: String(track.artist || '').trim().toLowerCase()};
      ranked.get(best.mood).primary.push({...base, score: best.score, primary: true});
      for (const match of alternatives) {
        // Short mixes can borrow explicit matches or nearby acoustic matches from untagged tracks.
        if (match.tag >= 3 || (!best.tag && match.sound >= .67 && best.score - match.score <= .18)) {
          ranked.get(match.mood).secondary.push({...base, score: match.score, primary: false});
        }
      }
    }
    return presets.map(mood => {
      const [label, description] = lang === 'ru' ? mood.ru : mood.en;
      const {primary, secondary} = ranked.get(mood.id);
      const ids = order(mood, primary, secondary);
      return {id: mood.id, label, description, ids};
    });
  }

  return {build};
});
