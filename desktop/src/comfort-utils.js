(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ComfortUtils = factory();
})(globalThis, () => {
  const DEFAULT_TITLE_OPTIONS = Object.freeze({ sites: true, underscores: true, extraSites: '' });
  let lastOptions, lastSignature, normalizedOptions = DEFAULT_TITLE_OPTIONS;
  let compiledExtra = '', sitePatterns;
  const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function normalizeTitleOptions(options = DEFAULT_TITLE_OPTIONS) {
    if (!options || typeof options !== 'object') options = DEFAULT_TITLE_OPTIONS;
    const raw = Array.isArray(options.extraSites) ? options.extraSites.slice(0, 32).join('\n') : String(options.extraSites || '').slice(0, 4096);
    const signature = `${options.sites !== false}:${options.underscores !== false}:${raw}`;
    if (options === lastOptions && signature === lastSignature) return normalizedOptions;
    const domains = [];
    for (const item of raw.split(/[,;\s]+/)) {
      const domain = item.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
      if (domain.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(domain) && !domains.includes(domain)) domains.push(domain);
      if (domains.length === 32) break;
    }
    lastOptions = options;lastSignature = signature;
    normalizedOptions = { sites: options.sites !== false, underscores: options.underscores !== false, extraSites: domains.join('\n') };
    return normalizedOptions;
  }

  function patterns(extraSites) {
    if (sitePatterns && compiledExtra === extraSites) return sitePatterns;
    const generic = '[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:com|net|org|ru|su|cc|me|top|info|biz|xyz|site|online|club|pro|fun|io|ua|kz)';
    const custom = extraSites ? '|' + extraSites.split('\n').map(escapePattern).join('|') : '';
    const domain = '(?:https?:\\/\\/|www\\.)?(?:' + generic + custom + ')(?:\\/[^\\s\\[\\]()]*)?';
    compiledExtra = extraSites;
    sitePatterns = {
      bracket: new RegExp('[\\[(]\\s*' + domain + '\\s*[\\])]', 'gi'),
      prefix: new RegExp('^\\s*' + domain + '(?:[\\s_]*[-–—|:]+[\\s_]*|[\\s_]+)', 'i'),
      suffix: new RegExp('(?:[\\s_]*[-–—|:]+[\\s_]*|[\\s_]+)' + domain + '\\s*$', 'i')
    };
    return sitePatterns;
  }

  function cleanTitle(title, options) {
    const original = String(title || '');
    if (!original || original.length > 8192) return original;
    const config = normalizeTitleOptions(options);
    let cleaned = original;
    if (config.sites) {
      const sites = patterns(config.extraSites);
      cleaned = cleaned.replace(sites.bracket, ' ')
        .replace(/\b(?:https?:\/\/|www\.)[^\s\[\]()]+/gi, ' ');
      // Download names sometimes contain both a leading and a trailing source.
      for (let i = 0; i < 3; i++) {
        const next = cleaned.replace(sites.prefix, '').replace(sites.suffix, '');
        if (next === cleaned) break;
        cleaned = next;
      }
      if (cleaned !== original) cleaned = cleaned.replace(/^[\s_\-–—|:]+|[\s_\-–—|:]+$/g, '');
    }
    if (config.underscores) cleaned = cleaned.replace(/_+/g, ' ');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned || original;
  }
  function releaseSummary(body) {
    return String(body || '').replace(/```[\s\S]*?```/g, '')
      .split('\n').map(line => line.replace(/^\s*[#*>-]+\s*/, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*`]/g, '').trim())
      .filter(line => line && !/^https?:\/\/|SHA256|\.exe$|\.zip$/i.test(line))
      .slice(0, 5).join('\n').slice(0, 700);
  }
  return { cleanTitle, normalizeTitleOptions, releaseSummary };
});
