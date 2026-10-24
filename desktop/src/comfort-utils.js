(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ComfortUtils = factory();
})(globalThis, () => {
  function cleanTitle(title) {
    const original = String(title || '');
    const domain = '(?:https?:\\/\\/|www\\.)?[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:com|net|org|ru|su|cc|me|top|info|biz|xyz)(?:\\/[^\\s\\]\\)]+)?';
    const cleaned = original
      .replace(new RegExp('\\s*[\\[(]\\s*' + domain + '\\s*[\\])]\\s*$', 'i'), '')
      .replace(new RegExp('\\s+[-–—|]\\s*' + domain + '\\s*$', 'i'), '')
      .replace(/\s+(?:https?:\/\/|www\.)\S+\s*$/i, '').trim();
    return cleaned || original;
  }
  function releaseSummary(body) {
    return String(body || '').replace(/```[\s\S]*?```/g, '')
      .split('\n').map(line => line.replace(/^\s*[#*>-]+\s*/, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*`]/g, '').trim())
      .filter(line => line && !/^https?:\/\/|SHA256|\.exe$|\.zip$/i.test(line))
      .slice(0, 5).join('\n').slice(0, 700);
  }
  return { cleanTitle, releaseSummary };
});
